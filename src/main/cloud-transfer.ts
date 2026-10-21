import {execFile} from 'node:child_process';
import {externalLauncherEnvironment} from './launcher-environment.js';
export type CloudTransferReader = (binary: string, signal: AbortSignal) => Promise<string>;
/** Exact-purpose one-use proof, on an unobserved private pipe. */
export const readCloudTransferCredential: CloudTransferReader = (binary, signal) => new Promise((resolve, reject) => {
  execFile(binary, ['cloud-transfer-token', '--json'], {signal, timeout: 35_000, killSignal: 'SIGKILL', maxBuffer: 128 * 1024, encoding: 'utf8',
    env: {...externalLauncherEnvironment(process.env), NO_COLOR: '1', TERM: 'dumb', RUST_LOG: 'off'}},
  (error, stdout) => error ? reject(Error('Cloud transfer proof is unavailable.')) : resolve(stdout));
});
/** issuedAt bounds local one-use freshness; it does not invent a provider expiry. */
export function cloudTransferProof(raw: string, account: string, now: number): string {
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > 128 * 1024) throw Error('Invalid cloud transfer proof.');
  let row: Record<string, unknown>;
  try {row = JSON.parse(raw);} catch {throw Error('Invalid cloud transfer proof.');}
  if (!row || typeof row !== 'object' || Array.isArray(row) || row.schema !== 1 || row.account !== account || row.kind !== 'loginprooftoken'
    || typeof row.token !== 'string' || !row.token.length || row.token.length > 100_000 || /[\x00-\x1f\x7f]/.test(row.token)
    || typeof row.issuedAt !== 'string' || row.issuedAt.length > 64 || !Number.isFinite(Date.parse(row.issuedAt))
    || Date.parse(row.issuedAt) < now - 30_000 || Date.parse(row.issuedAt) > now + 5_000) throw Error('Invalid cloud transfer proof.');
  return row.token;
}
