import { fetchEngineRelease } from './engine-fetch.js';
import { constants, promises as fs } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { run } from './process.js';
import {
  BACKEND_REPOSITORY, backendPackageName, backendAssetUrl, compareVersions, minimumBackendVersion,
  validateBackendManifest, validateBackendArchive, type BackendPackageManifest,
} from './backend-package.js';

export interface BackendArtifact { tag: string; manifest: BackendPackageManifest; archiveUrl: string }

async function bytes(url: string, fetcher: typeof fetch, limit: number): Promise<Buffer> {
  const response = await fetchEngineRelease(fetcher, url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok || !response.body) throw new Error(`Backend download failed (HTTP ${response.status}).`);
  const parts: Uint8Array[] = [];
  const reader = response.body.getReader();
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > limit) throw new Error('Backend metadata exceeds the download limit.');
      parts.push(chunk.value);
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(parts);
}

export async function discoverBackend(fetcher: typeof fetch): Promise<BackendArtifact> {
  const releases = JSON.parse((await bytes(`https://api.github.com/repos/${BACKEND_REPOSITORY}/releases?per_page=100`, fetcher, 2_000_000)).toString()) as Array<{
    tag_name?: string; draft?: boolean; prerelease?: boolean;
    assets?: Array<{ name?: string; browser_download_url?: string }>;
  }>;
  if (!Array.isArray(releases)) throw new Error('Invalid backend release list.');
  // The Electron-hosted backend requires the updated launcher.
  let selected: { tag: string; version: string; release: NonNullable<typeof releases[number]> } | undefined;
  for (const item of releases) {
    if (item.draft || item.prerelease) continue;
    const match = /^backend-v(\d+\.\d+\.\d+)$/.exec(item.tag_name ?? '');
    if (!match || compareVersions(match[1], minimumBackendVersion) < 0) continue;
    if (!selected || compareVersions(match[1], selected.version) > 0) selected = { tag: item.tag_name!, version: match[1], release: item };
  }
  if (!selected) throw new Error('No compatible xboks Engine backend release has been published yet.');
  const tag = selected.tag;
  const packageName = backendPackageName(selected.version);
  const asset = (name: string) => {
    const matches = selected!.release.assets?.filter(item => item.name === name) ?? [];
    if (matches.length !== 1) throw new Error('The newest xboks Engine backend release is incomplete.');
    return backendAssetUrl(tag, name, matches[0].browser_download_url);
  };
  const archive = `${packageName}.tar.xz`;
  const manifest = validateBackendManifest(JSON.parse((await bytes(asset(`${packageName}.manifest.json`), fetcher, 100_000)).toString()));
  if (manifest.version !== selected.version) throw new Error('The backend release does not match its manifest.');
  const checksum = (await bytes(asset(`${packageName}.sha512sum`), fetcher, 1000)).toString().trim();
  if (checksum !== `${manifest.archiveSha512}  ${archive}`) throw new Error('Backend SHA-512 manifest mismatch.');
  // Distribution must include the matching corresponding source, not just binaries.
  asset(`${packageName}-source.tar.xz`);
  asset(`${packageName}-source.sha512sum`);
  return { tag, manifest, archiveUrl: asset(archive) };
}

export async function installBackend(
  managedRoot: string, artifact: BackendArtifact, fetcher: typeof fetch,
  validate: (cli: string) => Promise<void>, assertIdle: () => Promise<void>,
  phase: (message: string) => void, runner: typeof run = run,
): Promise<string> {
  if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('The prebuilt backend currently supports x86_64 Linux only.');
  await assertIdle();
  const manifest = validateBackendManifest(artifact.manifest);
  if (artifact.tag !== `backend-v${manifest.version}`) throw new Error('The backend tag does not match its manifest.');
  const archiveUrl = backendAssetUrl(artifact.tag, manifest.archive, artifact.archiveUrl);
  const staging = path.join(managedRoot, `.download-${randomUUID()}`);
  await fs.mkdir(staging, { recursive: true });
  try {
    phase('Downloading xboks Engine…');
    const archive = path.join(staging, manifest.archive);
    const response = await fetchEngineRelease(fetcher, archiveUrl, { signal: AbortSignal.timeout(300_000) });
    if (!response.ok || !response.body) throw new Error(`Backend download failed (HTTP ${response.status}).`);
    const reader = response.body.getReader();
    const file = await fs.open(archive, 'wx');
    const hash = createHash('sha512');
    let size = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > 256 * 1024 * 1024) throw new Error('Backend archive exceeds the download limit.');
        hash.update(chunk.value);
        await file.writeFile(chunk.value);
      }
    } finally { await file.close(); await reader.cancel(); }
    phase('Verifying the backend checksum and archive…');
    if (hash.digest('hex') !== manifest.archiveSha512) throw new Error('Backend SHA-512 verification failed.');
    const listing = await runner('tar', ['-tJf', archive], { maxOutput: 100_000 });
    const verbose = await runner('tar', ['-tvJf', archive], { maxOutput: 100_000 });
    if (listing.code !== 0 || verbose.code !== 0) throw new Error('The backend archive is invalid.');
    const packageName = backendPackageName(manifest.version);
    validateBackendArchive(listing.output.trimEnd().split('\n'), verbose.output.trimEnd().split('\n'), packageName);
    const extracted = path.join(staging, 'extracted');
    await fs.mkdir(extracted);
    const result = await runner('tar', ['-xJf', archive, '--no-same-owner', '--no-same-permissions', '-C', extracted]);
    if (result.code !== 0) throw new Error('Backend extraction failed.');
    const candidate = path.join(extracted, packageName);
    const verifyFiles = async (root: string) => {
      for (const [name, expected] of Object.entries(manifest.files)) {
        const target = path.join(root, name);
        if (!(await fs.lstat(target)).isFile() || createHash('sha256').update(await fs.readFile(target)).digest('hex') !== expected) {
          throw new Error(`Backend file verification failed: ${name}`);
        }
      }
      for (const name of ['xodus-cli', 'xodus-service']) {
        const header = await fs.readFile(path.join(root, name));
        if (header.length < 64 || header.subarray(0, 4).toString('hex') !== '7f454c46' || header[4] !== 2 || header[5] !== 1 || header.readUInt16LE(18) !== 62) {
          throw new Error('The backend binary is not a Linux x86_64 ELF executable.');
        }
        await fs.chmod(path.join(root, name), 0o755);
        await fs.access(path.join(root, name), constants.X_OK);
      }
      // Never execute xodus-service --help: it starts keychain/device auth.
      await validate(path.join(root, 'xodus-cli'));
    };
    phase('Checking backend commands and runtime libraries…');
    await verifyFiles(candidate);
    await assertIdle();
    const release = path.join(managedRoot, 'releases', `${packageName}-${manifest.archiveSha512.slice(0, 16)}`);
    await fs.mkdir(path.dirname(release), { recursive: true });
    try { await fs.rename(candidate, release); }
    catch (error) {
      if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      await verifyFiles(release);
    }
    await fs.writeFile(path.join(release, 'metadata.json'), JSON.stringify(manifest, null, 2));
    return await ensureEngineAliases(release);
  } finally { await fs.rm(staging, { recursive: true, force: true }); }
}

/** Give managed installs owned executable names without changing the pinned
 * Cargo/manifest ABI. Call only for an application-owned, validated directory;
 * external executables retain their real paths. Every copy is byte checked. */
export async function ensureEngineAliases(directory: string): Promise<string> {
  for (const [sourceName, aliasName] of [['xodus-cli', 'xboks-engine'], ['xodus-service', 'xboks-engine-service']]) {
    const source = path.join(directory, sourceName), alias = path.join(directory, aliasName);
    let stat;
    try { stat = await fs.lstat(source); }
    catch (error) { if (sourceName === 'xodus-service' && (error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    if (!stat.isFile() || stat.size < 1 || stat.size > 256 * 1024 * 1024) throw new Error('Unsafe managed engine executable.');
    const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
    const expected = digest(await fs.readFile(source));
    try { await fs.copyFile(source, alias, constants.COPYFILE_EXCL); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    if (!(await fs.lstat(alias)).isFile() || digest(await fs.readFile(alias)) !== expected ||
        digest(await fs.readFile(source)) !== expected) throw new Error('Managed engine alias verification failed.');
    await fs.chmod(alias, 0o755);
  }
  return path.join(directory, 'xboks-engine');
}
