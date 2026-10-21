import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
const run = promisify(execFile);
it.skipIf(process.platform !== 'linux' || !existsSync('/usr/bin/gjs') || !existsSync('/usr/bin/dbus-run-session'))(
  'runs the real GJS adapter against isolated synthetic MPRIS services without touching a host player', async () => {
    const { stdout } = await run('dbus-run-session', ['--', process.execPath, 'scripts/desktop/fixtures/spotify-protocol.mjs'], { timeout: 25_000, maxBuffer: 100_000 });
    expect(JSON.parse(stdout.trim())).toMatchObject({ status: 'passed', transport: 'real-gjs-isolated-dbus', spotifyOnly: true,
      discoveryReadOnly: true, capabilityGuards: true, pauseResume: true, absoluteTrackBoundSeek: true, ownerDisappearance: true, permissionDenied: true, hostPlaybackChanged: false });
  }, 30_000,
);
