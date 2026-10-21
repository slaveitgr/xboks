import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { activationProvider, secretServiceProvider } from './keyring-provider.js';

const roots: string[] = [];
const service = (exec = '/usr/bin/kwalletd6', name = 'org.freedesktop.secrets') =>
  `[D-BUS Service]\nName=${name}\nExec=${exec}\n`;
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xboks-keyring-provider-'));
  roots.push(root);
  const env = { HOME: root, XDG_RUNTIME_DIR: path.join(root, 'runtime'), XDG_DATA_HOME: path.join(root, 'user'),
    XDG_DATA_DIRS: path.join(root, 'local') + ':' + path.join(root, 'system') };
  const builtin = path.join(root, 'builtin');
  const write = async (base: string, name: string, text: string) => {
    const dir = path.join(base, 'dbus-1/services');
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, name);
    await fs.writeFile(file, text);
    return file;
  };
  return { root, env, builtin, write, lookup: () => secretServiceProvider(env, builtin) };
}
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });

describe('Secret Service activation provider metadata', () => {
  it.each([
    ['/usr/bin/kwalletd5', 'kwallet'], ['/usr/bin/kwalletd6', 'kwallet'],
    ['/usr/lib/ksecretd', 'ksecretd'], ['"/path with spaces/ksecretd" --arg', 'ksecretd'],
    ['/usr/bin/gnome-keyring-daemon --start --components=secrets', 'other'],
    ['/usr/bin/keepassxc', 'other'], ['/usr/bin/env ksecretd', 'other'],
    ['/usr/bin/not-kwalletd6', 'other'], ['/usr/bin/ksecretd-helper', 'other'],
    ['$(/usr/bin/ksecretd)', 'other'], ['"/usr/bin/ksecretd"; touch /tmp/no', 'unknown'],
  ])('identifies %s without executing it', (exec, provider) => {
    expect(activationProvider(service(exec))).toEqual({ name: 'org.freedesktop.secrets', provider });
  });
  it('handles comments, whitespace and CRLF, not unrelated sections', () => {
    expect(activationProvider(' # comment\r\n[D-BUS Service]\r\n Name = org.freedesktop.secrets \r\n Exec = /usr/bin/ksecretd \r\n[Other]\r\nExec=/usr/bin/kwalletd6\r\n'))
      .toEqual({ name: 'org.freedesktop.secrets', provider: 'ksecretd' });
  });
  it.each([
    service() + 'Exec=/usr/bin/gnome-keyring-daemon\n', service() + 'Name=another.service\n',
    '[D-BUS Service]\nName=org.freedesktop.secrets\n', service() + '\0', 'x'.repeat(16385),
    service() + 'SystemdService=some-other-provider.service\n',
  ])('returns unknown for ambiguous or invalid metadata', text => {
    expect(activationProvider(text).provider).toBe('unknown');
  });
  it('recognizes the explicit KDE systemd unit without trusting arbitrary units', () => {
    expect(activationProvider(service('/usr/bin/ksecretd') + 'SystemdService=plasma-ksecretd.service\n').provider).toBe('ksecretd');
  });
  it.each(['kwalletd5', 'kwalletd6', 'ksecretd'])('finds generic-only activation backed by %s', async binary => {
    const f = await fixture();
    await f.write(f.env.XDG_DATA_HOME, 'org.freedesktop.secrets.service', service('/usr/bin/' + binary));
    expect(await f.lookup()).toBe(binary === 'ksecretd' ? 'ksecretd' : 'kwallet');
  });
  it('honors runtime, user and system directory precedence, including provider symlinks', async () => {
    const f = await fixture();
    const target = await f.write(f.builtin, 'org.freedesktop.secrets.service', service());
    await f.write(f.env.XDG_DATA_HOME, 'gnome-keyring.service', service('/usr/bin/gnome-keyring-daemon'));
    expect(await f.lookup()).toBe('other');
    const runtime = path.join(f.env.XDG_RUNTIME_DIR, 'dbus-1/services');
    await fs.mkdir(runtime, { recursive: true });
    await fs.symlink(target, path.join(runtime, 'org.freedesktop.secrets.service'));
    expect(await f.lookup()).toBe('kwallet');
  });
  it('does not select arbitrary duplicate registrations in the same directory', async () => {
    const f = await fixture();
    await f.write(f.env.XDG_DATA_HOME, 'org.freedesktop.secrets.service', service());
    await f.write(f.env.XDG_DATA_HOME, 'gnome.service', service('/usr/bin/gnome-keyring-daemon'));
    expect(await f.lookup()).toBe('unknown');
  });
  it('does not infer generic ownership from KDE-specific activation files', async () => {
    const f = await fixture();
    await f.write(f.env.XDG_DATA_HOME, 'org.kde.kwalletd6.service', service('/usr/bin/kwalletd6', 'org.kde.kwalletd6'));
    expect(await f.lookup()).toBe('unknown');
  });
  it('ignores noncanonical transient service names', async () => {
    const f = await fixture();
    await f.write(f.env.XDG_RUNTIME_DIR, 'renamed.service', service());
    expect(await f.lookup()).toBe('unknown');
  });
  it('rejects nonregular, oversized and invalid UTF8 metadata without falling through to a lower provider', async () => {
    for (const invalid of ['directory', 'oversized', 'encoding']) {
      const f = await fixture();
      await f.write(f.builtin, 'org.freedesktop.secrets.service', service());
      const file = await f.write(f.env.XDG_DATA_HOME, 'org.freedesktop.secrets.service', service());
      if (invalid === 'directory') { await fs.unlink(file); await fs.mkdir(file); }
      if (invalid === 'oversized') await fs.writeFile(file, 'x'.repeat(16385));
      if (invalid === 'encoding') await fs.writeFile(file, Buffer.from([0xff, 0xfe]));
      expect(await f.lookup()).toBe('unknown');
    }
  });
  it('handles missing, relative and excessive search paths conservatively', async () => {
    const f = await fixture();
    expect(await f.lookup()).toBe('unknown');
    expect(await secretServiceProvider({ HOME: f.root, XDG_DATA_HOME: 'relative', XDG_DATA_DIRS: 'also-relative' }, f.builtin)).toBe('unknown');
    expect(await secretServiceProvider({ ...f.env, XDG_DATA_DIRS: Array(40).fill(f.root).join(':') }, f.builtin)).toBe('unknown');
  });
});
