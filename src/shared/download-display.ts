/** Convert presentation only. The stored MiB/s limit and backend KiB/s control
 * are intentionally independent of this preference (F48405). */
export function downloadRateLabel(rate: string | undefined, unit: 'bits' | 'bytes' = 'bytes'): string | undefined {
  if (!rate || unit === 'bytes') return rate;
  const match = rate.trim().match(/^(\d+(?:\.\d+)?)\s*(B|KiB|MiB|GiB|TiB|KB|MB|GB|TB)\/s$/i);
  if (!match) return rate;
  const factors: Record<string, number> = { b: 1, kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4, kb: 1000, mb: 1000 ** 2, gb: 1000 ** 3, tb: 1000 ** 4 };
  const bits = Number(match[1]) * factors[match[2].toLowerCase()] * 8;
  if (!Number.isFinite(bits)) return rate;
  const index = Math.max(0, Math.min(4, bits > 0 ? Math.floor(Math.log10(bits) / 3) : 0));
  return `${(bits / 1000 ** index).toLocaleString('en-US', { maximumFractionDigits: 1, useGrouping: false })} ${['bit/s', 'Kbit/s', 'Mbit/s', 'Gbit/s', 'Tbit/s'][index]}`;
}
