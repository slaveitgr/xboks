import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { spawnTracked } from './process.js';

/** Only the provider sees the wallet password. This helper exchanges fixed
 * wallet-operation states, never credentials, secret values or provider error text. */
export class WalletUnlocker {
  private child?: ChildProcessWithoutNullStreams;
  private pending?: Promise<unknown>;
  get busy(): boolean { return Boolean(this.child); }
  async unlock(binary: string, windowId = ''): Promise<string> {
    return this.run(binary, windowId, 'keyring-unlock');
  }
  async create(binary: string, windowId = ''): Promise<string> {
    return this.run(binary, windowId, 'keyring-create');
  }
  private async run(binary: string, windowId: string, command: 'keyring-unlock' | 'keyring-create'): Promise<string> {
    if (this.child || !/^\d{0,20}$/.test(windowId)) return 'unavailable';
    const tracked = spawnTracked(binary, [command, '--window-id', windowId], { stdoutOnly: true, maxOutput: 4096, outputDrainMs: 100 });
    this.child = tracked.child;
    this.pending = tracked.result;
    const timeout = setTimeout(() => this.cancel(), 95_000);
    try {
      const result = await tracked.result;
      if (result.code !== 0) return 'unavailable';
      const value = JSON.parse(result.output);
      return value?.schema === 1 && ['ready', 'locked', 'stopped', 'needs-setup', 'cancelled', 'timed-out', 'unavailable'].includes(value.state)
        ? value.state : 'unavailable';
    } catch { return 'unavailable'; }
    finally { clearTimeout(timeout); this.child = undefined; this.pending = undefined; }
  }
  cancel(): void {
    const child = this.child;
    if (!child) return;
    child.kill('SIGINT');
    const force = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, 4000);
    force.unref();
  }
  async stop(): Promise<void> {
    this.cancel();
    await this.pending?.catch(() => {});
  }
}
