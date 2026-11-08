import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AppSnapshot, CatalogProduct, CatalogSearchResult } from '../shared/types';
import { ArrowLeft, ChevronLeft, ChevronRight, Gamepad2, Gift, Heart, RefreshCw, Search, X } from './XboxIcons';
import { useBackHandler } from './GamepadNavigation';
import { useReferenceLocale } from './ReferenceLocale';
import './xbox-store.css';

/** Legacy public product metadata retained for older imported editorial layouts.
 * The 2612 local Store layout is driven by returned collections, not this tile. */
export const minecraftStoreProductId = '9NXP44L49SHJ';
export const minecraftStoreArtwork = 'https://cms-assets.xboxservices.com/assets/8b/cd/8bcdf84a-6196-40e4-a605-d48d3546482f.jpg?n=Garrison_PCHome_Fallback_Minecraft_1920x1080.jpg';
export type XboxStoreCollection = 'all-pc' | 'toppaid' | 'addons' | 'deals';
export interface XboxStoreBridge {
  getFeaturedCatalog(): Promise<CatalogSearchResult>;
  searchCatalog(query: string, cursor?: string): Promise<CatalogSearchResult>;
  getCollection?(collection: XboxStoreCollection, cursor?: string): Promise<CatalogSearchResult>;
  getCategory?(category: StoreCategoryId, cursor?: string): Promise<CatalogSearchResult>;
  getWishlist?(cursor?: string): Promise<CatalogSearchResult>;
}
export type XboxStoreRequest = { kind: 'featured' } | { kind: 'search'; query: string }
  | { kind: 'collection'; collection: XboxStoreCollection } | { kind: 'category'; category: StoreCategoryId } | { kind: 'wishlist'; signedIn: boolean };
export interface XboxStoreListing {
  status: 'loading' | 'ready' | 'error' | 'unavailable' | 'signed-out';
  result?: CatalogSearchResult;
  loadingMore?: boolean;
}
/** An abandoned initial read has no result to resume. A cancelled continuation
 * can retain its first page, with its in-flight marker removed. */
export function storeRetainedListing(state: XboxStoreListing | undefined): XboxStoreListing | undefined {
  return state && state.status !== 'loading' ? {...state, loadingMore: false} : undefined;
}

/** One request scope owns each list; old results and pagination cannot replace
 * another category, account or query. Missing capabilities never become data. */
export function createXboxStoreLoader(bridge: XboxStoreBridge, changed: (state: XboxStoreListing) => void, initial?: { request: XboxStoreRequest; state: XboxStoreListing }) {
  let disposed = false, revision = 0, request: XboxStoreRequest = initial?.request ?? { kind: 'featured' }, state: XboxStoreListing = initial?.state ?? { status: 'loading' }, paging = false;
  let failedMore = initial?.state.status === 'error' && Boolean(initial.state.result?.hasMore);
  const publish = (next: XboxStoreListing) => { state = next; changed(next); };
  async function load(next: XboxStoreRequest, more = false): Promise<void> {
    if (disposed || more && (paging || !state.result?.hasMore || !state.result.cursor)) return;
    const previous = more ? state.result : undefined, cursor = previous?.cursor, current = ++revision;
    request = next; paging = more;
    failedMore = false;
    if (next.kind === 'wishlist' && !next.signedIn) { paging = false; publish({ status: 'signed-out' }); return; }
    if (next.kind === 'collection' && !bridge.getCollection || next.kind === 'category' && !bridge.getCategory || next.kind === 'wishlist' && !bridge.getWishlist) { paging = false; publish({ status: 'unavailable' }); return; }
    publish(previous ? { status: 'ready', result: previous, loadingMore: true } : { status: 'loading' });
    try {
      const result = next.kind === 'featured' ? await bridge.getFeaturedCatalog()
        : next.kind === 'search' ? await bridge.searchCatalog(next.query, cursor)
          : next.kind === 'collection' ? await bridge.getCollection!(next.collection, cursor)
            : next.kind === 'category' ? await bridge.getCategory!(next.category, cursor) : await bridge.getWishlist!(cursor);
      if (disposed || revision !== current) return;
      if (!result || !Array.isArray(result.products)) throw Error('Invalid Store collection.');
      if (more && result.hasMore && result.cursor === cursor) throw Error('Store pagination did not advance.');
      const products = [...new Map([...(previous?.products ?? []), ...result.products].map(product => [product.productId, product])).values()];
      publish({ status: 'ready', result: { ...result, products } });
    } catch { if (!disposed && revision === current) { failedMore = more; publish(previous ? { status: 'error', result: previous } : { status: 'error' }); } }
    finally { if (revision === current) paging = false; }
  }
  return { load: (next: XboxStoreRequest) => load(next), retry: () => load(request, failedMore), more: () => load(request, true), dispose() { disposed = true; revision++; } };
}

function browserStoreBridge(): XboxStoreBridge {
  const api = typeof window === 'undefined' ? undefined : window.launcher as typeof window.launcher & {
    getStoreCollection?: XboxStoreBridge['getCollection']; getStoreCategory?: XboxStoreBridge['getCategory']; getStoreWishlist?: XboxStoreBridge['getWishlist'];
  };
  const unavailable = async (): Promise<CatalogSearchResult> => { throw Error('The desktop catalog is unavailable.'); };
  return { getFeaturedCatalog: api?.getFeaturedCatalog ?? unavailable, searchCatalog: api?.searchCatalog ?? unavailable,
    getCollection: api?.getStoreCollection, getCategory: api?.getStoreCategory, getWishlist: api?.getStoreWishlist };
}
export function minecraftStoreFallback(): CatalogProduct {
  return { productId: minecraftStoreProductId, title: 'Minecraft', description: '', categories: [], heroUrl: minecraftStoreArtwork,
    storeUrl: `https://www.microsoft.com/store/productId/${minecraftStoreProductId}`, installability: 'unknown',
    supportNote: 'The catalog has not confirmed a compatible PC package for this product.' };
}
export function storeProductInstalled(product: CatalogProduct, games: AppSnapshot['games']): boolean {
  const ids = new Set([product.productId, product.installProductId].filter(Boolean).map(id => id!.toUpperCase()));
  return games.some(game => game.installState === 'ready' && game.storeId && ids.has(game.storeId.toUpperCase()));
}
export function XboxStoreProductCard({ product, data, open }: { product: CatalogProduct; data: AppSnapshot; open: (product: CatalogProduct) => void }) {
  const { text } = useReferenceLocale(), [failed, setFailed] = useState<string>();
  const artwork = product.posterUrl ?? product.heroUrl;
  return <article className="xbox-store-product" data-product-id={product.productId} data-gamepad-card>
    <button type="button" data-gamepad-card-activate data-store-focus={`product-${product.productId}`} aria-label={`${text('View game details', 'Προβολή λεπτομερειών παιχνιδιού')}: ${product.title}`} onClick={() => open(product)}>
      <span className="xbox-store-product-art">{artwork && failed !== artwork ? <img src={artwork} alt="" loading="lazy" onError={() => setFailed(artwork)} /> : <Gamepad2 />}{product.includedWith ? <small className="xbox-store-inclusion">{product.includedWith}</small> : null}</span>
      <span className="xbox-store-product-copy"><strong title={product.title}>{product.title}</strong>{product.publisher ? <span className="xbox-store-publisher">{product.publisher}</span> : null}{product.purchasePrice ? <span className="xbox-store-price">{product.purchasePrice}</span> : null}{storeProductInstalled(product, data.games) ? <small className="xbox-store-installed">{text('Installed', 'Εγκατεστημένο')}</small> : null}</span>
    </button>
  </article>;
}
function StoreShelf({ title, subtitle, products, data, open, all }: { title: string; subtitle?: string; products: CatalogProduct[]; data: AppSnapshot; open: (product: CatalogProduct) => void; all?: () => void }) {
  const { text } = useReferenceLocale(), rail = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ before: false, after: false });
  useEffect(() => {
    const node = rail.current; if (!node) return;
    const update = () => setPosition({ before: node.scrollLeft > 2, after: node.scrollLeft + node.clientWidth < node.scrollWidth - 2 });
    update(); node.addEventListener('scroll', update, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update); observer?.observe(node);
    return () => { node.removeEventListener('scroll', update); observer?.disconnect(); };
  }, [products]);
  return <section className="xbox-store-shelf"><header>{all ? <button type="button" data-store-focus="trending" onClick={all}><h2>{title}</h2><ChevronRight /></button> : <h2>{title}</h2>}{subtitle ? <p>{subtitle}</p> : null}</header>
    <div className="xbox-store-shelf-body"><div ref={rail} className="xbox-store-shelf-rail" data-gamepad-grid>{products.map(product => <XboxStoreProductCard key={product.productId} product={product} data={data} open={open} />)}</div>
      {position.before ? <button type="button" className="xbox-store-rail-previous" aria-label={`${text('Previous games', 'Προηγούμενα παιχνίδια')}: ${title}`} onClick={() => rail.current?.scrollBy({ left: -612, behavior: 'smooth' })}><ChevronLeft /></button> : null}
      {position.after ? <button type="button" className="xbox-store-rail-next" aria-label={`${text('More games', 'Περισσότερα παιχνίδια')}: ${title}`} onClick={() => rail.current?.scrollBy({ left: 612, behavior: 'smooth' })}><ChevronRight /></button> : null}
    </div>
  </section>;
}
function RedeemDialog({ close }: { close: () => void }) {
  const { text } = useReferenceLocale(), root = useRef<HTMLElement>(null), closed = useRef(false), callback = useRef(close); callback.current = close;
  const dismiss = () => { if (!closed.current) { closed.current = true; callback.current(); } };
  useBackHandler(() => { dismiss(); return true; }, true, () => root.current);
  useEffect(() => {
    const origin = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const shell = document.querySelector<HTMLElement>('.app-shell'), inert = shell?.inert ?? false;
    if (shell) shell.inert = true; root.current?.querySelector<HTMLButtonElement>('[data-gamepad-cancel]')?.focus();
    return () => { if (shell) shell.inert = inert; if (origin?.isConnected) origin.focus({ preventScroll: true }); };
  }, []);
  const content = <div className="xbox-store-dialog-backdrop"><section ref={root} className="xbox-store-redeem-dialog" role="dialog" aria-modal="true" aria-labelledby="xbox-store-redeem-title" onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss(); }
    if (event.key === 'Tab') { const nodes = [...root.current!.querySelectorAll<HTMLElement>('button,a[href]')]; if (event.shiftKey && document.activeElement === nodes[0]) { event.preventDefault(); nodes.at(-1)?.focus(); } else if (!event.shiftKey && document.activeElement === nodes.at(-1)) { event.preventDefault(); nodes[0]?.focus(); } }
  }}><button type="button" className="xbox-store-dialog-close" aria-label={text('Close', 'Κλείσιμο')} onClick={dismiss}><X /></button><Gift /><h2 id="xbox-store-redeem-title">{text('Redeem a code', 'Εξαργύρωση κωδικού')}</h2><p>{text('Continue on Microsoft’s official redemption page. Choose the Microsoft account you intend to use; website sign-in is separate from your launcher sign-in.', 'Συνεχίστε στην επίσημη σελίδα εξαργύρωσης της Microsoft. Επιλέξτε τον λογαριασμό Microsoft που θέλετε να χρησιμοποιήσετε· η σύνδεση στον ιστότοπο είναι ξεχωριστή από τη σύνδεση στην εφαρμογή.')}</p><div><a href="https://redeem.microsoft.com/" target="_blank" rel="noreferrer">{text('Continue on Microsoft', 'Συνέχεια στη Microsoft')}</a><button type="button" data-gamepad-cancel data-gamepad-initial onClick={dismiss}>{text('Cancel', 'Ακύρωση')}</button></div></section></div>;
  return typeof document === 'undefined' ? content : createPortal(content, document.body);
}

export interface XboxStorePageProps {
  deferPageBack?: boolean;
  data: AppSnapshot; openProduct: (product: CatalogProduct) => void;
  /** Keep this page mounted behind product details to retain gallery context. */
  active?: boolean;
  initialQuery?: string; clearSearch?: () => void; openLibrary?: () => void; openAccount?: () => void;
  toast?: (value: { kind: 'success' | 'error' | 'info'; message: string }) => void;
  bridge?: XboxStoreBridge;
  /** @deprecated Legacy editorial override; 2612 renders returned collections. */
  fallbackArtwork?: string;
}
export const storeCategoryDefinitions = [
  ['action-adventure', 'Action & adventure', 'Δράση και περιπέτεια', /action|adventure|δράση|περιπέτεια/i],
  ['atmospheric', 'Atmospheric', 'Ατμοσφαιρικά', /atmospheric|ατμοσφαιρ/i],
  ['card-board', 'Card & board', 'Κάρτες και επιτραπέζια', /card|board|κάρτ|επιτραπέζ/i],
  ['collaborative', 'Collaborative', 'Συνεργατικά', /collaborative|co.?op|συνεργα/i],
  ['comedic', 'Comedic', 'Κωμικά', /comedic|comedy|κωμ/i],
  ['competitive', 'Competitive', 'Ανταγωνιστικά', /competitive|ανταγωνισ/i],
  ['cozy', 'Cozy', 'Χαλαρωτικά', /cozy|cosy|χαλαρ/i],
  ['family', 'Family & kids', 'Οικογένεια και παιδιά', /family|kids|οικογέν|παιδι/i],
  ['fighting', 'Fighters & brawlers', 'Μάχες', /fight|brawl|μάχ/i],
  ['horror', 'Horror', 'Τρόμου', /horror|τρόμ/i],
  ['platformer', 'Platformers', 'Πλατφόρμας', /platform|πλατφόρμ/i],
  ['puzzle', 'Puzzle', 'Γρίφοι', /puzzle|trivia|γρίφ/i],
  ['racing', 'Racing & flying', 'Αγώνες και πτήσεις', /racing|flying|αγών|πτήσ/i],
  ['rpg', 'RPG', 'Παιχνίδια ρόλων', /role.?playing|rpg|ρόλων/i],
  ['shooter', 'Shooters', 'Βολών', /shooter|βολών/i],
  ['simulation', 'Simulation', 'Προσομοίωση', /simulation|προσομοί/i],
  ['social', 'Social', 'Κοινωνικά', /social|κοινωνικ/i],
  ['thriller', 'Thriller', 'Θρίλερ', /thriller|θρίλερ/i],
] as const;
export type StoreCategoryId = typeof storeCategoryDefinitions[number][0];
export function storeCategories(language = 'en') {
  return storeCategoryDefinitions.map(([id, en, el]) => ({ id, label: language === 'el' ? el : en }))
    .sort((a, b) => a.label.localeCompare(b.label, language));
}
export function storeCategoryProducts(products: CatalogProduct[], category: StoreCategoryId) {
  const pattern = storeCategoryDefinitions.find(value => value[0] === category)?.[3];
  return pattern ? products.filter(product => product.categories.some(value => pattern.test(value))) : [];
}
export type StoreView = 'home' | 'search' | 'trending' | XboxStoreCollection | 'wishlist' | 'categories' | 'category';
export interface StoreLocation { view: StoreView; query?: string; category?: StoreCategoryId }
export interface StoreReturn { location: StoreLocation; focus: string; scroll: number }
export interface StoreNavigation { location: StoreLocation; history: StoreReturn[] }
export function storeInitialNavigation(query = ''): StoreNavigation {
  const value = query.trim();
  return value.length >= 2 ? { location: {view: 'search', query: value}, history: [{location: {view: 'home'}, focus: 'browse', scroll: 0}] }
    : { location: {view: 'home'}, history: [] };
}
/** Local navigation retains each destination and its exact return target. */
export function storeNavigate(state: StoreNavigation, location: StoreLocation, focus: string, scroll: number, section = false): StoreNavigation {
  if (JSON.stringify(state.location) === JSON.stringify(location)) return state;
  return { location, history: section ? [] : [...state.history, {location: state.location, focus, scroll}].slice(-20) };
}
export function storeBack(state: StoreNavigation): { state: StoreNavigation; restore: StoreReturn } {
  const restore = state.history.at(-1) ?? { location: {view: 'home' as const}, focus: state.location.view === 'deals' ? 'deals' : 'browse', scroll: 0 };
  return { state: {location: restore.location, history: state.history.slice(0, -1)}, restore };
}

export function XboxStoreSpotlight({ products, open }: { products: CatalogProduct[]; open: (product: CatalogProduct) => void }) {
  const { text } = useReferenceLocale(), rail = useRef<HTMLDivElement>(null), [page, setPage] = useState(0);
  const items = [...new Map(products.map(product => [product.productId, product])).values()].slice(0, 6), pages = Math.ceil(items.length / 2);
  const scroll = (next: number) => {
    const node = rail.current; if (!node) return;
    const first = node.children[0] as HTMLElement | undefined, target = node.children[next * 2] as HTMLElement | undefined;
    if (!first || !target) return;
    const reduced = document.documentElement.hasAttribute('data-reduce-motion') || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    node.scrollTo({left: target.offsetLeft - first.offsetLeft, behavior: reduced ? 'auto' : 'smooth'});
  };
  useEffect(() => {
    const node = rail.current; if (!node) return;
    const update = () => {
      const first = node.children[0] as HTMLElement | undefined; if (!first) return;
      const positions = [...node.children].filter((_child, index) => index % 2 === 0).map(child => (child as HTMLElement).offsetLeft - first.offsetLeft);
      setPage(positions.reduce((nearest, position, index) => Math.abs(position - node.scrollLeft) < Math.abs(positions[nearest] - node.scrollLeft) ? index : nearest, 0));
    };
    update(); node.addEventListener('scroll', update, {passive: true});
    const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update); resize?.observe(node);
    return () => { node.removeEventListener('scroll', update); resize?.disconnect(); };
  }, [pages]);
  if (!items.length) return null;
  return <section className="xbox-store-featured" aria-label={text('Featured games', 'Επιλεγμένα παιχνίδια')}>
    <div className="xbox-store-featured-rail" ref={rail} data-gamepad-grid>{items.map(product => <button key={product.productId} type="button" data-store-hero={product.productId} data-store-focus={`hero-${product.productId}`} aria-label={`${text('View game details', 'Προβολή λεπτομερειών παιχνιδιού')}: ${product.title}`} onClick={() => open(product)}>
      {product.heroUrl || product.posterUrl ? <img src={product.heroUrl ?? product.posterUrl} alt="" loading="lazy" onError={event => {event.currentTarget.hidden = true;}}/> : null}
      <span><strong>{product.title}</strong>{product.publisher ? <span>{product.publisher}</span> : null}</span>
    </button>)}</div>
    {pages > 1 ? <div className="xbox-store-featured-pages" aria-label={text('Featured pages', 'Σελίδες επιλεγμένων')}>{Array.from({length: pages}, (_, index) => <button type="button" key={index} aria-label={text(`Featured page ${index + 1}`, `Σελίδα επιλεγμένων ${index + 1}`)} aria-pressed={index === page} onClick={() => scroll(index)}><span/></button>)}</div> : null}
    {pages > 1 ? <><button type="button" className="xbox-store-featured-previous" disabled={page === 0} aria-label={text('Previous featured games', 'Προηγούμενα επιλεγμένα παιχνίδια')} onClick={() => scroll(page - 1)}><ChevronLeft/></button><button type="button" className="xbox-store-featured-next" disabled={page === pages - 1} aria-label={text('Next featured games', 'Επόμενα επιλεγμένα παιχνίδια')} onClick={() => scroll(page + 1)}><ChevronRight/></button></> : null}
  </section>;
}
function StoreCategoriesIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.25"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="12" y="2" width="5" height="5" rx="1"/><rect x="2" y="12" width="5" height="5" rx="1"/><rect x="12" y="12" width="5" height="5" rx="1"/></svg>;
}
export function XboxStorePage({ data, openProduct, active = true, initialQuery = '', clearSearch, openLibrary, openAccount, bridge, deferPageBack = false }: XboxStorePageProps) {
  const { text, language } = useReferenceLocale(), api = useMemo(() => bridge ?? browserStoreBridge(), [bridge]);
  const root = useRef<HTMLElement>(null), [navigation, setNavigation] = useState(() => storeInitialNavigation(initialQuery));
  const {view, query = '', category = 'action-adventure'} = navigation.location;
  const [redeem, setRedeem] = useState(false), restore = useRef<StoreReturn>(), initial = useRef(initialQuery.trim());
  const [reading, setReading] = useState<{key: string; owner: string; state: XboxStoreListing}>({key: '', owner: '', state: {status: 'loading'}});
  const loader = useRef<ReturnType<typeof createXboxStoreLoader>>();
  const account = data.auth.stored === true && !data.auth.running ? data.auth.username ?? data.auth.gamertag ?? '' : '';
  const owner = JSON.stringify([data.settings.market, account, data.auth.running, data.backend.binaryPath, data.backend.commit]);
  const cache = useRef<{owner: string; bridge: XboxStoreBridge; entries: Map<string, XboxStoreListing>}>({owner, bridge: api, entries: new Map()});
  if (cache.current.owner !== owner || cache.current.bridge !== api) cache.current = {owner, bridge: api, entries: new Map()};
  const request: XboxStoreRequest = view === 'search' ? {kind: 'search', query} : view === 'wishlist' ? {kind: 'wishlist', signedIn: Boolean(account)}
    : view === 'category' ? {kind: 'category', category} : view === 'categories' ? {kind: 'collection', collection: 'all-pc'} : view === 'all-pc' || view === 'toppaid' || view === 'addons' || view === 'deals' ? {kind: 'collection', collection: view} : {kind: 'featured'};
  const key = JSON.stringify(request);
  const listing = reading.key === key && reading.owner === owner ? reading.state : cache.current.entries.get(key) ?? {status: 'loading' as const};
  useEffect(() => {
    if (!active) return;
    const retained = storeRetainedListing(cache.current.entries.get(key));
    const currentCache = cache.current;
    const next = createXboxStoreLoader(api, state => {
      if (cache.current !== currentCache) return;
      currentCache.entries.delete(key); currentCache.entries.set(key, state);
      if (currentCache.entries.size > 24) currentCache.entries.delete(currentCache.entries.keys().next().value!);
      setReading({key, owner, state});
    }, retained ? {request, state: retained} : undefined);
    loader.current = next;
    if (retained) setReading({key, owner, state: retained}); else void next.load(request);
    return () => { next.dispose(); if (loader.current === next) loader.current = undefined; };
  }, [api, key, owner, active]);
  useEffect(() => { if (!active) setRedeem(false); }, [active]);
  const scrollOwner = () => root.current?.closest<HTMLElement>('.page-scroll') ?? root.current;
  function navigate(location: StoreLocation, focus: string, section = false) {
    if (!active) return;
    const currentScroll = scrollOwner()?.scrollTop ?? 0;
    clearSearch?.(); setNavigation(state => storeNavigate(state, location, focus, currentScroll, section));
    if (section) scrollOwner()?.scrollTo({top: 0});
  }
  function back() {
    clearSearch?.(); setNavigation(state => { const next = storeBack(state); restore.current = next.restore; return next.state; });
  }
  useEffect(() => {
    const value = initialQuery.trim(); if (value === initial.current) return; initial.current = value;
    if (value.length >= 2) setNavigation(state => storeNavigate(state, {view: 'search', query: value}, 'browse', scrollOwner()?.scrollTop ?? 0));
    else if (view === 'search') setNavigation(state => {const next = storeBack(state); restore.current = next.restore; return next.state;});
  }, [initialQuery]);
  useEffect(() => {
    const target = restore.current; if (!active || !target) return; restore.current = undefined;
    const frame = requestAnimationFrame(() => {
      const button = [...root.current?.querySelectorAll<HTMLElement>('[data-store-focus]') ?? []].find(node => node.dataset.storeFocus === target.focus);
      (button ?? root.current?.querySelector<HTMLElement>('[data-store-tab="browse"]'))?.focus({preventScroll: true});
      scrollOwner()?.scrollTo({top: target.scroll});
    });
    return () => cancelAnimationFrame(frame);
  }, [navigation, active]);
  useBackHandler(() => { back(); return true; }, active && (view !== 'home' || navigation.history.length > 0) && !redeem && !deferPageBack);
  const products = listing.result?.products ?? [];
  const categories = storeCategories(language), loading = listing.status === 'loading';
  const open = (product: CatalogProduct) => { if (active) openProduct(product); };
  const shortcuts = [
    {id: 'all-pc', label: text('All PC games', 'Όλα τα παιχνίδια υπολογιστή')},
    {id: 'toppaid', label: text('Top paid', 'Κορυφαία επί πληρωμή')},
    {id: 'addons', label: text('Add-ons', 'Πρόσθετα')},
    {id: 'redeem', label: text('Redeem', 'Εξαργύρωση')},
  ] as const;
  const heading = view === 'search' ? text(`Results for “${query}”`, `Αποτελέσματα για «${query}»`) : view === 'trending' ? text('Trending PC games', 'Δημοφιλή παιχνίδια υπολογιστή')
    : view === 'categories' ? text('Browse by category', 'Περιήγηση ανά κατηγορία') : view === 'category' ? categories.find(value => value.id === category)?.label
      : view === 'wishlist' ? text('My wishlist', 'Η λίστα επιθυμιών μου') : view === 'deals' ? text('Deals', 'Προσφορές') : shortcuts.find(value => value.id === view)?.label;
  const browse = view !== 'deals';
  return <main ref={root} hidden={!active} className={`page xbox-store-page xbox-store-v2 ${view === 'home' ? 'xbox-store-landing' : view === 'categories' ? 'xbox-store-categories' : 'xbox-store-gallery'}`}>
    <h1 className="sr-only">{text('Store', 'Κατάστημα')}</h1>
    <nav className="xbox-store-navigation" aria-label={text('Store sections', 'Ενότητες καταστήματος')}>
      <div role="tablist" aria-label={text('Browse Store', 'Περιήγηση στο κατάστημα')}>{(['browse', 'deals'] as const).map((id, index) => <button type="button" key={id} role="tab" id={`store-tab-${id}`} aria-selected={id === 'browse' ? browse : !browse} aria-controls="store-content" tabIndex={(id === 'browse' ? browse : !browse) ? 0 : -1} data-store-tab={id} data-store-focus={id} data-gamepad-initial={active && (id === 'browse' ? browse : !browse) || undefined} onClick={() => navigate({view: id === 'browse' ? 'home' : 'deals'}, id, true)} onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation(); const next = event.key === 'Home' ? 'browse' : event.key === 'End' ? 'deals' : index ? 'browse' : 'deals';
        navigate({view: next === 'browse' ? 'home' : 'deals'}, next, true); requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(`[data-store-tab="${next}"]`)?.focus());
      }}>{id === 'browse' ? text('Browse', 'Περιήγηση') : text('Deals', 'Προσφορές')}</button>)}</div>
      <div className="xbox-store-navigation-actions"><button type="button" data-store-action="categories" data-store-focus="categories" aria-label={text('Browse by category', 'Περιήγηση ανά κατηγορία')} aria-pressed={view === 'categories' || view === 'category'} onClick={() => navigate({view: 'categories'}, 'categories')}><StoreCategoriesIcon/></button><button type="button" data-store-action="wishlist" data-store-focus="wishlist" aria-label={text('My wishlist', 'Η λίστα επιθυμιών μου')} aria-pressed={view === 'wishlist'} onClick={() => navigate({view: 'wishlist'}, 'wishlist')}><Heart/></button></div>
    </nav>
    {view !== 'home' ? <header className="xbox-store-gallery-heading"><button type="button" onClick={back} aria-label={text('Back to Store', 'Επιστροφή στο κατάστημα')}><ArrowLeft/></button><h2>{heading}</h2></header> : null}
    {view === 'categories' ? <nav className="xbox-store-utilities" aria-label={text('Store collections', 'Συλλογές καταστήματος')}>{shortcuts.map(shortcut => <button type="button" key={shortcut.id} data-store-action={shortcut.id} data-store-focus={shortcut.id} aria-haspopup={shortcut.id === 'redeem' ? 'dialog' : undefined} onClick={() => shortcut.id === 'redeem' ? setRedeem(true) : navigate({view: shortcut.id}, shortcut.id)}>{shortcut.label}</button>)}</nav> : null}
    <div id="store-content" role="tabpanel" aria-labelledby={browse ? 'store-tab-browse' : 'store-tab-deals'} className="xbox-store-listing" aria-busy={loading || listing.loadingMore || undefined}>
      {view === 'home' && loading ? <><div className="xbox-store-featured-loading" role="status" aria-label={text('Loading featured games…', 'Φόρτωση επιλεγμένων παιχνιδιών…')}><span/><span/></div><div className="xbox-store-loading-products" aria-hidden="true">{Array.from({length: 4}, (_, index) => <span key={index}/>)}</div></> : null}
      {view === 'home' && products.length ? <><XboxStoreSpotlight products={products} open={open}/><StoreShelf title={text('Trending PC games', 'Δημοφιλή παιχνίδια υπολογιστή')} products={products} data={data} open={open} all={() => navigate({view: 'trending'}, 'trending')} /></> : null}
      {view === 'categories' ? <section className="xbox-store-category-section" aria-label={text('Browse by category', 'Περιήγηση ανά κατηγορία')}><div className="xbox-store-category-grid" data-gamepad-grid>{categories.map(item => {
        const artwork = storeCategoryProducts(products, item.id).find(product => product.heroUrl || product.posterUrl);
        return <button key={item.id} type="button" data-store-category={item.id} data-store-focus={`category-${item.id}`} onClick={() => navigate({view: 'category', category: item.id}, `category-${item.id}`)}>
          {artwork ? <img src={artwork.heroUrl ?? artwork.posterUrl} alt="" loading="lazy" onError={event => {event.currentTarget.hidden = true;}}/> : <Gamepad2/>}<span>{item.label}</span>
        </button>;
      })}</div></section> : null}
      {view !== 'home' && view !== 'categories' && listing.result ? <p className="xbox-store-result-count" role="status">{text(`${products.length} games`, `${products.length} παιχνίδια`)}</p> : null}
      {view !== 'home' && view !== 'categories' && products.length ? <div className="xbox-store-gallery-grid" data-gamepad-grid>{products.map(product => <XboxStoreProductCard key={product.productId} product={product} data={data} open={open}/>)}</div> : null}
      {loading && view !== 'home' && view !== 'categories' ? <div className="xbox-store-loading-products" role="status" aria-label={text('Loading games…', 'Φόρτωση παιχνιδιών…')}>{Array.from({length: 8}, (_, index) => <span key={index}/>)}</div> : null}
      {listing.status === 'error' ? <div className="xbox-store-message" role="alert"><p>{text('This Store collection could not be loaded. Try again.', 'Αυτή η συλλογή καταστήματος δεν φορτώθηκε. Δοκιμάστε ξανά.')}</p><button type="button" onClick={() => void loader.current?.retry()}><RefreshCw/>{text('Retry', 'Επανάληψη')}</button></div> : null}
      {listing.status === 'unavailable' ? <div className="xbox-store-message" role="status">{view === 'wishlist' ? <Heart/> : <Gamepad2/>}<h3>{view === 'wishlist' ? text('Your wishlist is unavailable right now.', 'Η λίστα επιθυμιών σας δεν είναι διαθέσιμη αυτήν τη στιγμή.') : text('This collection is unavailable right now.', 'Αυτή η συλλογή δεν είναι διαθέσιμη αυτήν τη στιγμή.')}</h3><p>{text('Choose another collection or return to the Store.', 'Επιλέξτε άλλη συλλογή ή επιστρέψτε στο κατάστημα.')}</p></div> : null}
      {listing.status === 'signed-out' ? <div className="xbox-store-message" role="status"><Heart/><h3>{text('Sign in to view your Microsoft wishlist', 'Συνδεθείτε για να δείτε τη λίστα επιθυμιών Microsoft')}</h3>{openAccount ? <button type="button" onClick={openAccount}>{text('Account settings', 'Ρυθμίσεις λογαριασμού')}</button> : null}</div> : null}
      {listing.status === 'ready' && !products.length && view !== 'categories' ? <div className="xbox-store-message" role="status"><Search/><h3>{view === 'wishlist' ? text('No wishlist items were returned', 'Δεν επιστράφηκαν στοιχεία λίστας επιθυμιών') : view === 'category' ? text('No games match this category', 'Δεν βρέθηκαν παιχνίδια σε αυτήν την κατηγορία') : view === 'deals' ? text('No deals were returned', 'Δεν επιστράφηκαν προσφορές') : text('No games were returned', 'Δεν επιστράφηκαν παιχνίδια')}</h3><p>{text('Try another category or check again.', 'Δοκιμάστε άλλη κατηγορία ή ελέγξτε ξανά.')}</p><button type="button" onClick={() => void loader.current?.retry()}><RefreshCw/>{text('Check again', 'Νέος έλεγχος')}</button></div> : null}
      {listing.result?.hasMore && view !== 'home' ? <div className="xbox-store-load-more"><button type="button" disabled={listing.loadingMore} onClick={() => void loader.current?.more()}>{listing.loadingMore ? text('Loading…', 'Φόρτωση…') : text('Load more', 'Φόρτωση περισσότερων')}</button></div> : null}
      {view === 'home' && products.length ? <div className="xbox-store-browse-all"><button type="button" data-store-focus="all-pc" onClick={() => navigate({view: 'all-pc'}, 'all-pc')}>{text('Browse all games', 'Περιήγηση σε όλα τα παιχνίδια')}</button></div> : null}
      {openLibrary && listing.status === 'error' ? <button type="button" className="xbox-store-library-link" onClick={openLibrary}>{text('Open your local library', 'Άνοιγμα της τοπικής βιβλιοθήκης')}</button> : null}
    </div>
    {active && redeem ? <RedeemDialog close={() => setRedeem(false)}/> : null}
  </main>;
}
