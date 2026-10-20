import { Writable } from 'node:stream';
import { expect, it } from 'vitest';
import { DownloadBandwidthControls, isBandwidthOnlyPatch } from './download-bandwidth.js';

it('updates every active CLI once, leaves finished channels alone and can remove the limit', async () => {
  const controls = new DownloadBandwidthControls();
  const frames: string[][] = [[], []];
  const channels = frames.map(output => new Writable({ write(bytes, _encoding, done) { output.push(bytes.toString()); done(); } }));
  channels.forEach((channel, i) => controls.attach(String(i), channel));
  await controls.apply(0.5);
  expect(frames.map(output => JSON.parse(output[0]))).toEqual([0, 1].map(() => ({ schema: 1, command: 'set-download-limit', kibPerSecond: 512 })));
  controls.detach('0');
  await controls.apply(0);
  expect(frames[0]).toHaveLength(1);
  expect(JSON.parse(frames[1][1]).kibPerSecond).toBe(0);
  channels.forEach(channel => channel.destroy());
});

it('reports closed/write-failing channels rather than pretending the live limit applied', async () => {
  const controls = new DownloadBandwidthControls();
  const closed = new Writable({ write(_bytes, _encoding, done) { done(); } }); closed.destroy();
  controls.attach('closed', closed);
  await expect(controls.apply(1)).rejects.toThrow('no longer accepting');
  controls.detach('closed');
  const broken = new Writable({ write(_bytes, _encoding, done) { done(Error('synthetic pipe failure')); } });
  broken.on('error', () => {}); controls.attach('broken', broken);
  await expect(controls.apply(1)).rejects.toThrow('synthetic pipe failure');
  controls.detach('broken');
  await expect(controls.apply(0)).resolves.toBeUndefined();
});

it('recognizes only rate-only updates for the no-authentication settings path', () => {
  expect(isBandwidthOnlyPatch({ downloadLimitMiB: 0 })).toBe(true);
  expect(isBandwidthOnlyPatch({ downloadLimitMiB: 2 })).toBe(true);
  for (const patch of [{}, { market: 'US' }, { downloadLimitMiB: 2, market: 'GB' }]) expect(isBandwidthOnlyPatch(patch)).toBe(false);
});
