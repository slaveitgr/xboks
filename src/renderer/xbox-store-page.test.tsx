import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { demoSnapshot } from '../shared/demo-data';
import type { CatalogProduct, CatalogSearchResult } from '../shared/types';
import { createXboxStoreLoader, minecraftStoreArtwork, minecraftStoreFallback, minecraftStoreProductId, storeProductInstalled, XboxStorePage, XboxStoreProductCard, type XboxStoreBridge, type XboxStoreListing } from './XboxStorePage';

afterEach(() => vi.unstubAllGlobals());
const product = (id = '9AAAAAAAAAAA'): CatalogProduct => ({ productId: id, title: 'Returned game', description: '', categories: ['Action'], installability: 'unknown', supportNote: 'Unverified package.' });
const result = (products = [product()], page: Partial<CatalogSearchResult> = {}): CatalogSearchResult => ({ query: '', market: 'US', products, hasMore: false, source: 'Microsoft Store', fetchedAt: '2026-10-21T00:00:00.000Z', ...page });
const deferred = <T,>() => { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const bridge = (): XboxStoreBridge => ({ getFeaturedCatalog: vi.fn(async () => result()), searchCatalog: vi.fn(async () => result()) });

describe('Store request ownership', () => {
 it('keeps late featured results out of a newer search', async () => {
  const old = deferred<CatalogSearchResult>(), states: XboxStoreListing[] = [], api = bridge(); api.getFeaturedCatalog = () => old.promise;
  const loader = createXboxStoreLoader(api, state => states.push(state)); const first = loader.load({ kind: 'featured' });
  await loader.load({ kind: 'search', query: 'Actual query' }); old.resolve(result([product('9BBBBBBBBBBB')])); await first;
  expect(states.at(-1)?.result?.products[0].productId).toBe('9AAAAAAAAAAA'); expect(states.filter(state => state.status === 'ready')).toHaveLength(1);
 });
 it('does not publish after disposal or borrow results across accounts', async () => {
  const pending = deferred<CatalogSearchResult>(), changed = vi.fn(), api = bridge(); api.getWishlist = () => pending.promise;
  const loader = createXboxStoreLoader(api, changed), first = loader.load({ kind: 'wishlist', signedIn: true });
  await loader.load({ kind: 'wishlist', signedIn: false }); pending.resolve(result()); await first;
  expect(changed).toHaveBeenLastCalledWith({ status: 'signed-out' });
  const next = deferred<CatalogSearchResult>(); api.getFeaturedCatalog = () => next.promise;
  const active = loader.load({ kind: 'featured' }); loader.dispose(); const count = changed.mock.calls.length; next.resolve(result()); await active;
  expect(changed).toHaveBeenCalledTimes(count); await loader.retry(); expect(changed).toHaveBeenCalledTimes(count);
 });
 it.each(['all-pc', 'toppaid', 'addons'] as const)('never substitutes arbitrary search for missing %s capability', async collection => {
  const api = bridge(), changed = vi.fn(), loader = createXboxStoreLoader(api, changed);
  await loader.load({ kind: 'collection', collection }); expect(changed).toHaveBeenLastCalledWith({ status: 'unavailable' });
  expect(api.searchCatalog).not.toHaveBeenCalled(); expect(api.getFeaturedCatalog).not.toHaveBeenCalled();
 });
 it('checks sign-in before a wishlist provider and reports missing cloud capability explicitly', async () => {
  const api = bridge(), changed = vi.fn(), loader = createXboxStoreLoader(api, changed);
  await loader.load({ kind: 'wishlist', signedIn: false }); expect(changed).toHaveBeenLastCalledWith({ status: 'signed-out' });
  await loader.load({ kind: 'wishlist', signedIn: true }); expect(changed).toHaveBeenLastCalledWith({ status: 'unavailable' });
  expect(api.searchCatalog).not.toHaveBeenCalled();
 });
 it('loads the exact requested collection and retries a real failure without exposing raw errors', async () => {
  const api = bridge(), changed = vi.fn(); api.getCollection = vi.fn().mockRejectedValueOnce(Error('secret backend detail')).mockResolvedValueOnce(result());
  const loader = createXboxStoreLoader(api, changed); await loader.load({ kind: 'collection', collection: 'toppaid' });
  expect(changed).toHaveBeenLastCalledWith({ status: 'error' }); await loader.retry();
  expect(api.getCollection).toHaveBeenLastCalledWith('toppaid', undefined); expect(changed.mock.calls.flat()).not.toContain('secret backend detail'); expect(changed.mock.calls.at(-1)?.[0].status).toBe('ready');
 });
 it('serializes pagination and deduplicates IDs while accepting updated returned metadata', async () => {
  const pending = deferred<CatalogSearchResult>(), api = bridge(), states: XboxStoreListing[] = [];
  api.searchCatalog = vi.fn().mockResolvedValueOnce(result([product()], { cursor: 'next', hasMore: true })).mockReturnValueOnce(pending.promise);
  const loader = createXboxStoreLoader(api, state => states.push(state)); await loader.load({ kind: 'search', query: 'games' });
  const more = loader.more(); await loader.more(); expect(api.searchCatalog).toHaveBeenCalledTimes(2);
  pending.resolve(result([{ ...product(), title: 'Updated metadata' }, product('9BBBBBBBBBBB')])); await more;
  expect(states.at(-1)?.result?.products.map(game => game.title)).toEqual(['Updated metadata', 'Returned game']); expect(api.searchCatalog).toHaveBeenLastCalledWith('games', 'next');
 });
 it('rejects a cursor loop without losing already loaded games', async () => {
  const api = bridge(), changed = vi.fn(); api.searchCatalog = vi.fn(async () => result([product()], { cursor: 'same', hasMore: true }));
  const loader = createXboxStoreLoader(api, changed); await loader.load({ kind: 'search', query: 'games' }); await loader.more();
  expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({ status: 'error', result: { products: [product()] } });
 });
 it('a rejected stale request cannot replace a newer successful collection', async () => {
  const pending = deferred<CatalogSearchResult>(), api = bridge(), changed = vi.fn(); api.searchCatalog = () => pending.promise; api.getCollection = async () => result();
  const loader = createXboxStoreLoader(api, changed), search = loader.load({ kind: 'search', query: 'old' });
  await loader.load({ kind: 'collection', collection: 'addons' }); pending.reject(Error('late failure')); await search;
  expect(changed.mock.calls.at(-1)?.[0].status).toBe('ready');
 });
 it('resumes preserved collection pagination after product details without reloading the first page', async () => {
  const api = bridge(), changed = vi.fn(); api.getCollection = vi.fn(async () => result([product('9BBBBBBBBBBB')]));
  const loader = createXboxStoreLoader(api, changed, { request: { kind: 'collection', collection: 'addons' }, state: { status: 'ready', result: result([product()], { hasMore: true, cursor: 'retained-page' }) } });
  expect(changed).not.toHaveBeenCalled(); expect(api.getCollection).not.toHaveBeenCalled(); await loader.more();
  expect(api.getCollection).toHaveBeenCalledWith('addons', 'retained-page'); expect(changed.mock.calls.at(-1)?.[0].result.products).toHaveLength(2);
 });
});

describe('Store source and rendering', () => {
 it('uses the original official fallback and real product target without invented package, price or entitlement', () => {
  expect(minecraftStoreFallback()).toMatchObject({ productId: minecraftStoreProductId, title: 'Minecraft', heroUrl: minecraftStoreArtwork, installability: 'unknown' });
  expect(new URL(minecraftStoreArtwork).hostname).toBe('cms-assets.xboxservices.com');
  expect(minecraftStoreFallback().purchasePrice).toBeUndefined(); expect(minecraftStoreFallback().includedWith).toBeUndefined();
 });
 it.each(['en', 'el'])('renders five ordered %s shortcuts and three temporary loading slots without invoking native APIs', language => {
  vi.stubGlobal('localStorage', { getItem: () => language }); const api = bridge(), open = vi.fn();
  const html = renderToStaticMarkup(<XboxStorePage data={demoSnapshot()} bridge={api} openProduct={open} />);
  expect([...html.matchAll(/data-store-action="([^"]+)"/g)].map(match => match[1])).toEqual(['all-pc', 'toppaid', 'addons', 'redeem', 'wishlist']);
  expect(html).toContain(language === 'el' ? 'Η λίστα επιθυμιών μου' : 'My wishlist');
  expect(html).toContain('xbox-store-loading-heroes'); expect(html.match(/<span><\/span>/g)?.length).toBe(3);
  expect(api.getFeaturedCatalog).not.toHaveBeenCalled(); expect(api.searchCatalog).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled();
 });
 it('shows only returned price, subscription and exact local installation evidence', () => {
  const data = demoSnapshot(); data.games = [];
  let html = renderToStaticMarkup(<XboxStoreProductCard data={data} product={product()} open={() => {}} />);
  expect(html).not.toMatch(/Installed|Owned|Game Pass|Free|xbox-store-price/); expect(html).not.toContain('data-gamepad-auto-select');
  html = renderToStaticMarkup(<XboxStoreProductCard data={data} product={{ ...product(), publisher: 'Real publisher', purchasePrice: '$19.99', includedWith: 'Returned subscription' }} open={() => {}} />);
  expect(html).toContain('$19.99'); expect(html).toContain('Real publisher'); expect(html).toContain('Returned subscription'); expect(html).not.toContain('Owned');
 });
 it('does not mark a queued, failed or unrelated local game as installed', () => {
  const game = demoSnapshot().games[0];
  expect(storeProductInstalled(product(), [{ ...game, storeId: '9AAAAAAAAAAA', installState: 'ready' }])).toBe(true);
  expect(storeProductInstalled(product(), [{ ...game, storeId: '9BBBBBBBBBBB', installState: 'ready' }])).toBe(false);
  expect(storeProductInstalled(product(), [{ ...game, storeId: '9AAAAAAAAAAA', installState: 'incomplete' }])).toBe(false);
 });
 it('marks the inactive retained page hidden without reading APIs or claiming initial controller focus', () => {
  const api = bridge(), html = renderToStaticMarkup(<XboxStorePage active={false} data={demoSnapshot()} bridge={api} openProduct={() => {}} />);
  expect(html).toMatch(/<main hidden=""/); expect(html).not.toContain('data-gamepad-initial'); expect(api.getFeaturedCatalog).not.toHaveBeenCalled();
 });
});
