import { expect, it, vi } from 'vitest';
import { fetchEngineRelease } from './engine-fetch.js';

const api = 'https://api.github.com/repos/slaveitgr/xboks/releases?per_page=100';
const asset = 'https://github.com/slaveitgr/xboks/releases/download/v0.3.12/xboks-0.3.12-x86_64.AppImage';
it('requests only the owned release API without redirects or credentials', async () => {
  const fetcher = vi.fn(async () => new Response('[]'));
  expect(await (await fetchEngineRelease(fetcher, api)).text()).toBe('[]');
  expect(fetcher.mock.calls[0]).toEqual([api, expect.objectContaining({ redirect: 'manual', credentials: 'omit' })]);
});
it('follows only GitHub asset CDN redirects and preserves cancellation', async () => {
  const signal = new AbortController().signal;
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/github-production-release-asset/123/test?signature=fixture' } })).mockResolvedValueOnce(new Response('verified later'));
  expect(await (await fetchEngineRelease(fetcher, asset, { signal })).text()).toBe('verified later');
  expect(fetcher.mock.calls[1][1]).toMatchObject({ signal, redirect: 'manual', credentials: 'omit' });
});
it.each(['https://github.com/domsvoboda/xodus-nexus/releases/download/v1/other', 'https://evil.invalid/file', 'http://objects.githubusercontent.com/file', 'https://release-assets.githubusercontent.com.evil.invalid/file', 'https://user:password@objects.githubusercontent.com/file'])('rejects a foreign or unsafe asset redirect: %s', async location => {
  const fetcher = vi.fn(async () => new Response(null, { status: 302, headers: { location } }));
  await expect(fetchEngineRelease(fetcher, asset)).rejects.toThrow('redirect destination');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('rejects API redirects, redirect loops and credentials before downloading', async () => {
  const loop = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://objects.githubusercontent.com/file' } }));
  await expect(fetchEngineRelease(loop, api)).rejects.toThrow('release redirect');
  await expect(fetchEngineRelease(loop, asset)).rejects.toThrow('release redirect');
  expect(loop).toHaveBeenCalledTimes(7);
  const unused = vi.fn();
  await expect(fetchEngineRelease(unused, asset, { headers: { Authorization: 'fixture' } })).rejects.toThrow('Credentials');
  await expect(fetchEngineRelease(unused, 'https://github.com/other/repo/releases/download/v1/a')).rejects.toThrow('Unexpected');
  expect(unused).not.toHaveBeenCalled();
});
