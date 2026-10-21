import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import type { DesktopGuideApi, LauncherApi } from '../shared/types.js';

const preload = ts.transpileModule(readFileSync('src/preload/index.cts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture() {
  const exposed = {} as { launcher: LauncherApi; desktopGuide: DesktopGuideApi };
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const invoke = vi.fn(async () => {});
  const clock = { monotonic: 0, wall: 0 };
  const wallClockRead = vi.fn(() => clock.wall);
  const ipcRenderer = {
    invoke,
    on: (channel: string, listener: (...args: unknown[]) => void) => {
      if (!listeners.has(channel)) listeners.set(channel, new Set());
      listeners.get(channel)!.add(listener);
    },
    removeListener: (channel: string, listener: (...args: unknown[]) => void) => listeners.get(channel)?.delete(listener),
  };
  vm.runInNewContext(preload, { exports: {}, performance: { now: () => clock.monotonic }, Date: { now: wallClockRead }, require: () => ({ ipcRenderer,
    contextBridge: { exposeInMainWorld: (name: keyof typeof exposed, api: never) => { exposed[name] = api; } },
  }) });
  return { ...exposed, invoke, clock, wallClockRead, emit: (channel: string) => { for (const listener of listeners.get(channel) ?? []) listener({}); } };
}

describe('Game Bar Xbox mode entry preload', () => {
  it('requests only the focused-sender main route and propagates a rejected request', async () => {
    const f=fixture();
    expect(f.invoke).not.toHaveBeenCalled();
    await f.desktopGuide.requestXboxModeEntry();
    expect(f.invoke.mock.calls).toEqual([['desktop-guide-xbox-mode-entry']]);
    f.invoke.mockRejectedValueOnce(Error('Guide lost focus'));
    await expect(f.desktopGuide.requestXboxModeEntry()).rejects.toThrow('Guide lost focus');
  });
  it('queues one main request until the lazily created renderer mounts its dialog host', () => {
    const f=fixture(),open=vi.fn();
    f.emit('xbox-mode-entry-requested'); f.emit('xbox-mode-entry-requested');
    expect(open).not.toHaveBeenCalled();
    const unsubscribe=f.launcher.onXboxModeEntryRequested(open);
    expect(open).toHaveBeenCalledOnce(); expect(f.invoke).not.toHaveBeenCalled();
    unsubscribe();
    const remount=vi.fn(); f.launcher.onXboxModeEntryRequested(remount);
    expect(remount).not.toHaveBeenCalled();
  });
  it('delivers later requests once and removes subscribers without replaying a consumed request', () => {
    const f=fixture(),first=vi.fn(),second=vi.fn();
    const unsubscribe=f.launcher.onXboxModeEntryRequested(first);
    f.emit('xbox-mode-entry-requested');expect(first).toHaveBeenCalledOnce();
    unsubscribe(); f.launcher.onXboxModeEntryRequested(second);
    expect(second).not.toHaveBeenCalled();
    f.emit('xbox-mode-entry-requested');expect(second).toHaveBeenCalledOnce();expect(first).toHaveBeenCalledOnce();
    f.emit('unrelated-renderer-event');expect(second).toHaveBeenCalledOnce();
    expect(f.invoke).not.toHaveBeenCalled();
  });
  it.each([4999,5000,5001])('expires a buffered request at the five-second monotonic boundary (%d ms)', age => {
    const f=fixture(),open=vi.fn();f.clock.monotonic=100;
    f.emit('xbox-mode-entry-requested');f.clock.monotonic+=age;
    const unsubscribe=f.launcher.onXboxModeEntryRequested(open);
    expect(open).toHaveBeenCalledTimes(age<5000?1:0);
    unsubscribe();f.clock.monotonic=100;
    const remount=vi.fn();f.launcher.onXboxModeEntryRequested(remount);
    expect(remount).not.toHaveBeenCalled();expect(f.invoke).not.toHaveBeenCalled();
  });
  it.each([-86_400_000,86_400_000])('ignores a wall-clock jump of %d ms when delivering a fresh request', wall => {
    const f=fixture(),open=vi.fn();f.clock.monotonic=100;
    f.emit('xbox-mode-entry-requested');f.clock.monotonic=5099;f.clock.wall=wall;
    f.launcher.onXboxModeEntryRequested(open);
    expect(open).toHaveBeenCalledOnce();expect(f.wallClockRead).not.toHaveBeenCalled();
  });
  it('lets a new explicit request supersede an expired buffered request', () => {
    const f=fixture(),open=vi.fn();f.emit('xbox-mode-entry-requested');
    f.clock.monotonic=10_000;f.emit('xbox-mode-entry-requested');f.clock.monotonic=10_001;
    f.launcher.onXboxModeEntryRequested(open);expect(open).toHaveBeenCalledOnce();
  });
});
