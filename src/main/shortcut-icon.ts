import type { Game } from '../shared/types.js';

const MAX_BYTES = 4 * 1024 * 1024;
const HOSTS = new Set(['store-images.s-microsoft.com', 'store-images.microsoft.com']);
const raster = (bytes: Buffer) => bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
  || bytes.subarray(0, 3).toString('hex') === 'ffd8ff'
  || (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP');

/** Optional artwork only: network/decoder failures must not prevent a shortcut. */
export async function loadShortcutIcon(game: Pick<Game, 'coverDataUrl' | 'coverUrl'>,
  normalize: (bytes: Buffer) => Buffer | undefined, fetcher: typeof fetch = fetch): Promise<Buffer | undefined> {
  const convert = (bytes: Buffer) => {
    try { return bytes.length <= MAX_BYTES && raster(bytes) ? normalize(bytes) : undefined; }
    catch { return undefined; }
  };
  if (game.coverDataUrl && game.coverDataUrl.length <= MAX_BYTES * 1.4) {
    const data = game.coverDataUrl.match(/^data:image\/(?:png|jpeg|webp);base64,([a-zA-Z0-9+/=]+)$/);
    if (data) {
      const local = convert(Buffer.from(data[1], 'base64'));
      if (local?.length) return local;
    }
  }
  if (!game.coverUrl) return;
  try {
    const url = new URL(game.coverUrl);
    if (url.protocol !== 'https:' || !HOSTS.has(url.hostname.toLowerCase()) || url.port || url.username || url.password) return;
    const response = await fetcher(url.toString(), { redirect: 'error', signal: AbortSignal.timeout(5_000) });
    if (!response.ok || !response.body) return;
    const reader = response.body.getReader();
    const chunks: Buffer[] = []; let length = 0;
    try {
      const declared = response.headers.get('content-length');
      if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_BYTES)) return;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > MAX_BYTES) return;
        chunks.push(Buffer.from(value));
      }
      return convert(Buffer.concat(chunks));
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  } catch { return undefined; }
}
