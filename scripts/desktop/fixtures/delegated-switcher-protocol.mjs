// Runs only under dbus-run-session against synthetic services and real GJS.
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {helperForUnixSignals} from './legacy-unix-signals.mjs';

if (process.env.XBOKS_PRIVATE_PROTOCOL_TEST !== '1')
  throw new Error('Use delegated-switcher-transport.test.mjs to create an isolated bus.');
const processes = [], directory = await mkdtemp(path.join(os.tmpdir(), 'xboks-delegated-switcher-'));
const legacyUnixSignals = process.argv.includes('--legacy-unix-signals');
const deadline = setTimeout(() => {
  for (const child of processes) child.kill('SIGKILL');
  process.stderr.write('Private delegated switcher protocol test exceeded its deadline.\n');
  process.exit(1);
}, 15000);
function start(file, args = []) {
  const child = spawn('gjs', ['-m', file, ...args], {stdio: ['pipe', 'pipe', 'pipe'], env: {...process.env, GIO_USE_VFS: 'local'}});
  processes.push(child);
  const messages = [], listeners = new Set(); let stderr = '';
  child.stderr.on('data', data => { stderr += data; });
  createInterface({input: child.stdout}).on('line', line => {
    const message = JSON.parse(line); messages.push(message);
    for (const listener of listeners) listener(message);
  });
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({code, signal})));
  const wait = (predicate, after = 0) => {
    const existing = messages.slice(after).find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        listeners.delete(listener);
        reject(new Error(`Timed out: ${file}; stderr=${stderr}; messages=${JSON.stringify(messages)}`));
      }, 5000);
      const listener = message => {
        if (predicate(message)) { clearTimeout(timeout); listeners.delete(listener); resolve(message); }
      };
      listeners.add(listener);
    });
  };
  const send = request => {
    const after = messages.length;
    child.stdin.write(`${JSON.stringify(request)}\n`);
    return wait(message => message.id === request.id, after);
  };
  return {child, messages, wait, send, exited};
}
let fixtureId = 0;
const fixture = (service, command, fields = {}) => service.send({id: `fixture-${++fixtureId}`, command, ...fields});
const flags = (message, expected) => {
  for (const [key, value] of Object.entries(expected)) assert.equal(message[key], value, `${key}: ${JSON.stringify(message)}`);
  assert.equal(typeof message.canControlSwitcher, 'boolean');
  assert.equal(typeof message.visible, 'boolean');
};
try {
  const helperFile = await helperForUnixSignals('assets/desktop/experience-client.js', directory, legacyUnixSignals);
  const service = start('scripts/desktop/fixtures/delegated-switcher-service.js');
  await service.wait(message => message.event === 'ready');
  const helper = start(helperFile);
  let state = await helper.wait(message => message.event === 'state');
  flags(state, {active: true, owned: false, canControlSwitcher: true, visible: false, controlEpoch: 1});
  flags(await helper.send({id: 1, method: 'capabilities'}), {ok: true, version: 4, owned: false, canControlSwitcher: true});

  let id = 2;
  const invalid = [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, null, '1', true];
  for (const controlEpoch of invalid)
    flags(await helper.send({id: id++, method: 'switcher', action: 'open', controlEpoch}), {ok: false, error: 'invalid-command'});
  for (const method of ['state', 'enter', 'leave', 'foreground', 'focus-guide', 'capabilities'])
    flags(await helper.send({id: id++, method, controlEpoch: 1}), {ok: false, error: 'invalid-command'});
  flags(await helper.send({id: id++, method: 'switcher', action: 'open', expectedControlEpoch: 1}), {ok: false, error: 'invalid-command'});
  assert.equal(service.messages.some(message => ['Switch', 'ControlSwitcher', 'Enter', 'Leave'].includes(message.method)), false);

  const originalToken = state.controlEpoch;
  state = await helper.send({id: id++, method: 'switcher', action: 'open', controlEpoch: originalToken});
  flags(state, {ok: true, active: true, owned: false, canControlSwitcher: true, visible: true});
  assert.ok(state.controlEpoch > originalToken);
  assert.deepEqual(service.messages.find(message => message.method === 'ControlSwitcher'),
    {method: 'ControlSwitcher', action: 'open', expectedControlEpoch: originalToken});
  flags(await helper.send({id: id++, method: 'switcher', action: 'cancel'}),
    {ok: false, error: 'not-authorized', owned: false, visible: true});
  assert.equal(service.messages.filter(message => message.method === 'Switch').at(-1).action, 'cancel');
  flags(await helper.send({id: id++, method: 'switcher', action: 'next', controlEpoch: originalToken}),
    {ok: false, error: 'stale-control', visible: true});
  flags(await helper.send({id: id++, method: 'switcher', action: 'next', controlEpoch: Number.MAX_SAFE_INTEGER}),
    {ok: false, error: 'stale-control', visible: true});
  assert.equal(service.messages.filter(message => message.method === 'ControlSwitcher').at(-1).expectedControlEpoch, Number.MAX_SAFE_INTEGER);

  const beforeRevocation = state.controlEpoch;
  const revoked = await fixture(service, 'delegation', {allowed: false});
  state = await helper.send({id: id++, method: 'state'});
  flags(state, {active: true, owned: false, canControlSwitcher: false, visible: false, controlEpoch: revoked.controlEpoch});
  flags(await helper.send({id: id++, method: 'switcher', action: 'cancel', controlEpoch: beforeRevocation}),
    {ok: false, error: 'not-authorized', canControlSwitcher: false, visible: false});
  flags(await helper.send({id: id++, method: 'switcher', action: 'cancel', controlEpoch: state.controlEpoch}),
    {ok: false, error: 'not-authorized', owned: false});
  await fixture(service, 'delegation', {allowed: true});
  state = await helper.send({id: id++, method: 'state'});
  flags(state, {owned: false, canControlSwitcher: true, visible: true});
  state = await helper.send({id: id++, method: 'switcher', action: 'cancel', controlEpoch: state.controlEpoch});
  flags(state, {ok: true, visible: false, owned: false});

  // Hold an old snapshot while a newer signal query completes. The queued
  // delegated action must retain its captured token and fail after the change.
  await fixture(service, 'hold-next-query');
  let queryMark = service.messages.length, helperMark = helper.messages.length;
  const pendingState = helper.send({id: id++, method: 'state'});
  await service.wait(message => message.method === 'GetSwitcherControl' && message.held, queryMark);
  const capturedToken = state.controlEpoch;
  const queuedAction = helper.send({id: id++, method: 'switcher', action: 'next', controlEpoch: capturedToken});
  const changed = await fixture(service, 'visibility', {visible: true});
  await helper.wait(message => message.event === 'switcher' && message.controlEpoch === changed.controlEpoch, helperMark);
  helperMark = helper.messages.length;
  await fixture(service, 'release-query');
  flags(await pendingState, {controlEpoch: changed.controlEpoch, visible: true});
  flags(await queuedAction, {ok: false, error: 'stale-control', controlEpoch: changed.controlEpoch, visible: true});
  assert.equal(service.messages.filter(message => message.method === 'ControlSwitcher').at(-1).expectedControlEpoch, capturedToken);
  assert.ok(helper.messages.slice(helperMark).every(message => message.controlEpoch === undefined || message.controlEpoch >= changed.controlEpoch));

  await fixture(service, 'native', {active: false});
  state = await helper.send({id: id++, method: 'state'});
  flags(state, {active: false, owned: false, canControlSwitcher: false, visible: false});
  state = await helper.send({id: id++, method: 'enter'});
  flags(state, {ok: true, active: true, owned: true, canControlSwitcher: false});
  state = await helper.send({id: id++, method: 'switcher', action: 'open'});
  flags(state, {ok: true, owned: true, visible: true});
  assert.equal(service.messages.filter(message => message.method === 'Switch').at(-1).action, 'open');

  // An old owner-only action queued before a Native takeover stays owner-only,
  // even though its sender gains delegated control before it is dispatched.
  await fixture(service, 'hold-next-query');
  queryMark = service.messages.length; helperMark = helper.messages.length;
  const oldOwnerState = helper.send({id: id++, method: 'state'});
  await service.wait(message => message.method === 'GetSwitcherControl' && message.held, queryMark);
  const oldOwnerAction = helper.send({id: id++, method: 'switcher', action: 'open'});
  const native = await fixture(service, 'native', {active: true});
  await helper.wait(message => message.event === 'state' && message.controlEpoch === native.controlEpoch, helperMark);
  await fixture(service, 'release-query');
  flags(await oldOwnerState, {owned: false, canControlSwitcher: true, controlEpoch: native.controlEpoch});
  flags(await oldOwnerAction, {ok: false, error: 'not-authorized', owned: false, canControlSwitcher: true, visible: false});
  assert.equal(service.messages.filter(message => ['Switch', 'ControlSwitcher'].includes(message.method)).at(-1).method, 'Switch');
  assert.equal(service.messages.some(message => message.method === 'GetState'), false, 'v4 uses a single atomic state query');

  const leaveCount = service.messages.filter(message => message.method === 'Leave').length;
  helper.child.stdin.end();
  assert.deepEqual(await helper.exited, {code: 0, signal: null});
  const terminated = start(helperFile);
  await terminated.wait(message => message.event === 'state' && message.canControlSwitcher);
  terminated.child.kill('SIGTERM');
  assert.deepEqual(await terminated.exited, {code: 0, signal: null});
  assert.equal(service.messages.filter(message => message.method === 'Leave').length, leaveCount);
  assert.equal((await fixture(service, 'inspect')).nativeOwned, true);
  const lost = start(helperFile);
  state = await lost.wait(message => message.event === 'state');
  state = await lost.send({id: 1, method: 'switcher', action: 'open', controlEpoch: state.controlEpoch});
  flags(state, {ok: true, active: true, owned: false, canControlSwitcher: true, visible: true});
  await fixture(service, 'drop-name');
  const unavailable = await lost.wait(message => message.event === 'unavailable');
  flags(unavailable, {active: false, owned: false, canControlSwitcher: false, visible: false});
  assert.equal(Object.hasOwn(unavailable, 'controlEpoch'), false);
  lost.child.stdin.end(); await lost.exited;
  service.child.stdin.end();
  await service.exited;

  // Version 3 does not know either delegated method. It still supports the
  // owned Switch path, and cannot fabricate ownership or delegated capability.
  const legacy = start('scripts/desktop/fixtures/delegated-switcher-service.js', ['--v3']);
  await legacy.wait(message => message.event === 'ready');
  const old = start(helperFile);
  state = await old.wait(message => message.event === 'state');
  flags(state, {active: true, owned: false, canControlSwitcher: false, visible: false});
  assert.equal(Object.hasOwn(state, 'controlEpoch'), false);
  flags(await old.send({id: 1, method: 'capabilities'}), {ok: true, version: 3});
  flags(await old.send({id: 2, method: 'switcher', action: 'open', controlEpoch: 1}), {ok: false, error: 'unsupported', owned: false});
  flags(await old.send({id: 3, method: 'switcher', action: 'open'}), {ok: false, error: 'not-authorized', visible: false});
  await fixture(legacy, 'native', {active: false});
  flags(await old.send({id: 4, method: 'enter'}), {ok: true, active: true, owned: true, canControlSwitcher: false});
  flags(await old.send({id: 5, method: 'switcher', action: 'open'}), {ok: true, visible: true, owned: true});
  flags(await old.send({id: 6, method: 'switcher', action: 'cancel'}), {ok: true, visible: false});
  assert.ok(legacy.messages.some(message => message.method === 'GetState'));
  old.child.stdin.end(); assert.deepEqual(await old.exited, {code: 0, signal: null});
  assert.equal(legacy.messages.filter(message => message.method === 'Leave').length, 1);
  console.log(JSON.stringify({status: 'passed', atomicSnapshots: true, nativeLeaseReleased: false, hostShellEntered: false,
    unixSignals: legacyUnixSignals ? 'legacy-only' : 'native'}));
} finally {
  clearTimeout(deadline);
  for (const child of processes) child.kill('SIGKILL');
  await rm(directory, {recursive: true, force: true});
}
