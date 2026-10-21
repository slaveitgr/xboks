import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { backendAssetUrl, backendLock, backendPackageName, backendRecipeSha256 } from './backend-package.js';
import { ensureEngineAliases, installBackend } from './backend-releases.js';
import { launcherCandidate } from './launcher-update.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xboks-engine-alias-')); roots.push(root);
  await fs.writeFile(path.join(root, 'xodus-cli'), 'Synthetic command fixture', { mode: 0o755 });
  await fs.writeFile(path.join(root, 'xodus-service'), 'Synthetic service fixture', { mode: 0o755 });
  return root;
}
describe('engine distribution ownership', () => {
  it('creates byte-identical owned aliases, preserves ABI files and supports repeated checks without executing anything', async () => {
    const root = await fixture();
    expect(await ensureEngineAliases(root)).toBe(path.join(root, 'xboks-engine'));
    expect(await ensureEngineAliases(root)).toBe(path.join(root, 'xboks-engine'));
    for (const [source, alias] of [['xodus-cli', 'xboks-engine'], ['xodus-service', 'xboks-engine-service']]) {
      expect(await fs.readFile(path.join(root, alias))).toEqual(await fs.readFile(path.join(root, source)));
      expect((await fs.stat(path.join(root, alias))).mode & 0o777).toBe(0o755);
    }
  });
  it.each(['tampered', 'symlink'])('rejects an existing %s alias rather than trusting or replacing it', async kind => {
    const root = await fixture(), alias = path.join(root, 'xboks-engine');
    if (kind === 'symlink') await fs.symlink('xodus-cli', alias); else await fs.writeFile(alias, 'Changed');
    await expect(ensureEngineAliases(root)).rejects.toThrow('verification');
    expect(await fs.readFile(path.join(root, 'xodus-cli'), 'utf8')).toBe('Synthetic command fixture');
  });
  it('rejects upstream repository and mismatched tags even when a direct install bypasses discovery', async () => {
    const root = await fixture(), archive = `${backendPackageName(backendLock.version)}.tar.xz`;
    const manifest = { schema: 1, version: backendLock.version, commit: backendLock.commit, recipeSha256: backendRecipeSha256,
      compatibility: backendLock.compatibility, platform: 'linux', arch: 'x64', archive, archiveSha512: 'a'.repeat(128),
      files: { LICENSE: 'b'.repeat(64), 'xodus-cli': 'c'.repeat(64), 'xodus-service': 'd'.repeat(64) }, authUi: 'electron' as const };
    const tag = `backend-v${backendLock.version}`, fetcher = vi.fn() as unknown as typeof fetch;
    expect(() => backendAssetUrl(tag, archive, `https://github.com/domsvoboda/xodus-nexus/releases/download/${tag}/${archive}`)).toThrow('Unexpected');
    await expect(installBackend(root, { tag, manifest, archiveUrl: `https://github.com/domsvoboda/xodus-nexus/releases/download/${tag}/${archive}` }, fetcher, async () => {}, async () => {}, () => {})).rejects.toThrow('Unexpected');
    await expect(installBackend(root, { tag: 'backend-v99.0.0', manifest, archiveUrl: '' }, fetcher, async () => {}, async () => {}, () => {})).rejects.toThrow('tag');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('refuses an old upstream launcher asset even when its filename and checksum look compatible', () => {
    const tag = 'v99.0.0', name = 'xboks-99.0.0-x86_64.AppImage';
    const assets = [name, `${name}.sha512sum`].map(name => ({ name, size: 100,
      browser_download_url: `https://github.com/domsvoboda/xodus-nexus/releases/download/${tag}/${name}` }));
    expect(launcherCandidate([{ tag_name: tag, assets }], '0.0.1')).toBeUndefined();
  });
});
