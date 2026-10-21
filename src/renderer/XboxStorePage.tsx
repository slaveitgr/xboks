import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AppSnapshot, CatalogProduct, CatalogSearchResult } from '../shared/types';
import { ArrowLeft, ChevronLeft, ChevronRight, Gamepad2, Gift, Heart, RefreshCw, Search, X } from './XboxIcons';
import { useBackHandler } from './GamepadNavigation';
import { useReferenceLocale } from './ReferenceLocale';
import './xbox-store.css';

/** The supplied Xbox client uses this real public fallback when Store editorial
 * layout data is empty. It is a product link, not an install or ownership claim. */
export const minecraftStoreProductId = '9NXP44L49SHJ';
export const minecraftStoreArtwork = 'https://cms-assets.xboxservices.com/assets/8b/cd/8bcdf84a-6196-40e4-a605-d48d3546482f.jpg?n=Garrison_PCHome_Fallback_Minecraft_1920x1080.jpg';
export type XboxStoreCollection = 'all-pc' | 'toppaid' | 'addons';
export interface XboxStoreBridge {
  getFeaturedCatalog(): Promise<CatalogSearchResult>;
  searchCatalog(query: string, cursor?: string): Promise<CatalogSearchResult>;
  getCollection?(collection: XboxStoreCollection, cursor?: string): Promise<CatalogSearchResult>;
  getWishlist?(cursor?: string): Promise<CatalogSearchResult>;
}
export type XboxStoreRequest = { kind: 'featured' } | { kind: 'search'; query: string }
  | { kind: 'collection'; collection: XboxStoreCollection } | { kind: 'wishlist'; signedIn: boolean };
export interface XboxStoreListing {
  status: 'loading' | 'ready' | 'error' | 'unavailable' | 'signed-out';
  result?: CatalogSearchResult;
  loadingMore?: boolean;
}

/** One request scope owns each list; old results and pagination cannot replace
 * another category, account or query. Missing capabilities never become data. */
export function createXboxStoreLoader(bridge: XboxStoreBridge, changed: (state: XboxStoreListing) => void, initial?: { request: XboxStoreRequest; state: XboxStoreListing }) {
  let disposed = false, revision = 0, request: XboxStoreRequest = initial?.request ?? { kind: 'featured' }, state: XboxStoreListing = initial?.state ?? { status: 'loading' }, paging = false;
  const publish = (next: XboxStoreListing) => { state = next; changed(next); };
  async function load(next: XboxStoreRequest, more = false): Promise<void> {
    if (disposed || more && (paging || !state.result?.hasMore || !state.result.cursor)) return;
    const previous = more ? state.result : undefined, cursor = previous?.cursor, current = ++revision;
    request = next; paging = more;
    if (next.kind === 'wishlist' && !next.signedIn) { publish({ status: 'signed-out' }); return; }
    if (next.kind === 'collection' && !bridge.getCollection || next.kind === 'wishlist' && !bridge.getWishlist) { publish({ status: 'unavailable' }); return; }
    publish(previous ? { status: 'ready', result: previous, loadingMore: true } : { status: 'loading' });
    try {
      const result = next.kind === 'featured' ? await bridge.getFeaturedCatalog()
        : next.kind === 'search' ? await bridge.searchCatalog(next.query, cursor)
          : next.kind === 'collection' ? await bridge.getCollection!(next.collection, cursor) : await bridge.getWishlist!(cursor);
      if (disposed || revision !== current) return;
      if (!result || !Array.isArray(result.products)) throw Error('Invalid Store collection.');
      if (more && result.hasMore && result.cursor === cursor) throw Error('Store pagination did not advance.');
      const products = [...new Map([...(previous?.products ?? []), ...result.products].map(product => [product.productId, product])).values()];
      publish({ status: 'ready', result: { ...result, products } });
    } catch { if (!disposed && revision === current) publish(previous ? { status: 'error', result: previous } : { status: 'error' }); }
    finally { if (revision === current) paging = false; }
  }
  return { load: (next: XboxStoreRequest) => load(next), retry: () => load(request), more: () => load(request, true), dispose() { disposed = true; revision++; } };
}

function browserStoreBridge(): XboxStoreBridge {
  const api = typeof window === 'undefined' ? undefined : window.launcher as typeof window.launcher & {
    getStoreCollection?: XboxStoreBridge['getCollection']; getStoreWishlist?: XboxStoreBridge['getWishlist'];
  };
  const unavailable = async (): Promise<CatalogSearchResult> => { throw Error('The desktop catalog is unavailable.'); };
  return { getFeaturedCatalog: api?.getFeaturedCatalog ?? unavailable, searchCatalog: api?.searchCatalog ?? unavailable,
    getCollection: api?.getStoreCollection, getWishlist: api?.getStoreWishlist };
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
    <button type="button" data-gamepad-card-activate aria-label={`${text('View game details', 'Προβολή λεπτομερειών παιχνιδιού')}: ${product.title}`} onClick={() => open(product)}>
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
  return <section className="xbox-store-shelf"><header>{all ? <button type="button" onClick={all}><h2>{title}</h2><ChevronRight /></button> : <h2>{title}</h2>}{subtitle ? <p>{subtitle}</p> : null}</header>
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
  data: AppSnapshot; openProduct: (product: CatalogProduct) => void;
  /** Keep this page mounted behind product details to retain gallery context. */
  active?: boolean;
  initialQuery?: string; clearSearch?: () => void; openLibrary?: () => void; openAccount?: () => void;
  toast?: (value: { kind: 'success' | 'error' | 'info'; message: string }) => void;
  bridge?: XboxStoreBridge;
  /** Fixture/host artwork override; the shipped default is the original public asset. */
  fallbackArtwork?: string;
}
type StoreView = 'home' | 'search' | 'trending' | XboxStoreCollection | 'wishlist';
export function XboxStorePage({ data, openProduct, active = true, initialQuery = '', clearSearch, openLibrary, openAccount, toast, bridge, fallbackArtwork = minecraftStoreArtwork }: XboxStorePageProps) {
  const { text } = useReferenceLocale(), api = useMemo(() => bridge ?? browserStoreBridge(), [bridge]);
  const [view, setView] = useState<StoreView>(() => initialQuery.trim().length >= 2 ? 'search' : 'home'), [query, setQuery] = useState(initialQuery.trim());
  const [redeem, setRedeem] = useState(false), [artFailed, setArtFailed] = useState(false), [artAttempt, setArtAttempt] = useState(0), [opening, setOpening] = useState(false);
  const [reading, setReading] = useState<{ key: string; state: XboxStoreListing }>({ key: '', state: { status: 'loading' } });
  const readingOwner = useRef<XboxStoreBridge>();
  const loader = useRef<ReturnType<typeof createXboxStoreLoader>>(), origin = useRef<HTMLElement>(), activation = useRef(0), mounted = useRef(false), openingRef = useRef(false);
  const activationScope = useRef(''); activationScope.current = JSON.stringify([active, data.settings.market, view, query, initialQuery, redeem]);
  const account = data.auth.stored === true && !data.auth.running ? data.auth.username ?? '' : '';
  const request: XboxStoreRequest = view === 'search' ? { kind: 'search', query } : view === 'wishlist' ? { kind: 'wishlist', signedIn: Boolean(account) }
    : view === 'all-pc' || view === 'toppaid' || view === 'addons' ? { kind: 'collection', collection: view } : { kind: 'featured' };
  const key = JSON.stringify([request, data.settings.market, view === 'wishlist' ? account : '', data.backend.binaryPath, data.backend.commit]);
  const listing = reading.key === key ? reading.state : { status: 'loading' as const };
  useEffect(() => { const value = initialQuery.trim(); setQuery(value); if (value.length >= 2) setView('search'); else setView(current => current === 'search' ? 'home' : current); }, [initialQuery]);
  useEffect(() => {
    if (!active) return;
    const previous = readingOwner.current === api && reading.key === key && reading.state.status !== 'loading' ? { ...reading.state, loadingMore: false } : undefined;
    readingOwner.current = api;
    const owner = createXboxStoreLoader(api, state => setReading({ key, state }), previous ? { request, state: previous } : undefined); loader.current = owner;
    if (previous) { if (reading.state.loadingMore) setReading({ key, state: previous }); } else void owner.load(request);
    return () => { owner.dispose(); if (loader.current === owner) loader.current = undefined; };
  }, [api, key, active]);
  useEffect(() => { mounted.current = active; openingRef.current = false; setOpening(false); if (!active) setRedeem(false); return () => { mounted.current = false; activation.current++; openingRef.current = false; }; }, [api, data.settings.market, view, query, initialQuery, redeem, active]);
  useEffect(() => setArtFailed(false), [fallbackArtwork, artAttempt]);
  function home() { clearSearch?.(); setView('home'); setQuery(''); requestAnimationFrame(() => origin.current?.isConnected && origin.current.focus({ preventScroll: true })); }
  useBackHandler(() => { home(); return true; }, active && view !== 'home' && !redeem);
  const products = listing.result?.products ?? [];
  const open = (product: CatalogProduct) => { if (active) openProduct(product); };
  async function openMinecraft() {
    if (!active || openingRef.current) return;
    openingRef.current = true; setOpening(true); const current = ++activation.current, scope = activationScope.current;
    const currentActivation = () => mounted.current && activation.current === current && activationScope.current === scope;
    let product = products.find(value => value.productId === minecraftStoreProductId);
    try { if (!product) product = (await api.searchCatalog('Minecraft')).products.find(value => value.productId === minecraftStoreProductId); }
    catch { if (currentActivation()) toast?.({ kind: 'info', message: text('PC package availability could not be loaded. Game information is still available.', 'Η διαθεσιμότητα πακέτου υπολογιστή δεν φορτώθηκε. Οι πληροφορίες παιχνιδιού παραμένουν διαθέσιμες.') }); }
    if (currentActivation()) openProduct(product ?? minecraftStoreFallback());
    if (currentActivation()) { openingRef.current = false; setOpening(false); }
  }
  const shortcuts = [
    { id: 'all-pc', label: text('All PC games', 'Όλα τα παιχνίδια υπολογιστή') },
    { id: 'toppaid', label: text('Top paid', 'Κορυφαία επί πληρωμή') },
    { id: 'addons', label: text('Add-ons', 'Πρόσθετα') },
    { id: 'redeem', label: text('Redeem', 'Εξαργύρωση') },
    { id: 'wishlist', label: text('My wishlist', 'Η λίστα επιθυμιών μου') },
  ] as const;
  const heading = view === 'search' ? text(`Results for “${query}”`, `Αποτελέσματα για «${query}»`) : view === 'trending' ? text('Trending PC games', 'Δημοφιλή παιχνίδια υπολογιστή') : shortcuts.find(value => value.id === view)?.label;
  const loading = listing.status === 'loading';
  return <main hidden={!active} className={`page xbox-store-page ${view === 'home' ? 'xbox-store-landing' : 'xbox-store-gallery'}`}>
    <h1 className="sr-only">{text('Store', 'Κατάστημα')}</h1>
    {view === 'home' ? <section className="xbox-store-spotlight" aria-label={text('Featured game', 'Προτεινόμενο παιχνίδι')}>
      {loading ? <div className="xbox-store-loading-heroes" role="status" aria-label={text('Loading Store…', 'Φόρτωση καταστήματος…')}>{[0, 1, 2].map(index => <span key={index} />)}</div>
        : <button type="button" className="xbox-store-spotlight-tile" data-gamepad-initial={active || undefined} data-store-spotlight={minecraftStoreProductId} aria-label={text('View Minecraft game details', 'Προβολή λεπτομερειών Minecraft')} aria-busy={opening} disabled={opening || !active} onClick={() => void openMinecraft()}>
          {!artFailed ? <img key={artAttempt} src={fallbackArtwork} alt="" onError={() => setArtFailed(true)} /> : <span className="xbox-store-art-error"><Gamepad2 /><span>{text('Store artwork could not load', 'Η εικόνα του καταστήματος δεν φορτώθηκε')}</span></span>}
          <span className="xbox-store-spotlight-copy"><strong>Minecraft</strong><span>{text('Build, create, explore', 'Δόμηση, δημιουργία, εξερεύνηση')}</span></span>
        </button>}
      {artFailed ? <button type="button" className="xbox-store-art-retry" onClick={() => setArtAttempt(value => value + 1)}><RefreshCw />{text('Retry artwork', 'Επανάληψη εικόνας')}</button> : null}
    </section> : <header className="xbox-store-gallery-heading"><button type="button" onClick={home} aria-label={text('Back to Store', 'Επιστροφή στο κατάστημα')}><ArrowLeft /></button><h2>{heading}</h2></header>}
    <nav className="xbox-store-shortcuts" aria-label={text('Store categories', 'Κατηγορίες καταστήματος')}>{shortcuts.map(shortcut => <button key={shortcut.id} type="button" data-store-action={shortcut.id} aria-pressed={view === shortcut.id} aria-haspopup={shortcut.id === 'redeem' ? 'dialog' : undefined} onClick={event => {
      if (!active) return; origin.current = event.currentTarget;
      if (shortcut.id === 'redeem') setRedeem(true);
      else { if (view === shortcut.id) void loader.current?.retry(); else { clearSearch?.(); setView(shortcut.id); } }
    }}>{shortcut.label}</button>)}</nav>
    <div className="xbox-store-listing" aria-busy={loading || listing.loadingMore || undefined}>
      {view === 'home' && products.length ? <StoreShelf title={text('Trending PC games', 'Δημοφιλή παιχνίδια υπολογιστή')} subtitle={text('Explore the current Microsoft Store collection', 'Ανακαλύψτε την τρέχουσα συλλογή του Microsoft Store')} products={products} data={data} open={open} all={() => setView('trending')} /> : null}
      {view === 'home' && products.length ? [...new Set(products.flatMap(product => product.categories))].slice(0, 2).map(category => {
        const group = products.filter(product => product.categories.includes(category));
        return group.length >= 2 && group.length < products.length ? <StoreShelf key={category} title={category} products={group} data={data} open={open} /> : null;
      }) : null}
      {view !== 'home' && products.length ? <div className="xbox-store-gallery-grid" data-gamepad-grid>{products.map(product => <XboxStoreProductCard key={product.productId} product={product} data={data} open={open} />)}</div> : null}
      {loading && view !== 'home' ? <div className="xbox-store-loading-products" role="status" aria-label={text('Loading games…', 'Φόρτωση παιχνιδιών…')}>{Array.from({ length: 8 }, (_, index) => <span key={index} />)}</div> : null}
      {listing.status === 'error' ? <div className="xbox-store-message" role="alert"><p>{text('This Store collection could not be loaded. Try again.', 'Αυτή η συλλογή καταστήματος δεν φορτώθηκε. Δοκιμάστε ξανά.')}</p><button type="button" onClick={() => void loader.current?.retry()}><RefreshCw />{text('Retry', 'Επανάληψη')}</button></div> : null}
      {listing.status === 'unavailable' ? <div className="xbox-store-message" role="status">{view === 'wishlist' ? <Heart /> : <Gamepad2 />}<h3>{view === 'wishlist' ? text('Your Microsoft wishlist is unavailable through this connection.', 'Η λίστα επιθυμιών Microsoft δεν είναι διαθέσιμη μέσω αυτής της σύνδεσης.') : text('This collection is unavailable through the connected catalog.', 'Αυτή η συλλογή δεν είναι διαθέσιμη μέσω του συνδεδεμένου καταλόγου.')}</h3><p>{text('Only results returned by a connected provider are shown here.', 'Εδώ εμφανίζονται μόνο αποτελέσματα που επιστρέφει συνδεδεμένος πάροχος.')}</p><a href="https://www.xbox.com/games" target="_blank" rel="noreferrer">{text('Browse Xbox.com', 'Περιήγηση στο Xbox.com')}</a></div> : null}
      {listing.status === 'signed-out' ? <div className="xbox-store-message" role="status"><Heart /><h3>{text('Sign in to view your Microsoft wishlist', 'Συνδεθείτε για να δείτε τη λίστα επιθυμιών Microsoft')}</h3>{openAccount ? <button type="button" onClick={openAccount}>{text('Account settings', 'Ρυθμίσεις λογαριασμού')}</button> : null}</div> : null}
      {listing.status === 'ready' && !products.length ? <div className="xbox-store-message" role="status"><Search /><h3>{view === 'wishlist' ? text('No wishlist items were returned', 'Δεν επιστράφηκαν στοιχεία λίστας επιθυμιών') : text('No games were returned', 'Δεν επιστράφηκαν παιχνίδια')}</h3><p>{text('Try another search or check the catalog again.', 'Δοκιμάστε άλλη αναζήτηση ή ελέγξτε ξανά τον κατάλογο.')}</p><button type="button" onClick={() => void loader.current?.retry()}><RefreshCw />{text('Check again', 'Νέος έλεγχος')}</button></div> : null}
      {listing.result?.hasMore ? <div className="xbox-store-load-more"><button type="button" disabled={listing.loadingMore} onClick={() => void loader.current?.more()}>{listing.loadingMore ? text('Loading…', 'Φόρτωση…') : text('Load more', 'Φόρτωση περισσότερων')}</button></div> : null}
      {view === 'home' && products.length ? <div className="xbox-store-browse-all"><button type="button" onClick={() => setView('all-pc')}>{text('Browse all games', 'Περιήγηση σε όλα τα παιχνίδια')}</button></div> : null}
      {openLibrary && listing.status === 'error' ? <button type="button" className="xbox-store-library-link" onClick={openLibrary}>{text('Open your local library', 'Άνοιγμα της τοπικής βιβλιοθήκης')}</button> : null}
    </div>
    {active && redeem ? <RedeemDialog close={() => setRedeem(false)} /> : null}
  </main>;
}
