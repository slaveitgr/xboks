import { describe, expect, it, vi } from 'vitest';
import { KeyringSupport } from './keyring.js';

function fixture(options: { owned?: boolean; locked?: boolean; alias?: string; names?: string[]; enabled?: string; fail?: boolean } = {}) {
  let owned = options.owned ?? false;
  const execute = vi.fn(async (command: string, args: string[]) => {
    if (options.fail) throw Error('private provider text and identifiers');
    if (command.startsWith('kreadconfig')) return options.enabled ?? 'UNSET';
    const reply = (type: string, value: unknown) => JSON.stringify({ type, data: [value] });
    if (args.includes('NameHasOwner')) return reply('b', owned);
    if (args.includes('ListActivatableNames')) return reply('as', options.names ?? ['org.freedesktop.secrets']);
    if (args.includes('ReadAlias')) return reply('o', options.alias ?? '/org/freedesktop/secrets/collection/default');
    if (args.includes('Get')) return reply('v', { type: 'b', data: options.locked ?? false });
    if (args.includes('StartServiceByName')) { owned = true; return reply('u', 1); }
    throw Error('Unexpected command');
  });
  return { execute, support: new KeyringSupport({ XDG_CURRENT_DESKTOP: 'gamescope', DISPLAY: ':1' }, execute, 'linux') };
}

describe('safe keyring setup (#212, #234)', () => {
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
    const { support, execute } = fixture({ names: [name] });
    expect((await support.start()).state).toBe('ready');
    const [, args] = execute.mock.calls.find(([, args]) => args.includes('StartServiceByName'))!;
    expect(args.slice(-2)).toEqual([name, '0']);
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
