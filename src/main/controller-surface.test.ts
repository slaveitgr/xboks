import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true);
const declaration = (name: string) => ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name) as ts.FunctionDeclaration;
const controller = ast.statements.filter(ts.isVariableStatement).flatMap(node => [...node.declarationList.declarations])
  .find(node => node.name.getText(ast) === 'gameBarController')!.initializer as ts.NewExpression;
const options = controller.arguments![0] as ts.ObjectLiteralExpression;
const onInput = options.properties.find(node => node.name?.getText(ast) === 'onInput') as ts.PropertyAssignment;
const compiled = ts.transpileModule([
  declaration('updateControllerSurface').getText(ast), declaration('toggleDesktopGuide').getText(ast),
  `const onInput = ${onInput.initializer.getText(ast)};`,
].join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;

function fixture() {
  const guide = { focused: false, visible: false };
  const bridge = { current: { available: true, active: true, owned: false, canControlSwitcher: true, controlEpoch: 10 },
    canControlSwitcher: true, switcherVisible: true,
    switcher: vi.fn(async (action: string) => { if (action === 'cancel') bridge.switcherVisible = false; return bridge.switcherVisible; }),
    foregroundApp: vi.fn(async () => undefined) };
  const desktopGuide = { webContents: { send: vi.fn() }, toggle: vi.fn(async () => { guide.visible = !guide.visible; guide.focused = guide.visible; }) };
  const setSurface = vi.fn(), emitSnapshot = vi.fn(), refreshDeferredServiceAccount = vi.fn();
  const context = vm.createContext({ experienceBridge: bridge, fullscreenExperience: { current: { active: false } },
    desktopGuide, gameBarController: { setSurface }, desktopSettingsStatus: { gameBarController: {} },
    guideIsFocused: () => guide.focused, guideIsVisible: () => guide.visible,
    quitting: false, shutdownStarted: false, demoMode: false, launchReady: true, navigationSurface: 'none', guideForeground: undefined,
    guideInputActions: ['up', 'down', 'left', 'right', 'accept', 'back'], emitSnapshot, refreshDeferredServiceAccount });
  vm.runInContext(compiled, context);
  return { bridge, guide, desktopGuide, context, setSurface, emitSnapshot,
    update: () => context.updateControllerSurface(),
    input: (action: string, surface: string) => vm.runInContext(`onInput(${JSON.stringify(action)}, ${JSON.stringify(surface)})`, context),
    toggle: () => context.toggleDesktopGuide() };
}

it('routes the acknowledged delegated switcher while the app owns no fullscreen lease', async () => {
  const f = fixture(); f.update();
  expect(f.bridge.current.owned).toBe(false); expect(f.context.fullscreenExperience.current.active).toBe(false);
  expect(f.context.navigationSurface).toBe('switcher'); expect(f.setSurface).toHaveBeenLastCalledWith('switcher');
  await f.input('right', 'switcher'); await f.input('back', 'switcher');
  expect(f.bridge.switcher.mock.calls.map(([action]) => action)).toEqual(['right', 'cancel']);
  expect(f.desktopGuide.webContents.send).not.toHaveBeenCalled();
});

it('requires both control permission and acknowledged visibility before assigning the switcher surface', () => {
  const f = fixture(); f.bridge.canControlSwitcher = false; f.update(); expect(f.setSurface).toHaveBeenLastCalledWith('none');
  f.guide.focused = true; f.update(); expect(f.setSurface).toHaveBeenLastCalledWith('guide');
  f.bridge.canControlSwitcher = true; f.bridge.switcherVisible = false; f.update(); expect(f.setSurface).toHaveBeenLastCalledWith('guide');
  f.bridge.switcherVisible = true; f.context.shutdownStarted = true; f.update(); expect(f.setSurface).toHaveBeenLastCalledWith('none');
});

it('the Guide shortcut awaits delegated switcher cancellation before showing and routing the Guide', async () => {
  const f = fixture(); let acknowledge!: () => void;
  f.bridge.switcher.mockImplementationOnce(async () => { await new Promise<void>(resolve => { acknowledge = resolve; }); f.bridge.switcherVisible = false; return false; });
  const opened = f.toggle();
  expect(f.bridge.switcher).toHaveBeenCalledWith('cancel'); expect(f.desktopGuide.toggle).not.toHaveBeenCalled();
  acknowledge(); await opened; f.update();
  expect(f.guide.visible).toBe(true); expect(f.setSurface).toHaveBeenLastCalledWith('guide');
  await f.input('accept', 'guide'); expect(f.desktopGuide.webContents.send).toHaveBeenCalledWith('desktop-guide-input', 'accept');
  expect(f.bridge.current.owned).toBe(false); expect(f.context.fullscreenExperience.current.active).toBe(false);
});

it('a rejected queued cancel cannot open Guide over a switcher that remains visible', async () => {
  const f = fixture();
  f.bridge.switcher.mockRejectedValueOnce(Error('stale-control'));
  await f.toggle();
  expect(f.bridge.switcherVisible).toBe(true);
  expect(f.desktopGuide.toggle).not.toHaveBeenCalled();
  expect(f.bridge.foregroundApp).not.toHaveBeenCalled();
  f.update(); expect(f.setSurface).toHaveBeenLastCalledWith('switcher');
});
