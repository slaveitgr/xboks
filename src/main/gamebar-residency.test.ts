import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, expect, it } from 'vitest';
import { GameBarResidency, gameBarServiceEnabled } from './gamebar-residency.js';
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
it('keeps a service resident across closing all windows while honoring explicit Quit', () => {
  const service = new GameBarResidency(['--gamebar-service']);
  expect(service.keepsRunning(false)).toBe(true); expect(service.keepsRunning(true)).toBe(false);
  expect(service.shouldQuitWithoutWindows('linux', false)).toBe(false);
  const ordinary = new GameBarResidency([]); expect(ordinary.shouldQuitWithoutWindows('linux', false)).toBe(true);
  expect(ordinary.shouldQuitWithoutWindows('linux', true)).toBe(false);
  ordinary.activate(); expect(ordinary.keepsRunning(false)).toBe(true);
});
it('recognizes only an owned enabled xboks unit without creating anything', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'xboks-resident-')); directories.push(root);
  expect(await gameBarServiceEnabled(root)).toBe(false);
  const user = path.join(root, 'systemd/user'), unit = path.join(user, 'xboks-gamebar.service'), wanted = path.join(user, 'graphical-session.target.wants');
  await mkdir(wanted, { recursive: true }); await writeFile(unit, '# X-Xboks-GameBar-Service=1\n[Service]\n');
  expect(await gameBarServiceEnabled(root)).toBe(false);
  const link = path.join(wanted, 'xboks-gamebar.service'); await symlink(unit, link); expect(await gameBarServiceEnabled(root)).toBe(true);
  await writeFile(unit, 'unrelated service'); expect(await gameBarServiceEnabled(root)).toBe(false);
  await rm(unit); await writeFile(path.join(root, 'elsewhere'), '# X-Xboks-GameBar-Service=1\n'); await symlink(path.join(root, 'elsewhere'), unit);
  expect(await gameBarServiceEnabled(root)).toBe(false);
});
