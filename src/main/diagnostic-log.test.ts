import { expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readDiagnosticTail } from './diagnostic-log.js';
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
