import { constants, promises as fs } from 'node:fs';
import path from 'node:path';
import type { DiagnosticLog } from '../shared/types.js';

// Read only a bounded tail from the known private diagnostic directory. The
// renderer gets escaped text, never a file:// page or a file-association launch.
export async function readDiagnosticTail(file: string, root: string, limit = 512 * 1024): Promise<DiagnosticLog> {
  const canonicalRoot = await fs.realpath(root);
  const canonical = await fs.realpath(file);
  if (!canonical.startsWith(canonicalRoot + path.sep)) throw new Error('Not a launcher diagnostic log.');
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('Diagnostic log is not a regular file.');
    const length = Math.min(stat.size, limit);
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, Math.max(0, stat.size - length));
    let content = buffer.subarray(0, bytesRead).toString('utf8');
    if (stat.size > limit && content.includes('\n')) content = content.slice(content.indexOf('\n') + 1);
    return { name: path.basename(file), content, truncated: stat.size > limit };
  } finally { await handle.close(); }
}
