import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { transpileModule, ScriptTarget } from 'typescript';
import { launcherExecutablePath, showBeforeAccountCheck } from './launcher-startup.js';

describe('persistent launcher executable', () => {
  it.each(['xboks', 'xodus-nexus'])('maps only the known packaged %s binary to its wrapper', name => {
    expect(launcherExecutablePath(`/opt/launcher with spaces/${name}.bin`, true)).toBe(`/opt/launcher with spaces/${name}`);
    expect(launcherExecutablePath(`/opt/launcher with spaces/${name}.bin`, false)).toBe(`/opt/launcher with spaces/${name}.bin`);
  });
  it.each(['/opt/other.bin', '/usr/bin/electron', '/opt/xboks', '/opt/xodus-nexus', '/opt/myxboks.bin', '/opt/xboks.bin.copy'])('does not redirect an unrelated executable: %s', executable => {
    expect(launcherExecutablePath(executable, true)).toBe(executable);
    expect(launcherExecutablePath(executable, false)).toBe(executable);
  });
});

describe('visible launcher before keyring/account access (#212)', () => {
  const source = readFileSync('src/main/index.ts', 'utf8');
  const begin = source.indexOf('async function refreshInitialAccount()');
  const refreshSource = transpileModule(source.slice(begin, source.indexOf('\nasync function runAuth(', begin)), { compilerOptions: { target: ScriptTarget.ES2022 } }).outputText;
  function initialFixture() {
    let complete!: (value: unknown) => void;
    const check = new Promise(resolve => { complete = resolve; });
    const context = createContext({ keyringSupport: { check: () => check }, authState: { running: false, stored: null },
      demoMode: false, quitting: false, shutdownStarted: false, accountRefreshKey: () => 'same-backend', initialWalletAttempted: false,
      mainWindow: undefined, walletTarget: undefined, walletWindowCurrent: () => false,
      refreshAccount: vi.fn(async () => {}), emitSnapshot: vi.fn() });
    const job = runInContext(refreshSource + '\nrefreshInitialAccount()', context) as Promise<void>;
    return { context, job, complete };
  }
  it.each([true, false])('does not replace a newer sign-in result after a late keyring check: running=%s', async running => {
    const { context, job, complete } = initialFixture();
    const current = { running, stored: !running, lastResult: running ? undefined : 'success', note: 'Newer sign-in' };
    context.authState = current;
    complete({ gameMode: true, state: 'locked', message: 'Old locked state' });
    await job;
    expect(context.authState).toBe(current);
    expect(context.refreshAccount).not.toHaveBeenCalled();
    expect(context.emitSnapshot).not.toHaveBeenCalled();
  });
  it.each(['ready', 'unavailable'])('does not block normal account reads on a metadata result of %s', async state => {
    const { context, job, complete } = initialFixture();
    complete({ gameMode: true, state, message: 'Metadata only' });
    await job;
    expect(context.refreshAccount).toHaveBeenCalledOnce();
  });
  it('avoids a hidden wallet prompt in Game Mode without locking out Desktop Mode', async () => {
    for (const gameMode of [true, false]) {
      const { context, job, complete } = initialFixture();
      complete({ gameMode, state: 'locked', message: 'Unlock the wallet in Desktop Mode.' });
      await job;
      expect(context.refreshAccount).toHaveBeenCalledTimes(gameMode ? 0 : 1);
      if (gameMode) expect(context.authState.note).toBe('Unlock the wallet in Desktop Mode.');
    }
  });
  it('shows the window and resolves startup while a keyring read remains pending', async () => {
    const events: string[] = [];
    let done!: () => void;
    const refresh = new Promise<void>(resolve => { done = resolve; });
    await showBeforeAccountCheck(async () => { events.push('visible'); }, () => { events.push('keyring'); return refresh; }, () => events.push('failed'));
    expect(events).toEqual(['visible', 'keyring']);
    done();
  });
  it('handles both synchronous and asynchronous account failures without closing the UI', async () => {
    for (const refresh of [() => { throw Error('locked'); }, async () => { throw Error('locked'); }]) {
      const show = vi.fn(async () => {}), failed = vi.fn();
      await showBeforeAccountCheck(show, refresh, failed);
      await vi.waitFor(() => expect(failed).toHaveBeenCalledOnce());
      expect(show).toHaveBeenCalledOnce();
    }
  });
  it('does not start account access when creating the window fails', async () => {
    const refresh = vi.fn();
    await expect(showBeforeAccountCheck(async () => { throw Error('window'); }, refresh, vi.fn())).rejects.toThrow('window');
    expect(refresh).not.toHaveBeenCalled();
  });
  it('uses nonblocking startup for the launcher but preserves ordered game shortcut initialization', () => {
    const source = readFileSync('src/main/index.ts', 'utf8');
    const tail = source.slice(source.indexOf('await syncManagedWinePath();', source.indexOf('app.whenReady()')));
    expect(tail).toContain('await showBeforeAccountCheck(');
    expect(tail).toMatch(/if \(startupRequest.gameId\) \{\s*await prepareSystemWallet\(\);\s*await refreshAccount\(false\);\s*receiveLaunchRequest/);
    expect(tail.indexOf('registerIpc();')).toBeLessThan(tail.indexOf('await showBeforeAccountCheck('));
  });
});
