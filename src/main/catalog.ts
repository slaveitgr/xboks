import type { CatalogProduct, CatalogSearchResult, GameStoreDetails } from '../shared/types.js';
import type { HandheldCompatibility } from '../shared/handheld-compatibility.js';
import { randomBytes } from 'node:crypto';

type Fetcher = typeof fetch;

interface StoreImage {
  imageType?: unknown;
  url?: unknown;
}

interface DisplayCatalogImage {
  ImagePurpose?: unknown;
  Uri?: unknown;
}

interface StoreSearchProduct {
  productId?: unknown;
  title?: unknown;
  description?: unknown;
  publisherName?: unknown;
  images?: unknown;
  posterArtUrl?: unknown;
  boxArtUrl?: unknown;
  previews?: unknown;
  categories?: unknown;
  priceInfo?: unknown;
  skusSummary?: unknown;
  plaintextPassName?: unknown;
  releaseDateUtc?: unknown;
  averageRating?: unknown;
  redirectUrl?: unknown;
  isGame?: unknown;
}

interface StoreSearchResponse {
  productsList?: unknown;
  cursor?: unknown;
  hasMorePages?: unknown;
  nextPageNumber?: unknown;
}

export type StoreCollection = 'all-pc' | 'toppaid' | 'addons';
interface StoreCollectionPage { version: 1; collection: StoreCollection; market: string; page?: number; cursor?: string }
const STORE_COLLECTIONS = new Set<StoreCollection>(['all-pc', 'toppaid', 'addons']);

function collectionPage(collection: StoreCollection, market: string, cursor?: string): StoreCollectionPage {
  if (!cursor) return { version: 1, collection, market, ...(collection === 'toppaid' ? { page: 1 } : {}) };
  try {
    if (cursor.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw Error();
    const page = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as StoreCollectionPage;
    if (!page || page.version !== 1 || page.collection !== collection || page.market !== market) throw Error();
    if (collection === 'toppaid' ? !Number.isSafeInteger(page.page) || page.page! < 2 || page.page! > 100 || page.cursor !== undefined
      : typeof page.cursor !== 'string' || !page.cursor || page.cursor.length > 2048 || !/^[A-Za-z0-9+/=_-]+$/.test(page.cursor) || page.page !== undefined) throw Error();
    return page;
  } catch { throw Error('The Store collection paging cursor is invalid.'); }
}

function encodeCollectionPage(page: StoreCollectionPage): string {
  return Buffer.from(JSON.stringify(page)).toString('base64url');
}

interface DisplayCatalogResponse {
  Products?: unknown;
}

interface PackageSupport {
  installability: CatalogProduct['installability'];
  installProductId?: string;
  packageFormat?: string;
  supportNote: string;
}

interface BundleReference {
  productId: string;
  primary: boolean;
}

const IMAGE_HOSTS = new Set(['store-images.s-microsoft.com', 'store-images.microsoft.com']);
const STORE_HOSTS = new Set(['www.xbox.com', 'xbox.com', 'apps.microsoft.com']);
const CACHE_TTL_MS = 10 * 60 * 1000;
const HANDHELD_RESPONSE_LIMIT = 2 * 1024 * 1024;
// Box art is square and carries the game's title branding, matching the
// square library tiles; promotional square art is the textless fallback.
const POSTER_PURPOSES = ['BoxArt', 'TitledPoster', 'Poster', 'FeaturePromotionalSquareArt'];
const HERO_PURPOSES = ['TitledHeroArt', 'SuperHeroArt', 'Hero', 'Screenshot'];
export interface CatalogArtwork { coverUrl?: string; heroUrl?: string }

function displayImage(images: DisplayCatalogImage[], purposes: string[]): string | undefined {
  for (const purpose of purposes) {
    for (const image of images.filter(image => image.ImagePurpose === purpose)) {
      const uri = string(image.Uri);
      const url = safeUrl(uri?.startsWith('//') ? `https:${uri}` : uri, IMAGE_HOSTS);
      if (url) return url;
    }
  }
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

const HANDHELD_RATINGS: HandheldCompatibility['rating'][] = ['unknown', 'optimized', 'unsupported', 'playable'];
const HANDHELD_CRITERIA = ['defaults-work', 'iconography', 'text-input', 'ui-legibility', 'supported-display'] as const;

function handheldRating(value: unknown): HandheldCompatibility['rating'] | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? HANDHELD_RATINGS[value] : undefined;
}

function handheldCriteria(value: unknown): HandheldCompatibility['criteria'] {
  if (!Array.isArray(value) || value.length > 100) return;
  type Criterion = NonNullable<HandheldCompatibility['criteria']>[number];
  const seen = new Set<Criterion['id']>();
  const results = new Map<Criterion['id'], Criterion['rating']>();
  for (const entry of value) {
    const row = object(entry);
    const test = row?.deviceTest;
    if (typeof test !== 'number' || !Number.isInteger(test)) continue;
    const id = HANDHELD_CRITERIA[test];
    if (!id) continue;
    // Ambiguous duplicates must never leave a successful criterion behind,
    // including a duplicate whose result itself is malformed.
    if (seen.has(id)) { results.set(id, 'unknown'); continue; }
    seen.add(id);
    const rating = handheldRating(row?.testResult);
    if (rating) results.set(id, rating);
  }
  return results.size ? [...results].map(([id, rating]) => ({ id, rating })) : undefined;
}

/**
 * Public Xbox FD product summaries, not DisplayCatalog package capabilities.
 * Numeric TestResult values are bound by the original app's F21084 mapper:
 * 0 Unknown, 1 Verified, 2 Unsupported, 3 Playable. The public Xbox web client
 * uses the same hhVerified.deviceEvaluation field (observed 2026-10-21).
 */
export function parseHandheldCompatibility(productId: string, payload: unknown): HandheldCompatibility | undefined {
  if (!/^[A-Z0-9]{12}$/.test(productId)) return;
  const summaries = object(payload)?.productSummaries;
  if (!Array.isArray(summaries) || summaries.length > 100) return;
  const matches = summaries.map(object).filter(product => string(product?.productId)?.toUpperCase() === productId);
  // Do not borrow a bundle child's rating or choose between duplicate records.
  if (matches.length !== 1 || matches[0]?.productKind !== 'Game') return;
  const verified = object(matches[0].hhVerified);
  const rawRating = verified?.deviceEvaluation;
  const rating = handheldRating(rawRating);
  if (!rating) return;
  const criteria = handheldCriteria(verified?.deviceResults);
  return { rating, rawRating: rawRating as number, source: 'microsoft-catalog', platform: 'windows-pc',
    ...(criteria ? { criteria } : {}) };
}

async function boundedCatalogJson(response: Response): Promise<unknown> {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > HANDHELD_RESPONSE_LIMIT) {
    await response.body?.cancel();
    throw Error('Catalog metadata exceeds the response limit.');
  }
  const reader = response.body?.getReader();
  if (!reader) throw Error('Catalog metadata body is missing.');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > HANDHELD_RESPONSE_LIMIT) throw Error('Catalog metadata exceeds the response limit.');
      chunks.push(chunk.value);
    }
    return JSON.parse(Buffer.concat(chunks, length).toString('utf8')) as unknown;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function safeUrl(value: unknown, hosts: Set<string>): string | undefined {
  const raw = string(value);
  if (!raw || raw.length > 8192) return undefined;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.port && hosts.has(parsed.hostname.toLowerCase()) ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

function normalizeMarket(input: string): string {
  const market = input.trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(market)) return market;
  const region = market.match(/(?:^|-)([A-Z]{2})$/)?.[1];
  return region ?? 'US';
}

function findImage(product: StoreSearchProduct, types: string[]): string | undefined {
  // Box art carries the game's title branding; poster art is often textless
  // promotional key art, so it is only a fallback.
  const boxArt = safeUrl(product.boxArtUrl, IMAGE_HOSTS);
  if (boxArt) return boxArt;
  const direct = types.includes('Poster') ? safeUrl(product.posterArtUrl, IMAGE_HOSTS) : undefined;
  if (direct) return direct;
  const images = Array.isArray(product.images) ? product.images as StoreImage[] : [];
  for (const type of types) {
    const match = images.find((entry) => string(entry.imageType)?.toLowerCase() === type.toLowerCase());
    const url = safeUrl(match?.url, IMAGE_HOSTS);
    if (url) return url;
  }
  return undefined;
}

function findHero(product: StoreSearchProduct): string | undefined {
  const previews = Array.isArray(product.previews) ? product.previews as StoreImage[] : [];
  const hero = previews.find((entry) => ['superheroart', 'hero'].includes(string(entry.imageType)?.toLowerCase() ?? ''));
  return safeUrl(hero?.url, IMAGE_HOSTS);
}

function includedWith(product: StoreSearchProduct): string | undefined {
  const direct = string(product.plaintextPassName);
  if (direct) return direct;
  const summaries = Array.isArray(product.skusSummary) ? product.skusSummary : [];
  for (const summary of summaries) {
    const included = object(summary)?.includedWith;
    if (!Array.isArray(included)) continue;
    for (const entry of included) {
      const name = string(object(entry)?.name);
      if (name) return name;
    }
  }
  return undefined;
}

function purchasePrice(product: StoreSearchProduct): string | undefined {
  const price = string(object(product.priceInfo)?.displayPrice);
  if (price && price.toLowerCase() !== 'included') return price;
  const summaries = Array.isArray(product.skusSummary) ? product.skusSummary : [];
  for (const summary of summaries) {
    const display = string(object(summary)?.displayMSRP);
    if (display) return display;
  }
  return price;
}

function directPackageSupport(product: Record<string, unknown> | undefined): PackageSupport | undefined {
  if (!product) return {
    installability: 'unknown',
    supportNote: 'Microsoft package metadata was unavailable. You can still use manual Product ID installation.',
  };
  const skus = Array.isArray(product.DisplaySkuAvailabilities) ? product.DisplaySkuAvailabilities : [];
  const desktopFormats = new Set<string>();
  const universalFormats = new Set<string>();
  for (const availability of skus) {
    const sku = object(object(availability)?.Sku);
    const properties = object(sku?.Properties);
    const packages = Array.isArray(properties?.Packages) ? properties.Packages : [];
    for (const entry of packages) {
      const pkg = object(entry);
      const dependencies = Array.isArray(pkg?.PlatformDependencies) ? pkg.PlatformDependencies : [];
      const desktop = dependencies.some((dependency) => string(object(dependency)?.PlatformName) === 'Windows.Desktop');
      const universal = dependencies.some((dependency) => string(object(dependency)?.PlatformName) === 'Windows.Universal');
      const format = string(pkg?.PackageFormat)?.toUpperCase() ?? 'UNKNOWN';
      if (desktop) desktopFormats.add(format);
      if (universal) universalFormats.add(format);
    }
  }
  if (desktopFormats.has('MSIXVC')) return {
    installability: 'supported',
    packageFormat: 'MSIXVC',
    supportNote: 'A direct Windows.Desktop MSIXVC package was verified. Ownership is checked by XBOKS Engine when installation starts.',
  };
  if (desktopFormats.size > 0) return {
    installability: 'unsupported',
    packageFormat: [...desktopFormats].join(', '),
    supportNote: `The PC package uses ${[...desktopFormats].join(', ')}, which the current XBOKS Engine streaming path does not support.`,
  };
  if (universalFormats.size > 0) {
    const formats = [...universalFormats].join(', ');
    const appFormats = new Set(['APPX', 'APPXBUNDLE', 'EAPPX', 'EAPPXBUNDLE', 'MSIX', 'MSIXBUNDLE']);
    return {
      installability: 'unsupported',
      packageFormat: formats,
      supportNote: `Microsoft lists a Windows.Universal package (${formats}). XBOKS Engine currently supports only Windows.Desktop MSIXVC installation and launch. ${[...universalFormats].every(format => appFormats.has(format)) ? 'UWP/MSIX app packages are not supported yet.' : 'This platform/package combination is not supported yet.'}`,
    };
  }
  return undefined;
}

function bundleReferences(product: Record<string, unknown> | undefined): BundleReference[] {
  const references = new Map<string, boolean>();
  const skus = Array.isArray(product?.DisplaySkuAvailabilities) ? product.DisplaySkuAvailabilities : [];
  for (const availability of skus) {
    const properties = object(object(object(availability)?.Sku)?.Properties);
    const bundled = Array.isArray(properties?.BundledSkus) ? properties.BundledSkus : [];
    for (const entry of bundled) {
      const record = object(entry);
      const productId = string(record?.BigId)?.toUpperCase();
      if (productId) references.set(productId, references.get(productId) === true || record?.IsPrimary === true);
    }
  }
  return [...references].map(([productId, primary]) => ({ productId, primary }));
}

function packageSupport(productId: string, details: Map<string, Record<string, unknown>>, visited = new Set<string>()): PackageSupport {
  const product = details.get(productId);
  const direct = directPackageSupport(product);
  if (direct) return direct;
  if (!product) return {
    installability: 'unknown',
    supportNote: 'Microsoft package metadata was unavailable. You can still use manual Product ID installation.',
  };

  if (visited.has(productId)) return {
    installability: 'unsupported',
    supportNote: 'The Store bundle contains a circular product reference and cannot be resolved safely.',
  };
  const nextVisited = new Set(visited).add(productId);
  const references = bundleReferences(product);
  if (references.length > 1) {
    const resolved = references.map(reference => packageSupport(reference.productId, details, nextVisited));
    if (resolved.some(item => item.installability === 'supported')) return {
      installability: 'supported', packageFormat: 'MSIXVC',
      supportNote: 'This Store offer contains multiple products. Choose a verified PC package before installing. Ownership is checked by XBOKS Engine.',
    };
    return { installability: resolved.some(item => item.installability === 'unknown') ? 'unknown' : 'unsupported',
      supportNote: 'No supported PC package could be verified in this Store bundle.' };
  }
  const primary = references.filter((reference) => reference.primary);
  const candidates = primary.length === 1 ? primary : references.length === 1 ? references : [];
  if (candidates.length === 0) return {
    installability: 'unsupported',
    supportNote: references.length > 1
      ? 'This Store offer contains multiple packages without one unambiguous primary PC product. XBOKS will not guess which one to install.'
      : 'No Windows.Desktop MSIXVC package or resolvable primary bundle product was found. It may be an add-on or console-only product.',
  };

  const resolved = packageSupport(candidates[0].productId, details, nextVisited);
  if (resolved.installability !== 'supported') return {
    ...resolved,
    supportNote: `The Store offer points to ${candidates[0].productId}, but ${resolved.supportNote.charAt(0).toLowerCase()}${resolved.supportNote.slice(1)}`,
  };
  const installProductId = resolved.installProductId ?? candidates[0].productId;
  return {
    ...resolved,
    installProductId,
    supportNote: `The Store bundle was resolved to its primary Windows.Desktop MSIXVC product ${installProductId}. Ownership is checked by XBOKS Engine when installation starts.`,
  };
}

/** A Store edition may point to its base game. Never alias by title or infer a license. */
export function primaryGameProductId(productId: string, details: Map<string, Record<string, unknown>>): string | undefined {
  const visited = new Set<string>();
  let current = productId;
  for (let depth = 0; depth <= 4; depth++) {
    if (!/^[A-Z0-9]{12}$/.test(current) || visited.has(current)) return;
    visited.add(current);
    const product = details.get(current);
    if (product?.ProductType !== 'Game') return;
    const references = bundleReferences(product), primary = references.filter(reference => reference.primary);
    if (!references.length) return current === productId ? undefined : current;
    const candidate = primary.length === 1 ? primary[0] : references.length === 1 ? references[0] : undefined;
    if (!candidate) return;
    current = candidate.productId;
  }
}

export function parseCatalogProducts(search: StoreSearchResponse, catalog: DisplayCatalogResponse): CatalogProduct[] {
  const detailMap = new Map<string, Record<string, unknown>>();
  const details = Array.isArray(catalog.Products) ? catalog.Products : [];
  for (const detail of details) {
    const record = object(detail);
    const id = string(record?.ProductId)?.toUpperCase();
    if (id && record) detailMap.set(id, record);
  }
  const products = Array.isArray(search.productsList) ? search.productsList as StoreSearchProduct[] : [];
  return products.flatMap((product) => {
    const productId = string(product.productId)?.toUpperCase();
    const title = string(product.title);
    if (!productId || !title || product.isGame === false) return [];
    const support = packageSupport(productId, detailMap);
    return [{
      productId,
      primaryProductId: primaryGameProductId(productId, detailMap),
      title,
      description: string(product.description) ?? 'Microsoft Store did not provide a description.',
      publisher: string(product.publisherName),
      posterUrl: findImage(product, ['BoxArt', 'Poster']),
      heroUrl: findHero(product),
      storeUrl: safeUrl(product.redirectUrl, STORE_HOSTS),
      categories: Array.isArray(product.categories) ? product.categories.flatMap((entry) => string(entry) ?? []) : [],
      purchasePrice: purchasePrice(product),
      includedWith: includedWith(product),
      releaseDate: string(product.releaseDateUtc),
      averageRating: typeof product.averageRating === 'number' ? product.averageRating : undefined,
      ...support,
    }];
  });
}

export class CatalogService {
  private readonly gameCache = new Map<string, { until: number; value: GameStoreDetails }>();
  private readonly cache = new Map<string, { expires: number; value: CatalogSearchResult }>();

  constructor(private readonly fetcher: Fetcher = fetch) {}

  /** Read descriptive data for an installed game, independently of package support. */
  async gameDetails(productId: string, rawMarket: string): Promise<GameStoreDetails | undefined> {
    if (!/^[A-Z0-9]{12}$/.test(productId)) throw Error('Invalid Store product ID.');
    const market = normalizeMarket(rawMarket), key = `${market}:${productId}`;
    const cached = this.gameCache.get(key);
    if (cached && cached.until > Date.now()) return structuredClone(cached.value);
    const catalog = await this.details([productId], market);
    const product = (Array.isArray(catalog.Products) ? catalog.Products : []).map(object).find(p => p?.ProductId === productId);
    if (!product || product.ProductType !== 'Game') return;
    const localized = Array.isArray(product.LocalizedProperties) ? object(product.LocalizedProperties[0]) : undefined;
    const title = string(localized?.ProductTitle)?.slice(0, 512);
    if (!title) return;
    const images = Array.isArray(localized?.Images) ? localized.Images.slice(0, 200) as DisplayCatalogImage[] : [];
    const screenshots = [...new Set(images.filter(image => object(image)?.ImagePurpose === 'Screenshot')
      .flatMap(image => displayImage([image], ['Screenshot']) ?? []))].slice(0, 24);
    const properties = object(product.Properties);
    const categories = (Array.isArray(properties?.Categories) ? properties.Categories : []).flatMap(value => string(value)?.slice(0, 80) ?? []).slice(0, 12);
    const marketProperties = Array.isArray(product.MarketProperties) ? object(product.MarketProperties[0]) : undefined;
    const detailMap = new Map((Array.isArray(catalog.Products) ? catalog.Products : []).flatMap(entry => {
      const row = object(entry), id = string(row?.ProductId)?.toUpperCase();
      return row && id ? [[id, row] as const] : [];
    }));
    const value: GameStoreDetails = { productId, primaryProductId: primaryGameProductId(productId, detailMap), title, description: (string(localized?.ProductDescription) ?? '').slice(0, 64_000),
      publisher: string(localized?.PublisherName)?.slice(0, 512), heroUrl: displayImage(images.filter(image => object(image)), HERO_PURPOSES), categories, screenshots,
      releaseDate: string(marketProperties?.OriginalReleaseDate),
      handheldCompatibility: await this.handheldDetails(productId, market) };
    if (this.gameCache.size >= 100) this.gameCache.delete(this.gameCache.keys().next().value!);
    this.gameCache.set(key, { until: Date.now() + CACHE_TTL_MS, value });
    return structuredClone(value);
  }

  /** Resolve licensed IDs, never search results or an install-history guess. */
  async licensedProducts(ids: string[], rawMarket: string): Promise<CatalogProduct[]> {
    if (ids.length > 60 || ids.some(id => !/^[A-Z0-9]{12}$/.test(id))) throw Error('Invalid licensed product list.');
    const catalog = await this.details(ids, normalizeMarket(rawMarket), true);
    const wanted = new Set(ids);
    const rows = (Array.isArray(catalog.Products) ? catalog.Products : []).flatMap(entry => {
      const product = object(entry);
      const id = string(product?.ProductId);
      if (!product || !id || !wanted.has(id) || product.ProductType !== 'Game') return [];
      const localized = Array.isArray(product.LocalizedProperties) ? object(product.LocalizedProperties[0]) : undefined;
      const images = Array.isArray(localized?.Images) ? localized.Images as DisplayCatalogImage[] : [];
      const find = (purposes: string[]) => {
        const uri = string(purposes.flatMap(purpose => images.filter(image => image.ImagePurpose === purpose))[0]?.Uri);
        return uri?.startsWith('//') ? `https:${uri}` : uri;
      };
      return [{ productId: id, title: localized?.ProductTitle, description: localized?.ProductDescription,
        publisherName: localized?.PublisherName, boxArtUrl: find(POSTER_PURPOSES), isGame: true }];
    });
    // Entitlement does not imply a PC package or supported format. Only a real
    // unambiguous Windows.Desktop MSIXVC target can be "Ready to install".
    return parseCatalogProducts({ productsList: rows }, catalog).filter(product => product.installability === 'supported');
  }

  /** Optional public descriptive metadata; no session, ownership or Linux verdict. */
  private async handheldDetails(productId: string, market: string): Promise<HandheldCompatibility | undefined> {
    const url = new URL(`https://emerald.xboxservices.com/xboxcomfd/products/${productId}`);
    url.searchParams.set('locale', `en-${market}`);
    try {
      // This public route and version are used by Microsoft's Xbox web client.
      // MS-CV is a fresh anonymous correlation vector, never an account token.
      const response = await this.fetcher(url, {
        headers: { Accept: 'application/json', 'X-MS-API-Version': '1.0', 'MS-CV': `${randomBytes(16).toString('base64').replace(/=+$/, '')}.0` },
        credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) { await response.body?.cancel(); return; }
      return parseHandheldCompatibility(productId, await boundedCatalogJson(response));
    } catch {
      // Older catalogs, network failures and unrecognized values stay unknown.
      // The original game description/screenshots remain available.
      return;
    }
  }

  private async details(ids: string[], market: string, required = false): Promise<DisplayCatalogResponse> {
    const details = new Map<string, Record<string, unknown>>();
    let pending = ids.filter((value, index, values) => values.indexOf(value) === index);
    for (let depth = 0; depth < 4 && pending.length > 0 && details.size < 100; depth += 1) {
      const next = new Set<string>();
      for (let offset = 0; offset < pending.length; offset += 25) {
        const batch = pending.slice(offset, offset + 25).filter((id) => !details.has(id));
        if (batch.length === 0) continue;
        const detailsUrl = new URL('https://displaycatalog.mp.microsoft.com/v7.0/products');
        detailsUrl.searchParams.set('bigIds', batch.join(','));
        detailsUrl.searchParams.set('market', market);
        detailsUrl.searchParams.set('languages', 'en-us,neutral');
        try {
          const response = await this.fetcher(detailsUrl, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
          if (!response.ok) throw Error('Catalog request failed.');
          const catalog = await response.json() as DisplayCatalogResponse;
          if (!catalog || !Array.isArray(catalog.Products)) throw Error('Invalid catalog response.');
          for (const entry of Array.isArray(catalog.Products) ? catalog.Products : []) {
            const record = object(entry);
            const id = string(record?.ProductId)?.toUpperCase();
            if (!id || !record) continue;
            details.set(id, record);
            for (const reference of bundleReferences(record)) {
              if (!details.has(reference.productId) && details.size + next.size < 100) next.add(reference.productId);
            }
          }
        } catch {
          if (required) throw Error('Microsoft Store game details could not be loaded. Check your connection and retry the library.');
          // Cards remain visible even when display catalog enrichment is unavailable.
        }
      }
      pending = [...next];
    }
    return { Products: [...details.values()] };
  }

  private async result(search: StoreSearchResponse, query: string, market: string, includePaging: boolean): Promise<CatalogSearchResult> {
    const ids = (Array.isArray(search.productsList) ? search.productsList as StoreSearchProduct[] : [])
      .flatMap((product) => string(product.productId)?.toUpperCase() ?? [])
      .filter((value, index, values) => values.indexOf(value) === index);
    const catalog = await this.details(ids, market);
    return {
      query,
      market,
      products: parseCatalogProducts(search, catalog),
      cursor: includePaging ? string(search.cursor) : undefined,
      hasMore: includePaging && search.hasMorePages === true && Boolean(string(search.cursor)),
      fetchedAt: new Date().toISOString(),
      source: 'Microsoft Store',
    };
  }

  async search(rawQuery: string, rawMarket: string, cursor?: string): Promise<CatalogSearchResult> {
    const query = rawQuery.trim();
    if (query.length < 2) throw new Error('Enter at least two characters to search Microsoft Store.');
    if (query.length > 100) throw new Error('The Store search is limited to 100 characters.');
    if (cursor && (cursor.length > 4096 || !/^[A-Za-z0-9+/=_-]+$/.test(cursor))) throw new Error('The Store paging cursor is invalid.');
    const market = normalizeMarket(rawMarket);
    const cacheKey = `${market}\u0000${query.toLowerCase()}\u0000${cursor ?? ''}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expires > Date.now()) return structuredClone(cached.value);

    const searchUrl = new URL('https://apps.microsoft.com/api/products/search');
    for (const [key, value] of Object.entries({ query, mediaType: 'games', age: 'all', price: 'all', category: 'all', subscription: 'all', gl: market, hl: 'en-us' })) {
      searchUrl.searchParams.set(key, value);
    }
    if (cursor) searchUrl.searchParams.set('cursor', cursor);
    const searchResponse = await this.fetcher(searchUrl, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
    if (!searchResponse.ok) throw new Error(`Microsoft Store search returned HTTP ${searchResponse.status}.`);
    const search = await searchResponse.json() as StoreSearchResponse;
    const value = await this.result(search, query, market, true);
    this.cache.set(cacheKey, { expires: Date.now() + CACHE_TTL_MS, value });
    return structuredClone(value);
  }

  async featured(rawMarket: string): Promise<CatalogSearchResult> {
    const market = normalizeMarket(rawMarket);
    const cacheKey = `${market}\u0000featured`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expires > Date.now()) return structuredClone(cached.value);
    const url = new URL('https://apps.microsoft.com/api/Reco/GetComputedProductsList');
    for (const [key, value] of Object.entries({
      listName: 'TopTrending', pgNo: '1', noItems: '12', filteredCategories: 'AllProducts',
      mediaType: 'Games', gl: market, hl: 'en-us', exp: '0',
    })) url.searchParams.set(key, value);
    const response = await this.fetcher(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`Microsoft Store featured collection returned HTTP ${response.status}.`);
    const search = await response.json() as StoreSearchResponse & { title?: unknown };
    const value = await this.result(search, string(search.title) ?? 'Trending games', market, false);
    this.cache.set(cacheKey, { expires: Date.now() + CACHE_TTL_MS, value });
    return structuredClone(value);
  }

  /** Anonymous public Store galleries. These are service-ranked/filtered lists,
   * not title searches renamed as collections. The Microsoft web client exposes
   * GetComputedProductsList(TopPaid); wildcard search accepts games/addons. On
   * 2026-10-21 the addons route returned Add-on rows whose DisplayCatalog type
   * was Durable. Missing/malformed service data fails without fabricated rows. */
  async collection(collection: StoreCollection, rawMarket: string, cursor?: string): Promise<CatalogSearchResult> {
    if (!STORE_COLLECTIONS.has(collection)) throw Error('Unknown Store collection.');
    const market = normalizeMarket(rawMarket), page = collectionPage(collection, market, cursor);
    const cacheKey = `collection\u0000${market}\u0000${collection}\u0000${cursor ?? ''}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expires > Date.now()) return structuredClone(cached.value);
    const url = new URL(collection === 'toppaid' ? 'https://apps.microsoft.com/api/Reco/GetComputedProductsList' : 'https://apps.microsoft.com/api/products/search');
    const params = collection === 'toppaid'
      ? { listName: 'TopPaid', pgNo: String(page.page), noItems: '24', filteredCategories: 'AllProducts', mediaType: 'Games', gl: market, hl: 'en-us', exp: '0' }
      : { query: '*', mediaType: collection === 'addons' ? 'addons' : 'games', age: 'all', price: 'all', category: 'all', subscription: 'all', gl: market, hl: 'en-us', ...(page.cursor ? { cursor: page.cursor } : {}) };
    for (const [name, value] of Object.entries(params)) if (value !== undefined) url.searchParams.set(name, value);
    const response = await this.fetcher(url, { headers: { Accept: 'application/json' }, credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(20_000) });
    if (!response.ok) { await response.body?.cancel(); throw Error(`Microsoft Store collection returned HTTP ${response.status}.`); }
    const payload = object(await boundedCatalogJson(response));
    if (!payload || !Array.isArray(payload.productsList) || payload.productsList.length > 60) throw Error('Invalid Microsoft Store collection response.');
    // The add-on department may be sparse. Never fill it with base games when
    // the provider changes a filter or stops recognizing the department.
    if (collection === 'addons' && payload.productsList.some(entry => {
      const categories = object(entry)?.categories;
      return !Array.isArray(categories) || !categories.some(category => typeof category === 'string' && /^add-ons?$/i.test(category));
    })) throw Error('Microsoft Store did not return a verified add-on collection.');
    const search = payload as StoreSearchResponse;
    const query = collection === 'toppaid' ? 'Top paid games' : collection === 'addons' ? 'Add-ons' : 'All PC games';
    const value = await this.result(search, query, market, false);
    if (search.hasMorePages === true) {
      if (collection === 'toppaid') {
        const next = search.nextPageNumber;
        if (!Number.isSafeInteger(next) || (next as number) <= page.page! || (next as number) > 100) throw Error('Microsoft Store collection pagination did not advance.');
        value.cursor = encodeCollectionPage({ version: 1, collection, market, page: next as number });
      } else {
        const next = string(search.cursor);
        if (!next || next === page.cursor || next.length > 2048 || !/^[A-Za-z0-9+/=_-]+$/.test(next)) throw Error('Microsoft Store collection pagination did not advance.');
        value.cursor = encodeCollectionPage({ version: 1, collection, market, cursor: next });
      }
      value.hasMore = true;
    }
    if (this.cache.size >= 100) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(cacheKey, { expires: Date.now() + CACHE_TTL_MS, value });
    return structuredClone(value);
  }

  async posters(ids: string[], rawMarket: string): Promise<Map<string, string>> {
    const artwork = await this.artwork(ids, rawMarket);
    return new Map([...artwork].flatMap(([id, images]) => images.coverUrl ? [[id, images.coverUrl] as const] : []));
  }

  // Installed package logos are not covers. Fetch separate tile and landscape
  // images by genuine product ID, preserving the local logo as an offline fallback.
  async artwork(ids: string[], rawMarket: string): Promise<Map<string, CatalogArtwork>> {
    const market = normalizeMarket(rawMarket);
    const unique = ids
      .map((id) => id.trim().toUpperCase())
      .filter((id) => /^[A-Z0-9]{4,30}$/.test(id))
      .filter((id, index, values) => values.indexOf(id) === index);
    const artwork = new Map<string, CatalogArtwork>();
    for (let offset = 0; offset < unique.length; offset += 25) {
      const batch = unique.slice(offset, offset + 25);
      const detailsUrl = new URL('https://displaycatalog.mp.microsoft.com/v7.0/products');
      detailsUrl.searchParams.set('bigIds', batch.join(','));
      detailsUrl.searchParams.set('market', market);
      detailsUrl.searchParams.set('languages', 'en-us,neutral');
      try {
        const response = await this.fetcher(detailsUrl, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
        if (!response.ok) continue;
        const catalog = await response.json() as DisplayCatalogResponse;
        for (const entry of Array.isArray(catalog.Products) ? catalog.Products : []) {
          const record = object(entry);
          const id = string(record?.ProductId)?.toUpperCase();
          if (!id || !record || !batch.includes(id)) continue;
          const localized = Array.isArray(record.LocalizedProperties) ? record.LocalizedProperties : [];
          const first = object(localized[0]);
          const images = Array.isArray(first?.Images) ? first.Images as DisplayCatalogImage[] : [];
          const coverUrl = displayImage(images, POSTER_PURPOSES);
          const heroUrl = displayImage(images, HERO_PURPOSES);
          if (coverUrl || heroUrl) artwork.set(id, { coverUrl, heroUrl });
        }
      } catch {
        // Covers stay hidden when the display catalog is unavailable.
      }
    }
    return artwork;
  }
}
