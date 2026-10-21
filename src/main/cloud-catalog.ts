import {randomBytes} from 'node:crypto';
import type {CloudCollection, CloudProduct, CloudPublicCatalog} from '../shared/cloud-library.js';

// Xbox app 2610 F10531: XCloudAll, XCloudSYOG, XCloudPopular, RecentlyAdded, EAPlay.
export const CLOUD_SIGLS: Record<CloudCollection, string> = {
  all: '1bf84c2b-0643-4591-893f-d9edb703f692', own: 'e78d9a61-5ef4-43af-b400-edba1250b18e',
  popular: '6a589fa0-d493-472b-8e20-3813699d7056', recent: '06323672-b8c8-43cc-b0de-32d5a9834749',
  ea: '27a89da6-0eaf-4dca-8192-85e7f62a5b3f',
};
const productId = (value: unknown): value is string => typeof value === 'string' && /^[A-Z0-9]{12}$/.test(value);
const record = (value: unknown): Record<string, unknown> | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const text = (value: unknown, limit: number) => typeof value === 'string' ? value.trim().slice(0, limit) : undefined;
function artwork(value: unknown): string | undefined {
  const raw = text(record(value)?.URL, 8192); if (!raw) return;
  try { const url = new URL(raw.startsWith('//') ? `https:${raw}` : raw);
    if (url.protocol === 'https:' && !url.port && !url.username && !url.password && ['store-images.s-microsoft.com', 'store-images.microsoft.com'].includes(url.hostname)) return url.href;
  } catch { /* Missing artwork keeps its placeholder. */ }
}
async function json(response: Response, limit = 8_000_000): Promise<unknown> {
  if (!response.ok || Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw Error('Cloud catalog is unavailable.'); }
  const reader = response.body?.getReader(); if (!reader) throw Error('Cloud catalog is unavailable.');
  const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > limit) throw Error('Cloud catalog exceeds its limit.'); chunks.push(part.value); }
    return JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export function parseCloudSigl(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 5000) throw Error('Invalid cloud collection.');
  return [...new Set(value.flatMap(row => productId(record(row)?.id) ? [record(row)!.id as string] : []))];
}
export function parseCloudProducts(value: unknown, wanted: string[]): CloudProduct[] {
  const products = record(record(value)?.Products); if (!products) throw Error('Invalid cloud products.');
  return wanted.flatMap(id => {
    const product = record(products[id]), title = text(product?.ProductTitle, 512);
    if (!product || !title || product.StoreId !== id) return [];
    return [{productId: id, title, publisher: text(product.PublisherName, 512), description: text(product.Description ?? product.ProductDescription, 64000) ?? '',
      posterUrl: artwork(product.Image_Tile) ?? artwork(product.Image_Poster), heroUrl: artwork(product.Image_Hero) ?? artwork(product.Image_Tile),
      categories: Array.isArray(product.Categories) ? product.Categories.flatMap(category => text(category, 100) ?? []).slice(0, 20) : []}];
  });
}
/** Anonymous catalog reads; no cookies, account tokens, ownership or session creation. */
export class CloudCatalogService {
  private collections = new Map<string, {until: number; value: CloudPublicCatalog}>();
  private products = new Map<string, {until: number; value: CloudProduct}>();
  private pending = new Map<string, Promise<unknown>>();
  constructor(private fetcher: typeof fetch = fetch) {}
  private market(value: string) { return /^[A-Z]{2}$/.test(value) ? value : 'US'; }
  async catalog(rawMarket: string, refresh = false): Promise<CloudPublicCatalog> {
    const market = this.market(rawMarket), cached = this.collections.get(market), key = `catalog:${market}`;
    if (!refresh && cached && cached.until > Date.now()) return structuredClone(cached.value);
    if (this.pending.has(key)) return structuredClone(await this.pending.get(key) as CloudPublicCatalog);
    const job = (async () => {
      const collections = {} as CloudPublicCatalog['collections'];
      await Promise.all(Object.entries(CLOUD_SIGLS).map(async ([name, id]) => {
        const url = new URL('https://catalog.gamepass.com/sigls/v2'); url.searchParams.set('id', id); url.searchParams.set('market', market); url.searchParams.set('language', 'en-US');
        collections[name as CloudCollection] = parseCloudSigl(await json(await this.fetcher(url, {headers: {Accept: 'application/json'}, credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(15000)}), 1_000_000));
      }));
      const value = {collections, checkedAt: new Date().toISOString()};
      if (this.collections.size >= 8) this.collections.delete(this.collections.keys().next().value!);
      this.collections.set(market, {until: Date.now() + 600000, value}); return value;
    })();
    this.pending.set(key, job); try {return structuredClone(await job);} finally {this.pending.delete(key);}
  }
  async describe(ids: string[], rawMarket: string): Promise<CloudProduct[]> {
    if (!Array.isArray(ids) || ids.length > 60 || ids.some(id => !productId(id))) throw Error('Invalid cloud product list.');
    const market = this.market(rawMarket), unique = [...new Set(ids)], missing = unique.filter(id => (this.products.get(`${market}:${id}`)?.until ?? 0) <= Date.now());
    if (missing.length) {
      const url = new URL('https://catalog.gamepass.com/v3/products'); url.searchParams.set('market', market); url.searchParams.set('language', 'en-US'); url.searchParams.set('hydration', 'RemoteLowJade0');
      const response = await this.fetcher(url, {method: 'POST', headers: {Accept: 'application/json', 'Content-Type': 'application/json',
        'calling-app-name': 'Xbox Cloud Gaming Web', 'calling-app-version': '24.17.63', 'ms-cv': `${randomBytes(16).toString('base64').replace(/=+$/, '')}.0`},
        body: JSON.stringify({Products: missing}), credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(20000)});
      for (const product of parseCloudProducts(await json(response), missing)) {
        if (this.products.size >= 2000) this.products.delete(this.products.keys().next().value!);
        this.products.set(`${market}:${product.productId}`, {until: Date.now() + 600000, value: product});
      }
    }
    return unique.flatMap(id => {const product = this.products.get(`${market}:${id}`); return product && product.until > Date.now() ? [structuredClone(product.value)] : [];});
  }
}
