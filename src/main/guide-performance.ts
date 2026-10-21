import os from 'node:os';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { GuidePerformance } from '../shared/guide-widgets.js';

export function memorySample(text: string): GuidePerformance['memory'] {
  const value = (name: string) => Number(text.match(new RegExp(`^${name}:\\s+(\\d+) kB$`, 'm'))?.[1]) * 1024;
  const totalBytes = value('MemTotal'), available = value('MemAvailable');
  if (!Number.isSafeInteger(totalBytes) || totalBytes <= 0 || !Number.isSafeInteger(available) || available < 0 || available > totalBytes) return;
  const usedBytes = totalBytes - available;
  return { usedBytes, totalBytes, percent: usedBytes / totalBytes * 100 };
}
export class GuidePerformanceReader {
  private previous?: { total: number; idle: number };
  constructor(private roots = { proc: '/proc', drm: '/sys/class/drm' }, private cpus = os.cpus) {}
  async sample(): Promise<GuidePerformance> {
    const result: GuidePerformance = { status: 'available', sampledAt: new Date().toISOString() };
    const processors = this.cpus();
    const now = processors.reduce((a, cpu) => ({ total: a.total + Object.values(cpu.times).reduce((sum, n) => sum + n, 0), idle: a.idle + cpu.times.idle }), { total: 0, idle: 0 });
    if (this.previous && now.total > this.previous.total && now.idle >= this.previous.idle) result.cpuPercent = Math.max(0, Math.min(100, 100 * (1 - (now.idle - this.previous.idle) / (now.total - this.previous.total))));
    this.previous = now;
    try { result.memory = memorySample(await fs.readFile(path.join(this.roots.proc, 'meminfo'), 'utf8')); } catch { /* Unknown stays unknown. */ }
    try {
      const cards = (await fs.readdir(this.roots.drm)).filter(name => /^card\d+$/.test(name)).sort();
      for (const card of cards) {
        const device = path.join(this.roots.drm, card, 'device');
        const number = async (name: string) => {
          const text = (await fs.readFile(path.join(device, name), 'utf8')).trim();
          return /^\d+$/.test(text) && Number.isSafeInteger(Number(text)) ? Number(text) : NaN;
        };
        try {
          const busy = await number('gpu_busy_percent');
          if (busy >= 0 && busy <= 100) result.gpuPercent = busy;
        } catch { /* GPU and VRAM counters are independent optional capabilities. */ }
        try {
          const [usedBytes, totalBytes] = await Promise.all([number('mem_info_vram_used'), number('mem_info_vram_total')]);
          if (totalBytes > 0 && usedBytes >= 0 && usedBytes <= totalBytes) result.vram = { usedBytes, totalBytes, percent: usedBytes / totalBytes * 100 };
        } catch { /* Some drivers expose neither counter. */ }
        if (result.gpuPercent !== undefined || result.vram) break;
      }
    } catch { /* No readable DRM counters. */ }
    if (!processors.length && !result.memory && result.gpuPercent === undefined && !result.vram) return { ...result, status: 'unavailable', reason: 'System performance counters are unavailable.' };
    return result;
  }
}
