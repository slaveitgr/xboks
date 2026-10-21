import { expect, it } from 'vitest';
import { downloadRateLabel } from './download-display';

it('converts binary and decimal byte rates to bits without changing a cap', () => {
  const settings = Object.freeze({ downloadLimitMiB: 16, downloadSpeedUnit: 'bits' as const });
  expect(downloadRateLabel('10 MiB/s', settings.downloadSpeedUnit)).toBe('83.9 Mbit/s');
  expect(downloadRateLabel('10 MB/s', settings.downloadSpeedUnit)).toBe('80 Mbit/s');
  expect(settings.downloadLimitMiB).toBe(16);
});
it('preserves unknown and byte presentations and handles zero', () => {
  expect(downloadRateLabel(undefined, 'bits')).toBeUndefined();
  expect(downloadRateLabel('Negotiating…', 'bits')).toBe('Negotiating…');
  expect(downloadRateLabel('0 B/s', 'bits')).toBe('0 bit/s');
  expect(downloadRateLabel('10 MiB/s', 'bytes')).toBe('10 MiB/s');
});
