import { expect, it } from 'vitest';
import { loadShortcutIcon } from './shortcut-icon.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64');
const data = `data:image/png;base64,${png.toString('base64')}`;

it('prefers local raster artwork and falls back to bounded Microsoft Store artwork', async () => {
  let requests = 0;
  const fetcher: typeof fetch = async (_url, init) => {
    requests++; expect(init?.redirect).toBe('error');
    return new Response(png, { headers: { 'content-type': 'image/png' } });
  };
  expect(await loadShortcutIcon({ coverDataUrl: data, coverUrl: 'https://store-images.s-microsoft.com/game' }, bytes => bytes, fetcher)).toEqual(png);
  expect(requests).toBe(0);
  expect(await loadShortcutIcon({ coverDataUrl: 'data:image/png;base64,AAAA', coverUrl: 'https://store-images.s-microsoft.com/game' }, bytes => bytes, fetcher)).toEqual(png);
  expect(requests).toBe(1);
});

it('rejects untrusted URLs, oversized/vector payloads and decoder/network failures', async () => {
  let requests = 0;
  const fetcher: typeof fetch = async () => { requests++; throw Error('offline'); };
  for (const coverUrl of ['http://store-images.s-microsoft.com/x', 'https://localhost/x',
    'https://store-images.s-microsoft.com.evil.test/x', 'https://user:pass@store-images.microsoft.com/x', 'file:///tmp/x']) {
    expect(await loadShortcutIcon({ coverUrl }, bytes => bytes, fetcher)).toBeUndefined();
  }
  expect(requests).toBe(0);
  expect(await loadShortcutIcon({ coverDataUrl: data }, () => { throw Error('bad image'); })).toBeUndefined();
  const coverUrl = 'https://store-images.microsoft.com/game';
  expect(await loadShortcutIcon({ coverUrl }, bytes => bytes, fetcher)).toBeUndefined();
  for (const response of [new Response(png, { headers: { 'content-length': '99999999' } }),
    new Response(Buffer.alloc(4 * 1024 * 1024 + 1)), new Response('<svg/>')]) {
    expect(await loadShortcutIcon({ coverUrl }, bytes => bytes, async () => response)).toBeUndefined();
  }
});
