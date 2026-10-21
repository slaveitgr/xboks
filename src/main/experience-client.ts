import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { externalLauncherEnvironment } from './launcher-environment.js';

export interface ExperienceLease { available: boolean; active: boolean; owned: boolean; reason?: string }
export interface ExperienceBridge {
  readonly current: ExperienceLease;
  request(method: 'state' | 'enter' | 'leave'): Promise<ExperienceLease>;
  dispose(): void;
}

/** Keep a session-bus sender alive for the lifetime of its shell lease. A
 * one-shot gdbus command cannot provide app-exit cleanup ownership. */
export class GnomeExperienceClient implements ExperienceBridge {
  private child?: ChildProcessWithoutNullStreams;
  private nextId = 0;
  private partial = '';
  private value: ExperienceLease = { available: false, active: false, owned: false, reason: 'GNOME integration has not been checked.' };
  private pending = new Map<number, { resolve(value: ExperienceLease): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  constructor(private options: {
    helper: string;
    environment?: NodeJS.ProcessEnv;
    changed?: (value: ExperienceLease) => void;
    start?: () => ChildProcessWithoutNullStreams;
    timeoutMs?: number;
  }) {}
  get current(): ExperienceLease { return { ...this.value }; }
  private publish(value: ExperienceLease): void { this.value = value; this.options.changed?.(this.current); }
  private fail(reason: string): void {
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(Error(reason)); }
    this.pending.clear();
    this.publish({ available: false, active: false, owned: false, reason });
  }
  private start(): void {
    if (this.child) return;
    const environment = this.options.environment ?? process.env;
    if (process.platform !== 'linux' || !/(?:^|:)gnome(?:$|:)/i.test(environment.XDG_CURRENT_DESKTOP ?? '')) throw Error('GNOME Shell integration is available in a GNOME desktop session.');
    if (!path.isAbsolute(this.options.helper) || !existsSync(this.options.helper)) throw Error('The GNOME integration helper is unavailable.');
    const child = this.options.start?.() ?? spawn('gjs', ['-m', this.options.helper], {
      env: externalLauncherEnvironment(environment), stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child; this.partial = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (this.child !== child) return;
      this.partial += chunk;
      if (this.partial.length > 65_536) { this.dispose(); return; }
      let newline;
      while ((newline = this.partial.indexOf('\n')) >= 0) {
        const line = this.partial.slice(0, newline); this.partial = this.partial.slice(newline + 1);
        if (line) this.receive(line);
      }
    });
    // Never send helper stderr/DBus response bodies or desktop state to UI logs.
    child.stderr.resume();
    child.stdin.on('error', () => { if (this.child === child) this.dispose(); });
    child.once('error', () => {
      if (this.child !== child) return;
      this.child = undefined; this.fail('The GNOME integration helper could not start.');
    });
    child.once('close', () => {
      if (this.child !== child) return;
      this.child = undefined; this.fail('The GNOME integration helper disconnected; desktop mode was restored.');
    });
  }
  private receive(line: string): void {
    try {
      const message = JSON.parse(line);
      if (!message || typeof message !== 'object') throw Error();
      if (message.event === 'unavailable') {
        this.fail('The xboks GNOME extension is not installed or enabled.'); return;
      }
      if (typeof message.active !== 'boolean' || typeof message.owned !== 'boolean' || message.owned && !message.active) throw Error();
      const state: ExperienceLease = { available: true, active: message.active, owned: message.owned };
      if (message.event === 'state') { this.publish(state); return; }
      if (!Number.isSafeInteger(message.id) || typeof message.ok !== 'boolean') throw Error();
      const request = this.pending.get(message.id);
      if (!request) return;
      clearTimeout(request.timer); this.pending.delete(message.id);
      this.publish(message.ok === false && message.error === 'unavailable'
        ? { available: false, active: false, owned: false, reason: 'The xboks GNOME extension is not installed or enabled.' } : state);
      if (message.ok) request.resolve(this.current);
      else request.reject(Error('GNOME could not change Xbox mode. Keep xboks focused and check that the extension is enabled.'));
    } catch { this.dispose(); }
  }
  async request(method: 'state' | 'enter' | 'leave'): Promise<ExperienceLease> {
    if (!['state', 'enter', 'leave'].includes(method)) throw Error('Invalid gaming mode operation.');
    try { this.start(); }
    catch (error) { this.fail((error as Error).message); throw error; }
    if (this.pending.size >= 8) throw Error('A gaming mode request is already pending.');
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return;
        // Losing an unknown in-flight Enter must also drop its bus lease.
        this.dispose();
      }, this.options.timeoutMs ?? 10_000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.child!.stdin.write(JSON.stringify({ id, method }) + '\n'); }
      catch { this.dispose(); }
    });
  }
  dispose(): void {
    const child = this.child; this.child = undefined; this.partial = '';
    this.fail('GNOME integration is disconnected. The shell restores desktop mode when the lease closes.');
    if (!child) return;
    child.stdin.end(); child.kill('SIGTERM');
    const timer = setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 1500);
    timer.unref(); child.once('close', () => clearTimeout(timer));
  }
}
