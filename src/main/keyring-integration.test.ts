import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { createContext, runInContext } from 'node:vm';
import { expect, it, vi } from 'vitest';
import ts from 'typescript';

// Execute the actual integration with fake windows and wallet adapters. No
// Electron, system bus, provider, account request or real profile is opened.
const source = ts.createSourceFile('index.ts', readFileSync('src/main/index.ts', 'utf8'), ts.ScriptTarget.ES2022, true);
const names = ['walletWindowCurrent', 'nativeWalletOperation', 'runWalletRequest', 'walletRequestWindow', 'refreshInitialAccount', 'prepareSystemWallet', 'claimLauncherInstance'];
const declarations = source.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text ?? ''));
if (declarations.length !== names.length) throw Error('Wallet integration functions were not found.');
const handlers: ts.CallExpression[] = [];
function visit(node: ts.Node) {
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.expression.getText(source) === 'ipcMain' && node.expression.name.text === 'handle' &&
      ts.isStringLiteral(node.arguments[0]) && ['keyring-start', 'keyring-create'].includes(node.arguments[0].text) && ts.isArrowFunction(node.arguments[1]) && node.arguments[1].modifiers?.some(item => item.kind === ts.SyntaxKind.AsyncKeyword)) handlers.push(node);
  ts.forEachChild(node, visit);
}
visit(source); if (handlers.length !== 2) throw Error('Wallet request handlers were not found.');
const printed = ts.createPrinter().printFile(ts.factory.updateSourceFile(source, declarations));
const code = ts.transpileModule(printed + '\nfunction registerWalletIpc(){' + handlers.map(handler => handler.getText(source) + ';').join('\n') + '}', {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const ready = { state: 'ready', canStart: false, gameMode: true, message: 'Ready' }, locked = { ...ready, state: 'locked', canUnlock: true, message: 'Locked' };
function fixture() {
  class Window extends EventEmitter {
    visible = true; focused = true; destroyed = false;
    webContents = { send: vi.fn() };
    isDestroyed = () => this.destroyed; isVisible = () => this.visible; isFocused = () => this.focused;
    getNativeWindowHandle = () => Buffer.from([123, 0, 0, 0]); hide = vi.fn(() => { this.visible = false; });
  }
  const target = new Window(), context = createContext({
    Buffer, mainWindow: target, walletTarget: undefined, initialWalletAttempted: false, demoMode: false, quitting: false, shutdownStarted: false, shortcutOnly: false,
    authState: { stored: null, running: false, note: 'Before' }, backend: { current: { available: true, binaryPath: '/fixture/engine', capabilities: { commands: ['keyring-create', 'keyring-unlock', 'keyring-session-stop'] } } },
    keyringSupport: { busy: false, check: vi.fn(async () => locked), startForStartup: vi.fn(async () => ready), start: vi.fn(async () => ready), createCollection: vi.fn(async () => ready) },
    walletUnlocker: { unlock: vi.fn(async () => 'ready'), create: vi.fn(async () => 'ready'), cancel: vi.fn() },
    accountRefreshKey: vi.fn(() => 'same-backend'), emitSnapshot: vi.fn(), refreshAccount: vi.fn(async () => {}), requireBackend: vi.fn(() => '/fixture/engine'),
    ensureIdle: vi.fn(), ipcMain: { handle: vi.fn() }, startupError: undefined, pathMigration: undefined,
    app: { requestSingleInstanceLock: vi.fn(() => true) }, startupRequest: {}, shortcutInstanceData: vi.fn(() => ({ fixture: true })),
    showLauncher: vi.fn(async (valid: () => boolean) => { if (!valid()) throw Error('cancelled'); context.mainWindow ??= new Window(); context.mainWindow.visible = true; context.shortcutOnly = false; }),
  });
  runInContext(code, context); context.registerWalletIpc();
  const handler = (name: string) => context.ipcMain.handle.mock.calls.find(([channel]: [string]) => channel === name)![1];
  return { context, target, Window, handler };
}
it('attempts a focused visible Game Mode wallet once and rechecks account/backend identity before refresh', async () => {
  const f = fixture(); await f.context.refreshInitialAccount(); await f.context.refreshInitialAccount();
  expect(f.context.keyringSupport.startForStartup).toHaveBeenCalledOnce(); expect(f.context.refreshAccount).toHaveBeenCalledOnce();
  expect(f.target.webContents.send).toHaveBeenCalledWith('keyring-state', ready);
  const changed = fixture(); changed.context.keyringSupport.startForStartup.mockImplementation(async () => { changed.context.authState = { stored: false, running: false, note: 'New account' }; return ready; });
  await changed.context.refreshInitialAccount(); expect(changed.context.refreshAccount).not.toHaveBeenCalled(); expect(changed.context.authState.note).toBe('New account');
  const backend = fixture(); backend.context.keyringSupport.check.mockImplementation(async () => { backend.context.accountRefreshKey.mockReturnValue('replacement-backend'); return locked; });
  await backend.context.refreshInitialAccount(); expect(backend.context.keyringSupport.startForStartup).not.toHaveBeenCalled();
});
it.each(['hidden', 'unfocused', 'desktop', 'demo'])('does not automatically raise a wallet prompt for %s startup', async condition => {
  const f = fixture(); if (condition === 'hidden') f.target.visible = false; if (condition === 'unfocused') f.target.focused = false;
  if (condition === 'desktop') f.context.keyringSupport.check.mockResolvedValue({ ...locked, gameMode: false }); if (condition === 'demo') f.context.demoMode = true;
  await f.context.refreshInitialAccount(); expect(f.context.keyringSupport.startForStartup).not.toHaveBeenCalled(); expect(f.context.walletUnlocker.unlock).not.toHaveBeenCalled();
});
it('authorizes wallet IPC against its focused original main and rejects overlap or replacement', async () => {
  const f = fixture(), start = f.handler('keyring-start'), create = f.handler('keyring-create');
  await expect(create({ sender: {} })).rejects.toThrow('focused launcher'); f.target.focused = false;
  await expect(start({ sender: f.target.webContents })).rejects.toThrow('focused launcher'); f.target.focused = true;
  let finish!: (value: typeof ready) => void; f.context.keyringSupport.start.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const request = start({ sender: f.target.webContents }); await expect(create({ sender: f.target.webContents })).rejects.toThrow('wallet operation');
  f.context.mainWindow = new f.Window(); finish(ready); await expect(request).rejects.toThrow('cancelled');
  expect(f.target.webContents.send).not.toHaveBeenCalled(); expect(f.context.mainWindow.webContents.send).not.toHaveBeenCalled(); expect(f.context.walletTarget).toBeUndefined();
});
it('parents only a supported native helper to the captured window and cancels it when that window closes', async () => {
  const f = fixture(); f.context.walletTarget = f.target; let finish!: (value: string) => void;
  f.context.walletUnlocker.unlock.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const pending = f.context.nativeWalletOperation('unlock'); expect(f.context.walletUnlocker.unlock).toHaveBeenCalledWith('/fixture/engine', '123');
  f.target.destroyed = true; f.target.emit('closed'); expect(f.context.walletUnlocker.cancel).toHaveBeenCalledOnce(); finish('ready');
  expect(await pending).toBe('cancelled'); expect(f.target.listenerCount('closed')).toBe(0);
  f.target.destroyed = false; f.context.backend.current.capabilities.commands = []; expect(await f.context.nativeWalletOperation('create')).toBe('unavailable');
  expect(f.context.walletUnlocker.create).not.toHaveBeenCalled();
});
it('reveals a direct shortcut prompt once and restores only its own hidden launcher', async () => {
  const f = fixture(); f.context.shortcutOnly = true; f.target.visible = false;
  await f.context.prepareSystemWallet(); expect(f.context.showLauncher).toHaveBeenCalledOnce(); expect(f.context.shortcutOnly).toBe(true); expect(f.target.hide).toHaveBeenCalledOnce();
  const opened = fixture(); opened.context.shortcutOnly = true; opened.target.visible = false;
  opened.context.keyringSupport.start.mockImplementation(async () => { opened.context.shortcutOnly = false; return ready; });
  await opened.context.prepareSystemWallet(); expect(opened.target.hide).not.toHaveBeenCalled();
});
it('does not prompt or hide another window after shutdown or replacement during an asynchronous reveal', async () => {
  const f = fixture(); f.target.visible = false; f.context.shortcutOnly = true;
  f.context.showLauncher.mockImplementation(async valid => { f.context.shutdownStarted = true; expect(valid()).toBe(false); });
  await expect(f.context.prepareSystemWallet()).rejects.toThrow('cancelled'); expect(f.context.keyringSupport.start).not.toHaveBeenCalled(); expect(f.target.hide).not.toHaveBeenCalled();
  const replaced = fixture(); replaced.context.keyringSupport.start.mockImplementation(async () => { replaced.context.mainWindow = new replaced.Window(); return ready; });
  await expect(replaced.context.prepareSystemWallet()).rejects.toThrow('cancelled'); expect(replaced.context.mainWindow.hide).not.toHaveBeenCalled();
});
it.each(['primary', 'secondary', 'throw', 'startup-error', 'demo'])('holds the migration lease until singleton acquisition finishes and releases it: %s', async scenario => {
  const f = fixture(), order: string[] = [];
  const release = vi.fn(async () => { order.push('release'); }); f.context.pathMigration = { releaseStartupLock: release };
  f.context.app.requestSingleInstanceLock.mockImplementation(() => { order.push('claim'); if (scenario === 'throw') throw Error('synthetic lock error'); return scenario !== 'secondary'; });
  if (scenario === 'startup-error') f.context.startupError = Error('copy lease is held'); if (scenario === 'demo') f.context.demoMode = true;
  if (scenario === 'throw') await expect(f.context.claimLauncherInstance()).rejects.toThrow('synthetic');
  else expect(await f.context.claimLauncherInstance()).toBe(['primary', 'demo'].includes(scenario));
  expect(order).toEqual(['startup-error', 'demo'].includes(scenario) ? ['release'] : ['claim', 'release']); expect(release).toHaveBeenCalledOnce();
});
