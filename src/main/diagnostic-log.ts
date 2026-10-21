import { constants, promises as fs } from 'node:fs';
import path from 'node:path';
import type { DiagnosticLog } from '../shared/types.js';

async function openDiagnosticFile(file: string, root: string) {
  const canonicalRoot = await fs.realpath(root);
  const canonical = await fs.realpath(file);
  if (!canonical.startsWith(canonicalRoot + path.sep)) throw new Error('Not a launcher diagnostic log.');
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (!(await handle.stat()).isFile()) throw new Error('Diagnostic log is not a regular file.');
    return { handle, canonical };
  } catch (error) { await handle.close(); throw error; }
}

export async function diagnosticLogFile(file: string, root: string): Promise<string> {
  const { handle, canonical } = await openDiagnosticFile(file, root);
  try { return canonical; } finally { await handle.close(); }
}

// Copy the full file at the moment of the click, never the renderer's preview.
// Keep a memory ceiling and fail explicitly instead of silently truncating.
// A log still being written may append more bytes after this snapshot.
export async function copyDiagnosticFile(file: string, root: string, writeText: (text: string) => void,
  limit = 128 * 1024 * 1024): Promise<void> {
  const { handle } = await openDiagnosticFile(file, root);
  try {
    const { size } = await handle.stat();
    if (size > limit) throw new Error('This log is too large for the clipboard. Use Show log file to attach the complete file.');
    const buffer = Buffer.alloc(size);
    let offset = 0;
    while (offset < size) {
      const { bytesRead } = await handle.read(buffer, offset, Math.min(size - offset, 1024 * 1024), offset);
      if (!bytesRead) throw new Error('The log changed while copying. Try again.');
      offset += bytesRead;
    }
    writeText(buffer.toString('utf8'));
  } finally { await handle.close(); }
}

// Read only a bounded tail from the known private diagnostic directory. The
// renderer gets escaped text, never a file:// page or a file-association launch.
export async function readDiagnosticTail(file: string, root: string, limit = 512 * 1024): Promise<DiagnosticLog> {
  const { handle } = await openDiagnosticFile(file, root);
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
