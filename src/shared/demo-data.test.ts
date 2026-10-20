import { describe, expect, it } from 'vitest';
import { demoAccountLibrary, demoSnapshot } from './demo-data.js';

const versions = { launcher: '7.8.9', backend: '4.5.6', backendCommit: 'a'.repeat(40), backendCompatibility: 'linux-run-v99' };
const artwork = new Map([
  ['9N4PT8HGCDHQ', { coverUrl: 'https://example.test/gears-cover', heroUrl: 'https://example.test/gears-wide' }],
  ['9NPKGVXPFRSX', { coverUrl: 'https://example.test/age-cover', heroUrl: 'https://example.test/age-wide' }],
]);

describe('demo presentation data', () => {
  it('uses supplied application and backend metadata rather than old fixture versions', () => {
    const state = demoSnapshot(versions);
    expect(state.launcherUpdate?.currentVersion).toBe(versions.launcher);
    expect(state.backend).toMatchObject({ version: versions.backend, releaseVersion: versions.backend,
      commit: versions.backendCommit, linuxRunPatch: versions.backendCompatibility });
    expect(state.runtime.name).toBe('xodus-nexus-runtime-demo');
  });

  it('preserves separate box art and landscape art for home, library and account entries', () => {
    const state = demoSnapshot(versions, artwork);
    expect(state.games[0]).toMatchObject(artwork.get('9N4PT8HGCDHQ')!);
    expect(state.games[0].heroUrl).not.toBe(state.games[0].coverUrl);
    expect(state.downloads[0].coverUrl).toBe(artwork.get('9NPKGVXPFRSX')!.coverUrl);
    expect(demoAccountLibrary('gamepass', artwork).products[0]).toMatchObject({
      posterUrl: artwork.get('9NPKGVXPFRSX')!.coverUrl, heroUrl: artwork.get('9NPKGVXPFRSX')!.heroUrl,
    });
  });
});
