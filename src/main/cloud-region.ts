/** Login-only compatibility country selection. This header does not route the
 * connection through the listed address or change the streaming server.
 * Fixed country hints from Better xCloud (MIT), revision
 * f8397043f6d2148d2345d508902a38c69cf1ee20, src/enums/bypass-servers.ts.
 * Its copyright and permission notice is retained in assets/licenses/. */
import {CLOUD_LOGIN_COUNTRIES, type CloudLoginCountry} from '../shared/cloud-region.js';
export {CLOUD_LOGIN_COUNTRIES, type CloudLoginCountry} from '../shared/cloud-region.js';

const COUNTRY_HINTS: Readonly<Record<Exclude<CloudLoginCountry, 'auto'>, string>> = Object.freeze({
  pl: '45.134.212.66',
  us: '143.244.47.65',
  br: '169.150.198.66',
  jp: '138.199.21.239',
  kr: '121.125.60.151',
});
const LOGIN_URLS = new Set([
  'https://xgpuweb.gssv-play-prod.xboxlive.com/v2/login/user',
  'https://xgpuwebf2p.gssv-play-prod.xboxlive.com/v2/login/user',
]);

/** Settings may be read from older releases or supplied over IPC. Unknown
 * values return to the ordinary automatic path, never an arbitrary header. */
export function normalizeCloudLoginCountry(value: unknown): CloudLoginCountry {
  return typeof value === 'string' && (CLOUD_LOGIN_COUNTRIES as readonly string[]).includes(value)
    ? value as CloudLoginCountry : 'auto';
}

/** Only the two fixed offering-login requests can carry a country hint. Catalog,
 * signaling, media, authentication and third-party requests never use this. */
export function cloudLoginHeaders(country: unknown, target: string): Record<string, string> {
  if (!LOGIN_URLS.has(target)) throw Error('Invalid cloud login destination.');
  const selected = normalizeCloudLoginCountry(country);
  return {
    'x-gssv-client': 'XboxComBrowser',
    ...(selected === 'auto' ? {} : {'X-Forwarded-For': COUNTRY_HINTS[selected]}),
  };
}
