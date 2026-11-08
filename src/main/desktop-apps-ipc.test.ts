import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {expect, it, vi} from 'vitest';
import ts from 'typescript';
import {voiceDocumentAllowed} from './voice-capture.js';

function fixture(demoMode = false) {
  const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  const start = source.indexOf('function registerIpc(): void {') + 'function registerIpc(): void {'.length;
  const end = source.indexOf("ipcMain.handle('window-fullscreen-get'", start);
  if (start < 30 || end < start) throw Error('Desktop Apps registration fixture boundary changed.');
  const code = ts.transpileModule(source.slice(start, end).replaceAll('import.meta.url', 'sourceModuleUrl'), {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS}}).outputText;
  const handlers = new Map<string, (...args: any[]) => any>(), list = vi.fn(async () => ({available: true, apps: []})), launch = vi.fn(async (_id: unknown, authorized: () => boolean) => { if (!authorized()) throw Error('not-authorized'); });
  const frame = {url: 'file:///app/dist/index.html#library'};
  const contents = {mainFrame: frame, getURL: () => frame.url};
  let visible = true, focused = true, destroyed = false;
  const mainWindow = {webContents: contents, isDestroyed: () => destroyed, isVisible: () => visible, isFocused: () => focused};
  const context: any = {URL, path, fileURLToPath, pathToFileURL, sourceModuleUrl: 'file:///app/dist-electron/main/index.js', __dirname: '/app/dist-electron/main',
    DesktopApps: class {list = list; launch = launch;}, app: {isPackaged: false}, ipcMain: {handle: (name: string, callback: (...args: any[]) => unknown) => handlers.set(name, callback)},
    mainWindow, desktopGuide: {webContents: {mainFrame: {}}}, shutdownStarted: false, voiceDocumentAllowed, process: {env: {}}, demoMode,
  };
  runInNewContext(code, context);
  const event = {sender: contents, senderFrame: frame};
  return {list, launch, event, context, handlers,
    setVisible: (value: boolean) => {visible = value;}, setFocused: (value: boolean) => {focused = value;}, setDestroyed: (value: boolean) => {destroyed = value;},
    invoke: (name: string, request = event, id?: string) => handlers.get(name)!(request, id)};
}

it('allows read-only inventory in the trusted main document without requiring focus', async () => {
  const f = fixture(); f.setFocused(false);
  expect(await f.invoke('desktop-apps-list')).toEqual({available: true, apps: []}); expect(f.list).toHaveBeenCalledOnce();
});

it('requires a visible focused trusted main document for a desktop application launch', async () => {
  const f = fixture();
  f.setFocused(false); expect(() => f.invoke('desktop-apps-launch', f.event, 'app.desktop')).toThrow('XBOKS window');
  f.setFocused(true); f.setVisible(false); expect(() => f.invoke('desktop-apps-launch', f.event, 'app.desktop')).toThrow('XBOKS window');
  f.setVisible(true); await f.invoke('desktop-apps-launch', f.event, 'app.desktop'); expect(f.launch).toHaveBeenCalledOnce(); expect(f.launch.mock.calls[0][0]).toBe('app.desktop');
  f.launch.mockImplementationOnce(async (_id, authorized) => { f.setFocused(false); if (!authorized()) throw Error('not-authorized'); });
  await expect(f.invoke('desktop-apps-launch', f.event, 'app.desktop')).rejects.toThrow('not-authorized');
});

it('rejects subframes, other windows, remote documents and teardown before reaching the provider', () => {
  const f = fixture();
  for (const event of [{...f.event, senderFrame: {...f.event.senderFrame}}, {sender: f.context.desktopGuide.webContents, senderFrame: undefined}]) {
    expect(() => f.invoke('desktop-apps-list', event as typeof f.event)).toThrow();
    expect(() => f.invoke('desktop-apps-launch', event as typeof f.event, 'app.desktop')).toThrow();
  }
  f.event.senderFrame.url = 'https://example.test/'; expect(() => f.invoke('desktop-apps-list')).toThrow();
  f.event.senderFrame.url = 'file:///app/dist/index.html'; f.setDestroyed(true); expect(() => f.invoke('desktop-apps-list')).toThrow();
  f.setDestroyed(false); f.context.shutdownStarted = true; expect(() => f.invoke('desktop-apps-list')).toThrow();
  expect(f.list).not.toHaveBeenCalled(); expect(f.launch).not.toHaveBeenCalled();
});

it('does not enumerate or launch host applications in demo mode', async () => {
  const f = fixture(true); expect(await f.invoke('desktop-apps-list')).toMatchObject({available: false, apps: []});
  expect(() => f.invoke('desktop-apps-launch', f.event, 'app.desktop')).toThrow('demo mode');
  expect(f.list).not.toHaveBeenCalled(); expect(f.launch).not.toHaveBeenCalled();
});
