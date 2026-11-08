import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { demoSnapshot } from '../shared/demo-data';
import type { CatalogProduct, CatalogSearchResult } from '../shared/types';
import { createXboxStoreLoader, minecraftStoreArtwork, minecraftStoreFallback, minecraftStoreProductId, storeCategories, storeCategoryProducts, storeProductInstalled, XboxStorePage, XboxStoreProductCard, XboxStoreSpotlight, storeRetainedListing, storeInitialNavigation, storeNavigate, storeBack, type XboxStoreBridge, type XboxStoreListing } from './XboxStorePage';

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
 it.each(['all-pc', 'toppaid', 'addons', 'deals'] as const)('never substitutes arbitrary search for missing %s capability', async collection => {
  const api = bridge(), changed = vi.fn(), loader = createXboxStoreLoader(api, changed);
  await loader.load({ kind: 'collection', collection }); expect(changed).toHaveBeenLastCalledWith({ status: 'unavailable' });
  expect(api.searchCatalog).not.toHaveBeenCalled(); expect(api.getFeaturedCatalog).not.toHaveBeenCalled();
 });
 it('uses the exact category provider and never substitutes the first generic PC page', async () => {
  const api = bridge(), changed = vi.fn(), loader = createXboxStoreLoader(api, changed);
  api.getCollection = vi.fn(async () => result());
  await loader.load({kind: 'category', category: 'cozy'});
  expect(changed).toHaveBeenLastCalledWith({status: 'unavailable'});
  expect(api.getCollection).not.toHaveBeenCalled(); expect(api.searchCatalog).not.toHaveBeenCalled(); expect(api.getFeaturedCatalog).not.toHaveBeenCalled();
  // The native mood feed establishes membership even without a public genre tag.
  const mood = {...product('9CCCCCCCCCCC'), categories: []};
  api.getCategory = vi.fn().mockResolvedValueOnce(result([mood], {cursor: 'cozy-next', hasMore: true})).mockResolvedValueOnce(result([product('9BBBBBBBBBBB')]));
  await loader.retry(); expect(api.getCategory).toHaveBeenLastCalledWith('cozy', undefined);
  expect(changed.mock.calls.at(-1)?.[0].result.products).toEqual([mood]);
  await loader.more(); expect(api.getCategory).toHaveBeenLastCalledWith('cozy', 'cozy-next');
  expect(changed.mock.calls.at(-1)?.[0].result.products).toHaveLength(2);
 });
 it('keeps a late category page out of a newly selected category', async () => {
  const api = bridge(), changed = vi.fn(), pending = deferred<CatalogSearchResult>();
  api.getCategory = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce(result([product('9BBBBBBBBBBB')]));
  const loader = createXboxStoreLoader(api, changed), previous = loader.load({kind: 'category', category: 'cozy'});
  await loader.load({kind: 'category', category: 'racing'}); pending.resolve(result()); await previous;
  expect(changed.mock.calls.at(-1)?.[0].result.products[0].productId).toBe('9BBBBBBBBBBB');
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
 it('retries the failed Deals continuation without discarding the retained first page', async () => {
  const api = bridge(), changed = vi.fn();
  api.getCollection = vi.fn().mockResolvedValueOnce(result([product()], {cursor: 'deals-next', hasMore: true}))
    .mockRejectedValueOnce(Error('private network detail')).mockResolvedValueOnce(result([product('9BBBBBBBBBBB')]));
  const loader = createXboxStoreLoader(api, changed);
  await loader.load({kind: 'collection', collection: 'deals'}); await loader.more();
  expect(changed).toHaveBeenLastCalledWith({status: 'error', result: expect.objectContaining({products: [product()], cursor: 'deals-next'})});
  await loader.retry();
  expect(api.getCollection).toHaveBeenLastCalledWith('deals', 'deals-next');
  expect(changed.mock.calls.at(-1)?.[0].result.products).toHaveLength(2);
  expect(changed.mock.calls.flat()).not.toContain('private network detail');
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
 it('restarts abandoned initial reads while retaining cancelled continuation pages', () => {
  expect(storeRetainedListing(undefined)).toBeUndefined();
  expect(storeRetainedListing({status: 'loading'})).toBeUndefined();
  const first = result([product()], {cursor: 'next', hasMore: true});
  expect(storeRetainedListing({status: 'ready', result: first, loadingMore: true})).toEqual({status: 'ready', result: first, loadingMore: false});
  expect(storeRetainedListing({status: 'error', result: first})).toEqual({status: 'error', result: first, loadingMore: false});
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
 it.each(['en', 'el'])('renders the observed Browse/Deals navigation without fabricating personal collections', language => {
  vi.stubGlobal('localStorage', { getItem: () => language }); const api = bridge(), open = vi.fn();
  const html = renderToStaticMarkup(<XboxStorePage data={demoSnapshot()} bridge={api} openProduct={open} />);
  expect([...html.matchAll(/data-store-tab="([^"]+)"/g)].map(match => match[1])).toEqual(['browse', 'deals']);
  expect([...html.matchAll(/data-store-action="([^"]+)"/g)].map(match => match[1])).toEqual(['categories', 'wishlist']);
  expect(html).toContain(language === 'el' ? 'Η λίστα επιθυμιών μου' : 'My wishlist');
  expect(html).toContain('xbox-store-featured-loading'); expect(html).toContain('xbox-store-loading-products');
  expect(html).not.toContain('data-store-category='); expect(html).not.toContain('xbox-store-utilities');
  expect(html).not.toContain('Picks for you'); expect(html).not.toContain('Minecraft');
  expect(html).toMatch(/role="tab"[^>]+aria-selected="true"[^>]+tabindex="0"[^>]+data-store-tab="browse"/);
  expect(html).toMatch(/role="tab"[^>]+aria-selected="false"[^>]+tabindex="-1"[^>]+data-store-tab="deals"/);
  expect(api.getFeaturedCatalog).not.toHaveBeenCalled(); expect(api.searchCatalog).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled();
 });
 it('keeps public returned hero identities, prices and publisher facts separate from personalized campaigns', () => {
  const products = [{...product(), title: 'Selected title', publisher: 'Returned publisher', heroUrl: 'https://example.test/hero.png'}, product('9BBBBBBBBBBB'), product('9CCCCCCCCCCC')];
  const html = renderToStaticMarkup(<XboxStoreSpotlight products={products} open={() => {}}/>);
  expect([...html.matchAll(/data-store-hero="([^"]+)"/g)].map(match => match[1])).toEqual(products.map(value => value.productId));
  expect(html).toContain('Selected title'); expect(html).toContain('Returned publisher'); expect(html).toContain('https://example.test/hero.png');
  expect(html.match(/Featured page /g)).toHaveLength(2); expect(html).not.toMatch(/Picks for you|Owned|Buy now|Free to play/);
 });
 it('sorts the declared categories in the current language and filters only returned product metadata', () => {
  const english = storeCategories('en'), greek = storeCategories('el');
  expect(english.map(value => value.label)).toEqual([...english.map(value => value.label)].sort((a, b) => a.localeCompare(b, 'en')));
  expect(greek.map(value => value.label)).toEqual([...greek.map(value => value.label)].sort((a, b) => a.localeCompare(b, 'el')));
  const racing = { ...product('9BBBBBBBBBBB'), categories: ['Racing & flying'] }, other = { ...product(), categories: ['Puzzle & trivia'] };
  expect(storeCategoryProducts([racing, other], 'racing')).toEqual([racing]);
  expect(storeCategoryProducts([racing, other], 'horror')).toEqual([]);
  expect(storeCategoryProducts([racing, other], 'puzzle')).toEqual([other]);
  expect(racing.purchasePrice).toBeUndefined(); expect(racing.includedWith).toBeUndefined();
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


describe('Store navigation history', () => {
 it('returns through category and collection origins with exact saved scroll and focus', () => {
  const initial = storeInitialNavigation();
  const categories = storeNavigate(initial, {view: 'categories'}, 'categories', 280);
  const category = storeNavigate(categories, {view: 'category', category: 'racing'}, 'category-racing', 640);
  const back = storeBack(category);
  expect(back.restore).toEqual({location: {view: 'categories'}, focus: 'category-racing', scroll: 640});
  expect(back.state.location).toEqual({view: 'categories'});
  expect(storeBack(back.state).restore).toEqual({location: {view: 'home'}, focus: 'categories', scroll: 280});
  expect(initial.history).toEqual([]); expect(categories.history).toHaveLength(1);
 });
 it('treats Browse and Deals as sections rather than indefinitely stacking tab clicks', () => {
  let state = storeNavigate(storeInitialNavigation(), {view: 'categories'}, 'categories', 20);
  state = storeNavigate(state, {view: 'deals'}, 'deals', 20, true);
  expect(state.history).toEqual([]); expect(state.location.view).toBe('deals');
  expect(storeBack(state)).toEqual({state: {location: {view: 'home'}, history: []}, restore: {location: {view: 'home'}, focus: 'deals', scroll: 0}});
  expect(storeNavigate(state, {view: 'deals'}, 'deals', 0, true)).toBe(state);
 });
 it('keeps search results tied to their query and returns to the previous selected section', () => {
  const initial = storeInitialNavigation('  Forza  ');
  expect(initial.location).toEqual({view: 'search', query: 'Forza'});
  expect(storeBack(initial).state.location).toEqual({view: 'home'});
  const deals = storeNavigate(storeInitialNavigation(), {view: 'deals'}, 'deals', 0, true);
  const searched = storeNavigate(deals, {view: 'search', query: 'Halo'}, 'deals', 110);
  expect(storeBack(searched).restore).toEqual({location: {view: 'deals'}, focus: 'deals', scroll: 110});
  expect(storeInitialNavigation('x').location).toEqual({view: 'home'});
 });
 it('bounds retained destinations without mutating previous route snapshots', () => {
  let state = storeInitialNavigation();
  for (let i=0; i<50; i++) state = storeNavigate(state, {view: 'search', query: String(i)}, 'browse', i);
  expect(state.history).toHaveLength(20); expect(state.history[0].location.query).toBe('29');
 });
});
