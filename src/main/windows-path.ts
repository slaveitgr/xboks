import { promises as fs } from 'node:fs';
import path from 'node:path';

const fold = (value: string) => value.replace(/[A-Z]/g, letter => letter.toLowerCase());

/** Resolve a Windows package path without guessing among ambiguous Linux files. */
export async function resolvePackageFile(root: string, name: string): Promise<string | undefined> {
  const parts = name.split(/[\\/]+/).filter(Boolean);
  if (!parts.length || parts.some(part => part === '.' || part === '..' || part.includes(':') || part.includes('\0'))) return;
  try {
    const base = await fs.realpath(root);
    let current = base;
    for (const part of parts) {
      const entries = await fs.readdir(current);
      const matches = entries.includes(part) ? [part] : entries.filter(entry => fold(entry) === fold(part));
      if (matches.length !== 1) return;
      current = path.join(current, matches[0]);
      const real = await fs.realpath(current);
      const relative = path.relative(base, real);
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return;
    }
    if (!(await fs.stat(current)).isFile()) return;
    return path.relative(base, current);
  } catch { return undefined; }
}
