import { constants, promises as fs, type Stats } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { stripAnsi } from '../shared/utils.js';
import { externalLauncherEnvironment } from './launcher-environment.js';

const MAX_BINARY = 300 * 1024 * 1024;
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
function hasSocialCommand(help: string): boolean {
  let commands = false;
  for (const line of stripAnsi(help).split(/\r?\n/)) {
    if (/^Commands:\s*$/.test(line)) { commands = true; continue; }
    if (commands && /^\S/.test(line)) commands = false;
    if (commands && /^ {2,}social(?:\s|$)/.test(line)) return true;
  }
  return false;
}

/** Resolve an optional companion without changing the selected/installed backend.
 * The only process probe is its bounded top-level --help; never account/login/social.
 * The manifest binds local bytes, not publisher authenticity or live service behavior. */
export async function socialBackend(root: string, probe: SocialBackendHelpProbe = helpProbe): Promise<string | undefined> {
  if (process.platform !== 'linux' || !path.isAbsolute(root)) return undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const directory = await fs.lstat(root);
    if (!directory.isDirectory() || directory.isSymbolicLink()) return undefined;
    const canonicalRoot = await fs.realpath(root);
    const manifestPath = path.join(canonicalRoot, 'manifest.json');
    const manifestStat = await fs.lstat(manifestPath);
    if (!manifestStat.isFile() || manifestStat.isSymbolicLink() || manifestStat.size < 1 || manifestStat.size > MAX_MANIFEST) return undefined;
    const manifestHandle = await fs.open(manifestPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    let manifest: { schema?: unknown; version?: unknown; sha256?: unknown; binary?: unknown };
    try {
      const buffer = Buffer.alloc(MAX_MANIFEST + 1);
      const { bytesRead } = await manifestHandle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > MAX_MANIFEST || !unchanged(manifestStat, await manifestHandle.stat())) return undefined;
      manifest = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'));
    } finally { await manifestHandle.close(); }
    if (!manifest || manifest.schema !== 1 || manifest.version !== '0.3.0' || manifest.binary !== 'xodus-cli' || typeof manifest.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(manifest.sha256)) return undefined;
    const binary = path.join(canonicalRoot, 'xodus-cli');
    const before = await fs.lstat(binary);
    if (!before.isFile() || before.isSymbolicLink() || before.size < 1 || before.size > MAX_BINARY || !(before.mode & 0o111)) return undefined;
    if (path.dirname(await fs.realpath(binary)) !== canonicalRoot) return undefined;
    await fs.access(binary, constants.X_OK);
    const handle = await fs.open(binary, constants.O_RDONLY | constants.O_NOFOLLOW);
    let digest: string;
    try {
      if (!unchanged(before, await handle.stat())) return undefined;
      const hash = createHash('sha256'); let bytes = 0;
      for await (const chunk of handle.createReadStream({ autoClose: false })) {
        bytes += chunk.length; if (bytes > MAX_BINARY) return undefined;
        hash.update(chunk);
      }
      if (bytes !== before.size || !unchanged(before, await handle.stat())) return undefined;
      digest = hash.digest('hex');
    } finally { await handle.close(); }
    if (digest !== manifest.sha256 || !unchanged(before, await fs.lstat(binary))) return undefined;
    const result = await Promise.race([
      probe(binary, ['--help'], { timeout: 5_000, maxBuffer: MAX_HELP }),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Companion help probe timed out.')), 5_000); }),
    ]);
    if (result.code !== 0 || Buffer.byteLength(result.stdout) > MAX_HELP || Buffer.byteLength(result.stderr ?? '') > MAX_HELP || !hasSocialCommand(result.stdout)) return undefined;
    if (!unchanged(before, await fs.lstat(binary)) || !unchanged(manifestStat, await fs.lstat(manifestPath))) return undefined;
    return binary;
  } catch { return undefined; }
  finally { if (timer) clearTimeout(timer); }
}
