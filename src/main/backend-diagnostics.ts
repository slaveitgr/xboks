import { constants, promises as fs } from 'node:fs';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import type { DiagnosticLog } from '../shared/types.js';
import { readDiagnosticTail } from './diagnostic-log.js';
import { sessionStages, ticketFailureDiagnostic } from './session-errors.js';
import { contentLicenseDiagnostic, contentLicenseStages } from '../shared/content-license.js';
import { transferDiagnostic, transferStages } from '../shared/transfer-failure.js';

const operations = new Set(['account', 'profile', 'achievements', 'library', 'login', 'logout', 'streaming', 'download', 'license', 'run', 'resolve-package', 'service', 'probe']);
const credentialStages = new Set(['keyring-unavailable', 'keyring-invalid-data', 'keyring-missing-data', 'keyring-write-verification', 'credential-io', 'device-authentication']);
const stages = new Set([
  ...sessionStages,
  ...contentLicenseStages,
  ...transferStages,
  'keyring-unavailable', 'keyring-invalid-data', 'keyring-missing-data', 'keyring-write-verification', 'credential-io', 'device-authentication',
  'stored-account', 'account-changed', 'stored-device', 'device-token', 'stored-user', 'user-token', 'http-client',
  'store-ticket', 'store-ticket-refused', 'store-ticket-type', 'store-ticket-format', 'market', 'account-check',
  'entitlement-shape', 'entitlement-count', 'entitlement-product', 'entitlement-status', 'entitlement-trial', 'entitlement-sharing',
  'entitlement-expiry', 'entitlement-parent', 'entitlements-request', 'entitlements-http', 'entitlements-cursor', 'entitlements-pagination',
  'entitlements-size', 'entitlements-read', 'entitlements-json', 'entitlements-inconsistent', 'complete', 'partial',
  'timeout', 'invalid-response', 'loader-library', 'panic', 'ready', 'protocol-error', 'cancelled', 'window-error', 'spawn-not-found', 'spawn-permission',
]);
type Event = 'start' | 'exit' | 'spawn-error' | 'diagnostic' | 'validation';
type Context = { launcher?: string; backend?: string; source?: string };
type RecordData = { operation: string; event: Event; stage?: string; status?: number; skipped?: number; code?: number; serviceCode?: string; signal?: string; elapsedMs?: number };
const version = (value?: string) => value && /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(value) ? value : 'unknown';

/** Allowlisted metadata only. Never persists child output, argv, auth frames or identifiers. */
export class BackendDiagnostics {
  private queue = Promise.resolve();
  private pending = 0;
  private failed = false;
  private readonly root: string;
  private readonly file: string;
  constructor(userData: string, private context: () => Context = () => ({}), private limit = 256 * 1024) {
    this.root = path.join(userData, 'backend-diagnostics');
    this.file = path.join(this.root, 'backend.log');
  }
  private async safeFile(file: string): Promise<void> {
    try {
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || (stat.mode & 0o077)) throw Error('Unsafe log');
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  private async safeRoot(): Promise<void> {
    const stat = await fs.lstat(this.root);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || (stat.mode & 0o077)) throw Error('Unsafe log directory');
  }
  private async append(line: string): Promise<void> {
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    await this.safeRoot();
    await this.safeFile(this.file);
    let size = 0;
    try { size = (await fs.stat(this.file)).size; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (size + Buffer.byteLength(line) > this.limit && size) {
      await this.safeFile(this.file + '.1');
      await fs.rename(this.file, this.file + '.1');
    }
    const handle = await fs.open(this.file, constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW, 0o600);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || (stat.mode & 0o077)) throw Error('Unsafe log');
      await handle.writeFile(line);
    } finally { await handle.close(); }
  }
  record(data: RecordData): void {
    if (!operations.has(data.operation) || !['start', 'exit', 'spawn-error', 'diagnostic', 'validation'].includes(data.event) || this.pending >= 256) return;
    let context: Context;
    try { context = this.context(); } catch { context = {}; }
    const entry: Record<string, unknown> = {
      at: new Date().toISOString(), operation: data.operation, event: data.event,
      launcher: version(context.launcher), backend: version(context.backend),
      source: ['managed', 'external'].includes(context.source ?? '') ? context.source : 'unknown',
    };
    if (data.stage && stages.has(data.stage)) entry.stage = data.stage;
    if (Number.isInteger(data.status) && data.status! >= 100 && data.status! <= 599) entry.status = data.status;
    if (Number.isInteger(data.skipped) && data.skipped! >= 0 && data.skipped! <= 200_000) entry.skipped = data.skipped;
    if (Number.isInteger(data.code) && data.code! >= -1 && data.code! <= 255) entry.code = data.code;
    if (data.serviceCode && /^[A-F0-9]{8}$/.test(data.serviceCode) && ['library', 'profile'].includes(data.operation)
      && ['ticket-refused', 'ticket-interaction-required'].includes(data.stage ?? '')) entry.serviceCode = data.serviceCode;
    if (data.signal && ['SIGINT', 'SIGTERM', 'SIGKILL', 'SIGSEGV', 'SIGABRT', 'SIGPIPE'].includes(data.signal)) entry.signal = data.signal;
    if (Number.isFinite(data.elapsedMs)) entry.elapsedMs = Math.max(0, Math.min(86_400_000, Math.round(data.elapsedMs!)));
    this.pending++;
    this.queue = this.queue.then(() => this.append(JSON.stringify(entry) + '\n')).catch(() => { this.failed = true; }).finally(() => { this.pending--; });
  }
  async flush(): Promise<void> { await this.queue; }
  get pendingWrites(): number { return this.pending; }
  async read(): Promise<DiagnosticLog> {
    await this.flush();
    if (this.failed) throw Error('Backend diagnostics could not be saved. Check available disk space and private profile permissions.');
    try { await this.safeRoot(); await this.safeFile(this.file); return await readDiagnosticTail(this.file, this.root); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { name: 'backend.log', content: 'No backend operations have been recorded in this profile yet.', truncated: false };
      throw Error('Backend diagnostics could not be opened safely.');
    }
  }
}

/** Bounded, ASCII-only framing. Unknown or oversized lines are discarded, not redacted. */
export class BackendDiagnosticReader {
  private line = '';
  private discard = false;
  private total = 0;
  private emitted = 0;
  constructor(private operation: string, private emit: (record: RecordData) => void) {}
  push(bytes: Buffer): void {
    for (const byte of bytes) {
      if (++this.total > 2 * 1024 * 1024 || this.emitted >= 32) return;
      if (byte === 10) {
        if (!this.discard) this.consume(this.line.replace(/\r$/, ''));
        this.line = ''; this.discard = false;
      } else if (!this.discard) {
        if (this.line.length >= 512 || byte > 127) { this.line = ''; this.discard = true; }
        else this.line += String.fromCharCode(byte);
      }
    }
  }
  private consume(line: string): void {
    let stage: string | undefined, status: number | undefined, skipped: number | undefined, serviceCode: string | undefined;
    const credential = /^NEXUS_CREDENTIAL_ERROR_V1 ([a-z-]+)$/.exec(line);
    const session = /^NEXUS_SESSION_DIAGNOSTIC_V1 ([a-z-]+)$/.exec(line);
    const content = contentLicenseDiagnostic(line);
    const transfer = transferDiagnostic(line);
    const ticket = ticketFailureDiagnostic(line);
    const numeric = /^NEXUS_LIBRARY_DIAGNOSTIC_V1 ([a-z-]+) (\d{1,3}) (\d{1,6})$/.exec(line);
    const legacy = /^Account library unavailable \(([a-z-]+)\); credentials and installed games are unchanged\.$/.exec(line);
    if (credential && credentialStages.has(credential[1])) stage = credential[1];
    else if (ticket && ['library', 'profile'].includes(this.operation)) { stage = ticket.stage; serviceCode = ticket.serviceCode; }
    else if (transfer && ['streaming', 'download'].includes(this.operation)) { stage = transfer.stage; status = transfer.status; }
    else if (content && ['streaming', 'download', 'license', 'run'].includes(this.operation)) { stage = content.stage; status = content.status; }
    else if (session && ['library', 'profile'].includes(this.operation) && sessionStages.has(session[1])) stage = session[1];
    else if (numeric && this.operation === 'library') {
      stage = numeric[1]; status = Number(numeric[2]); skipped = Number(numeric[3]);
      if ((status !== 0 && (status < 100 || status > 599)) || skipped > 200_000) return;
    }
    else if (legacy && this.operation === 'library') stage = legacy[1];
    else if (line === 'Unable to read the stored account: Stored Xodus credentials are empty or invalid. Check the system keyring.') stage = 'keyring-invalid-data';
    else if (line === 'Unable to read the stored account: The system keyring could not be accessed. Check that it is running and unlocked.') stage = 'keyring-unavailable';
    else if (line === 'Account library timed out; installed games are unchanged.') stage = 'timeout';
    else if (/^thread '[^']{1,80}' panicked at /.test(line)) stage = 'panic';
    else if (/^[^\r\n]{1,200}: error while loading shared libraries: /.test(line)) stage = 'loader-library';
    if (!stage || !stages.has(stage)) return;
    this.emitted++;
    this.emit({ operation: this.operation, event: 'diagnostic', stage, status, skipped, serviceCode });
  }
}

let active: BackendDiagnostics | undefined;
export function setBackendDiagnostics(value: BackendDiagnostics | undefined): void { active = value; }
export function backendDiagnostic(data: RecordData): void { active?.record(data); }
export function observeBackendChild(child: ChildProcess, operation: string): void {
  const log = active;
  if (!log || !operations.has(operation)) return;
  const start = performance.now();
  log.record({ operation, event: 'start' });
  const reader = new BackendDiagnosticReader(operation, record => log.record(record));
  child.stderr?.on('data', (bytes: Buffer) => reader.push(bytes));
  // No stdout listener: login URLs, cookies, profile and entitlement data are private.
  child.once('error', error => log.record({ operation, event: 'spawn-error', elapsedMs: performance.now() - start,
    stage: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'spawn-not-found' : (error as NodeJS.ErrnoException).code === 'EACCES' ? 'spawn-permission' : undefined }));
  child.once('close', (code, signal) => log.record({ operation, event: 'exit', code: code ?? -1, signal: signal ?? undefined, elapsedMs: performance.now() - start }));
}
export function observeBackendCommand(child: ChildProcess, binary: string, args: string[]): void {
  if (path.basename(binary) !== 'xodus-cli') return;
  const operation = args.includes('--help') || args.includes('--version') ? 'probe' : args[0];
  observeBackendChild(child, operation);
}
