import type { Writable } from 'node:stream';
import { downloadLimitCommand } from '../shared/download-bandwidth.js';

/** Active CLI stdin channels only. Removing a channel never changes its process. */
export class DownloadBandwidthControls {
  private channels = new Map<string, Writable>();
  attach(id: string, stdin: Writable): void { this.channels.set(id, stdin); }
  detach(id: string): void { this.channels.delete(id); }
  async apply(limitMiB: number): Promise<void> {
    const command = downloadLimitCommand(limitMiB);
    await Promise.all([...this.channels.values()].map(stdin => new Promise<void>((resolve, reject) => {
      if (stdin.destroyed || !stdin.writable) { reject(Error('The active download is no longer accepting controls.')); return; }
      stdin.write(command, error => error ? reject(error) : resolve());
    })));
  }
}

export function isBandwidthOnlyPatch(patch: object): boolean {
  return Object.keys(patch).length === 1 && Object.hasOwn(patch, 'downloadLimitMiB');
}
