import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { GnomeExperienceClient } from './experience-client.js';
let root: string, client: GnomeExperienceClient;
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'xboks-experience-client-')); await fs.writeFile(path.join(root, 'helper.js'), '// fixture; never executed'); });
afterEach(async () => { client?.dispose(); await fs.rm(root, { recursive: true, force: true }); });
function fixture(timeoutMs = 1000) {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null as number | null,
    kill: vi.fn(() => { child.exitCode = 0; child.emit('close', 0); return true; }) });
  const start = vi.fn(() => child as unknown as ChildProcessWithoutNullStreams), messages: any[] = [];
  child.stdin.on('data', bytes => { for (const line of String(bytes).trim().split('\n')) if (line) messages.push(JSON.parse(line)); });
  client = new GnomeExperienceClient({ helper: path.join(root, 'helper.js'), environment: { XDG_CURRENT_DESKTOP: 'ubuntu:GNOME' }, start, timeoutMs });
  return { child, start, messages, reply: (value: unknown) => child.stdout.write(JSON.stringify(value) + '\n') };
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
