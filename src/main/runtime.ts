import { fetchEngineRelease } from './engine-fetch.js';
import { constants, promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { RuntimeStatus } from '../shared/types.js';
import { run } from './process.js';
import { engineRuntimeDirectory } from './managed-paths.js';

import { runtimeAssetUrl, runtimeCandidate, runtimeReleasesUrl, type EngineRuntimeArtifact } from './runtime-package.js';

interface RuntimePointer {
  name: string;
  winePath: string;
  commit: string;
  installedAt: string;
}

// Release directories carry simple, user-facing version names; patch
// provenance lives in current.json and the release notes, not in the path.
// Upstream Proton describe style: <wine>-<yyyymmdd>-g<sha> (e.g.
// 11.0-20261011-g3fd4ae10), so the version says which Wine it is.
export function canonicalSnapshotName(commit: string): string {
  return `xboks-engine-runtime-${commit.slice(0, 8)}`;
}

export function nexusReleaseName(archiveAssetName: string): string {
  return engineRuntimeDirectory(archiveAssetName.replace(/-x86_64\.tar\.xz$/, ''));
}

export function previewBaseRelease(name: string): string | null {
  const match = name.match(/^(proton-xodus-[A-Za-z0-9._-]+)-xgamesave-pr28-[0-9a-f]{10}(?:-bridge-v1(?:-userstate-v1(?:-userguest-v1)?)?)?(?:-locale-v1)?$/);
  return match?.[1] ?? null;
}

export class RuntimeManager {
  private status: RuntimeStatus;
  private emitLog: (scope: string, line: string) => void;
  private isOperationActive: () => boolean;
  private nexusArtifact?: EngineRuntimeArtifact;
  private readonly fetcher: typeof fetch;

  constructor(runtimeRoot: string, emitLog: (scope: string, line: string) => void, isOperationActive: () => boolean, fetcher: typeof fetch = fetch) {
    this.emitLog = emitLog;
    this.isOperationActive = isOperationActive;
    this.fetcher = fetcher;
    this.status = {
      installed: false,
      checking: false,
      updating: false,
      runtimeRoot,
      artifactAvailable: false,
      prerequisites: { gh: false, authenticated: false, tar: false, sha512sum: false },
    };
  }

  get current(): RuntimeStatus { return structuredClone(this.status); }
  setRoot(root: string): void { this.status.runtimeRoot = root; }

  private async commandOk(command: string, args: string[]): Promise<boolean> {
    try { return (await run(command, args, { maxOutput: 30_000 })).code === 0; } catch { return false; }
  }

  private pointerFile(): string { return path.join(this.status.runtimeRoot, 'current.json'); }

  private async readPointer(): Promise<RuntimePointer | null> {
    try {
      const pointer = JSON.parse(await fs.readFile(this.pointerFile(), 'utf8')) as RuntimePointer;
      if (typeof pointer.winePath !== 'string') return null;
      return { ...pointer, winePath: await fs.realpath(pointer.winePath).catch(() => pointer.winePath) };
    } catch { return null; }
  }

  private async validateWine(winePath: string): Promise<boolean> {
    try {
      await fs.access(winePath, constants.X_OK);
      const result = await run(winePath, ['--version'], { maxOutput: 30_000 });
      return result.code === 0 && /wine/i.test(result.output);
    } catch { return false; }
  }

  async refresh(): Promise<RuntimeStatus> {
    const [tar, sha512sum] = await Promise.all([
      this.commandOk('tar', ['--version']), this.commandOk('sha512sum', ['--version']),
    ]);
    // Legacy status keys remain for IPC compatibility; consumer downloads no
    // longer require GitHub CLI, a GitHub login or upstream Actions artifacts.
    this.status.prerequisites = { gh: false, authenticated: false, tar, sha512sum };
    const pointer = await this.readPointer();
    if (pointer && await this.validateWine(pointer.winePath)) {
      Object.assign(this.status, {
        installed: true,
        name: pointer.name,
        winePath: pointer.winePath,
        commit: pointer.commit,
        error: undefined,
      });
    } else {
      Object.assign(this.status, { installed: false, name: undefined, winePath: undefined, commit: undefined });
    }
    return this.current;
  }

  async check(): Promise<RuntimeStatus> {
    this.status.checking = true;
    this.status.error = undefined;
    try {
      await this.checkNexus();
      Object.assign(this.status, {
        artifactAvailable: this.status.nexusAvailable,
        artifactName: this.status.nexusName,
        artifactExpiresAt: undefined,
        error: this.status.nexusError,
      });
    } finally { this.status.checking = false; }
    return this.current;
  }

  private setPhase(phase: string, onStatus: () => void): void {
    this.status.phase = phase;
    this.emitLog('runtime', phase);
    onStatus();
  }

  async install(onStatus: () => void): Promise<string> {
    return this.installNexus(onStatus);
  }

  // Shared tail of both install paths: verify the archive structure, extract,
  // validate Wine and atomically switch the active runtime pointer. The
  // release directory uses the simple canonical name (releaseName); what the
  // archive calls its top-level folder is only provenance, kept in current.json.
  private async activateArchive(downloads: string, archiveName: string, commit: string, onStatus: () => void, releaseName: string): Promise<string> {
    const staging = path.join(this.status.runtimeRoot, `.staging-${randomUUID()}`);
    const extracted = path.join(staging, 'extracted');
    const archivePath = path.join(downloads, archiveName);
    let reservedRelease: string | undefined, pointerTemporary: string | undefined;
    let activated = false;
    try {
      // Only tar's stdout contains paths. Loader/overlay warnings on stderr
      // must not become archive members, even when tar itself exits successfully.
      const listing = await run('tar', ['-tJf', archivePath], { maxOutput: 20_000_000, stdoutOnly: true });
      if (listing.code !== 0) throw new Error('The runtime is not a valid tar.xz archive.');
      const entries = listing.output.split('\n').filter(Boolean);
      if (entries.length === 0 || entries.some((entry) => path.isAbsolute(entry) || entry.split('/').includes('..'))) {
        throw new Error('The archive contains unsafe paths.');
      }
      const top = entries[0].split('/')[0];
      if (!/^(proton-xodus-|xodus-nexus-runtime-|xboks-engine-runtime-)/.test(top) || entries.some((entry) => entry.split('/')[0] !== top)) {
        throw new Error('Unexpected engine runtime structure.');
      }

      this.setPhase('Extracting approximately 1.4 GB of runtime files…', onStatus);
      await fs.mkdir(extracted, { recursive: true });
      let result = await run('tar', ['-xJf', archivePath, '-C', extracted], { onLine: (line) => this.emitLog('runtime', line), maxOutput: 1_000_000 });
      if (result.code !== 0) throw new Error('Runtime extraction failed.');
      const candidateRoot = path.join(extracted, top);
      const candidateWine = path.join(candidateRoot, 'files', 'bin', 'wine');
      if (!await this.validateWine(candidateWine)) throw new Error('The downloaded Wine failed --version validation.');
      if (this.isOperationActive()) throw new Error('Another operation started during installation; the runtime was not activated.');

      const releases = path.join(this.status.runtimeRoot, 'releases');
      const releaseRoot = path.join(releases, releaseName);
      await fs.mkdir(releases, { recursive: true });
      // Reserve a fresh destination exclusively. A same-name directory is not
      // proof that its bytes match the freshly verified archive; never reuse it
      // or overwrite the current/previous runtime, even if Wine --version works.
      try { await fs.mkdir(releaseRoot, { mode: 0o700 }); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('An engine runtime release with this version already exists; its files were not replaced.');
        throw error;
      }
      reservedRelease = releaseRoot;
      for (const entry of await fs.readdir(candidateRoot)) {
        await fs.rename(path.join(candidateRoot, entry), path.join(releaseRoot, entry));
      }
      const winePath = path.join(releaseRoot, 'files', 'bin', 'wine');
      if (!await this.validateWine(winePath)) throw new Error('The activated runtime is not executable.');
      const pointer: RuntimePointer = { name: releaseName, winePath, commit, installedAt: new Date().toISOString() };
      await fs.mkdir(this.status.runtimeRoot, { recursive: true });
      pointerTemporary = `${this.pointerFile()}.tmp-${randomUUID()}`;
      await fs.writeFile(pointerTemporary, JSON.stringify(pointer, null, 2), { flag: 'wx', mode: 0o600 });
      await fs.rename(pointerTemporary, this.pointerFile());
      activated = true;
      Object.assign(this.status, { installed: true, name: releaseName, winePath, commit, phase: 'Runtime is ready.', error: undefined });
      this.emitLog('runtime', `Active Wine: ${winePath}`);
      return winePath;
    } finally {
      if (pointerTemporary) await fs.rm(pointerTemporary, { force: true }).catch(() => undefined);
      if (reservedRelease && !activated) await fs.rm(reservedRelease, { recursive: true, force: true }).catch(() => undefined);
      await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  // Keep the existing IPC names while both runtime actions use the same
  // application-owned release channel. Immutable upstream inputs are build-only.
  async checkNexus(): Promise<RuntimeStatus> {
    this.status.nexusChecking = true;
    this.status.nexusError = undefined;
    try {
      const response = await fetchEngineRelease(this.fetcher, runtimeReleasesUrl, {
        headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok || !response.body) throw new Error('The xboks Engine runtime release list could not be read.');
      const reader = response.body.getReader(), parts: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const chunk = await reader.read(); if (chunk.done) break;
          size += chunk.value.length;
          if (size > 2_000_000) throw new Error('The engine runtime release list exceeds its size limit.');
          parts.push(chunk.value);
        }
      } finally { await reader.cancel(); }
      this.nexusArtifact = runtimeCandidate(JSON.parse(Buffer.concat(parts).toString()));
      Object.assign(this.status, { nexusAvailable: true, nexusName: this.nexusArtifact.name, nexusVersion: this.nexusArtifact.version, nexusError: undefined, releaseState: 'available' });
    } catch (error) {
      this.nexusArtifact = undefined;
      const message = (error as Error).message;
      Object.assign(this.status, { nexusAvailable: false, nexusName: undefined, nexusVersion: undefined, nexusError: message,
        releaseState: message.startsWith('No xboks Engine runtime release has been published') ? 'unpublished' : 'error' });
    } finally { this.status.nexusChecking = false; }
    return this.current;
  }

  private async downloadFile(url: string, target: string, limit: number): Promise<void> {
    const response = await fetchEngineRelease(this.fetcher, url, { signal: AbortSignal.timeout(600_000) });
    if (!response.ok || !response.body) throw new Error(`Download failed with HTTP ${response.status}.`);
    const reader = response.body.getReader(), file = await fs.open(target, 'wx');
    let size = 0;
    try {
      for (;;) {
        const chunk = await reader.read(); if (chunk.done) break;
        size += chunk.value.length;
        if (size > limit) throw new Error('The engine runtime download exceeds its size limit.');
        await file.writeFile(chunk.value);
      }
    } finally { await file.close(); await reader.cancel(); }
  }

  async installNexus(onStatus: () => void): Promise<string> {
    if (this.isOperationActive()) throw new Error('The runtime cannot be changed while an engine operation is active.');
    if (!this.nexusArtifact) await this.checkNexus();
    const artifact = this.nexusArtifact;
    if (!artifact) throw new Error(this.status.nexusError ?? 'No xboks Engine runtime is available.');
    if (!this.status.prerequisites.tar || !this.status.prerequisites.sha512sum) throw new Error('tar or sha512sum is missing.');

    this.status.updating = true;
    this.status.error = undefined;
    onStatus();
    const staging = path.join(this.status.runtimeRoot, `.staging-${randomUUID()}`);
    const downloads = path.join(staging, 'downloads');
    try {
      await fs.mkdir(downloads, { recursive: true });
      this.setPhase(`Downloading xboks Engine runtime ${artifact.version}…`, onStatus);
      await this.downloadFile(runtimeAssetUrl(artifact.version, artifact.name, artifact.url), path.join(downloads, artifact.name), 4 * 1024 ** 3);
      this.setPhase('Verifying the SHA-512 checksum…', onStatus);
      await this.downloadFile(runtimeAssetUrl(artifact.version, artifact.checksumName, artifact.checksumUrl), path.join(downloads, artifact.checksumName), 4096);
      const checksum = (await fs.readFile(path.join(downloads, artifact.checksumName), 'utf8')).trim().match(/^([a-f0-9]{128})[ \t]+\*?([^\r\n]+)$/i);
      if (!checksum || checksum[2] !== artifact.name) throw new Error('The SHA-512 file does not identify this xboks Engine runtime archive.');
      const result = await run('sha512sum', ['-c', artifact.checksumName], { cwd: downloads, maxOutput: 100_000 });
      if (result.code !== 0) throw new Error('xboks Engine runtime SHA-512 verification failed.');

      return await this.activateArchive(downloads, artifact.name, artifact.version, onStatus, nexusReleaseName(artifact.name));
    } catch (error) {
      this.status.error = (error as Error).message;
      throw error;
    } finally {
      this.status.updating = false;
      await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
      onStatus();
    }
  }

  async rollbackCloudSavePreview(onStatus: () => void): Promise<string> {
    if (this.isOperationActive()) throw new Error('The runtime cannot be changed while an engine operation is active.');
    const current = await this.readPointer();
    const baseName = current ? previewBaseRelease(current.name) : null;
    if (!current || !baseName) throw new Error('No cloud-save preview is active.');
    const winePath = path.join(this.status.runtimeRoot, 'releases', baseName, 'files', 'bin', 'wine');
    if (!await this.validateWine(winePath)) throw new Error('The previous runtime is missing or failed validation. The preview remains active.');
    this.status.updating = true;
    onStatus();
    try {
      const pointer: RuntimePointer = { ...current, name: baseName, winePath, installedAt: new Date().toISOString() };
      const temporary = `${this.pointerFile()}.tmp-${randomUUID()}`;
      await fs.writeFile(temporary, JSON.stringify(pointer, null, 2), { mode: 0o600 });
      await fs.rename(temporary, this.pointerFile());
      Object.assign(this.status, { name: baseName, winePath, phase: 'Previous runtime restored.', error: undefined });
      this.emitLog('runtime', `Restored Wine: ${winePath}`);
      return winePath;
    } finally {
      this.status.updating = false;
      onStatus();
    }
  }
}
