import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import * as jsxRuntime from 'react/jsx-runtime';
import * as icons from 'lucide-react';
import ts from 'typescript';
import type {CloudSessionState} from '../shared/cloud-stream';
import type {ConsoleStreamState} from '../shared/console-stream';
import {CLOUD_PLAYER_STAGES, CloudPlayerError} from './cloud-player';

type State = CloudSessionState | ConsoleStreamState;
const deferred = <T,>() => {let resolve!: (value: T) => void, reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};};

/** Executes the actual host and its dependency-sensitive effects without adding
 * a DOM test dependency. Provider pushes and IPC replies have separate clocks. */
function host(kind: 'cloud' | 'console') {
  let cursor = 0, dirty = false, mounted = true, listener: ((state: State) => void) | undefined;
  const slots: any[] = [], effects: (() => void)[] = [], writes = vi.fn(), remove = vi.fn();
  const read = vi.fn(async (id?: string): Promise<State> => id ? {phase: 'provisioning', id} : {phase: 'closed'});
  const stop = vi.fn(async (_id?: string) => {}), handle = {close: vi.fn(), pause: vi.fn(), guide: vi.fn(), mute: vi.fn()};
  const connect = vi.fn(async (_options: {id: string; changed?: (state: 'connected') => void}) => handle);
  const bridge = kind === 'cloud'
    ? {getCloudStreamState: read, onCloudStreamState: (callback: (state: State) => void) => {listener = callback; return remove;}, stopCloudStream: stop, exchangeCloudSdp: vi.fn(), exchangeCloudIce: vi.fn()}
    : {getConsoleStreamState: read, onConsoleStreamState: (callback: (state: State) => void) => {listener = callback; return remove;}, stopConsoleStream: stop, exchangeConsoleStreamSdp: vi.fn(), exchangeConsoleStreamIce: vi.fn()};
  const hooks = {
    useState(initial: unknown) {const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], (value: any) => {const next = typeof value === 'function' ? value(slots[index]) : value; writes(index, next); if (!Object.is(slots[index], next)) {slots[index] = next; dirty = true;}}];},
    useRef(initial: unknown) {return slots[cursor++] ??= {current: initial};},
    useEffect(effect: () => (() => void) | undefined, deps: unknown[]) {
      const index = cursor++, previous = slots[index];
      if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
        const slot = {deps, cleanup: undefined as (() => void) | undefined}; slots[index] = slot;
        effects.push(() => {previous?.cleanup?.(); slot.cleanup = effect();});
      }
    },
  };
  const videoListeners = new Map<string, Set<(event: {currentTarget: unknown}) => void>>();
  const video = {videoWidth: 1920, videoHeight: 1080,
    addEventListener(name: string, callback: (event: {currentTarget: unknown}) => void) {if (!videoListeners.has(name)) videoListeners.set(name, new Set()); videoListeners.get(name)!.add(callback);},
    removeEventListener(name: string, callback: (event: {currentTarget: unknown}) => void) {videoListeners.get(name)?.delete(callback);},
  };
  const container = {querySelectorAll: () => [video], querySelector: () => video, contains: (node: unknown) => node === video};
  const imports: Record<string, unknown> = {
    react: hooks, 'react/jsx-runtime': jsxRuntime, 'lucide-react': icons, './XboxIcons': icons,
    './ReferenceLocale': {useReferenceLocale: () => ({text: (english: string) => english})},
    './GamepadNavigation': {useBackHandler: () => {}},
    './stream-input': {claimStreamInput: () => {}, releaseStreamInput: () => {}, useStreamObscured: () => false},
    './cloud-player': {connectCloudPlayer: connect, CloudPlayerError, CLOUD_PLAYER_STAGES},
    './cloud-stream.css': {}, './console-library.css': {},
  };
  const exports: Record<string, any> = {};
  const code = ts.transpileModule(readFileSync(new URL(kind === 'cloud' ? './CloudStream.tsx' : './ConsoleStream.tsx', import.meta.url), 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX},
  }).outputText;
  runInNewContext(code, {exports, require: (id: string) => {if (!(id in imports)) throw Error(`Unexpected import: ${id}`); return imports[id];}, AbortController,
    setTimeout: (callback: () => void, delay: number) => setTimeout(callback, delay), clearTimeout: (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
    document: {activeElement: null, getElementById: () => container}, window: {addEventListener: () => {}, removeEventListener: () => {}},
    MutationObserver: class {observe() {} disconnect() {}},
  });
  const Component = kind === 'cloud' ? exports.CloudStreamHost : exports.ConsoleStreamHost;
  let tree: any;
  const render = () => {
    if (!mounted) return tree;
    let attempts = 0;
    do {dirty = false; cursor = 0; tree = Component({bridge}); effects.splice(0).forEach(effect => effect()); if (++attempts > 20) throw Error('Host render did not settle.');} while (dirty);
    return tree;
  };
  const flush = async () => {for (let i = 0; i < 6; i++) {await Promise.resolve(); render();}};
  const nodes = (node: any): any[] => node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)] : [];
  const text = (node: any): string => typeof node === 'string' ? node : node && typeof node === 'object' ? [node.props?.children].flat(Infinity).map(text).join(' ') : '';
  render();
  return {read, stop, connect, handle, writes, remove, flush,
    publish(state: State) {listener?.(state); render();},
    advance: async (ms: number) => {await vi.advanceTimersByTimeAsync(ms); await flush();},
    phase: () => tree?.props?.[kind === 'cloud' ? 'data-cloud-session-phase' : 'data-console-session-phase'],
    text: () => text(tree),
    playing() {connect.mock.calls.at(-1)?.[0].changed?.('connected'); for (const callback of videoListeners.get('playing') ?? []) callback({currentTarget: video}); render();},
    openMenu() {nodes(tree).find(node => node.type === 'button' && ['End cloud session','End remote play'].includes(node.props['aria-label']))?.props.onClick(); render();},
    cancelLabel: () => text(nodes(tree).find(node => node.type === 'button' && node.props['data-gamepad-cancel'])).trim(),
    returnToLibrary: () => nodes(tree).find(node => node.type === 'button' && node.props['data-gamepad-cancel'])?.props.onClick(),
    unmount() {mounted = false; slots.forEach(slot => slot?.cleanup?.());},
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {vi.clearAllTimers(); vi.useRealTimers();});

describe.each(['cloud', 'console'] as const)('%s stream host polling', kind => {
  it('continues after every same-phase push arrives before the IPC reply, then creates the player once ready', async () => {
    const app = host(kind); await app.flush(); let polls = 0;
    app.read.mockImplementation(async id => {
      const state: State = {phase: ++polls === 3 ? 'ready' : 'provisioning', id};
      app.publish(state); return state;
    });
    app.publish({phase: 'provisioning', id: 'owned'});
    await app.advance(1000); expect(polls).toBe(1); expect(app.phase()).toBe('provisioning');
    await app.advance(2000); expect(polls).toBe(2);
    await app.advance(2000); expect(polls).toBe(3); expect(app.phase()).toBe('ready'); expect(app.connect).toHaveBeenCalledOnce();
    await app.advance(10_000); expect(polls).toBe(3); app.unmount();
  });
  it('accepts a ready reply without a push and does not overlap a slow pending read', async () => {
    const app = host(kind); await app.flush(); const pending = deferred<State>();
    app.read.mockImplementation(() => pending.promise); app.publish({phase: 'starting', id: 'owned'});
    await app.advance(1000); await app.advance(10_000); expect(app.read).toHaveBeenCalledTimes(2);
    pending.resolve({phase: 'ready', id: 'owned'}); await app.flush();
    expect(app.phase()).toBe('ready'); expect(app.connect).toHaveBeenCalledOnce(); await app.advance(10_000); expect(app.read).toHaveBeenCalledTimes(2); app.unmount();
  });
  it('keeps a newer ready push when an older provisioning reply arrives afterwards', async () => {
    const app = host(kind); await app.flush(); const pending = deferred<State>();
    app.read.mockImplementation(() => pending.promise); app.publish({phase: 'provisioning', id: 'owned'}); await app.advance(1000);
    app.publish({phase: 'ready', id: 'owned'}); await app.flush(); pending.resolve({phase: 'provisioning', id: 'owned'}); await app.flush();
    expect(app.phase()).toBe('ready'); expect(app.connect).toHaveBeenCalledOnce(); await app.advance(10_000); expect(app.read).toHaveBeenCalledTimes(2); app.unmount();
  });
  it('ignores a ready reply for a replaced session and polls only the replacement', async () => {
    const app = host(kind); await app.flush(); const old = deferred<State>();
    app.read.mockImplementation(id => id === 'old' ? old.promise : Promise.resolve({phase: 'ready', id}));
    app.publish({phase: 'provisioning', id: 'old'}); await app.advance(1000); app.publish({phase: 'provisioning', id: 'new'});
    old.resolve({phase: 'ready', id: 'old'}); await app.flush(); expect(app.connect).not.toHaveBeenCalled();
    await app.advance(1000); expect(app.connect).toHaveBeenCalledOnce(); expect(app.connect.mock.calls[0]?.[0]).toMatchObject({id: 'new'}); app.unmount();
  });
  it.each(['error', 'closed'] as const)('does not resurrect a session after a %s push supersedes a pending read', async phase => {
    const app = host(kind); await app.flush(); const pending = deferred<State>();
    app.read.mockImplementation(() => pending.promise); app.publish({phase: 'provisioning', id: 'owned'}); await app.advance(1000);
    app.publish(phase === 'closed' ? {phase} : {phase, id: 'owned', error: 'service'}); pending.resolve({phase: 'ready', id: 'owned'}); await app.flush();
    expect(app.phase()).toBe(phase === 'closed' ? undefined : phase); expect(app.connect).not.toHaveBeenCalled(); await app.advance(10_000); expect(app.read).toHaveBeenCalledTimes(2); app.unmount();
  });
  it('disposes timers and ignores late replies or subscriptions after unmount', async () => {
    const app = host(kind); await app.flush(); const pending = deferred<State>();
    app.read.mockImplementation(() => pending.promise); app.publish({phase: 'provisioning', id: 'owned'}); await app.advance(1000); app.unmount();
    const writes = app.writes.mock.calls.length; pending.resolve({phase: 'ready', id: 'owned'}); app.publish({phase: 'ready', id: 'owned'}); await app.flush(); await app.advance(10_000);
    expect(app.writes).toHaveBeenCalledTimes(writes); expect(app.remove).toHaveBeenCalledOnce(); expect(app.connect).not.toHaveBeenCalled(); expect(app.read).toHaveBeenCalledTimes(2);
  });
  it('stops the loop and shows a failure when the current session read rejects', async () => {
    const app = host(kind); await app.flush(); app.read.mockRejectedValue(Error('private provider body'));
    app.publish({phase: 'provisioning', id: 'owned'}); await app.advance(1000);
    expect(app.text()).toContain(kind === 'cloud' ? 'Your cloud game could not connect' : 'Your console could not connect'); expect(app.text()).not.toContain('private provider body');
    await app.advance(10_000); expect(app.read).toHaveBeenCalledTimes(2); app.unmount();
  });
  it('preserves a newer push when a stale read rejects and continues the current session loop', async () => {
    const app = host(kind); await app.flush(); const pending = deferred<State>();
    app.read.mockImplementationOnce(() => pending.promise).mockImplementation(async id => ({phase: 'ready', id}));
    app.publish({phase: 'provisioning', id: 'owned'}); await app.advance(1000); app.publish({phase: 'provisioning', id: 'owned'});
    pending.reject(Error('stale response')); await app.flush(); expect(app.text()).not.toContain('could not connect');
    await app.advance(2000); expect(app.phase()).toBe('ready'); expect(app.connect).toHaveBeenCalledOnce(); app.unmount();
  });
  it('ends the current session without letting a late state reply reopen it', async () => {
    const app = host(kind); await app.flush(); const pending = deferred<State>();
    app.read.mockImplementation(() => pending.promise); app.publish({phase: 'provisioning', id: 'owned'}); await app.advance(1000);
    app.returnToLibrary(); await app.flush(); pending.resolve({phase: 'ready', id: 'owned'}); await app.flush();
    expect(app.stop).toHaveBeenCalledWith('owned'); expect(app.phase()).toBeUndefined(); expect(app.connect).not.toHaveBeenCalled(); await app.advance(10_000); expect(app.read).toHaveBeenCalledTimes(2); app.unmount();
  });
  it('resets the previous video and menu before a new session starts preparing', async () => {
    const app = host(kind); await app.flush(); app.publish({phase: 'ready', id: 'old'}); await app.flush(); app.playing(); app.openMenu();
    expect(app.cancelLabel()).toBe('Keep playing');
    app.publish({phase: 'provisioning', id: 'new'}); await app.flush();
    expect(app.cancelLabel()).toBe(kind === 'cloud' ? 'Return to cloud games' : 'Return to XBOKS'); expect(app.text()).not.toContain('Keep playing');
    app.returnToLibrary(); await app.flush(); expect(app.stop).toHaveBeenCalledWith('new'); expect(app.phase()).toBeUndefined(); app.unmount();
  });
});
