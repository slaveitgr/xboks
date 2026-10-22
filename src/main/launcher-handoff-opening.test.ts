import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';

// Execute the production opening and creation functions with fake native
// windows. No Electron process, host window, account or desktop is touched.
const production = ts.createSourceFile('index.ts', readFileSync('src/main/index.ts', 'utf8'), ts.ScriptTarget.ES2022, true);
const names = ['showLauncher', 'createWindow'];
const functions = production.statements.filter(statement => ts.isFunctionDeclaration(statement) && names.includes(statement.name?.text ?? ''));
if (functions.length !== names.length) throw Error('Production launcher opening functions were not found.');
const extracted = ts.factory.updateSourceFile(production, functions);
const transformed = ts.transform(extracted, [context => {
  const visit: ts.Visitor = node => ts.isPropertyAccessExpression(node) && node.name.text === 'url' &&
    ts.isMetaProperty(node.expression) && node.expression.keywordToken === ts.SyntaxKind.ImportKeyword
    ? ts.factory.createStringLiteral('file:///fixture/src/main/index.ts') : ts.visitEachChild(node, visit, context);
  return root => ts.visitNode(root, visit) as ts.SourceFile;
}]);
const executable = ts.transpileModule(ts.createPrinter().printFile(transformed.transformed[0]), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
transformed.dispose();

function fixture({ maximized = false, devServer = false } = {}) {
  let finishLoad!: () => void;
  const loaded = new Promise<void>(resolve => { finishLoad = resolve; });
  const windows: NativeWindow[] = [];
  const refreshDeferredServiceAccount = vi.fn();
  class NativeWindow extends EventEmitter {
    visible: boolean;
    destroyed = false;
    minimized = true;
    webContents = Object.assign(new EventEmitter(), { id: 1, setWindowOpenHandler: vi.fn() });
    constructor(readonly options: { show: boolean }) {
      super(); this.visible = options.show; windows.push(this);
    }
    isDestroyed = () => this.destroyed;
    isMinimized = () => this.minimized;
    restore = vi.fn(() => { this.minimized = false; this.visible = true; });
    show = vi.fn(() => { this.visible = true; this.emit('show'); });
    focus = vi.fn();
    // Electron maximize can reveal a hidden window. Keep that behavior here
    // so an eager maximize in production would fail cancellation assertions.
    maximize = vi.fn(() => { this.visible = true; });
    loadURL = vi.fn(() => loaded);
    loadFile = vi.fn(() => loaded);
  }
  const context = createContext({
    mainWindow: null as NativeWindow | null, windowOpening: undefined as Promise<void> | undefined, shortcutOnly: true,
    BrowserWindow: NativeWindow, process: { env: devServer ? { VITE_DEV_SERVER_URL: 'http://fixture.invalid' } : {} },
    demoMode: false, path, fileURLToPath, URL, __dirname: '/fixture/dist-electron/main',
    readWindowState: () => ({ x: 0, y: 0, width: 1000, height: 700, maximized }), restoredBoundsOnScreen: () => true,
    voiceCapture: { release: vi.fn() }, refreshDeferredServiceAccount,
    launchReady: true, emitSnapshot: vi.fn(),
    // These operations remain inside callbacks that opening must only register.
    fullscreenExperience: { dispose: vi.fn() },
  });
  runInContext(executable, context);
  const actualCreateWindow = context.createWindow as (background?: boolean) => Promise<void>;
  const createWindow = vi.fn((background?: boolean) => actualCreateWindow(background));
  context.createWindow = createWindow;
  const showLauncher = context.showLauncher as (authorized?: () => boolean) => Promise<void>;
  return { context, windows, createWindow, showLauncher, finishLoad, refreshDeferredServiceAccount };
}

describe('production launcher opening during Game Bar handoff', () => {
  it.each(['Guide reopened','session locked'] as const)('never reveals or focuses a delayed creation after %s cancels the original request', async reason => {
    const f=fixture({maximized:true}),state={guideRevision:1,locked:false};
    const valid=()=>state.guideRevision===1&&!state.locked;
    const opening=f.showLauncher(valid),rejected=expect(opening).rejects.toThrow('cancelled');
    const native=f.windows[0];
    expect(f.createWindow).toHaveBeenCalledWith(true);expect(native.options.show).toBe(false);
    expect(native.visible).toBe(false);expect(native.maximize).not.toHaveBeenCalled();
    native.emit('ready-to-show');expect(native.visible).toBe(false);
    if(reason==='Guide reopened')state.guideRevision++;else state.locked=true;
    f.finishLoad();await rejected;
    expect(native.restore).not.toHaveBeenCalled();expect(native.show).not.toHaveBeenCalled();expect(native.focus).not.toHaveBeenCalled();
    expect(native.maximize).not.toHaveBeenCalled();expect(native.visible).toBe(false);
    expect(f.refreshDeferredServiceAccount).not.toHaveBeenCalled();expect(f.context.windowOpening).toBeUndefined();
  });
  it.each([false,true])('reveals a valid handoff once after load, deferring saved maximize until reveal (dev server=%s)',async devServer=>{
    const f=fixture({maximized:true,devServer}),valid=vi.fn(()=>true),opening=f.showLauncher(valid),native=f.windows[0];
    expect(native.options.show).toBe(false);native.emit('ready-to-show');
    expect(native.visible).toBe(false);expect(native.maximize).not.toHaveBeenCalled();expect(native.focus).not.toHaveBeenCalled();
    f.finishLoad();await opening;
    expect(native.restore).toHaveBeenCalledOnce();expect(native.show).toHaveBeenCalledOnce();expect(native.focus).toHaveBeenCalledOnce();
    expect(native.maximize).toHaveBeenCalledOnce();expect(native.visible).toBe(true);
    expect(devServer?native.loadURL:native.loadFile).toHaveBeenCalledOnce();expect(f.refreshDeferredServiceAccount).toHaveBeenCalledOnce();
    expect(f.context.emitSnapshot).toHaveBeenCalledOnce();
  });
  it('waits for an existing hidden creation without constructing or revealing another window',async()=>{
    const f=fixture({maximized:true});
    const existing=f.createWindow(true);f.context.windowOpening=existing;
    const opening=f.showLauncher(()=>true),native=f.windows[0];
    expect(f.createWindow).toHaveBeenCalledOnce();expect(native.show).not.toHaveBeenCalled();expect(native.focus).not.toHaveBeenCalled();
    f.finishLoad();await opening;
    expect(f.windows).toHaveLength(1);expect(native.show).toHaveBeenCalledOnce();expect(native.focus).toHaveBeenCalledOnce();
    expect(native.maximize).toHaveBeenCalledOnce();
  });
  it('rechecks cancellation after waiting for a creation that was already in progress',async()=>{
    const f=fixture();f.context.windowOpening=f.createWindow(true);
    let valid=true;const opening=f.showLauncher(()=>valid),rejected=expect(opening).rejects.toThrow('cancelled');
    valid=false;f.finishLoad();await rejected;
    const native=f.windows[0];expect(f.createWindow).toHaveBeenCalledOnce();
    expect(native.restore).not.toHaveBeenCalled();expect(native.show).not.toHaveBeenCalled();expect(native.focus).not.toHaveBeenCalled();
    expect(native.visible).toBe(false);
  });
  it.each([false,true])('never reveals a replacement main after delayed creation (reused opening=%s)',async reused=>{
    const f=fixture();
    if(reused)f.context.windowOpening=f.createWindow(true);
    const opening=f.showLauncher(()=>true),rejected=expect(opening).rejects.toThrow('cancelled'),original=f.windows[0];
    const replacement=new f.context.BrowserWindow({show:false});f.context.mainWindow=replacement;
    f.finishLoad();await rejected;
    for(const native of [original,replacement]) {
      expect(native.restore).not.toHaveBeenCalled();expect(native.show).not.toHaveBeenCalled();expect(native.focus).not.toHaveBeenCalled();
      expect(native.visible).toBe(false);
    }
    expect(f.refreshDeferredServiceAccount).not.toHaveBeenCalled();
  });
  it('leaves ordinary unguarded launch construction and ready-to-show behavior intact',async()=>{
    const f=fixture({maximized:true}),opening=f.showLauncher(),native=f.windows[0];
    expect(f.createWindow).toHaveBeenCalledWith(false);expect(native.options.show).toBe(true);
    expect(native.maximize).toHaveBeenCalledOnce();native.emit('ready-to-show');expect(native.show).toHaveBeenCalledOnce();
    f.finishLoad();await opening;
    expect(native.focus).toHaveBeenCalledOnce();expect(f.refreshDeferredServiceAccount).toHaveBeenCalledOnce();
  });
  it('rejects an already cancelled handoff before construction or any native action',async()=>{
    const f=fixture();await expect(f.showLauncher(()=>false)).rejects.toThrow('cancelled');
    expect(f.createWindow).not.toHaveBeenCalled();expect(f.windows).toHaveLength(0);expect(f.context.shortcutOnly).toBe(true);
  });
});
