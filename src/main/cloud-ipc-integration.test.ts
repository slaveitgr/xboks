import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import vm from 'node:vm';
import ts from 'typescript';
import { CloudAccountService } from './cloud-account';
import { ConsoleStreamService } from './console-stream';

// Execute the real registration, admission and lifecycle functions in isolation.
// Electron, credentials, HTTP, windows and system services are owned fixtures.
const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true);
const register = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'registerIpc') as ts.FunctionDeclaration;
const declaration = (name: string, statements: ts.NodeArray<ts.Statement> = ast.statements) => {
  const found = statements.find(n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => ts.isIdentifier(d.name) && d.name.text === name));
  if (!found) throw Error(`Fixture cannot find actual declaration ${name}`);
  return found.getText(ast).replace(/^(?:const|let) /, 'var ');
};
const functionSource = (name: string) => {
  const found = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  if (!found) throw Error(`Fixture cannot find actual function ${name}`);
  return found.getText(ast);
};
const ipcSource = register.body!.statements.filter(n => ts.isExpressionStatement(n) && ts.isCallExpression(n.expression)
  && n.expression.expression.getText(ast) === 'ipcMain.handle' && ts.isStringLiteral(n.expression.arguments[0])
  && (n.expression.arguments[0].text.startsWith('cloud-') || n.expression.arguments[0].text.startsWith('console-stream-') || n.expression.arguments[0].text === 'remote-play-open')).map(n => n.getText(ast)).join('\n');
const quitRegistration = ast.statements.find(n => ts.isExpressionStatement(n) && ts.isCallExpression(n.expression)
  && n.expression.expression.getText(ast) === 'app.on' && ts.isStringLiteral(n.expression.arguments[0]) && n.expression.arguments[0].text === 'before-quit')!;
const changedCallback = (name: string) => {
  const statement = ast.statements.find(n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => ts.isIdentifier(d.name) && d.name.text === name)) as ts.VariableStatement;
  const init = statement.declarationList.declarations[0].initializer as ts.NewExpression;
  const options = init.arguments![0] as ts.ObjectLiteralExpression;
  return (options.properties.find(p => ts.isPropertyAssignment(p) && p.name.getText(ast) === 'changed') as ts.PropertyAssignment).initializer.getText(ast);
};
const createWindow = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'createWindow') as ts.FunctionDeclaration;
const streamLifetimeSource = createWindow.body!.statements.filter(n => (ts.isVariableStatement(n)
  && n.declarationList.declarations.some(d => ts.isIdentifier(d.name) && d.name.text === 'stopOwnedStreams'))
  || (ts.isExpressionStatement(n) && ts.isCallExpression(n.expression) && n.expression.expression.getText(ast).endsWith('.on')
  && n.expression.arguments[1]?.getText(ast).includes('stopOwnedStreams'))).map(n => n.getText(ast)).join('\n');
const compile = (code: string) => ts.transpileModule(code.replaceAll('import.meta.url', JSON.stringify('file:///fixture/dist-electron/main/index.js')),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const ACCOUNT = 'fixture@example.invalid', PRODUCT = '9N26X2PMTWBT', NOW = Date.parse('2026-10-22T00:00:00Z');
const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });

function fixture(options: { companion?: boolean; holdCredential?: boolean; holdDelete?: boolean } = {}) {
  const handlers = new Map<string, (...args: any[]) => any>(), appEvents = new Map<string, (...args: any[]) => any>();
  const requests: { url: string; options: RequestInit }[] = [];
  let releaseCompanion!: (path?: string) => void, releaseCredential!: (value: string) => void;
  const deletes: ((value: unknown) => void)[] = [];
  let credentialSignal: AbortSignal | undefined;
  const flags = { visible: true, focused: true, destroyed: false, contentsDestroyed: false }, frame = {};
  const main = Object.assign(new EventEmitter(), {webContents: Object.assign(new EventEmitter(), {mainFrame: frame, send: vi.fn(), isDestroyed: () => flags.contentsDestroyed}),
    isDestroyed: () => flags.destroyed, isVisible: () => flags.visible, isFocused: () => flags.focused});
  const nativeWindows = [main];
  const reader = vi.fn((_binary: string, signal: AbortSignal) => {
    credentialSignal = signal;
    const raw = JSON.stringify({ schema: 1, account: ACCOUNT, token: 'fixture-private-gssv', expiresAt: '2026-10-22T01:00:00Z' });
    if (!options.holdCredential) return Promise.resolve(raw);
    return new Promise<string>((resolve, reject) => { releaseCredential = resolve; signal.addEventListener('abort', () => reject(Error('Canceled fixture credential.')), { once: true }); });
  });
  const fetcher = vi.fn(async (url: any, request: RequestInit = {}) => {
    requests.push({ url: String(url), options: request }); let result: unknown;
    if (String(url).endsWith('/login/user')) result = { gsToken: 'fixture-private-stream-token', durationInSeconds: 3600,
      offeringSettings: { regions: [{ isDefault: true, baseUri: String(url).includes('xhome.') ? 'https://uks.core.gssv-play-prodxhome.xboxlive.com' : 'https://uks.core.gssv-play-prod.xboxlive.com' }] } };
    else if (String(url).endsWith('/v2/titles') || String(url).includes('/v2/titles/mru?')) result = { results: [{ titleId: 'TITLE_FIXTURE', details: { productId: PRODUCT, hasEntitlement: true } }] };
    else if (String(url).endsWith('/v6/servers/home?mr=50')) result = {results: [{serverId: 'fixture-private-console-server', deviceName: 'Xbox One X', consoleType: 'XboxOneX', powerState: 'On'}]};
    else if (String(url).endsWith('/play')) result = { sessionId: String(url).includes('/home/') ? 'fixture-private-console-session' : 'fixture-private-provider-session' };
    else if (String(url).endsWith('/state')) result = { state: 'Provisioned' };
    else if (request.method === 'DELETE' && options.holdDelete) result = await new Promise(resolve => { deletes.push(resolve); });
    else result = {};
    return new Response(JSON.stringify(result), { status: 200 });
  });
  let context: any;
  const account = new CloudAccountService({ reader, fetcher: fetcher as typeof fetch, now: () => NOW, changed: state => context?.onCloudChanged?.(state) });
  const consoleStream = new ConsoleStreamService({reader, fetcher: fetcher as typeof fetch, now: () => NOW, changed: state => context?.onConsoleChanged?.(state)});
  const backend = { current: { binaryPath: '/fixture/xboks-engine', capabilities: { commands: options.companion ? ['social'] : ['cloud-token'] } } };
  const socialBackend = vi.fn(() => options.companion ? new Promise<string | undefined>(resolve => { releaseCompanion = resolve; }) : Promise.resolve('/fixture/companion'));
  const power = { start: vi.fn(() => 7), stop: vi.fn(), isStarted: vi.fn(() => true) };
  context = vm.createContext({
    Promise, JSON, URL, Map, Set, Error, String, Boolean, Number, path, process: { resourcesPath: '/fixture/resources' },
    fileURLToPath: (url: URL) => url.pathname, console: { warn() {}, error() {} },
    setTimeout: () => 0, clearTimeout() {},
    mainWindow: main, nativeWindows, backend, cloudAccount: account, cloudAccountIdentity: undefined, cloudStopJob: undefined,
    consoleStream, consoleAccountIdentity: undefined, consoleStopJob: undefined, streamingTransition: false,
    bundledCloudBackendJob: undefined, bundledCloudTransferBackendJob: undefined, socialBackend,
    readCloudTransferCredential: vi.fn(async () => 'fixture-private-transfer'), authState: { stored: true, running: false, username: ACCOUNT },
    store: { settings: { cloudLoginCountry: 'auto' }, downloads: [], save: vi.fn(async () => {}) }, currentMarket: () => 'US',
    demoMode: false, shutdownStarted: false, quitting: false, preparingLaunch: false,
    serviceSessions: new Map(), operations: new Map(), gameProcesses: new Map(), downloadCancellations: new Map(),
    cloudDisplayBlocker: undefined, consoleDisplayBlocker: undefined, powerSaveBlocker: power,
    cloudCatalog: { catalog: vi.fn(async () => ({ collections: {} })), describe: vi.fn(async () => []) },
    remotePlay: { destroy: vi.fn(), open: vi.fn(async () => {}) }, cloudGaming: { destroy: vi.fn(), open: vi.fn(async () => {}), state: {} },
    updateRemotePlayVisibility: vi.fn(), cloudGamingInlineObscured: false,
    desktopGuide: { webContents: { mainFrame: {} }, destroy: vi.fn() },
    app: { isPackaged: true, on: (name: string, fn: (...args: any[]) => any) => appEvents.set(name, fn), quit: vi.fn() },
    ipcMain: { handle: (name: string, fn: (...args: any[]) => any) => handlers.set(name, fn) },
    walletUnlocker: { busy: false, cancel: vi.fn(), stop: vi.fn(async () => {}) }, keyringSupport: { busy: false }, walletTarget: undefined,
    disposeGameBarController: vi.fn(), fullscreenExperience: { dispose: vi.fn() }, voiceCapture: { release: vi.fn() }, spotify: { dispose: vi.fn() },
    installQueue: { stop: vi.fn(), size: 0 }, accountLibrary: { reset: vi.fn() }, xboxSocial: { select: vi.fn() }, guidePower: { clear: vi.fn() },
    accountProfile: { cancel: vi.fn() }, accountRefresh: { invalidate: vi.fn() },
    pendingSettingsUpdates: 0, settingsUpdates: Promise.resolve(), backendDiagnostics: undefined, authJob: undefined,
    preparingInstall: false, checkingGameUpdates: false, gameUpdateController: undefined, gameUpdateJob: undefined,
    launcherUpdater: { state: { updating: false }, cancel: vi.fn() },
    ensureIdle: vi.fn(), prepareGameLaunch: vi.fn(async () => {}),
  });
  const code = [functionSource('cloudBackendBinary'), functionSource('cloudTransferBackendBinary'), functionSource('cloudTransferCredential'), functionSource('invalidateChangedCloudAccount'), functionSource('stopCloudStreaming'), functionSource('stopConsoleStreaming'), functionSource('launchGame'),
    declaration('systemSender', register.body!.statements), declaration('cloudSender', register.body!.statements), declaration('selectCloudAccount', register.body!.statements), declaration('selectConsoleAccount', register.body!.statements), ipcSource,
    `var onCloudChanged = ${changedCallback('cloudAccount')};`, `var onConsoleChanged = ${changedCallback('consoleStream')};`, streamLifetimeSource, quitRegistration.getText(ast)].join('\n');
  vm.runInContext(compile(code), context);
  const event = { sender: main.webContents, senderFrame: frame };
  cleanups.push(() => {account.select(); consoleStream.select(); for (const resolve of deletes.splice(0)) resolve({});});
  return { context, account, consoleStream, handlers, flags, main, frame, event, requests, reader, fetcher, power, socialBackend,
    get signal() { return credentialSignal; },
    companion: (value = '/fixture/verified-companion') => releaseCompanion(value),
    credential: () => releaseCredential(JSON.stringify({ schema: 1, account: ACCOUNT, token: 'fixture-private-gssv', expiresAt: '2026-10-22T01:00:00Z' })),
    deleted: () => {for (const resolve of deletes.splice(0)) resolve({});},
    call: (name: string, ...args: any[]) => handlers.get(name)!(event, ...args),
    quit: () => { const quitEvent = { preventDefault: vi.fn() }; appEvents.get('before-quit')!(quitEvent); return quitEvent; },
  };
}

it('resolves only a verified purpose helper without replacing the selected game engine', async () => {
  const h = fixture(), controller = new AbortController();
  await expect(h.context.cloudTransferCredential('/fixture/old-engine', controller.signal)).resolves.toBe('fixture-private-transfer');
  expect(h.socialBackend).toHaveBeenCalledWith('/fixture/resources/social-backend', undefined, 'cloud-transfer-token');
  expect(h.context.readCloudTransferCredential).toHaveBeenCalledWith('/fixture/companion', controller.signal);
  expect(h.context.backend.current.binaryPath).toBe('/fixture/xboks-engine');
  expect(h.reader).not.toHaveBeenCalled(); expect(h.requests).toEqual([]);
});
it('uses a capable selected purpose helper and never spawns one after cancellation or missing verification', async () => {
  const h = fixture(), controller = new AbortController();
  h.context.backend.current.capabilities.commands.push('cloud-transfer-token');
  await h.context.cloudTransferCredential('/fixture/old-engine', controller.signal);
  expect(h.socialBackend).not.toHaveBeenCalled();
  expect(h.context.readCloudTransferCredential).toHaveBeenCalledWith('/fixture/xboks-engine', controller.signal);
  const waiting = fixture({companion:true}), abort = new AbortController();
  const pending = waiting.context.cloudTransferCredential('/fixture/old-engine', abort.signal);
  await vi.waitFor(() => expect(waiting.socialBackend).toHaveBeenCalledOnce()); abort.abort(); waiting.companion();
  await expect(pending).rejects.toThrow(); expect(waiting.context.readCloudTransferCredential).not.toHaveBeenCalled();
  const absent = fixture(); absent.socialBackend.mockResolvedValue(undefined as never);
  await expect(absent.context.cloudTransferCredential('/fixture/old-engine', new AbortController().signal)).rejects.toThrow('unavailable');
  expect(absent.context.readCloudTransferCredential).not.toHaveBeenCalled();
});

it('registers actual native stream handlers and denies another window or subframe before credential/network access', async () => {
  const h = fixture();
  for (const name of ['cloud-account-catalog', 'cloud-stream-start', 'cloud-stream-sdp', 'cloud-stream-ice', 'cloud-stream-state', 'cloud-products',
    'console-stream-devices', 'console-stream-start', 'console-stream-sdp', 'console-stream-ice', 'console-stream-state', 'console-stream-stop', 'console-stream-wake', 'remote-play-open']) {
    const handler = h.handlers.get(name)!;
    await expect(Promise.resolve().then(() => handler({ sender: h.context.desktopGuide.webContents, senderFrame: h.context.desktopGuide.webContents.mainFrame }, PRODUCT))).rejects.toThrow();
    await expect(Promise.resolve().then(() => handler({ ...h.event, senderFrame: {} }, PRODUCT))).rejects.toThrow();
  }
  expect(h.reader).not.toHaveBeenCalled(); expect(h.requests).toEqual([]);
});
it('reuses the selected native account in real IPC without returning credentials or opening a web player', async () => {
  const h = fixture(), result = await h.call('cloud-account-catalog');
  expect(result.status).toBe('ready'); expect(result.titles[0].productId).toBe(PRODUCT); expect(h.reader).toHaveBeenCalledOnce();
  expect(JSON.stringify(result)).not.toMatch(/fixture-private|gsToken|token/); expect(h.context.cloudGaming.open).not.toHaveBeenCalled(); expect(h.socialBackend).not.toHaveBeenCalled();
  expect(h.power.start).not.toHaveBeenCalled();
});
it('prefers a verified companion when the selected game engine lacks the cloud command, then binds the exact account', async () => {
  const h = fixture({ companion: true }), result = h.call('cloud-account-catalog'); await vi.waitFor(() => expect(h.socialBackend).toHaveBeenCalledOnce()); h.companion();
  expect((await result).status).toBe('ready'); expect(h.reader.mock.calls[0][0]).toBe('/fixture/verified-companion');
  expect(h.socialBackend).toHaveBeenCalledWith('/fixture/resources/social-backend', undefined, 'cloud-token');
});
it('rejects account changes during companion verification instead of authorizing the old cloud request', async () => {
  const h = fixture({ companion: true }), result = h.call('cloud-account-catalog'); await vi.waitFor(() => expect(h.socialBackend).toHaveBeenCalledOnce());
  h.context.authState.username = 'another@example.invalid'; h.companion(); await expect(result).rejects.toThrow('account changed'); expect(h.reader).not.toHaveBeenCalled();
});
it('rejects selected-backend changes during companion verification before account exchange', async () => {
  const h = fixture({ companion: true }), result = h.call('cloud-account-catalog'); await vi.waitFor(() => expect(h.socialBackend).toHaveBeenCalledOnce());
  h.context.backend.current.binaryPath = '/fixture/another-engine'; h.companion(); await expect(result).rejects.toThrow(); expect(h.reader).not.toHaveBeenCalled();
});
it('does not launch a cloud game if its window hides while the companion is being verified', async () => {
  const h = fixture({ companion: true }), result = h.call('cloud-stream-start', PRODUCT); await vi.waitFor(() => expect(h.socialBackend).toHaveBeenCalledOnce());
  h.flags.visible = false; await h.context.stopCloudStreaming(); h.companion(); await expect(result).rejects.toThrow(); expect(h.reader).not.toHaveBeenCalled(); expect(h.requests).toEqual([]);
});
it('does not launch after quit or focus loss during account-provider verification', async () => {
  for (const state of ['quit', 'focus']) {
    const h = fixture({ companion: true }), result = h.call('cloud-stream-start', PRODUCT); await vi.waitFor(() => expect(h.socialBackend).toHaveBeenCalledOnce());
    if (state === 'quit') h.context.quitting = true; else h.flags.focused = false;
    h.companion(); await expect(result).rejects.toThrow(); expect(h.reader).not.toHaveBeenCalled();
  }
});
it('starts the requested in-app session and releases its display blocker when stopped', async () => {
  const h = fixture(), state = await h.call('cloud-stream-start', PRODUCT); expect(state.phase).toBe('ready'); expect(h.power.start).toHaveBeenCalledOnce();
  expect(h.context.cloudGaming.destroy).toHaveBeenCalledOnce(); expect(h.context.remotePlay.destroy).toHaveBeenCalledOnce(); expect(h.context.cloudGaming.open).not.toHaveBeenCalled();
  const messages = h.main.webContents.send.mock.calls.filter(c => c[0] === 'cloud-stream-state'); expect(messages.length).toBeGreaterThan(0);
  expect(JSON.stringify(messages)).not.toMatch(/fixture-private|gsToken/); await h.call('cloud-stream-stop', state.id); expect(h.power.stop).toHaveBeenCalledWith(7);
});
it('clears old account sessions and caches before state/signaling is handled after sign-out', async () => {
  const h = fixture(), state = await h.call('cloud-stream-start', PRODUCT);
  h.context.authState.stored = false; h.context.authState.username = undefined;
  expect((await h.call('cloud-stream-state')).phase).toBe('closed');
  await expect(h.call('cloud-stream-sdp', state.id, 'v=0\r\nfixture')).rejects.toThrow();
  expect(h.requests.some(r => r.options.method === 'DELETE')).toBe(true);
  const catalog = await h.call('cloud-account-catalog'); expect(catalog.status).toBe('signed-out'); expect(catalog.titles).toEqual([]);
});
it('navigates to the native console library without a web player, another login, or an implicit stream launch', async () => {
  const h = fixture(); await h.call('remote-play-open');
  expect(h.main.webContents.send).toHaveBeenCalledWith('console-library-open');
  expect(h.context.remotePlay.open).not.toHaveBeenCalled(); expect(h.context.cloudGaming.open).not.toHaveBeenCalled();
  expect(h.reader).not.toHaveBeenCalled(); expect(h.requests).toEqual([]);
});
it('lists consoles through the same selected native account and exposes only local console identities', async () => {
  const h = fixture(), result = await h.call('console-stream-devices');
  expect(result.status).toBe('ready'); expect(result.consoles).toHaveLength(1);
  expect(result.consoles[0]).toMatchObject({name: 'Xbox One X', consoleType: 'XboxOneX', powerState: 'on', canWake: false});
  expect(result.consoles[0].id).toMatch(/^[a-f0-9-]{36}$/); expect(h.reader).toHaveBeenCalledOnce();
  expect(JSON.stringify(result)).not.toMatch(/fixture-private|gsToken|token|serverId/);
  expect(h.requests[0].url).toBe('https://xhome.gssv-play-prod.xboxlive.com/v2/login/user');
  expect(h.requests[1].url).toContain('gssv-play-prodxhome.xboxlive.com/v6/servers/home?mr=50');
  expect(h.context.remotePlay.open).not.toHaveBeenCalled(); expect(h.power.start).not.toHaveBeenCalled();
});
it('waits for native cloud or console cleanup before opening the explicit legacy cloud fallback', async () => {
  for (const kind of ['cloud', 'console']) {
    const h = fixture({holdDelete: true});
    if (kind === 'cloud') await h.call('cloud-stream-start', PRODUCT);
    else {const list = await h.call('console-stream-devices'); await h.call('console-stream-start', list.consoles[0].id);}
    const result = h.call('cloud-gaming-open'); await vi.waitFor(() => expect(h.requests.some(r => r.options.method === 'DELETE')).toBe(true));
    expect(h.context.cloudGaming.open).not.toHaveBeenCalled(); expect(h.context.remotePlay.open).not.toHaveBeenCalled();
    h.deleted(); await result; expect(h.context.cloudGaming.open).toHaveBeenCalledOnce();
  }
});
it('serializes cloud-to-console and console-to-cloud handoffs before creating another provider session', async () => {
  for (const first of ['cloud', 'console']) {
    const h = fixture({holdDelete: true}), list = await h.call('console-stream-devices'), consoleId = list.consoles[0].id;
    await h.call(`${first}-stream-start`, first === 'cloud' ? PRODUCT : consoleId);
    const next = first === 'cloud' ? 'console' : 'cloud', result = h.call(`${next}-stream-start`, next === 'cloud' ? PRODUCT : consoleId);
    await vi.waitFor(() => expect(h.requests.filter(r => r.options.method === 'DELETE')).toHaveLength(1));
    expect(h.requests.filter(r => r.url.endsWith('/play'))).toHaveLength(1);
    await expect(h.call(`${first}-stream-start`, first === 'cloud' ? PRODUCT : consoleId)).rejects.toThrow();
    await expect(h.call('cloud-gaming-open')).rejects.toThrow();
    h.deleted(); expect((await result).phase).toBe('ready');
    expect(h.requests.filter(r => r.url.endsWith('/play'))).toHaveLength(2);
    expect(first === 'cloud' ? h.account.state.phase : h.consoleStream.state.phase).toBe('closed');
    expect(h.context.streamingTransition).toBe(false); expect(h.context.remotePlay.open).not.toHaveBeenCalled();
  }
});
it('waits for either native stream to stop before local-game preparation and blocks new stream starts throughout the handoff', async () => {
  for (const kind of ['cloud', 'console']) {
    const h = fixture({holdDelete: true}), list = await h.call('console-stream-devices'), consoleId = list.consoles[0].id;
    await h.call(`${kind}-stream-start`, kind === 'cloud' ? PRODUCT : consoleId);
    const result = h.context.launchGame('fixture-installed-game');
    await vi.waitFor(() => expect(h.requests.some(r => r.options.method === 'DELETE')).toBe(true));
    expect(h.context.ensureIdle).toHaveBeenCalledWith('launch'); expect(h.context.preparingLaunch).toBe(true);
    expect(h.context.prepareGameLaunch).not.toHaveBeenCalled();
    await expect(h.call('cloud-stream-start', PRODUCT)).rejects.toThrow();
    await expect(h.call('console-stream-start', consoleId)).rejects.toThrow();
    h.deleted(); await result;
    expect(h.context.prepareGameLaunch).toHaveBeenCalledOnce(); expect(h.context.prepareGameLaunch).toHaveBeenCalledWith('fixture-installed-game');
    expect(h.context.preparingLaunch).toBe(false); expect(h.account.state.phase).toBe('closed'); expect(h.consoleStream.state.phase).toBe('closed');
  }
});
it('does not prepare a local game after shutdown or quit begins while stream teardown is pending', async () => {
  for (const closingFlag of ['shutdownStarted', 'quitting']) {
    const h = fixture({holdDelete: true}); await h.call('cloud-stream-start', PRODUCT);
    const result = h.context.launchGame('fixture-installed-game');
    await vi.waitFor(() => expect(h.requests.some(r => r.options.method === 'DELETE')).toBe(true));
    h.context[closingFlag] = true; h.deleted(); await expect(result).rejects.toThrow('closing');
    expect(h.context.prepareGameLaunch).not.toHaveBeenCalled(); expect(h.context.preparingLaunch).toBe(false);
  }
});
it('refuses a local-game launch during another stream handoff and clears admission after failed local preparation', async () => {
  const h = fixture(); h.context.streamingTransition = true;
  await expect(h.context.launchGame('fixture-installed-game')).rejects.toThrow('streaming action');
  expect(h.context.prepareGameLaunch).not.toHaveBeenCalled(); expect(h.context.preparingLaunch).toBe(false);
  h.context.streamingTransition = false;
  h.context.prepareGameLaunch.mockRejectedValueOnce(Error('Fixture local game could not be prepared.'));
  await expect(h.context.launchGame('fixture-installed-game')).rejects.toThrow('could not be prepared');
  expect(h.context.preparingLaunch).toBe(false); expect((await h.call('cloud-stream-start', PRODUCT)).phase).toBe('ready');
});
it('does not start cloud or console sessions while a local game process is already running without a cloud-save service', async () => {
  const h = fixture(), list = await h.call('console-stream-devices'), before = h.requests.length;
  h.context.gameProcesses.set('fixture-local-game', {}); expect(h.context.serviceSessions.size).toBe(0);
  await expect(h.call('cloud-stream-start', PRODUCT)).rejects.toThrow();
  await expect(h.call('console-stream-start', list.consoles[0].id)).rejects.toThrow();
  expect(h.requests).toHaveLength(before); expect(h.requests.some(r => r.url.endsWith('/play'))).toBe(false);
});
it('invalidates old console identities and pending signaling on sign-out', async () => {
  const h = fixture(), list = await h.call('console-stream-devices'), state = await h.call('console-stream-start', list.consoles[0].id);
  expect(state.phase).toBe('ready'); h.context.authState.stored = false; h.context.authState.username = undefined;
  expect((await h.call('console-stream-state')).phase).toBe('closed');
  await expect(h.call('console-stream-sdp', state.id, 'v=0\r\nfixture')).rejects.toThrow();
  expect((await h.call('console-stream-devices')).status).toBe('signed-out');
  expect(h.requests.some(r => r.options.method === 'DELETE' && r.url.includes('/sessions/home/'))).toBe(true);
  expect(h.power.stop).toHaveBeenCalledWith(7);
});
it('stops native sessions when their actual owner hides, closes or loses its renderer process', async () => {
  for (const kind of ['cloud', 'console']) for (const event of ['hide', 'closed', 'render-process-gone', 'destroyed']) {
    const h = fixture();
    if (kind === 'cloud') await h.call('cloud-stream-start', PRODUCT);
    else {const list = await h.call('console-stream-devices'); await h.call('console-stream-start', list.consoles[0].id);}
    if (event === 'destroyed') h.flags.contentsDestroyed = true;
    (['render-process-gone', 'destroyed'].includes(event) ? h.main.webContents : h.main).emit(event);
    expect(kind === 'cloud' ? h.account.state.phase : h.consoleStream.state.phase).toBe('closed');
    await vi.waitFor(() => expect(h.requests.some(r => r.options.method === 'DELETE')).toBe(true));
    expect(h.power.stop).toHaveBeenCalledWith(7);
  }
});
it('cleans owned sessions on main-frame reload while preserving hash and nested-frame navigation', async () => {
  for (const kind of ['cloud', 'console']) {
    const h = fixture();
    if (kind === 'cloud') await h.call('cloud-stream-start', PRODUCT);
    else {const list = await h.call('console-stream-devices'); await h.call('console-stream-start', list.consoles[0].id);}
    const service = kind === 'cloud' ? h.account : h.consoleStream;
    h.main.webContents.emit('did-start-navigation', {}, 'https://fixture.invalid/frame', false, false);
    h.main.webContents.emit('did-start-navigation', {}, 'file:///fixture/index.html#cloud', true, true);
    expect(service.state.phase).toBe('ready'); expect(h.requests.some(r => r.options.method === 'DELETE')).toBe(false);
    h.main.webContents.emit('did-start-navigation', {}, 'file:///fixture/index.html', false, true);
    expect(service.state.phase).toBe('closed');
    await vi.waitFor(() => expect(h.requests.filter(r => r.options.method === 'DELETE')).toHaveLength(1));
    expect(h.power.stop).toHaveBeenCalledWith(7);
  }
});
it('still releases native sessions and display blockers when sending to a tearing-down renderer throws', async () => {
  for (const kind of ['cloud', 'console']) {
    const h = fixture();
    if (kind === 'cloud') await h.call('cloud-stream-start', PRODUCT);
    else {const list = await h.call('console-stream-devices'); await h.call('console-stream-start', list.consoles[0].id);}
    h.main.webContents.send.mockImplementation(() => {throw Error('Fixture renderer was destroyed.');});
    await expect(h.call(`${kind}-stream-stop`)).resolves.toBeUndefined();
    expect(kind === 'cloud' ? h.account.state.phase : h.consoleStream.state.phase).toBe('closed');
    expect(h.power.stop).toHaveBeenCalledWith(7);
    expect(h.requests.some(r => r.options.method === 'DELETE')).toBe(true);
  }
});
it('quitting aborts a private pending credential request even before a cloud session exists', async () => {
  const h = fixture({ holdCredential: true }), result = h.call('cloud-account-catalog'); await vi.waitFor(() => expect(h.reader).toHaveBeenCalledOnce());
  h.quit(); expect(h.signal?.aborted).toBe(true); await result; expect(h.requests).toEqual([]);
});
it('quitting aborts a private pending console credential request before any home offering request', async () => {
  const h = fixture({holdCredential: true}), result = h.call('console-stream-devices'); await vi.waitFor(() => expect(h.reader).toHaveBeenCalledOnce());
  h.quit(); expect(h.signal?.aborted).toBe(true); expect((await result).consoles).toEqual([]); expect(h.requests).toEqual([]);
});
it('quitting waits for owned session cleanup before requesting final app exit', async () => {
  const h = fixture({ holdDelete: true }); await h.call('cloud-stream-start', PRODUCT);
  const event = h.quit(); expect(event.preventDefault).toHaveBeenCalledOnce(); await vi.waitFor(() => expect(h.requests.some(r => r.options.method === 'DELETE')).toBe(true));
  expect(h.context.app.quit).not.toHaveBeenCalled(); h.deleted(); await vi.waitFor(() => expect(h.context.app.quit).toHaveBeenCalledOnce());
});
it.each(['cloud', 'console'] as const)('quitting joins an already closed %s service while its internal account-change cleanup is pending', async kind => {
  const h = fixture({holdDelete: true});
  if (kind === 'cloud') await h.call('cloud-stream-start', PRODUCT);
  else {const list = await h.call('console-stream-devices'); await h.call('console-stream-start', list.consoles[0].id);}
  const service = kind === 'cloud' ? h.account : h.consoleStream;
  // Internal cleanup has no IPC stop wrapper job, and Closed precedes DELETE.
  service.select('replacement@example.invalid', '/fixture/xboks-engine', 'en-US');
  expect(service.state.phase).toBe('closed'); expect(service.cleanupPending).toBe(true);
  expect(h.context.cloudStopJob).toBeUndefined(); expect(h.context.consoleStopJob).toBeUndefined();
  expect(h.requests.filter(r => r.options.method === 'DELETE')).toHaveLength(1);
  const event = h.quit(); expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(h.context.app.quit).not.toHaveBeenCalled();
  h.deleted(); await vi.waitFor(() => expect(h.context.app.quit).toHaveBeenCalledOnce());
  expect(service.cleanupPending).toBe(false);
  expect(h.requests.filter(r => r.options.method === 'DELETE')).toHaveLength(1);
});
it('quitting drains both native services and releases both display blockers before final exit', async () => {
  const h = fixture({holdDelete: true}), list = await h.call('console-stream-devices');
  await h.call('console-stream-start', list.consoles[0].id);
  // Exercise defensive shutdown even if both independently owned service objects
  // are active; ordinary IPC admission already prevents this combination.
  h.account.select(ACCOUNT, '/fixture/xboks-engine', 'en-US', 'auto'); await h.account.start(PRODUCT);
  expect(h.account.state.phase).toBe('ready'); expect(h.consoleStream.state.phase).toBe('ready');
  const event = h.quit(); expect(event.preventDefault).toHaveBeenCalledOnce();
  await vi.waitFor(() => expect(h.requests.filter(r => r.options.method === 'DELETE')).toHaveLength(2));
  expect(h.context.app.quit).not.toHaveBeenCalled(); expect(h.power.stop).toHaveBeenCalledTimes(2);
  h.deleted(); await vi.waitFor(() => expect(h.context.app.quit).toHaveBeenCalledOnce());
});
it('does not start a private account exchange after quit begins during companion verification', async () => {
  const h = fixture({ companion: true }), result = h.call('cloud-account-catalog'); await vi.waitFor(() => expect(h.socialBackend).toHaveBeenCalledOnce());
  h.quit(); h.companion(); await expect(result).rejects.toThrow(); expect(h.reader).not.toHaveBeenCalled(); expect(h.requests).toEqual([]);
});
it('applies a changed explicit cloud login country through IPC after invalidating the previous account offering', async () => {
  const h = fixture(); await h.call('cloud-account-catalog'); expect(h.requests[0].options.headers).not.toHaveProperty('X-Forwarded-For');
  h.context.store.settings.cloudLoginCountry = 'pl'; await h.call('cloud-account-catalog');
  expect(h.reader).toHaveBeenCalledTimes(2); expect(h.requests[3].options.headers).toMatchObject({ 'X-Forwarded-For': '45.134.212.66' });
  expect(h.requests.slice(4).every(r => !(r.options.headers as Record<string, string>)['X-Forwarded-For'])).toBe(true);
});
