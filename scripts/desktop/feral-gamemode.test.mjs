import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

let supported = true;
try { execFileSync('gjs', ['--version'], {stdio: 'pipe'}); execFileSync('dbus-run-session', ['--version'], {stdio: 'pipe'}); }
catch { supported = false; }

test('optional GameMode client observes actual daemon state and releases only its own current process registrations', {skip: !supported}, async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'linux-gaming-mode-bus-'));
    try {
        const config = path.join(temporary, 'bus.conf');
        // No standard service directories: a daemon-loss test must never
        // activate the installed host binary, even on this private bus.
        await fs.writeFile(config, '<busconfig><type>session</type><listen>unix:tmpdir=/tmp</listen><auth>EXTERNAL</auth>' +
            '<policy context="default"><allow own="*"/><allow send_destination="*"/><allow receive_sender="*"/></policy></busconfig>');
        const stdout = execFileSync('dbus-run-session', ['--config-file=' + config, '--', 'gjs', '-m', 'scripts/desktop/fixtures/feral-gamemode-protocol.js'], {
            encoding: 'utf8', timeout: 30000,
            env: {...process.env, XBOKS_PRIVATE_GAMEMODE_TEST: '1', GIO_USE_VFS: 'local'},
        });
        const result = JSON.parse(stdout.trim());
        assert.equal(result.status, 'passed'); assert.ok(result.checks >= 26);
        assert.equal(result.hostDaemonTouched, false); assert.equal(result.requesterBeforeTarget, true);
        assert.equal(result.pidReuseProtected, true);
    } finally { await fs.rm(temporary, {recursive: true, force: true}); }
});

test('GameMode integration parses without Shell imports or command execution', async () => {
    const file = 'desktop/gnome/xboks-experience@slaveitgr.github.io/feral-gamemode.js';
    execFileSync(process.execPath, ['--check', file]);
    const source = await fs.readFile(file, 'utf8');
    assert.doesNotMatch(source, /resource:\/\/\/org\/gnome\/shell|Subprocess|spawn_command|set_boolean|set_string|kill\(/);
});
