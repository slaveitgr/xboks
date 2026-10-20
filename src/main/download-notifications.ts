import type { DownloadTask } from '../shared/types.js';

interface NotificationPort {
  isSupported(): boolean;
  show(options: { title: string; body: string }): void;
}

/** Notify only newly completed jobs, never restored history or failed/cancelled
 * tasks. Desktop notification failures must not change installation results. */
export class DownloadCompletionNotifications {
  private readonly notified = new Set<string>();
  constructor(private readonly port: NotificationPort) {}

  complete(task: DownloadTask): boolean {
    if (task.status !== 'complete' || this.notified.has(task.id)) return false;
    this.notified.add(task.id);
    if (this.notified.size > 256) this.notified.delete(this.notified.values().next().value!);
    try {
      if (!this.port.isSupported()) return false;
      const title = task.kind === 'update' ? 'Game update complete' : task.kind === 'content' ? 'Content download complete' : 'Download complete';
      this.port.show({ title, body: `${task.title} has finished downloading.` });
      return true;
    } catch (error) {
      console.warn('Could not show download completion notification:', error instanceof Error ? error.message : 'Desktop notifications unavailable.');
      return false;
    }
  }
}
