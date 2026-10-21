import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { bundleSocialBackend } from '../../scripts/bundle-social-backend.mjs';
import { socialBackend } from './social-backend.js';

const roots: string[] = [];
const digest = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const help = 'Xbox command-line client\n\nUsage: xodus-cli [OPTIONS] <COMMAND>\n\nCommands:\n  account  Account\n  social   Friends and chats\n  help     Help\n\nOptions:\n  --help   Help\n';
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xboks-social-backend-')); roots.push(root);
  const binary = path.join(root, 'xodus-cli'), manifestFile = path.join(root, 'manifest.json');
  const bytes = Buffer.from('Synthetic executable fixture; never executed.');
  await fs.writeFile(binary, bytes, { mode: 0o755 });
  const manifest = { schema: 1, version: '0.3.0', sha256: digest(bytes), binary: 'xodus-cli' };
  await fs.writeFile(manifestFile, JSON.stringify(manifest));
  const probe = vi.fn(async (_binary: string, _args: readonly string[], _options: { timeout: number; maxBuffer: number }) => ({ code: 0, stdout: help }));
  return { root, binary, manifestFile, bytes, manifest, probe };
}
afterEach(async () => { vi.useRealTimers(); await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });

describe('optional bundled social companion', () => {
  it('verifies bytes and only probes bounded top-level help before resolving the executable', async () => {
    const f = await fixture();
    expect(await socialBackend(f.root, f.probe)).toBe(f.binary);
    expect(f.probe).toHaveBeenCalledOnce();
    expect(f.probe).toHaveBeenCalledWith(f.binary, ['--help'], { timeout: 5_000, maxBuffer: 100_000 });
    expect(await fs.readFile(f.binary)).toEqual(f.bytes);
    expect(JSON.parse(await fs.readFile(f.manifestFile, 'utf8'))).toEqual(f.manifest);
  });
  it.each([
    { schema: 2 }, { version: '0.2.0' }, { version: '9.0.0' }, { binary: '../outside' }, { binary: '/tmp/outside' },
    { sha256: 'not-a-hash' }, { sha256: '0'.repeat(64) },
  ])('rejects incompatible/traversing/corrupt manifests before execution: %j', async patch => {
    const f = await fixture(); await fs.writeFile(f.manifestFile, JSON.stringify({ ...f.manifest, ...patch }));
    expect(await socialBackend(f.root, f.probe)).toBeUndefined(); expect(f.probe).not.toHaveBeenCalled();
  });
  it.each(['{', 'null', '[]', 'X'.repeat(65_537)])('rejects malformed or oversized manifest data', async bytes => {
    const f = await fixture(); await fs.writeFile(f.manifestFile, bytes);
    expect(await socialBackend(f.root, f.probe)).toBeUndefined(); expect(f.probe).not.toHaveBeenCalled();
  });
  it('treats an absent optional bundle as unavailable, without a probe or writes', async () => {
    const f = await fixture();
    expect(await socialBackend(path.join(f.root, 'missing'), f.probe)).toBeUndefined();
    expect(await socialBackend('relative/bundle', f.probe)).toBeUndefined();
    expect(f.probe).not.toHaveBeenCalled(); expect(await fs.readdir(f.root)).toEqual(['manifest.json', 'xodus-cli']);
  });
  it.each(['root', 'manifest', 'binary'])('rejects symlinked %s paths, including links outside the bundle', async target => {
    const f = await fixture();
    if (target === 'root') {
      const linked = path.join(f.root, 'linked'); await fs.symlink(f.root, linked);
      expect(await socialBackend(linked, f.probe)).toBeUndefined();
    } else {
      const source = target === 'binary' ? f.binary : f.manifestFile;
      await fs.rename(source, source + '.outside'); await fs.symlink(source + '.outside', source);
      expect(await socialBackend(f.root, f.probe)).toBeUndefined();
    }
    expect(f.probe).not.toHaveBeenCalled();
  });
  it.each(['directory', 'empty', 'non-executable', 'oversized'])('rejects an unsafe %s binary before any process probe', async scenario => {
    const f = await fixture();
    if (scenario === 'directory') { await fs.rm(f.binary); await fs.mkdir(f.binary); }
    if (scenario === 'empty') await fs.writeFile(f.binary, '');
    if (scenario === 'non-executable') await fs.chmod(f.binary, 0o644);
    if (scenario === 'oversized') await fs.truncate(f.binary, 300 * 1024 * 1024 + 1);
    expect(await socialBackend(f.root, f.probe)).toBeUndefined(); expect(f.probe).not.toHaveBeenCalled();
  });
  it.each([
    'Social features are described here.\n',
    'Commands:\n  account  Account for social access\nOptions:\n  --social  Not a command\n',
    'Commands:\n  socializer  Not the social command\n',
    'Options:\n  social  This is not a command section\n',
  ])('requires the actual social command, not a string mention', async stdout => {
    const f = await fixture(); f.probe.mockResolvedValue({ code: 0, stdout });
    expect(await socialBackend(f.root, f.probe)).toBeUndefined();
  });
  it('accepts normal colored CLI help but rejects nonzero status/excessive output/startup failures', async () => {
    const f = await fixture(); f.probe.mockResolvedValueOnce({ code: 0, stdout: help.replace('Commands:', '\u001b[1mCommands:\u001b[0m') });
    expect(await socialBackend(f.root, f.probe)).toBe(f.binary);
    f.probe.mockResolvedValueOnce({ code: 2, stdout: help }); expect(await socialBackend(f.root, f.probe)).toBeUndefined();
    f.probe.mockResolvedValueOnce({ code: 0, stdout: help + 'X'.repeat(100_001) }); expect(await socialBackend(f.root, f.probe)).toBeUndefined();
    f.probe.mockRejectedValueOnce(new Error('Synthetic timeout/start failure')); expect(await socialBackend(f.root, f.probe)).toBeUndefined();
  });
  it.each(['binary', 'manifest'])('rejects %s replacement while help is running', async target => {
    const f = await fixture();
    f.probe.mockImplementationOnce(async () => {
      const file = target === 'binary' ? f.binary : f.manifestFile;
      await fs.rename(file, file + '.old'); await fs.copyFile(file + '.old', file);
      return { code: 0, stdout: help };
    });
    expect(await socialBackend(f.root, f.probe)).toBeUndefined();
  });
  it('bounds a help probe that never completes and clears its deadline', async () => {
    const f = await fixture(); vi.useFakeTimers();
    let started!: () => void;
    const enteringProbe = new Promise<void>(resolve => { started = resolve; });
    f.probe.mockImplementationOnce(() => { started(); return new Promise(() => {}); });
    const pending = socialBackend(f.root, f.probe);
    await enteringProbe;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await pending).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('social companion distribution assembly', () => {
  it('copies exact binary/license/source bytes, records pinned hashes and leaves source inputs untouched', async () => {
    const f = await fixture();
    const license = path.join(f.root, 'upstream-LICENSE'), sourceArchive = path.join(f.root, 'corresponding-source.tar.xz');
    await fs.writeFile(license, 'Synthetic license fixture'); await fs.writeFile(sourceArchive, 'Synthetic opaque corresponding-source archive');
    const output = path.join(f.root, 'generated');
    const result = await bundleSocialBackend({ binary: f.binary, license, sourceArchive, output });
    expect(result).toMatchObject({ output, schema: 1, version: '0.3.0', sha256: digest(f.bytes), binary: 'xodus-cli', sourceArchive: 'source.tar.xz' });
    expect(await fs.readFile(path.join(output, 'xodus-cli'))).toEqual(f.bytes);
    expect((await fs.stat(path.join(output, 'xodus-cli'))).mode & 0o777).toBe(0o755);
    expect(await fs.readFile(path.join(output, 'LICENSE'), 'utf8')).toBe('Synthetic license fixture');
    expect(await fs.readFile(path.join(output, 'source.tar.xz'), 'utf8')).toBe('Synthetic opaque corresponding-source archive');
    expect(result.licenseSha256).toBe(digest('Synthetic license fixture'));
    expect(result.sourceArchiveSha256).toBe(digest('Synthetic opaque corresponding-source archive'));
    expect(await fs.readFile(f.binary)).toEqual(f.bytes);
    expect(await socialBackend(output, f.probe)).toBe(path.join(output, 'xodus-cli'));
    expect(await fs.readFile(path.join(output, 'README.txt'), 'utf8')).toContain('does not certify');
  });
  it('refuses existing outputs and symlink/empty input files without replacing any files', async () => {
    const f = await fixture(), output = path.join(f.root, 'generated'); await fs.mkdir(output); await fs.writeFile(path.join(output, 'keep'), 'keep');
    const inputs = { binary: f.binary, license: f.manifestFile, sourceArchive: f.manifestFile, output };
    await expect(bundleSocialBackend(inputs)).rejects.toThrow('already exists');
    expect(await fs.readFile(path.join(output, 'keep'), 'utf8')).toBe('keep');
    await fs.symlink(f.manifestFile, path.join(f.root, 'linked-source'));
    await expect(bundleSocialBackend({ ...inputs, output: output + '-new', sourceArchive: path.join(f.root, 'linked-source') })).rejects.toThrow('regular bounded');
    await fs.writeFile(path.join(f.root, 'empty'), '');
    await expect(bundleSocialBackend({ ...inputs, output: output + '-new', license: path.join(f.root, 'empty') })).rejects.toThrow('regular bounded');
    await expect(fs.access(output + '-new')).rejects.toThrow();
  });
  it('keeps the companion outside ASAR and allows absent optional extraResources in the actual builder copier', async () => {
    const f = await fixture(), config = JSON.parse(await fs.readFile('package.json', 'utf8')).build;
    expect(config.files).toContain('!assets/social-backend/**/*');
    expect(config.extraResources).toContainEqual({ from: 'assets/social-backend', to: 'social-backend', filter: ['**/*'] });
    const { copyFiles, FileMatcher } = createRequire(import.meta.url)('app-builder-lib/out/fileMatcher.js');
    const output = path.join(f.root, 'packaged-resources');
    const matcher = new FileMatcher(path.join(f.root, 'absent-optional'), output, (value: string) => value, ['**/*']);
    await expect(copyFiles([matcher], undefined, false)).resolves.toBeDefined();
    await expect(fs.access(output)).rejects.toThrow();
  });
});
