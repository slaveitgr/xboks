import { describe, expect, it, vi } from 'vitest';
import { KeyringSupport } from './keyring.js';

function fixture(options: { owned?: boolean; locked?: boolean; alias?: string; names?: string[]; enabled?: string; fail?: boolean;
  provider?: 'kwallet' | 'ksecretd' | 'other' | 'unknown'; config?: Record<string, string>; configFailure?: string } = {}) {
  let owned = options.owned ?? false;
  const execute = vi.fn(async (command: string, args: string[]) => {
    if (options.fail) throw Error('private provider text and identifiers');
    if (command.startsWith('kreadconfig')) {
      if (command === options.configFailure || options.configFailure === 'all') throw Error('No KConfig client');
      return options.config?.[`${args[3]}/${args[5]}`] ?? options.enabled ?? 'UNSET';
    }
    const reply = (type: string, value: unknown) => JSON.stringify({ type, data: [value] });
    if (args.includes('NameHasOwner')) return reply('b', owned);
    if (args.includes('ListActivatableNames')) return reply('as', options.names ?? ['org.freedesktop.secrets']);
    if (args.includes('ReadAlias')) return reply('o', options.alias ?? '/org/freedesktop/secrets/collection/default');
    if (args.includes('Get')) return reply('v', { type: 'b', data: options.locked ?? false });
    if (args.includes('StartServiceByName')) { owned = true; return reply('u', 1); }
    throw Error('Unexpected command');
  });
  const identify = vi.fn(async () => options.provider ?? 'unknown');
  const startProvider = vi.fn(async () => { owned = true; });
  return { execute, identify, startProvider, support: new KeyringSupport({ XDG_CURRENT_DESKTOP: 'gamescope', DISPLAY: ':1' }, execute, 'linux', identify, { startProvider }) };
}

describe('safe keyring setup (#212, #234)', () => {
  it.each(['kwallet', 'ksecretd'] as const)('automatically starts known enabled %s in Game Mode', async provider => {
    const f = fixture({ provider });
    expect((await f.support.startForStartup()).state).toBe('ready');
    expect(f.startProvider).toHaveBeenCalledOnce();
  });
  it.each(['other', 'unknown'] as const)('leaves stopped %s providers to explicit activation', async provider => {
    const f = fixture({ provider });
    expect((await f.support.startForStartup()).state).toBe('stopped');
    expect(f.startProvider).not.toHaveBeenCalled();
    expect(f.execute.mock.calls.some(([, args]) => args.includes('StartServiceByName'))).toBe(false);
    expect((await f.support.start()).state).toBe('ready');
  });
  it.each([{ enabled: 'false' }, { config: { 'org.freedesktop.secrets/apiEnabled': 'false' } }, { configFailure: 'all' }])('does not automatically activate disabled or unverifiable KDE: %j', async config => {
    const f = fixture({ provider: 'kwallet', ...config });
    expect((await f.support.startForStartup()).state).not.toBe('ready');
    expect(f.startProvider).not.toHaveBeenCalled();
  });
  it('keeps Desktop startup metadata-only, even with a locked existing wallet', async () => {
    const f = fixture({ owned: true, locked: true });
    const unlock = vi.fn(async () => 'ready');
    const support = new KeyringSupport({ XDG_CURRENT_DESKTOP: 'KDE' }, f.execute, 'linux', f.identify, { canUnlock: () => true, unlock });
    expect((await support.startForStartup()).state).toBe('locked');
    expect(unlock).not.toHaveBeenCalled();
  });
  it.each(['ready', 'cancelled', 'timed-out', 'unavailable'])('uses the native password flow once at startup, result=%s', async result => {
    let locked = true;
    const f = fixture({ owned: true });
    const execute = (command: string, args: string[]) => args.includes('Get')
      ? Promise.resolve(JSON.stringify({ type: 'v', data: [{ type: 'b', data: locked }] })) : f.execute(command, args);
    const unlock = vi.fn(async () => { if (result === 'ready') locked = false; return result; });
    const support = new KeyringSupport({ XDG_CURRENT_DESKTOP: 'gamescope' }, execute, 'linux', f.identify, { canUnlock: () => true, unlock });
    const first = support.startForStartup();
    expect(support.start()).toBe(first);
    expect((await first).state).toBe(result === 'ready' ? 'ready' : 'locked');
    expect(unlock).toHaveBeenCalledOnce();
    expect(f.startProvider).not.toHaveBeenCalled();
  });
  it.each(['ready','cancelled','timed-out','unavailable'])('keeps explicit unlock result %s honest and never starts a second provider', async result => {
    let locked = true;
    const base = fixture({ owned: true, locked: true });
    const execute = vi.fn(async (command: string, args: string[]) => args.includes('Get')
      ? JSON.stringify({ type: 'v', data: [{ type: 'b', data: locked }] }) : base.execute(command, args));
    const unlock = vi.fn(async () => { if (result === 'ready') locked = false; return result; });
    const support = new KeyringSupport({ XDG_CURRENT_DESKTOP: 'gamescope' }, execute, 'linux', base.identify,
      { canUnlock: () => true, unlock, startProvider: base.startProvider });
    expect(await support.check()).toMatchObject({ state: 'locked', canUnlock: true });
    expect(unlock).not.toHaveBeenCalled();
    expect(await support.start()).toMatchObject({ state: result === 'ready' ? 'ready' : 'locked' });
    expect(unlock).toHaveBeenCalledOnce(); expect(base.startProvider).not.toHaveBeenCalled();
    expect(base.identify).not.toHaveBeenCalled();
  });
  it('coalesces unlock requests while checks remain metadata-only', async () => {
    const base = fixture({ owned: true, locked: true });
    let finish!: (state: string) => void;
    const unlock = vi.fn(() => new Promise<string>(resolve => { finish = resolve; }));
    const support = new KeyringSupport({}, base.execute, 'linux', base.identify, { canUnlock: () => true, unlock });
    const first = support.start(), second = support.start();
    expect(first).toBe(second); expect(support.busy).toBe(true); expect(support.check()).toBe(first);
    await vi.waitFor(() => expect(unlock).toHaveBeenCalledOnce());
    finish('cancelled'); await first;
    expect(support.busy).toBe(false); expect((await support.check()).state).toBe('locked');
  });
  it('does not change Desktop activation or invoke a scoped KDE process on other providers', async () => {
    const base = fixture({ provider: 'ksecretd' });
    const support = new KeyringSupport({ XDG_CURRENT_DESKTOP: 'KDE' }, base.execute, 'linux', base.identify, { startProvider: base.startProvider });
    expect((await support.start()).state).toBe('ready');
    expect(base.startProvider).not.toHaveBeenCalled();
    expect(base.execute.mock.calls.some(([,args]) => args.includes('StartServiceByName'))).toBe(true);
  });
  it.each([
    ['kwallet', ['org.freedesktop.secrets']], ['ksecretd', ['org.freedesktop.secrets']],
    ['kwallet', ['org.freedesktop.secrets', 'org.kde.kwalletd6']],
    ['ksecretd', ['org.freedesktop.secrets', 'org.kde.secretservicecompat']],
  ] as const)('detects disabled %s behind the standard activation name (%j)', async (provider, names) => {
    const { support, execute, identify } = fixture({ provider, names: [...names], enabled: 'false' });
    expect(await support.check()).toMatchObject({ state: 'disabled', canStart: false });
    expect(await support.start()).toMatchObject({ state: 'disabled', canStart: false });
    expect(identify).toHaveBeenCalled();
    expect(execute.mock.calls.some(([, args]) => args.includes('StartServiceByName'))).toBe(false);
  });
  it.each(['other', 'unknown'] as const)('does not block a stopped %s provider due to unrelated disabled KWallet settings', async provider => {
    const { support, execute } = fixture({ provider, names: ['org.freedesktop.secrets', 'org.kde.kwalletd6'], enabled: 'false' });
    expect(await support.start()).toMatchObject({ state: 'ready', canStart: false });
    expect(execute.mock.calls.some(([command]) => command.startsWith('kreadconfig'))).toBe(false);
    expect(execute.mock.calls.filter(([, args]) => args.includes('StartServiceByName'))[0][1].slice(-2)).toEqual(['org.freedesktop.secrets', '0']);
  });
  it.each([true, false])('never attributes or starts another provider when an existing wallet is locked=%s', async locked => {
    const { support, execute, identify } = fixture({ owned: true, locked, provider: 'kwallet', enabled: 'false' });
    expect((await support.start()).state).toBe(locked ? 'locked' : 'ready');
    expect(identify).not.toHaveBeenCalled();
    expect(execute.mock.calls.some(([command, args]) => command.startsWith('kreadconfig') || args.includes('StartServiceByName'))).toBe(false);
  });
  it.each(['kwallet', 'ksecretd'] as const)('checks the Secret Service API flag for %s, not only its wallet enabled flag', async provider => {
    const { support, execute } = fixture({ provider, config: { 'org.freedesktop.secrets/apiEnabled': 'false' } });
    expect(await support.start()).toMatchObject({ state: 'disabled', canStart: false });
    const reads = execute.mock.calls.filter(([command]) => command.startsWith('kreadconfig'));
    expect(reads.map(([, args]) => args[3])).toEqual([provider === 'kwallet' ? 'Wallet' : 'KSecretD', 'org.freedesktop.secrets']);
  });
  it('does not apply the legacy Wallet disabled flag to modern ksecretd', async () => {
    const { support } = fixture({ provider: 'ksecretd', config: { 'Wallet/Enabled': 'false' } });
    expect((await support.start()).state).toBe('ready');
  });
  it.each(['UNSET', 'true', '1'])('keeps normal standard-name KDE activation working with enabled=%s', async enabled => {
    const { support, execute } = fixture({ provider: 'kwallet', enabled });
    expect((await support.check()).state).toBe('stopped');
    expect((await support.start()).state).toBe('ready');
    expect(JSON.stringify(execute.mock.calls)).not.toMatch(/kwriteconfig|Unlock|GetSecret|SearchItems|CreateCollection|SetSecret/);
  });
  it('falls back to kreadconfig5 when kreadconfig6 is absent', async () => {
    const { support, execute } = fixture({ provider: 'kwallet', enabled: 'false', configFailure: 'kreadconfig6' });
    expect((await support.start()).state).toBe('disabled');
    expect(execute.mock.calls.map(([command]) => command)).toContain('kreadconfig5');
  });
  it('does not block activation when provider configuration clients are unavailable', async () => {
    const { support } = fixture({ provider: 'kwallet', configFailure: 'all' });
    expect((await support.start()).state).toBe('ready');
  });
  it('treats failed provider attribution as unknown without exposing its error or changing authentication', async () => {
    const f = fixture({ enabled: 'false' });
    const support = new KeyringSupport({}, f.execute, 'linux', async () => { throw Error('private activation metadata'); });
    expect((await support.check()).state).toBe('stopped');
    expect((await support.start()).state).toBe('ready');
    expect(JSON.stringify(f.execute.mock.calls)).not.toMatch(/kreadconfig|kwriteconfig|GetSecret|Unlock/);
  });
  it('checks only metadata without activating a service or reading credentials', async () => {
    const { support, execute } = fixture({ owned: true });
    expect(await support.check()).toMatchObject({ state: 'ready', canStart: false, gameMode: true });
    const commands = JSON.stringify(execute.mock.calls);
    expect(commands).toContain('--auto-start=no');
    expect(commands).toContain('--allow-interactive-authorization=no');
    expect(commands).not.toMatch(/StartServiceByName|Unlock|GetSecret|SearchItems|CreateCollection|GetAll|set-environment|kwriteconfig/);
  });
  it.each([true, false])('reports running wallet lock state %s honestly', async locked => {
    const { support } = fixture({ owned: true, locked });
    expect((await support.check()).state).toBe(locked ? 'locked' : 'ready');
  });
  it('distinguishes no default collection from an unlocked usable wallet', async () => {
    const { support } = fixture({ owned: true, alias: '/' });
    expect((await support.check()).state).toBe('needs-setup');
  });
  it('can explicitly start an installed provider but never claims activation alone means ready', async () => {
    const { support, execute } = fixture({ locked: true });
    expect((await support.check()).state).toBe('stopped');
    expect(execute.mock.calls.some(([, args]) => args.includes('StartServiceByName'))).toBe(false);
    expect((await support.start()).state).toBe('locked');
    expect(execute.mock.calls.filter(([, args]) => args.includes('StartServiceByName'))).toHaveLength(1);
  });
  it.each(['org.freedesktop.secrets', 'org.kde.secretservicecompat', 'org.kde.kwalletd6', 'org.kde.kwalletd5'])('starts only advertised provider %s', async name => {
    const { support, execute, startProvider } = fixture({ names: [name] });
    expect((await support.start()).state).toBe('ready');
    if (name === 'org.freedesktop.secrets') {
      const [, args] = execute.mock.calls.find(([, args]) => args.includes('StartServiceByName'))!;
      expect(args.slice(-2)).toEqual([name, '0']);
      expect(startProvider).not.toHaveBeenCalled();
    } else {
      expect(startProvider).toHaveBeenCalledWith(name.includes('compat') ? 'ksecretd' : name.endsWith('5') ? 'kwallet5' : 'kwallet', expect.any(Object), expect.any(Function));
      expect(execute.mock.calls.some(([, args]) => args.includes('StartServiceByName'))).toBe(false);
    }
  });
  it('never replaces an existing third-party provider even with KDE Wallet disabled', async () => {
    const { support, execute } = fixture({ owned: true, enabled: 'false', names: ['org.kde.kwalletd6'] });
    expect((await support.start()).state).toBe('ready');
    expect(execute.mock.calls.some(([command, args]) => command.startsWith('kreadconfig') || args.includes('StartServiceByName'))).toBe(false);
  });
  it('does not interpret UNSET as disabled or modify a disabled KDE wallet', async () => {
    for (const enabled of ['UNSET', 'true', 'false', '0']) {
      const { support, execute } = fixture({ names: ['org.kde.kwalletd6'], enabled });
      const result = await support.start();
      expect(result.state).toBe(['false', '0'].includes(enabled) ? 'disabled' : 'ready');
      expect(JSON.stringify(execute.mock.calls)).not.toMatch(/kwriteconfig|secret-tool|delete|password|reset/);
    }
  });
  it('uses KSecretD settings for modern KDE rather than disabling it with the legacy Wallet flag', async () => {
    const { support, execute } = fixture({ names: ['org.kde.secretservicecompat'] });
    await support.check();
    const reads = execute.mock.calls.filter(([command]) => command.startsWith('kreadconfig'));
    expect(reads.map(([, args]) => args[3])).toEqual(['KSecretD', 'org.freedesktop.secrets']);
  });
  it('never starts an unadvertised or absent provider', async () => {
    const { support, execute } = fixture({ names: ['unrelated.service'] });
    expect((await support.start()).state).toBe('missing');
    expect(execute.mock.calls.some(([, args]) => args.includes('StartServiceByName'))).toBe(false);
  });
  it('sanitizes failure, missing client and invalid metadata responses', async () => {
    for (const execute of [async () => { throw Error('secret private path'); }, async () => 'not JSON', async () => JSON.stringify({ type: 'b', data: ['yes'] })]) {
      const support = new KeyringSupport({}, execute, 'linux');
      expect(await support.start()).toMatchObject({ state: 'unavailable', canStart: false });
      expect((await support.check()).message).not.toMatch(/secret private|not JSON/);
    }
  });
  it('coalesces overlapping status checks and repeated start requests', async () => {
    const { support, execute } = fixture();
    const a = support.check(), b = support.check();
    expect(a).toBe(b);
    const startA = support.start(), startB = support.start();
    expect(startA).toBe(startB);
    expect(support.check()).toBe(startA);
    expect((await startA).state).toBe('ready');
    expect(execute.mock.calls.filter(([, args]) => args.includes('StartServiceByName'))).toHaveLength(1);
  });
  it('does not execute platform commands off Linux', async () => {
    const execute = vi.fn();
    expect((await new KeyringSupport({}, execute, 'darwin').start()).state).toBe('unavailable');
    expect(execute).not.toHaveBeenCalled();
  });
});
