import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { externalLauncherEnvironment } from './launcher-environment.js';

describe('shared graphical session isolation (#208)', () => {
  it.each(['gamescope', 'KDE', 'GNOME'])('preserves caller display endpoints in %s', desktop => {
    const original = { XDG_CURRENT_DESKTOP: desktop, DISPLAY: ':1', XAUTHORITY: '/tmp/session-cookie', WAYLAND_DISPLAY: 'gamescope-0' };
    expect(externalLauncherEnvironment(original)).toEqual(original);
    expect(original.WAYLAND_DISPLAY).toBe('gamescope-0');
  });
  it('never publishes launcher display values to the shared bus or systemd manager', () => {
    expect(readFileSync('src/main/index.ts', 'utf8')).not.toMatch(/prepareGameModeKeyring|dbus-update-activation-environment|import-environment|set-environment/);
  });
});
