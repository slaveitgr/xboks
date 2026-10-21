// Runs only inside a fresh dbus-run-session. Never starts/imports GNOME Shell.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { helperForUnixSignals } from './legacy-unix-signals.mjs';
const processes = [];
const fixtureDirectory = await mkdtemp(path.join(os.tmpdir(), 'xboks-experience-protocol-'));
const legacyUnixSignals = process.argv.includes('--legacy-unix-signals');
function start(file) {
  const process = spawn('gjs', ['-m', file], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...globalThis.process.env, GIO_USE_VFS: 'local' } });
  processes.push(process);
  const messages = [], listeners = new Set(); let stderr = '';
  process.stderr.on('data', data => { stderr += data; });
  createInterface({ input: process.stdout }).on('line', line => {
    const message = JSON.parse(line); messages.push(message);
    for (const listener of listeners) listener(message);
  });
  const exited = new Promise(resolve => process.once('exit', (code, signal) => resolve({ code, signal })));
  const wait = predicate => {
    const present = messages.find(predicate); if (present) return Promise.resolve(present);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { listeners.delete(listener); reject(new Error(`Timed out: ${file}; stderr=${stderr}; messages=${JSON.stringify(messages)}`)); }, 4000);
      const listener = message => { if (predicate(message)) { clearTimeout(timeout); listeners.delete(listener); resolve(message); } };
      listeners.add(listener);
    });
  };
  return { process, messages, exited, wait, send: (id, method, action) => process.stdin.write(JSON.stringify({ id, method, ...(action ? {action} : {}) }) + '\n') };
}
try {
  const helperFile = await helperForUnixSignals('assets/desktop/experience-client.js', fixtureDirectory, legacyUnixSignals);
  const service = start('scripts/desktop/fixtures/experience-service.js');
  await service.wait(message => message.event === 'ready');
  const first = start(helperFile);
  await first.wait(message => message.event === 'state' && message.active === false);
  first.send(1, 'enter');
  assert.deepEqual(await first.wait(message => message.id === 1), { id: 1, ok: true, active: true, owned: true });
  first.send(10, 'capabilities'); assert.equal((await first.wait(message => message.id === 10)).version, 2);
  first.send(11, 'foreground'); assert.deepEqual((await first.wait(message => message.id === 11)).app,
    {desktopId: 'fixture.Editor.desktop', name: 'Editor', title: 'Synthetic document'});
  first.send(12, 'focus-guide'); assert.equal((await first.wait(message => message.id === 12)).ok, true);
  first.send(13, 'switcher', 'open'); assert.equal((await first.wait(message => message.id === 13)).visible, true);
  await first.wait(message => message.event === 'switcher' && message.visible === true);
  first.send(14, 'switcher', 'cancel'); assert.equal((await first.wait(message => message.id === 14)).visible, false);
  const second = start(helperFile);
  assert.deepEqual(await second.wait(message => message.event === 'state'), { event: 'state', active: true, owned: false });
  second.send(2, 'leave');
  assert.deepEqual(await second.wait(message => message.id === 2), { id: 2, ok: false, active: true, owned: false, error: 'not-authorized' });
  first.process.stdin.end();
  assert.deepEqual(await first.exited, { code: 0, signal: null });
  await service.wait(message => message.event === 'left');
  second.send(3, 'enter');
  assert.deepEqual(await second.wait(message => message.id === 3), { id: 3, ok: true, active: true, owned: true });
  second.process.kill('SIGKILL');
  await second.exited;
  await service.wait(message => message.event === 'owner-lost');
  const third = start(helperFile);
  assert.deepEqual(await third.wait(message => message.event === 'state'), { event: 'state', active: false, owned: false });
  third.send(4, 'enter');
  assert.equal((await third.wait(message => message.id === 4)).owned, true);
  third.send(5, 'invalid');
  assert.equal((await third.wait(message => message.id === 5)).error, 'invalid-command');
  third.process.kill('SIGTERM');
  assert.deepEqual(await third.exited, { code: 0, signal: null });
  assert.equal(service.messages.filter(message => message.event === 'left').length, 2);
  console.log(JSON.stringify({ status: 'passed', transport: 'real-gjs-isolated-dbus', unixSignals: legacyUnixSignals ? 'legacy-only' : 'native', ownership: true, eofLeave: true, sigtermLeave: true, killedOwnerRelease: true, hostShellEntered: false }));
} finally {
  for (const process of processes) process.kill('SIGKILL');
  await rm(fixtureDirectory, { recursive: true, force: true });
}
