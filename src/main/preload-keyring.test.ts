import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { ModuleKind, transpileModule } from 'typescript';
it('exposes wallet create and native status with independent removable preload listeners', () => {
  let api: any; const on = vi.fn(), removeListener = vi.fn(), invoke = vi.fn();
  const electron = { contextBridge: { exposeInMainWorld: (name: string, value: unknown) => { if (name === 'launcher') api = value; } }, ipcRenderer: { on, removeListener, invoke } };
  const code = transpileModule(readFileSync('src/preload/index.cts', 'utf8'), { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  runInNewContext(code, { exports: {}, require: (name: string) => { expect(name).toBe('electron'); return electron; } });
  const first = vi.fn(), second = vi.fn(), offFirst = api.onKeyringStatus(first), offSecond = api.onKeyringStatus(second);
  const listeners = on.mock.calls.filter(([name]) => name === 'keyring-state').map(([, listener]) => listener);
  const status = { state: 'ready', canStart: false, gameMode: true, message: 'Ready' };
  listeners.forEach(listener => listener({ sender: 'not exposed' }, status)); expect(first).toHaveBeenCalledWith(status); expect(second).toHaveBeenCalledWith(status);
  offFirst(); expect(removeListener).toHaveBeenLastCalledWith('keyring-state', listeners[0]); offSecond(); expect(removeListener).toHaveBeenLastCalledWith('keyring-state', listeners[1]);
  api.createKeyringCollection(); expect(invoke).toHaveBeenCalledWith('keyring-create');
});
