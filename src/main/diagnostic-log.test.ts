import { expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { copyDiagnosticFile, diagnosticLogFile, readDiagnosticTail } from './diagnostic-log.js';
it('reads a bounded diagnostic tail and rejects outside paths/symlinks', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-log-test-'));
  try {
    const logs = path.join(root, 'logs'); await fs.mkdir(logs);
    const file = path.join(logs, 'game.log'); await fs.writeFile(file, 'old line\n'.repeat(20) + 'last line');
    const log = await readDiagnosticTail(file, logs, 24); expect(log.truncated).toBe(true); expect(log.content).toContain('last line'); expect(log.content.length).toBeLessThanOrEqual(24);
    await fs.writeFile(path.join(root, 'outside'), 'PRIVATE');
    await expect(readDiagnosticTail(path.join(root, 'outside'), logs)).rejects.toThrow('Not a launcher');
    await fs.symlink(file, path.join(logs, 'link')); await expect(readDiagnosticTail(path.join(logs, 'link'), logs)).rejects.toThrow();
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
it('copies the complete Unicode log rather than its bounded preview, including first and final lines', async () => {
  const logs = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-full-log-'));
  try {
    const file = path.join(logs, 'game.log');
    const content = 'FIRST: původní chyba\n' + 'diagnostika žluťoučký\n'.repeat(90000) + 'LAST: dokončeno 😀\n';
    await fs.writeFile(file, content);
    const preview = await readDiagnosticTail(file, logs);
    expect(preview.truncated).toBe(true); expect(preview.content).not.toContain('FIRST:');
    const writeText = vi.fn();
    await copyDiagnosticFile(file, logs, writeText);
    expect(writeText).toHaveBeenCalledTimes(1); expect(writeText).toHaveBeenCalledWith(content);
    await fs.writeFile(file, '');
    await copyDiagnosticFile(file, logs, writeText);
    expect(writeText).toHaveBeenLastCalledWith('');
  } finally { await fs.rm(logs, { recursive: true, force: true }); }
});
it('rejects oversized logs explicitly without copying a truncated fallback', async () => {
  const logs = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-large-log-'));
  try {
    const file = path.join(logs, 'game.log'); await fs.writeFile(file, '123456789');
    const writeText = vi.fn();
    await expect(copyDiagnosticFile(file, logs, writeText, 8)).rejects.toThrow('too large for the clipboard');
    expect(writeText).not.toHaveBeenCalled();
    await copyDiagnosticFile(file, logs, writeText, 9);
    expect(writeText).toHaveBeenCalledTimes(1); expect(writeText).toHaveBeenCalledWith('123456789');
  } finally { await fs.rm(logs, { recursive: true, force: true }); }
});
it('does not copy symlinks, outside files, directories or unavailable files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-copy-log-'));
  try {
    const logs = path.join(root, 'logs'); await fs.mkdir(logs);
    const file = path.join(logs, 'game.log'); await fs.writeFile(file, 'known log');
    const outside = path.join(root, 'outside'); await fs.writeFile(outside, 'PRIVATE');
    const link = path.join(logs, 'link'); await fs.symlink(file, link);
    const writeText = vi.fn();
    for (const target of [link, outside, logs, path.join(logs, 'missing')]) {
      await expect(copyDiagnosticFile(target, logs, writeText)).rejects.toThrow();
    }
    expect(writeText).not.toHaveBeenCalled();
    await expect(copyDiagnosticFile(file, logs, () => { throw Error('Clipboard unavailable'); })).rejects.toThrow('Clipboard unavailable');
    // Failure closed the descriptor; the same valid file remains usable.
    await copyDiagnosticFile(file, logs, writeText);
    expect(writeText).toHaveBeenCalledTimes(1); expect(writeText).toHaveBeenCalledWith('known log');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
it('reveals only the known regular private log, never links, directories or neighboring paths', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-log-reveal-'));
  try {
    const logs = path.join(root, 'logs'); await fs.mkdir(logs);
    const file = path.join(logs, 'game.log'); await fs.writeFile(file, 'complete file');
    expect(await diagnosticLogFile(file, logs)).toBe(await fs.realpath(file));
    await fs.symlink(file, path.join(logs, 'link'));
    await expect(diagnosticLogFile(path.join(logs, 'link'), logs)).rejects.toThrow();
    await fs.mkdir(path.join(logs, 'directory'));
    await expect(diagnosticLogFile(path.join(logs, 'directory'), logs)).rejects.toThrow('regular file');
    await fs.mkdir(path.join(root, 'logs-neighbor'));
    const outside = path.join(root, 'logs-neighbor', 'private'); await fs.writeFile(outside, 'secret');
    await expect(diagnosticLogFile(outside, logs)).rejects.toThrow('Not a launcher');
    await fs.symlink(path.dirname(outside), path.join(logs, 'parent-link'));
    await expect(diagnosticLogFile(path.join(logs, 'parent-link', 'private'), logs)).rejects.toThrow('Not a launcher');
    await expect(diagnosticLogFile(path.join(logs, 'missing'), logs)).rejects.toThrow();
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
