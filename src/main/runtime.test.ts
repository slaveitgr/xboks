import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { canonicalSnapshotName, nexusReleaseName, previewBaseRelease, RuntimeManager } from './runtime.js';
import { runtimeCandidate, runtimeReleasesUrl } from './runtime-package.js';
import { run } from './process.js';

function runtime(suffix: string, published_at = '2026-10-21T12:00:00Z') {
  const version = `runtime-11.0-${suffix}`, base = `xboks-engine-runtime-11.0-${suffix}`;
  const names = [`${base}-x86_64.tar.xz`, `${base}-x86_64.sha512sum`, `${base}-source.tar.xz`, `${base}-source.sha512sum`];
  return { tag_name: version, published_at, assets: names.map(name => ({ name, browser_download_url: `https://github.com/slaveitgr/xboks/releases/download/${version}/${name}` })) };
}

describe('owned engine runtime distribution', () => {
  it('keeps legacy local archive names readable but gives managed folders owned names', () => {
    expect(nexusReleaseName('xodus-nexus-runtime-11.0-tested-x86_64.tar.xz')).toBe('xboks-engine-runtime-11.0-tested');
    expect(nexusReleaseName('xboks-engine-runtime-11.0-tested-x86_64.tar.xz')).toBe('xboks-engine-runtime-11.0-tested');
    expect(canonicalSnapshotName('3fd4ae1091339ef07d6f2d53fda8e15541f96ad3')).toBe('xboks-engine-runtime-3fd4ae10');
  });

  it('uses only the xboks release API for both public check actions, without a GitHub login', async () => {
    const release = runtime('tested');
    const fetcher = vi.fn(async () => new Response(JSON.stringify([{ tag_name: 'v99.0.0', assets: [] }, release]))) as unknown as typeof fetch;
    const manager = new RuntimeManager('/tmp/unused', () => {}, () => false, fetcher);
    expect((await manager.checkNexus()).nexusVersion).toBe(release.tag_name);
    const status = await manager.check();
    expect(status.artifactAvailable).toBe(true); expect(status.artifactName).toBe(release.assets[0].name);
    expect(status.prerequisites.authenticated).toBe(false);
    expect(vi.mocked(fetcher).mock.calls.every(([input]) => input === runtimeReleasesUrl)).toBe(true);
  });

  it.each([false, true])('selects newest publication independently of hash/list order: %s', reversed => {
    const older = runtime('gffff', '2026-10-20T12:00:00Z'), newer = runtime('gaaaa', '2026-10-21T12:00:00Z');
    expect(runtimeCandidate([...(reversed ? [newer, older] : [older, newer]), { ...runtime('draft', '2026-10-22'), draft: true },
      { ...runtime('preview', '2026-10-22'), prerelease: true }, runtime('undated', 'invalid')]).version).toBe(newer.tag_name);
  });

  it.each(['foreign', 'legacy-upstream', 'missing-source', 'mismatched-checksum', 'duplicate'])('rejects %s runtime assets without falling back to upstream or an older release', scenario => {
    const selected = runtime('newest', '2026-10-22');
    if (scenario === 'foreign') selected.assets[0].browser_download_url = 'https://example.com/runtime.tar.xz';
    if (scenario === 'legacy-upstream') selected.assets.forEach(a => { a.name = a.name.replace('xboks-engine-', 'xodus-nexus-'); a.browser_download_url = a.browser_download_url.replace('slaveitgr/xboks', 'domsvoboda/xodus-nexus'); });
    if (scenario === 'missing-source') selected.assets.pop();
    if (scenario === 'mismatched-checksum') selected.assets[1].name = 'wrong.sha512sum';
    if (scenario === 'duplicate') selected.assets.push(selected.assets[0]);
    expect(() => runtimeCandidate([runtime('older', '2026-10-20'), selected])).toThrow(/Unexpected|incomplete/);
  });

  it('reports unpublished owned releases honestly and bounds metadata', async () => {
    for (const value of [[], [{ tag_name: 'v0.3.12', assets: [] }]]) {
      const manager = new RuntimeManager('/tmp/unused', () => {}, () => false, (async () => new Response(JSON.stringify(value))) as typeof fetch);
      const status = await manager.checkNexus();
      expect(status.nexusError).toContain('No xboks Engine runtime release has been published yet');
      expect(status.releaseState).toBe('unpublished');
    }
    const manager = new RuntimeManager('/tmp/unused', () => {}, () => false, (async () => new Response(' '.repeat(2_000_001))) as typeof fetch);
    const status = await manager.checkNexus();
    expect(status.nexusError).toContain('size limit'); expect(status.releaseState).toBe('error');
    expect(() => runtimeCandidate({})).toThrow('Invalid');
  });

  it('does not download or replace a runtime during an active operation', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    const manager = new RuntimeManager('/tmp/unused', () => {}, () => true, fetcher);
    await expect(manager.install(() => {})).rejects.toThrow('while an engine operation is active');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(['valid', 'legacy-root', 'stderr-warning', 'bad-digest', 'wrong-file', 'unsafe-root', 'mixed-root', 'oversized-checksum', 'tampered-existing'])('verifies a real downloaded archive before activation: %s', async scenario => {
    const release = runtime('tested'), archiveName = release.assets[0].name, checksumName = release.assets[1].name;
    const releaseName = nexusReleaseName(archiveName), root = await fs.mkdtemp(path.join(os.tmpdir(), 'xboks-engine-runtime-test-'));
    const build = path.join(root, 'build');
    const top = scenario === 'unsafe-root' ? 'unexpected-root' : scenario === 'legacy-root' ? 'proton-xodus-legacy-x86_64' : releaseName;
    const wine = path.join(build, top, 'files', 'bin', 'wine');
    await fs.mkdir(path.dirname(wine), { recursive: true });
    await fs.writeFile(wine, '#!/bin/sh\necho wine-11.0-test\n', { mode: 0o755 });
    if (scenario === 'mixed-root') await fs.mkdir(path.join(build, 'second-root'));
    const packed = await run('tar', ['-cJf', path.join(build, archiveName), '-C', build, top, ...(scenario === 'mixed-root' ? ['second-root'] : [])]);
    if (packed.code !== 0) throw new Error('The tar fixture could not be created.');
    const digest = createHash('sha512').update(await fs.readFile(path.join(build, archiveName))).digest('hex');
    await fs.writeFile(path.join(build, checksumName), scenario === 'oversized-checksum' ? 'X'.repeat(4097) : `${scenario === 'bad-digest' ? '0'.repeat(128) : digest}  ${scenario === 'wrong-file' ? 'other.tar.xz' : archiveName}\n`);
    const requested: string[] = [];
    const fetcher = (async (input: URL | RequestInfo) => {
      const url = String(input); requested.push(url);
      if (url === runtimeReleasesUrl) return new Response(JSON.stringify([release]));
      expect(release.assets.some(asset => asset.browser_download_url === url)).toBe(true);
      return new Response(await fs.readFile(path.join(build, url.split('/').pop()!)));
    }) as typeof fetch;
    const manager = new RuntimeManager(root, () => {}, () => false, fetcher);
    const originalPreload = process.env.LD_PRELOAD;
    if (scenario === 'stderr-warning') process.env.LD_PRELOAD = path.join(root, 'nonexistent-test-overlay.so');
    try {
      const previousWine = path.join(root, 'releases', 'previous', 'files', 'bin', 'wine');
      await fs.mkdir(path.dirname(previousWine), { recursive: true });
      await fs.writeFile(previousWine, '#!/bin/sh\necho wine-previous\n', { mode: 0o755 });
      const previous = { name: 'previous', winePath: previousWine, commit: 'previous', installedAt: 'before' };
      await fs.writeFile(path.join(root, 'current.json'), JSON.stringify(previous));
      if (scenario === 'tampered-existing') {
        const conflictingWine = path.join(root, 'releases', releaseName, 'files', 'bin', 'wine');
        await fs.mkdir(path.dirname(conflictingWine), { recursive: true });
        await fs.writeFile(conflictingWine, '#!/bin/sh\necho wine-TAMPERED\n', { mode: 0o755 });
      }
      await manager.refresh();
      if (!['valid', 'legacy-root', 'stderr-warning'].includes(scenario)) {
        await expect(manager.installNexus(() => {})).rejects.toThrow(scenario === 'tampered-existing' ? /already exists/ : scenario === 'oversized-checksum' ? /size limit/ : ['unsafe-root', 'mixed-root'].includes(scenario) ? /runtime structure/ : /SHA-512/);
        expect(JSON.parse(await fs.readFile(path.join(root, 'current.json'), 'utf8'))).toEqual(previous);
        expect(manager.current.name).toBe('previous'); expect(manager.current.updating).toBe(false);
        if (scenario === 'tampered-existing') expect(await fs.readFile(path.join(root, 'releases', releaseName, 'files', 'bin', 'wine'), 'utf8')).toContain('wine-TAMPERED');
        expect((await fs.readdir(root)).some(name => name.startsWith('.staging-'))).toBe(false);
        return;
      }
      const winePath = await manager.install(() => {});
      expect(winePath).toBe(path.join(root, 'releases', releaseName, 'files', 'bin', 'wine'));
      expect(JSON.parse(await fs.readFile(path.join(root, 'current.json'), 'utf8'))).toMatchObject({ name: releaseName, commit: release.tag_name });
      expect(manager.current.installed).toBe(true);
      expect(await fs.readFile(previousWine, 'utf8')).toContain('wine-previous');
      expect(requested).toEqual([runtimeReleasesUrl, release.assets[0].browser_download_url, release.assets[1].browser_download_url]);
    } finally {
      if (originalPreload === undefined) delete process.env.LD_PRELOAD; else process.env.LD_PRELOAD = originalPreload;
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe('legacy cloud-save preview rollback', () => {
  it('extracts the preserved base release', () => {
    expect(previewBaseRelease('proton-xodus-test-offline-v2-xgamesave-pr28-3fd4ae1091')).toBe('proton-xodus-test-offline-v2');
    expect(previewBaseRelease('proton-xodus-test-offline-v2-xgamesave-pr28-3fd4ae1091-bridge-v1')).toBe('proton-xodus-test-offline-v2');
    expect(previewBaseRelease('proton-xodus-test-offline-v2-xgamesave-pr28-3fd4ae1091-bridge-v1-userstate-v1')).toBe('proton-xodus-test-offline-v2');
    expect(previewBaseRelease('proton-xodus-test-offline-v2-xgamesave-pr28-3fd4ae1091-bridge-v1-userstate-v1-userguest-v1')).toBe('proton-xodus-test-offline-v2');
    expect(previewBaseRelease('proton-xodus-test-offline-v2-xgamesave-pr28-3fd4ae1091-bridge-v1-userstate-v1-userguest-v1-locale-v1')).toBe('proton-xodus-test-offline-v2');
    expect(previewBaseRelease('proton-xodus-test-offline-v2-xgamesave-pr28-3fd4ae1091-locale-v1')).toBe('proton-xodus-test-offline-v2');
  });

  it('rejects unrelated and malformed release names', () => {
    expect(previewBaseRelease('proton-xodus-test-offline-v2')).toBeNull();
    expect(previewBaseRelease('../escape-xgamesave-pr28-3fd4ae1091')).toBeNull();
  });

  it('atomically switches a preview back to its validated base release', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xodus-runtime-test-'));
    const base = 'proton-xodus-test-offline-v2';
    const winePath = path.join(root, 'releases', base, 'files', 'bin', 'wine');
    try {
      await fs.mkdir(path.dirname(winePath), { recursive: true });
      await fs.writeFile(winePath, '#!/bin/sh\necho wine-test\n', { mode: 0o755 });
      await fs.writeFile(path.join(root, 'current.json'), JSON.stringify({
        name: `${base}-xgamesave-pr28-3fd4ae1091`, winePath: '/preview/wine', commit: 'abc', installedAt: 'before',
      }));
      const manager = new RuntimeManager(root, () => undefined, () => false);
      expect(await manager.rollbackCloudSavePreview(() => undefined)).toBe(winePath);
      const pointer = JSON.parse(await fs.readFile(path.join(root, 'current.json'), 'utf8')) as { name: string; winePath: string };
      expect(pointer.name).toBe(base);
      expect(pointer.winePath).toBe(winePath);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
