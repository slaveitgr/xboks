import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { GnomeExperienceClient } from './experience-client.js';
import { FullscreenExperience } from './fullscreen-experience.js';
let root: string, client: GnomeExperienceClient;
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'xboks-experience-client-')); await fs.writeFile(path.join(root, 'helper.js'), '// fixture; never executed'); });
afterEach(async () => { client?.dispose(); await fs.rm(root, { recursive: true, force: true }); });
function fixture(timeoutMs = 1000) {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null as number | null,
    kill: vi.fn(() => { child.exitCode = 0; child.emit('close', 0); return true; }) });
  const start = vi.fn(() => child as unknown as ChildProcessWithoutNullStreams), messages: any[] = [], changed = vi.fn(), switcherChanged = vi.fn();
  child.stdin.on('data', bytes => { for (const line of String(bytes).trim().split('\n')) if (line) messages.push(JSON.parse(line)); });
  client = new GnomeExperienceClient({ helper: path.join(root, 'helper.js'), environment: { XDG_CURRENT_DESKTOP: 'ubuntu:GNOME' }, start, timeoutMs, changed, switcherChanged });
  return { child, start, messages, changed, switcherChanged, reply: (value: unknown) => child.stdout.write(JSON.stringify(value) + '\n') };
}
it('holds one helper connection across state/enter/leave and matches replies by id', async () => {
  const f = fixture();
  for (const method of ['state', 'enter', 'leave'] as const) {
    const request = client.request(method), id = f.messages.at(-1).id;
    f.reply({ id, ok: true, active: method === 'enter', owned: method === 'enter' });
    expect(await request).toMatchObject({ available: true, owned: method === 'enter' });
  }
  expect(f.start).toHaveBeenCalledOnce();
  client.dispose(); expect(f.child.kill).toHaveBeenCalledWith('SIGTERM');
});
it('does not infer ownership from global active state and accepts emergency release events', async () => {
  const f = fixture(), p = client.request('state');
  f.reply({ id: f.messages[0].id, ok: true, active: true, owned: false });
  expect((await p).owned).toBe(false);
  f.reply({ event: 'state', active: false, owned: false });
  expect(client.current.active).toBe(false);
});
it('fails pending requests without exposing arbitrary helper data on malformed or absent-service events', async () => {
  const f = fixture(), p = client.request('enter');
  const failed = expect(p).rejects.toThrow('not installed or enabled');
  f.reply({ event: 'unavailable', active: false, owned: false }); await failed;
  expect(client.current).toMatchObject({ available: false, owned: false });
  const q = client.request('state'), invalid = expect(q).rejects.toThrow('disconnected');
  f.reply({ id: f.messages.at(-1).id, ok: true, active: false, owned: true }); await invalid;
  expect(f.child.kill).toHaveBeenCalled();
});
it('drops an uncertain lease when a request times out or the helper exits', async () => {
  const f = fixture(10); await expect(client.request('enter')).rejects.toThrow('disconnected');
  expect(f.child.kill).toHaveBeenCalled();
  const second = fixture(), p = client.request('state'), rejected = expect(p).rejects.toThrow('disconnected');
  second.child.emit('close', 1); await rejected;
  expect(client.current.available).toBe(false);
});
it('does not promote an absent extension to available on a repeated state request', async () => {
  const f = fixture();
  for (let attempt = 0; attempt < 2; attempt++) {
    const p = client.request('state'), failed = expect(p).rejects.toThrow('GNOME could not change');
    f.reply({ id: f.messages.at(-1).id, ok: false, active: false, owned: false, error: 'unavailable' });
    await failed; expect(client.current.available).toBe(false);
  }
});
it('keeps foreground metadata separate from the shell lease and validates its bounds', async () => {
  const f = fixture(), p = client.foregroundApp();
  expect(f.messages[0].method).toBe('foreground');
  f.reply({ id: f.messages[0].id, ok: true, active: false, owned: false,
    app: { desktopId: 'org.example.Editor.desktop', name: 'Editor', title: 'Document' } });
  expect(await p).toEqual({ desktopId: 'org.example.Editor.desktop', name: 'Editor', title: 'Document' });
  expect(client.current).toEqual({ available: true, active: false, owned: false });
  const empty = client.foregroundApp();
  f.reply({ id: f.messages.at(-1).id, ok: true, active: false, owned: false, app: null });
  expect(await empty).toBeUndefined();
  const invalid = client.foregroundApp(), failed = expect(invalid).rejects.toThrow('disconnected');
  f.reply({ id: f.messages.at(-1).id, ok: true, active: false, owned: false,
    app: { desktopId: 'app.desktop', name: 'App', title: 'x'.repeat(513) } });
  await failed;
});
it('matches focus/capability/switcher replies and ignores untrusted switcher commands', async () => {
  const f = fixture(), focus = client.focusGuide();
  f.reply({ id: f.messages.at(-1).id, ok: true, active: true, owned: true }); expect(await focus).toBe(true);
  const caps = client.capabilities();
  f.reply({ id: f.messages.at(-1).id, ok: true, active: true, owned: true, version: 2 }); expect(await caps).toBe(2);
  const open = client.switcher('open'); expect(f.messages.at(-1)).toMatchObject({ method: 'switcher', action: 'open' });
  f.reply({ id: f.messages.at(-1).id, ok: true, active: true, owned: true, visible: true });
  expect(await open).toBe(true); expect(client.switcherVisible).toBe(true);
  f.reply({ event: 'switcher', active: true, owned: true, visible: false }); expect(client.switcherVisible).toBe(false);
  f.reply({ event: 'switcher', active: true, owned: false, visible: true }); expect(client.switcherVisible).toBe(false);
  await expect(client.switcher('arbitrary-command' as any)).rejects.toThrow('Invalid switcher action');
});
it('unsupported new methods do not disconnect an existing mode lease', async () => {
  const f = fixture(), focus = client.focusGuide(), failed = expect(focus).rejects.toThrow('GNOME could not change');
  f.reply({ id: f.messages.at(-1).id, ok: false, active: true, owned: true, error: 'unsupported' }); await failed;
  expect(client.current).toMatchObject({ available: true, active: true, owned: true });
  expect(f.child.kill).not.toHaveBeenCalled();
});
it('deduplicates lease notifications without losing repeated foreground, capability, focus or switcher replies', async () => {
  const f = fixture(), entered = client.request('enter'), lease = {active: true, owned: true};
  f.reply({id: f.messages.at(-1).id, ok: true, ...lease}); await entered;
  for (let index = 0; index < 10; index++) {
    const state = client.request('state'); f.reply({id: f.messages.at(-1).id, ok: true, ...lease});
    expect(await state).toEqual({available: true, ...lease});
    const app = {desktopId: 'org.example.Editor.desktop', name: 'Editor', title: `Document ${index}`};
    const foreground = client.foregroundApp(); f.reply({id: f.messages.at(-1).id, ok: true, ...lease, app}); expect(await foreground).toEqual(app);
    const version = index % 3 + 1, capabilities = client.capabilities(); f.reply({id: f.messages.at(-1).id, ok: true, ...lease, version}); expect(await capabilities).toBe(version);
    const focused = client.focusGuide(); f.reply({id: f.messages.at(-1).id, ok: true, ...lease}); expect(await focused).toBe(true);
    const visible = index % 2 === 0, switcher = client.switcher('next'); f.reply({id: f.messages.at(-1).id, ok: true, ...lease, visible}); expect(await switcher).toBe(visible);
    f.reply({event: 'state', ...lease});
  }
  // Previously all 51 replies plus 10 duplicate state events notified main.
  expect(f.messages).toHaveLength(51); expect(f.changed).toHaveBeenCalledOnce();
  expect(f.changed).toHaveBeenCalledWith({available: true, ...lease}); expect(f.switcherChanged).toHaveBeenCalledTimes(10);
  expect(f.start).toHaveBeenCalledOnce(); expect(f.child.kill).not.toHaveBeenCalled();
});
it('still publishes real availability, activity, ownership, reason and recovery changes', async () => {
  const f = fixture(), initial = client.request('state');
  f.reply({id: f.messages.at(-1).id, ok: true, active: false, owned: false}); await initial;
  f.reply({event: 'state', active: false, owned: false}); expect(f.changed).toHaveBeenCalledTimes(1);
  f.reply({event: 'state', active: true, owned: false}); expect(f.changed).toHaveBeenCalledTimes(2);
  f.reply({event: 'state', active: true, owned: true}); expect(f.changed).toHaveBeenCalledTimes(3);
  f.reply({event: 'state', active: false, owned: false}); expect(f.changed).toHaveBeenCalledTimes(4);
  f.reply({event: 'unavailable'}); f.reply({event: 'unavailable'}); expect(f.changed).toHaveBeenCalledTimes(5);
  const absent = client.request('state'), rejected = expect(absent).rejects.toThrow('GNOME could not change');
  f.reply({id: f.messages.at(-1).id, ok: false, active: false, owned: false, error: 'unavailable'}); await rejected;
  expect(f.changed).toHaveBeenCalledTimes(5); expect(client.current.reason).toContain('not installed or enabled');
  f.reply({event: 'state', active: false, owned: false}); expect(f.changed).toHaveBeenCalledTimes(6); expect(client.current.reason).toBeUndefined();
  f.reply({event: 'unavailable'}); expect(f.changed).toHaveBeenCalledTimes(7);
  client.dispose(); expect(f.changed).toHaveBeenCalledTimes(8); expect(client.current.reason).toContain('disconnected');
  client.dispose(); expect(f.changed).toHaveBeenCalledTimes(8);
});

it('acknowledges delegated switcher control without claiming the native mode lease', async () => {
  const f = fixture(), state = client.request('state');
  const delegated = { active: true, owned: false, canControlSwitcher: true, controlEpoch: 41, visible: true };
  f.reply({ id: f.messages.at(-1).id, ok: true, ...delegated }); await state;
  expect(client.current).toEqual({ available: true, active: true, owned: false, canControlSwitcher: true, controlEpoch: 41 });
  expect(client.canControlSwitcher).toBe(true); expect(client.switcherVisible).toBe(true);
  const fullscreen = new FullscreenExperience({ bridge: client, session: false, windowFullscreen: () => false,
    setWindowFullscreen: vi.fn(), changed: vi.fn() });
  expect(fullscreen.current).toMatchObject({ available: true, active: false, source: 'gnome-extension' });
  const moved = client.switcher('right');
  expect(f.messages.at(-1)).toEqual({ id: 2, method: 'switcher', action: 'right', controlEpoch: 41 });
  f.reply({ id: 2, ok: true, ...delegated }); expect(await moved).toBe(true);
  const cancelled = client.switcher('cancel');
  expect(f.messages.at(-1)).toMatchObject({ action: 'cancel', controlEpoch: 41 });
  f.reply({ id: 3, ok: true, ...delegated, controlEpoch: 42, visible: false });
  expect(await cancelled).toBe(false); expect(client.switcherVisible).toBe(false);
  expect(client.current.owned).toBe(false); expect(fullscreen.current.active).toBe(false);
});

it('clears delegated visibility on capability loss, inactivity, unavailable events and helper loss', async () => {
  const f = fixture(), state = client.request('state');
  const delegated = { active: true, owned: false, canControlSwitcher: true, controlEpoch: 10, visible: true };
  f.reply({ id: 1, ok: true, ...delegated }); await state;
  f.reply({ event: 'state', ...delegated, canControlSwitcher: false, controlEpoch: 11 });
  expect(client.canControlSwitcher).toBe(false); expect(client.switcherVisible).toBe(false);
  const count = f.messages.length;
  await expect(client.switcher('accept')).rejects.toThrow('control is unavailable'); expect(f.messages).toHaveLength(count);
  f.reply({ event: 'switcher', ...delegated, controlEpoch: 12 }); expect(client.switcherVisible).toBe(true);
  f.reply({ event: 'state', ...delegated, active: false, canControlSwitcher: false, controlEpoch: 13 });
  expect(client.canControlSwitcher).toBe(false); expect(client.switcherVisible).toBe(false);
  f.reply({ event: 'state', ...delegated, controlEpoch: 14 }); expect(client.switcherVisible).toBe(true);
  f.reply({ event: 'unavailable' }); expect(client.canControlSwitcher).toBe(false); expect(client.switcherVisible).toBe(false);
  f.reply({ event: 'state', ...delegated, controlEpoch: 15 }); expect(client.switcherVisible).toBe(true);
  f.child.emit('close', 1); expect(client.canControlSwitcher).toBe(false); expect(client.switcherVisible).toBe(false);
});

it('never upgrades an unowned switcher call when a later control grant arrives', async () => {
  const f = fixture(), state = client.request('state');
  f.reply({ id: 1, ok: true, active: true, owned: false }); await state;
  const denied = client.switcher('accept');
  f.reply({ event: 'state', active: true, owned: false, canControlSwitcher: true, controlEpoch: 21, visible: true });
  await expect(denied).rejects.toThrow('control is unavailable'); expect(f.messages).toHaveLength(1);
});

it.each(['delegated-to-owned', 'owned-to-delegated', 'new-token', 'capability-lost'] as const)(
  'keeps queued actions bound to their original control snapshot across %s', async transition => {
    const f = fixture(), state = client.request('state');
    const original = { active: true, owned: transition === 'owned-to-delegated', canControlSwitcher: true, controlEpoch: 50, visible: true };
    f.reply({ id: 1, ok: true, ...original }); await state;
    const first = client.switcher('next'), second = client.switcher('accept');
    const sent = f.messages.slice(1);
    expect(sent.map(message => message.controlEpoch)).toEqual(original.owned ? [undefined, undefined] : [50, 50]);
    const next = { ...original, owned: transition === 'delegated-to-owned', canControlSwitcher: transition !== 'capability-lost', controlEpoch: 51, visible: false };
    f.reply({ event: 'state', ...next });
    for (const command of sent) f.reply({ id: command.id, ok: true, ...original });
    expect(await first).toBe(false); expect(await second).toBe(false);
    expect(client.current).toEqual({ available: true, active: next.active, owned: next.owned, canControlSwitcher: next.canControlSwitcher, controlEpoch: 51 });
    expect(client.switcherVisible).toBe(false); expect(f.messages.slice(1)).toEqual(sent);
  });

it('uses current acknowledged visibility when an action signal precedes its reply', async () => {
  const f = fixture(), state = client.request('state');
  const delegated = { active: true, owned: false, canControlSwitcher: true, controlEpoch: 60, visible: false };
  f.reply({ id: 1, ok: true, ...delegated }); await state;
  const opened = client.switcher('open');
  f.reply({ event: 'switcher', ...delegated, controlEpoch: 61, visible: true });
  f.reply({ id: 2, ok: true, ...delegated, controlEpoch: 61, visible: true });
  expect(await opened).toBe(true); expect(client.current.controlEpoch).toBe(61); expect(client.current.owned).toBe(false);
  f.reply({ event: 'state', ...delegated });
  expect(client.current.controlEpoch).toBe(61); expect(client.switcherVisible).toBe(true);
});

it('keeps legacy owned switcher commands token-free, including helper v3 fields', async () => {
  const f = fixture(), caps = client.capabilities();
  const owned = { active: true, owned: true, canControlSwitcher: true, visible: false };
  f.reply({ id: 1, ok: true, ...owned, version: 3 }); expect(await caps).toBe(3);
  const opened = client.switcher('open'); expect(f.messages.at(-1)).toEqual({ id: 2, method: 'switcher', action: 'open' });
  f.reply({ id: 2, ok: true, ...owned, visible: true });
  expect(await opened).toBe(true); expect(client.canControlSwitcher).toBe(true);
});

it.each([
  { canControlSwitcher: 'true', controlEpoch: 1, visible: true },
  { canControlSwitcher: true, visible: true },
  { canControlSwitcher: true, controlEpoch: 0, visible: true },
  { canControlSwitcher: true, controlEpoch: -1, visible: true },
  { canControlSwitcher: true, controlEpoch: 1.5, visible: true },
  { canControlSwitcher: true, controlEpoch: Number.MAX_SAFE_INTEGER + 1, visible: true },
  { canControlSwitcher: true, controlEpoch: '1', visible: true },
  { canControlSwitcher: true, controlEpoch: 1 },
  { canControlSwitcher: true, controlEpoch: 1, visible: 'true' },
  { controlEpoch: 1, visible: true },
])('disconnects on malformed delegated control metadata %j', async metadata => {
  const f = fixture(), state = client.request('state'), failed = expect(state).rejects.toThrow('disconnected');
  f.reply({ id: 1, ok: true, active: true, owned: false, ...metadata }); await failed;
  expect(client.canControlSwitcher).toBe(false); expect(client.switcherVisible).toBe(false); expect(f.child.kill).toHaveBeenCalled();
});

it('rejects a claimed v4 capability without the atomic control token', async () => {
  const f = fixture(), caps = client.capabilities(), failed = expect(caps).rejects.toThrow('disconnected');
  f.reply({ id: 1, ok: true, active: true, owned: true, canControlSwitcher: true, visible: false, version: 4 });
  await failed; expect(client.current.available).toBe(false);
});

it('ignores unmatched reply ids without publishing their control metadata', async () => {
  const f = fixture(), state = client.request('state');
  const delegated = { active: true, owned: false, canControlSwitcher: true, controlEpoch: 70, visible: true };
  f.reply({ id: 1, ok: true, ...delegated }); await state;
  f.reply({ id: 999, ok: true, ...delegated, owned: true, controlEpoch: 71, visible: false });
  expect(client.current.owned).toBe(false); expect(client.current.controlEpoch).toBe(70); expect(client.switcherVisible).toBe(true);
});
