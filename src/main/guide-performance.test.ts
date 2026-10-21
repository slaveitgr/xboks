import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { GuidePerformanceReader, memorySample } from './guide-performance.js';
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'xboks-perf-')); directories.push(root);
  const roots = { proc: path.join(root, 'proc'), drm: path.join(root, 'drm') };
  await Promise.all(Object.values(roots).map(dir => mkdir(dir)));
  return roots;
}
const cpu = (idle: number, user: number) => [{ model: 'synthetic', speed: 1, times: { idle, user, sys: 0, nice: 0, irq: 0 } }];
it('calculates used memory from MemAvailable, not free memory alone', () => {
  expect(memorySample('MemTotal: 1000 kB\nMemFree: 100 kB\nMemAvailable: 600 kB\n')).toEqual({ usedBytes: 409600, totalBytes: 1024000, percent: 40 });
  for (const text of ['', 'MemTotal: 1 kB', 'MemTotal: 0 kB\nMemAvailable: 0 kB', 'MemTotal: 1 kB\nMemAvailable: 2 kB']) expect(memorySample(text)).toBeUndefined();
});
it('starts with unknown CPU, samples real deltas and tolerates counter resets', async () => {
  const roots = await fixture(); let times = cpu(100, 100);
  const reader = new GuidePerformanceReader(roots, () => times);
  expect((await reader.sample()).cpuPercent).toBeUndefined();
  times = cpu(175, 125); expect((await reader.sample()).cpuPercent).toBe(25);
  expect((await reader.sample()).cpuPercent).toBeUndefined();
  times = cpu(1, 1); expect((await reader.sample()).cpuPercent).toBeUndefined();
});
it('reads optional AMD GPU/VRAM independently and never fabricates FPS or other missing counters', async () => {
  const roots = await fixture(), device = path.join(roots.drm, 'card1/device'); await mkdir(device, { recursive: true });
  await writeFile(path.join(roots.proc, 'meminfo'), 'MemTotal: 1000 kB\nMemAvailable: 600 kB\n');
  await writeFile(path.join(device, 'mem_info_vram_total'), '8000\n'); await writeFile(path.join(device, 'mem_info_vram_used'), '2000\n');
  const reader = new GuidePerformanceReader(roots, () => []);
  expect(await reader.sample()).toMatchObject({ status: 'available', memory: { percent: 40 }, vram: { usedBytes: 2000, totalBytes: 8000, percent: 25 } });
  expect(await reader.sample()).not.toHaveProperty('gpuPercent'); expect(await reader.sample()).not.toHaveProperty('fps');
  await writeFile(path.join(device, 'gpu_busy_percent'), '35\n'); expect((await reader.sample()).gpuPercent).toBe(35);
  await writeFile(path.join(device, 'gpu_busy_percent'), '101\n'); await writeFile(path.join(device, 'mem_info_vram_used'), '9000\n');
  const invalid = await reader.sample(); expect(invalid.gpuPercent).toBeUndefined(); expect(invalid.vram).toBeUndefined();
});
it('keeps unavailable driver counters unknown and reports absent data', async () => {
  const roots = await fixture();
  expect(await new GuidePerformanceReader(roots, () => []).sample()).toMatchObject({ status: 'unavailable' });
});
