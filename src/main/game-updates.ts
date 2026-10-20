import { createConnection } from 'node:net';
import type { GameUpdate } from '../shared/types.js';

function version(value: string): number[] | undefined {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(value)) return;
  const parts = value.split('.').map(Number);
  return parts.every(n => n <= 65535) ? parts : undefined;
}
function xmlValue(xml: string, key: string): string | undefined {
  return xml.match(new RegExp(`<${key}>([^<]*)</${key}>`))?.[1];
}
export function gameUpdateResult(xml: string, installed: string): GameUpdate {
  const base = { checking: false, checkedAt: new Date().toISOString() };
  const latest = xmlValue(xml, 'LatestVersion');
  const left = version(installed), right = latest && version(latest);
  const hrText = xmlValue(xml, 'HResult');
  const hr = hrText && /^\d+$/.test(hrText) ? Number(hrText) : NaN;
  const checked = xmlValue(xml, 'Checked') === 'true';
  const stage = xmlValue(xml, 'ErrorStage');
  // The service deliberately rejects automatic mandatory/DLC policy for a
  // newer version. Its sanitized version-comparison result still establishes
  // availability from the genuine authenticated GetBasePackage response.
  if (!left || !right || !(hr === 0 && checked || hr === 0x80004001 && stage === 'version-comparison')) {
    return { ...base, error: `Update availability could not be verified (0x${Number.isFinite(hr) ? hr.toString(16).padStart(8, '0') : 'unknown'}).` };
  }
  let comparison = 0;
  for (let i = 0; i < 4 && !comparison; i++) comparison = right[i] - left[i];
  return { ...base, latestVersion: latest, available: comparison > 0 };
}

export async function queryGameUpdate(socketPath: string, productId: string, installed: string, signal?: AbortSignal): Promise<GameUpdate> {
  if (!/^[A-Z0-9]{12}$/i.test(productId) || !version(installed)) throw new Error('A verified Store ID and four-part installed version are required.');
  const body = Buffer.from(`<Request><ProductId>${productId}</ProductId><InstalledVersion>${installed}</InstalledVersion></Request>`);
  const header = Buffer.alloc(8); header.writeUInt32LE(0x58445358, 0); header.writeUInt16LE(9, 4); header.writeUInt16LE(body.length, 6);
  const xml = await new Promise<string>((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('Update check cancelled.')); return; }
    const socket = createConnection(socketPath); let buffer = Buffer.alloc(0); let done = false;
    const aborted = () => finish(new Error('Update check cancelled.'));
    const finish = (error?: Error, value?: string) => { if (done) return; done = true; signal?.removeEventListener('abort', aborted); socket.destroy(); error ? reject(error) : resolve(value!); };
    signal?.addEventListener('abort', aborted, { once: true });
    socket.setTimeout(65_000, () => finish(new Error('Game update check timed out.')));
    socket.once('error', error => finish(error));
    socket.once('close', () => { if (!done) finish(new Error('The update service closed before replying.')); });
    socket.once('connect', () => socket.write(Buffer.concat([header, body])));
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > 65543) return finish(new Error('Invalid update response size.'));
      if (buffer.length < 8) return;
      if (buffer.readUInt32LE(0) !== 0x58445358 || ![9, 10].includes(buffer.readUInt16LE(4))) return finish(new Error('Unsupported update service response.'));
      const length = buffer.readUInt16LE(6);
      if (buffer.length >= 8 + length) finish(undefined, buffer.subarray(8, 8 + length).toString('utf8'));
    });
  });
  return gameUpdateResult(xml, installed);
}
