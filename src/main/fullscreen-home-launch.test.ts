import { expect, it } from 'vitest';
import { FullscreenHomeLaunch, fullscreenHomeRequested, fullscreenHomeInstanceData, fullscreenHomeInstanceRequested } from './shortcut-launch.js';
import { shortcutArguments, shortcutInstanceData, shortcutInstanceRequest } from './game-shortcuts.js';

it('keeps explicit home intent in the parsed singleton handoff without changing game/profile shortcuts', () => {
  expect(fullscreenHomeRequested(['--fullscreen-experience', '--xboks-profile', '/profile'])).toBe(true);
  expect(fullscreenHomeRequested(['--launch-game', '0123456789abcdef'])).toBe(false);
  const data = { ...shortcutInstanceData(shortcutArguments(['--xboks-profile', '/profile'])),
    ...fullscreenHomeInstanceData(true) };
  expect(shortcutInstanceRequest(data, '/profile')).toEqual({ profile: '/profile' });
  expect(fullscreenHomeInstanceRequested(JSON.parse(JSON.stringify(data)))).toBe(true);
  expect(fullscreenHomeInstanceRequested(shortcutInstanceData({}))).toBe(false);
  expect(fullscreenHomeInstanceRequested(fullscreenHomeInstanceData(false))).toBe(false);
  expect(() => shortcutInstanceRequest(data, '/different')).toThrow('different');
});

it('rejects ambiguous mode combinations and malformed singleton intent', () => {
  for (const arguments_ of [
    ['--fullscreen-experience', '--fullscreen-experience'], ['--fullscreen-experience=true'],
    ['--fullscreen-experience', '--launch-game', '0123456789abcdef'],
    ['--fullscreen-experience', '--game-bar'], ['--fullscreen-experience', '--gamebar-service'],
  ]) expect(() => fullscreenHomeRequested(arguments_)).toThrow();
  for (const request of [null, true, { schema: 2, requested: true }, { schema: 1, requested: 'true' },
    { schema: 1, requested: true, gameId: '0123456789abcdef' }])
    expect(() => fullscreenHomeInstanceRequested({ xboksFullscreenHome: request })).toThrow();
});

function fixture() {
  let time = 0, focused = false, valid = true, integration = false, active = false;
  const calls: string[] = [];
  const launch = new FullscreenHomeLaunch({
    show: async () => { calls.push('show'); }, valid: () => valid, focused: () => focused,
    active: () => active, integration: async () => { calls.push('integration'); return integration; },
    enter: async () => { calls.push('enter'); active = true; }, now: () => time,
    wait: async () => { calls.push('wait'); time += 250; focused = true; integration = time >= 500; }, timeoutMs: 1000,
  });
  return { launch, calls, focus: () => { focused = true; }, active: () => { active = true; },
    cancel: () => { valid = false; }, ready: () => { integration = true; }, now: () => time };
}

it('shows the launcher before waiting for focus and Shell integration, then enters once', async () => {
  const f = fixture();
  await f.launch.request();
  expect(f.calls).toEqual(['show', 'wait', 'integration', 'wait', 'integration', 'enter']);
  expect(f.now()).toBe(500);
});

it('coalesces a home activation received while the resident launcher is opening', async () => {
  const f = fixture();
  const first = f.launch.request(), second = f.launch.request();
  expect(first).toBe(second);
  await Promise.all([first, second]);
  expect(f.calls.filter(call => call === 'show')).toHaveLength(1);
  expect(f.calls.filter(call => call === 'enter')).toHaveLength(1);
  await f.launch.request();
  expect(f.calls.filter(call => call === 'show')).toHaveLength(2);
  expect(f.calls.filter(call => call === 'enter')).toHaveLength(1);
});

it('cancelled windows never enter and a later explicit request can retry', async () => {
  const f = fixture(); f.cancel();
  await expect(f.launch.request()).rejects.toThrow('cancelled');
  expect(f.calls).toEqual(['show']);
});

it('does not enter if focus or window ownership changes during the integration query', async () => {
  for (const cause of ['focus', 'window']) {
    let focused = true, valid = true, entered = false;
    const launch = new FullscreenHomeLaunch({ show: async () => {}, focused: () => focused, valid: () => valid,
      active: () => false, integration: async () => { if (cause === 'focus') focused = false; else valid = false; return true; },
      enter: async () => { entered = true; } });
    await expect(launch.request()).rejects.toThrow('interrupted');
    expect(entered).toBe(false);
  }
});

it('times out without entering if the extension is unavailable and requires an actual active acknowledgment', async () => {
  let time = 0, entered = 0;
  const options = { show: async () => {}, focused: () => true, valid: () => true, active: () => false,
    integration: async () => false, enter: async () => { entered++; }, now: () => time,
    wait: async () => { time += 250; }, timeoutMs: 500 };
  await expect(new FullscreenHomeLaunch(options).request()).rejects.toThrow('unavailable');
  expect(entered).toBe(0); expect(time).toBe(500);
  await expect(new FullscreenHomeLaunch({ ...options, integration: async () => true }).request()).rejects.toThrow('not acknowledged');
  expect(entered).toBe(1);
});

it('keeps the explicit failure visible and permits a fresh activation after an entry rejection', async () => {
  let calls = 0, active = false;
  const launch = new FullscreenHomeLaunch({ show: async () => {}, focused: () => true, valid: () => true,
    active: () => active, integration: async () => true,
    enter: async () => { if (++calls === 1) throw Error('Shell refused the lease'); active = true; } });
  await expect(launch.request()).rejects.toThrow('Shell refused');
  await launch.request();
  expect(calls).toBe(2);
});
