import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

let hasGjs = true;
try { execFileSync('gjs', ['--version'], {stdio: 'pipe'}); } catch { hasGjs = false; }

test('actual GJS legacy signal APIs reversibly lease only synthetic unblocked handlers with an eight-handler limit', {skip: !hasGjs}, () => {
  const stdout = execFileSync('gjs', ['-m', 'scripts/desktop/fixtures/gobject-overlay-lease-probe.js'], {
    encoding: 'utf8', timeout: 5000,
    env: {...process.env, DISPLAY: '', WAYLAND_DISPLAY: '', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/nonexistent-xboks-synthetic-signal-test'},
  });
  assert.deepEqual(JSON.parse(stdout.trim()), {
    status: 'passed', nativeSessionChanged: false, emitter: 'synthetic-GObject', legacyFindArguments: 7,
    maxHandlers: 8, staticIsConnected: true, preblockedCountPreserved: true, laterHandlerStopped: true,
    disconnectedIdsSkipped: true, overflowRestored: true,
  });
});
