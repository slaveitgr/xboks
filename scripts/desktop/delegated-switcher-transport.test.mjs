import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

let supported = true;
try { execFileSync('gjs', ['--version'], {stdio: 'pipe'}); execFileSync('dbus-run-session', ['--version'], {stdio: 'pipe'}); }
catch { supported = false; }

for (const legacyUnixSignals of [false, true]) {
  test(`GJS delegated switcher uses atomic snapshots and captured tokens on a private bus: legacy signals=${legacyUnixSignals}`, {skip: !supported}, () => {
    const stdout = execFileSync('dbus-run-session', ['--', process.execPath, 'scripts/desktop/fixtures/delegated-switcher-protocol.mjs',
      ...(legacyUnixSignals ? ['--legacy-unix-signals'] : [])], {
      encoding: 'utf8', timeout: 25000, env: {...process.env, GIO_USE_VFS: 'local', XBOKS_PRIVATE_PROTOCOL_TEST: '1'},
    });
    const result = JSON.parse(stdout.trim());
    assert.equal(result.status, 'passed');
    assert.equal(result.hostShellEntered, false);
    assert.equal(result.nativeLeaseReleased, false);
    assert.equal(result.atomicSnapshots, true);
    assert.equal(result.unixSignals, legacyUnixSignals ? 'legacy-only' : 'native');
  });
}
