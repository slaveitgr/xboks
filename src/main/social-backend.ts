import { constants, promises as fs, type Stats } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { stripAnsi } from '../shared/utils.js';
import { externalLauncherEnvironment } from './launcher-environment.js';

const MAX_BINARY = 300 * 1024 * 1024;
const MAX_LICENSE = 2 * 1024 * 1024;
const MAX_SOURCE = 2 * 1024 * 1024 * 1024;
const MAX_MANIFEST = 64 * 1024;
const MAX_HELP = 100_000;
export interface SocialBackendHelpOptions { timeout: number; maxBuffer: number }
export type SocialBackendHelpProbe = (binary: string, args: readonly string[], options: SocialBackendHelpOptions) => Promise<{ code: number; stdout: string; stderr?: string }>;
const helpProbe: SocialBackendHelpProbe = (binary, args, options) => new Promise((resolve, reject) => {
  execFile(binary, [...args], { shell: false, encoding: 'utf8', timeout: options.timeout, maxBuffer: options.maxBuffer, killSignal: 'SIGKILL',
    env: { ...externalLauncherEnvironment(process.env), NO_COLOR: '1', TERM: 'dumb' } }, (error, stdout, stderr) => {
    if (error && (error.killed || typeof error.code !== 'number')) { reject(error); return; }
    resolve({ code: error ? Number(error.code) : 0, stdout, stderr });
  });
});
const unchanged = (a: Stats, b: Stats) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mode === b.mode && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
const validDigest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
interface VerifiedCompanionFile { file: string; stat: Stats }
async function verifyCompanionFile(root: string, name: string, expected: string, limit: number, executable = false): Promise<VerifiedCompanionFile> {
  const file = path.join(root, name), before = await fs.lstat(file);
  if (!before.isFile() || before.isSymbolicLink() || before.size < 1 || before.size > limit || executable && !(before.mode & 0o111)) throw Error('Invalid companion file.');
  if (path.dirname(await fs.realpath(file)) !== root) throw Error('Companion file is outside its bundle.');
  if (executable) await fs.access(file, constants.X_OK);
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!unchanged(before, await handle.stat())) throw Error('Companion file changed.');
    const hash = createHash('sha256'); let bytes = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      bytes += chunk.length;
      if (bytes > limit) throw Error('Companion file exceeds its limit.');
      hash.update(chunk);
    }
    if (bytes !== before.size || !unchanged(before, await handle.stat()) || hash.digest('hex') !== expected) throw Error('Companion file verification failed.');
  } finally { await handle.close(); }
  if (!unchanged(before, await fs.lstat(file))) throw Error('Companion file changed.');
  return { file, stat: before };
}
function hasCompanionCommand(help: string, command: 'social' | 'cloud-token'): boolean {
  let commands = false;
  for (const line of stripAnsi(help).split(/\r?\n/)) {
    if (/^Commands:\s*$/.test(line)) { commands = true; continue; }
    if (commands && /^\S/.test(line)) commands = false;
    if (commands && new RegExp(`^ {2,}${command}(?:\\s|$)`).test(line)) return true;
  }
  return false;
}

/** Resolve an optional companion without changing the selected/installed backend.
 * The only process probe is its bounded top-level --help; never account/login/social.
 * Binary, license and corresponding-source bytes must match the manifest.
 * These hashes do not prove source completeness, publisher identity or live services. */
export async function socialBackend(root: string, probe: SocialBackendHelpProbe = helpProbe, requiredCommand: 'social' | 'cloud-token' = 'social'): Promise<string | undefined> {
  if (process.platform !== 'linux' || !path.isAbsolute(root) || !['social', 'cloud-token'].includes(requiredCommand)) return undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const directory = await fs.lstat(root);
    if (!directory.isDirectory() || directory.isSymbolicLink()) return undefined;
    const canonicalRoot = await fs.realpath(root);
    const manifestPath = path.join(canonicalRoot, 'manifest.json');
    const manifestStat = await fs.lstat(manifestPath);
    if (!manifestStat.isFile() || manifestStat.isSymbolicLink() || manifestStat.size < 1 || manifestStat.size > MAX_MANIFEST) return undefined;
    const manifestHandle = await fs.open(manifestPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    let manifest: { schema?: unknown; version?: unknown; sha256?: unknown; binary?: unknown;
      license?: unknown; licenseSha256?: unknown; sourceArchive?: unknown; sourceArchiveSha256?: unknown };
    try {
      const buffer = Buffer.alloc(MAX_MANIFEST + 1);
      const { bytesRead } = await manifestHandle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > MAX_MANIFEST || !unchanged(manifestStat, await manifestHandle.stat())) return undefined;
      manifest = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'));
    } finally { await manifestHandle.close(); }
    if (!manifest || manifest.schema !== 1 || manifest.version !== '0.3.0' || typeof manifest.binary !== 'string' ||
        !['xboks-engine', 'xodus-cli'].includes(manifest.binary) || !validDigest(manifest.sha256) ||
        manifest.license !== 'LICENSE' || !validDigest(manifest.licenseSha256) ||
        manifest.sourceArchive !== 'source.tar.xz' || !validDigest(manifest.sourceArchiveSha256)) return undefined;
    const verified = [
      await verifyCompanionFile(canonicalRoot, manifest.binary, manifest.sha256, MAX_BINARY, true),
      await verifyCompanionFile(canonicalRoot, manifest.license, manifest.licenseSha256, MAX_LICENSE),
      await verifyCompanionFile(canonicalRoot, manifest.sourceArchive, manifest.sourceArchiveSha256, MAX_SOURCE),
    ];
    const binary = verified[0].file;
    const result = await Promise.race([
      probe(binary, ['--help'], { timeout: 5_000, maxBuffer: MAX_HELP }),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Companion help probe timed out.')), 5_000); }),
    ]);
    if (result.code !== 0 || Buffer.byteLength(result.stdout) > MAX_HELP || Buffer.byteLength(result.stderr ?? '') > MAX_HELP || !hasCompanionCommand(result.stdout, requiredCommand)) return undefined;
    for (const entry of verified) if (!unchanged(entry.stat, await fs.lstat(entry.file))) return undefined;
    if (!unchanged(manifestStat, await fs.lstat(manifestPath))) return undefined;
    return binary;
  } catch { return undefined; }
  finally { if (timer) clearTimeout(timer); }
}
