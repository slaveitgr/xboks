import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';
import * as jsxRuntime from 'react/jsx-runtime';
import * as icons from 'lucide-react';
import ts from 'typescript';
import type { KeyringStatus } from '../shared/types';

const ready: KeyringStatus = { state: 'ready', canStart: false, gameMode: true, message: 'The default system wallet is running and unlocked.' };
const tick = () => new Promise(resolve => setImmediate(resolve));
function runtime() {
  let cursor = 0, listener: ((value: KeyringStatus) => void) | undefined;
  const slots: any[] = [], effects: (() => void)[] = [], cleanups: (() => void)[] = [], writes = vi.fn(), unsubscribe = vi.fn();
  const api = { checkKeyring: vi.fn(async () => ready), startKeyring: vi.fn(async () => ready), createKeyringCollection: vi.fn(async () => ready),
    onKeyringStatus: vi.fn((callback: (value: KeyringStatus) => void) => { listener = callback; return unsubscribe; }) };
  const hooks = {
    useState: (initial: unknown) => { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], (value: unknown) => { writes(index, value); slots[index] = value; }]; },
    useRef: (initial: unknown) => { const index = cursor++; return slots[index] ??= { current: initial }; },
    useEffect: (effect: () => (() => void) | undefined) => { const index = cursor++; if (!(index in slots)) { slots[index] = true; effects.push(() => { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); }); } },
  };
  const exports: Record<string, any> = {}, imports: Record<string, unknown> = { react: hooks, 'react/jsx-runtime': jsxRuntime, 'lucide-react': icons, './XboxIcons': icons };
  const code = ts.transpileModule(readFileSync(new URL('./KeyringSetup.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  runInNewContext(code, { exports, require: (id: string) => { if (!(id in imports)) throw Error(`Unexpected import: ${id}`); return imports[id]; }, window: { launcher: api } });
  const nodes = (node: any): any[] => node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)] : [];
  const text = (node: any): string => typeof node === 'string' ? node : node && typeof node === 'object' ? [node.props?.children].flat(Infinity).map(text).join(' ') : '';
  const render = (props = {}) => { cursor = 0; const tree = exports.KeyringSetup(props); effects.splice(0).forEach(effect => effect()); return tree; };
  return { api, writes, unsubscribe, render, publish: (value: KeyringStatus) => listener?.(value), unmount: () => cleanups.splice(0).forEach(cleanup => cleanup()),
    button: (label: string, props = {}) => nodes(render(props)).find(node => node.type === 'button' && node.props['aria-label'] === label), text: () => text(render()) };
}

it('checks metadata on mount and lets trusted native state supersede a late check before explicit collection creation', async () => {
  const app = runtime(); let finish!: (value: KeyringStatus) => void;
  app.api.checkKeyring.mockImplementation(() => new Promise(resolve => { finish = resolve; })); app.render();
  expect(app.api.checkKeyring).toHaveBeenCalledOnce(); expect(app.api.startKeyring).not.toHaveBeenCalled(); expect(app.api.createKeyringCollection).not.toHaveBeenCalled();
  const setup = { ...ready, state: 'needs-setup' as const, canCreate: true, message: 'Choose a password in your provider window.' };
  app.publish(setup); finish(ready); await tick();
  expect(app.text()).toContain(setup.message); expect(app.button('Create wallet')).toBeDefined();
  app.button('Create wallet').props.onClick(); await tick();
  expect(app.api.createKeyringCollection).toHaveBeenCalledOnce(); expect(app.api.startKeyring).not.toHaveBeenCalled(); expect(app.button('Create wallet')).toBeUndefined();
});
it('uses the existing start IPC for an explicit native unlock and disables actions while it is pending', async () => {
  const app = runtime(); app.render(); await tick();
  const locked = { ...ready, state: 'locked' as const, canUnlock: true, message: 'Unlock in the native provider.' };
  app.publish(locked); let finish!: (value: KeyringStatus) => void;
  app.api.startKeyring.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  expect(app.button('Create wallet')).toBeUndefined(); app.button('Unlock wallet').props.onClick();
  expect(app.button('Unlock wallet').props.disabled).toBe(true); expect(app.button('Check keyring').props.disabled).toBe(true);
  finish({ ...locked, message: 'Wallet unlocking was cancelled. Your saved credentials are unchanged.' }); await tick();
  expect(app.text()).toContain('cancelled'); expect(app.api.startKeyring).toHaveBeenCalledOnce(); expect(app.api.createKeyringCollection).not.toHaveBeenCalled();
});
it('offers no unsupported wallet operation and never renders a raw helper failure', async () => {
  const app = runtime(); app.api.checkKeyring.mockRejectedValue(Error('private account token /provider/path')); app.render(); await tick();
  expect(app.text()).toContain('Keyring status could not be checked'); expect(app.text()).not.toMatch(/private account|provider\/path/);
  expect(app.button('Unlock wallet')).toBeUndefined(); expect(app.button('Create wallet')).toBeUndefined();
  app.publish({ ...ready, state: 'needs-setup' }); expect(app.button('Create wallet')).toBeUndefined();
  app.publish({ ...ready, state: 'locked', canUnlock: true }); expect(app.button('Unlock wallet', { disabled: true }).props.disabled).toBe(true);
});
it('unsubscribes native updates and discards pending metadata when the component unmounts', async () => {
  const app = runtime(); let finish!: (value: KeyringStatus) => void;
  app.api.checkKeyring.mockImplementation(() => new Promise(resolve => { finish = resolve; })); app.render(); app.unmount();
  const count = app.writes.mock.calls.length; finish(ready); await tick();
  expect(app.unsubscribe).toHaveBeenCalledOnce(); expect(app.writes.mock.calls).toHaveLength(count);
});
