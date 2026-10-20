import type { BackendCapabilities } from './types.js';
/** UI uses MiB/s, backend protocol uses integer KiB/s. Zero is unlimited. */
export function downloadLimitKiB(value: unknown): number {
  if (value === undefined) return 0;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1024 || value > 0 && value < 1 / 1024) throw Error('Download speed limit must be 0 (unlimited) or between 0.001 and 1024 MiB/s.');
  return value === 0 ? 0 : Math.max(1, Math.floor(value * 1024));
}
export function downloadLimitArgs(value: unknown, capabilities: Pick<BackendCapabilities, 'streamingBandwidthLimit'>): string[] {
  const kib = downloadLimitKiB(value);
  if (!capabilities.streamingBandwidthLimit) {
    if (kib) throw Error('Update the Nexus backend in Settings to use the configured download speed limit. The download was not started without its limit.');
    return [];
  }
  return ['--download-limit-kib', String(kib)];
}
export function downloadLimitCommand(value: unknown): string {
  return JSON.stringify({schema:1,command:'set-download-limit',kibPerSecond:downloadLimitKiB(value)})+'\n';
}
