/** Consumer updates start in our repository. GitHub's signed asset CDN URLs
 * are followed explicitly; APIs and cross-repository redirects are not. */
const repository = 'slaveitgr/xboks';
const assetHosts = new Set(['release-assets.githubusercontent.com', 'objects.githubusercontent.com']);
const redirectStatus = new Set([301, 302, 303, 307, 308]);

export async function releaseText(response: Response, limit: number): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.length;
      if (bytes > limit) throw Error('Release metadata exceeds the download limit.');
      chunks.push(chunk.value);
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  } finally { await reader.cancel(); }
}

export async function fetchEngineRelease(fetcher: typeof fetch, input: string, init: RequestInit = {}): Promise<Response> {
  let url = new URL(input);
  const safeUrl = (value: URL) => value.protocol === 'https:' && !value.username && !value.password && !value.port && !value.hash;
  const api = url.hostname === 'api.github.com' && url.pathname === `/repos/${repository}/releases`;
  const asset = url.hostname === 'github.com' && new RegExp(`^/${repository}/releases/download/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$`).test(url.pathname);
  if (!safeUrl(url) || !api && !asset || init.method && init.method !== 'GET' || init.body) throw Error('Unexpected xboks Engine release request.');
  const headers = new Headers(init.headers);
  // No account credentials belong on public binary/checksum requests.
  if (headers.has('authorization') || headers.has('cookie')) throw Error('Credentials cannot be sent to the release channel.');
  for (let redirects = 0; redirects <= 5; redirects++) {
    const response = await fetcher(url.href, { ...init, headers, credentials: 'omit', redirect: 'manual' });
    if (response.redirected || response.url && new URL(response.url).href !== url.href) {
      await response.body?.cancel();
      throw Error('The release request followed an unchecked redirect.');
    }
    if (!redirectStatus.has(response.status)) return response;
    const location = response.headers.get('location');
    await response.body?.cancel();
    if (api || !location || redirects === 5) throw Error('Unexpected xboks Engine release redirect.');
    const next = new URL(location, url);
    if (!safeUrl(next) || !assetHosts.has(next.hostname)) throw Error('Unexpected xboks Engine asset redirect destination.');
    url = next;
  }
  throw Error('Too many release redirects.');
}
