import { describe, expect, it } from 'vitest';
import { gameUpdateResult, queryGameUpdate } from './game-updates.js';
import { createServer } from 'node:net';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
function response(version: string, hr = 0, stage = '') { return `<Response><HResult>${hr}</HResult><Checked>${hr === 0}</Checked><LatestVersion>${version}</LatestVersion><ErrorStage>${stage}</ErrorStage></Response>`; }
describe('genuine game update result', () => {
  it('compares numeric package versions, without inventing ownership or mandatory policy', () => {
    expect(gameUpdateResult(response('1.10.0.0', 0x80004001, 'version-comparison'), '1.9.0.0').available).toBe(true);
    expect(gameUpdateResult(response('1.9.0.0'), '1.9.0.0').available).toBe(false);
    expect(gameUpdateResult(response('1.8.0.0'), '1.9.0.0').available).toBe(false);
  });
  it('keeps failed, unsupported, malformed and absent versions unknown', () => {
    for (const xml of [response('1.10.0.0', 0x80070005, 'package-query'), response('1.10.0.0', 0x80004001, 'package-query'), response('0'), '<Response/>']) {
      const result = gameUpdateResult(xml, '1.9.0.0'); expect(result.available).toBeUndefined(); expect(result.error).toBeTruthy();
    }
  });
  it('handles split protocol headers/payloads on a synthetic local service', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-package-test-')); const socketPath = path.join(root, 's');
    const server = createServer(socket => { socket.once('data', () => {
      const xml = Buffer.from(response('1.10.0.0', 0x80004001, 'version-comparison'));
      const header = Buffer.alloc(8); header.writeUInt32LE(0x58445358); header.writeUInt16LE(10, 4); header.writeUInt16LE(xml.length, 6);
      socket.write(header.subarray(0, 3)); setTimeout(() => socket.end(Buffer.concat([header.subarray(3), xml])), 5);
    }); });
    await new Promise<void>(resolve => server.listen(socketPath, resolve));
    try { expect((await queryGameUpdate(socketPath, '9ABCDEFGHIJK', '1.9.0.0')).available).toBe(true); }
    finally { await new Promise<void>(resolve => server.close(() => resolve())); await fs.rm(root, { recursive: true, force: true }); }
  });
});
