import {afterEach, expect, it, vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {EventEmitter} from 'node:events';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the actual delivery and show/focus callbacks against owned windows.
// No Electron window, account, desktop session or backend is contacted.
const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true);
const declaration = (name: string) => ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name) as ts.FunctionDeclaration;
const windowBody = declaration('createWindow').body!.statements;
const resume = windowBody.filter(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
  && node.expression.expression.getText(ast) === 'mainWindow.on'
  && ['show', 'focus'].includes((node.expression.arguments[0] as ts.StringLiteral).text)
  && node.expression.arguments[1]?.getText(ast).includes('emitSnapshot')).map(node => node.getText(ast));
const compiled = ts.transpileModule([declaration('emitSnapshot').getText(ast), declaration('scheduleSnapshot').getText(ast), ...resume].join('\n'),
  {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None}}).outputText;
afterEach(() => vi.useRealTimers());

function fixture() {
  const state = {visible: true, minimized: false, focused: true, destroyed: false, contentsDestroyed: false, guideVisible: false, guideDestroyed: false, libraryRevision: 0};
  const contents = {isDestroyed: () => state.contentsDestroyed, send: vi.fn()};
  const guide = {isDestroyed: () => state.guideDestroyed, send: vi.fn()};
  const main = Object.assign(new EventEmitter(), {isDestroyed: () => state.destroyed, isVisible: () => state.visible,
    isMinimized: () => state.minimized, isFocused: () => state.focused, webContents: contents});
  const snapshot = vi.fn(() => ({libraryRevision: state.libraryRevision})), invalidate = vi.fn();
  const context = vm.createContext({mainWindow: main, desktopGuide: {webContents: guide}, guideIsVisible: () => state.guideVisible,
    fullscreenExperience: {current: {active: false}}, launchReady: true, snapshot, invalidateChangedCloudAccount: invalidate,
    snapshotTimer: undefined, clearTimeout, setTimeout});
  vm.runInContext(compiled, context);
  return {state, contents, guide, main, snapshot, invalidate, context, emit: () => context.emitSnapshot(), schedule: () => context.scheduleSnapshot()};
}

it('builds one current snapshot for both visible surfaces', () => {
  const h = fixture(); h.state.guideVisible = true; h.emit();
  expect(h.snapshot).toHaveBeenCalledOnce();
  expect(h.contents.send).toHaveBeenCalledWith('snapshot', {libraryRevision: 0});
  expect(h.guide.send).toHaveBeenCalledWith('snapshot', {libraryRevision: 0});
  expect(h.contents.send.mock.calls[0][1]).toBe(h.guide.send.mock.calls[0][1]);
});
it.each(['hidden', 'minimized', 'destroyed', 'contents-destroyed'] as const)('does not clone or send to %s launcher/hidden Guide, while invalidating account state', condition => {
  const h = fixture();
  if (condition === 'hidden') h.state.visible = false;
  else if (condition === 'minimized') h.state.minimized = true;
  else if (condition === 'destroyed') h.state.destroyed = true;
  else h.state.contentsDestroyed = true;
  for (let revision = 0; revision < 100; revision++) {h.state.libraryRevision = revision; h.emit();}
  expect(h.invalidate).toHaveBeenCalledTimes(100);
  expect(h.snapshot).not.toHaveBeenCalled(); expect(h.contents.send).not.toHaveBeenCalled(); expect(h.guide.send).not.toHaveBeenCalled();
});
it('keeps an unfocused visible desktop launcher current but defers a covered Xbox-mode launcher', () => {
  const h = fixture(); h.state.focused = false; h.emit(); expect(h.contents.send).toHaveBeenCalledOnce();
  h.contents.send.mockClear(); h.snapshot.mockClear(); h.context.fullscreenExperience.current.active = true;
  h.emit(); expect(h.snapshot).not.toHaveBeenCalled(); expect(h.contents.send).not.toHaveBeenCalled();
  h.state.guideVisible = true; h.emit(); expect(h.snapshot).toHaveBeenCalledOnce(); expect(h.guide.send).toHaveBeenCalledOnce(); expect(h.contents.send).not.toHaveBeenCalled();
});
it.each(['show', 'focus'] as const)('the actual %s callback immediately sends the latest deferred library state', event => {
  const h = fixture(); h.context.fullscreenExperience.current.active = true; h.state.focused = false; h.state.visible = false;
  h.emit(); h.state.libraryRevision = 17; h.emit(); expect(h.snapshot).not.toHaveBeenCalled();
  h.state.focused = true; h.state.visible = true; h.main.emit(event);
  expect(h.snapshot).toHaveBeenCalledOnce(); expect(h.contents.send).toHaveBeenCalledWith('snapshot', {libraryRevision: 17});
});
it('ignores startup focus/show until services are initialized and never sends to destroyed Guide contents', () => {
  const h = fixture(); h.context.launchReady = false; h.main.emit('show'); h.main.emit('focus'); expect(h.snapshot).not.toHaveBeenCalled();
  h.state.guideVisible = true; h.state.guideDestroyed = true; h.emit(); expect(h.contents.send).toHaveBeenCalledOnce(); expect(h.guide.send).not.toHaveBeenCalled();
});
it('coalesces queued updates and cancels pending delivery on an immediate hidden-state update', () => {
  vi.useFakeTimers(); const h = fixture(); h.schedule(); h.schedule(); vi.advanceTimersByTime(249); expect(h.snapshot).not.toHaveBeenCalled();
  h.state.visible = false; h.emit(); vi.advanceTimersByTime(1); expect(h.snapshot).not.toHaveBeenCalled(); expect(h.invalidate).toHaveBeenCalledOnce();
  h.state.visible = true; h.schedule(); h.state.libraryRevision = 3; vi.advanceTimersByTime(250);
  expect(h.snapshot).toHaveBeenCalledOnce(); expect(h.contents.send).toHaveBeenCalledWith('snapshot', {libraryRevision: 3});
});
