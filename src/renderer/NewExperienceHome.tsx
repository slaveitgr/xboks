import { useEffect, useMemo, useRef, useState } from 'react';
import type { AccountLibraryPage, AppSnapshot, CatalogProduct, CatalogSearchResult, Game, LauncherApi, Page } from '../shared/types';
import { LoaderCircle } from 'lucide-react';
import { ChevronLeft, ChevronRight, CircleAlert, Gamepad2 } from './XboxIcons';
import { useLibraryCollections } from './LibraryChrome';
import { useReferenceLocale } from './ReferenceLocale';
import './new-experience-home.css';

export type NewHomeBridge = Pick<LauncherApi, 'getFeaturedCatalog' | 'getAccountLibrary'>;
export type NewHomeStatus = 'loading' | 'ready' | 'error' | 'idle';
export interface NewExperienceHomeProps {
  data: AppSnapshot;
  go: (page: Page) => void;
  action: (fn: () => Promise<unknown>, success?: string) => void;
  openGame?: (id: string) => void;
  openProduct?: (product: CatalogProduct) => void;
  bridge?: NewHomeBridge;
}

/** Installation/import time is never a substitute for a recorded play event. */
export function newHomeRecentGames(games: readonly Game[], history: Readonly<Record<string, number>>): Game[] {
  const seen = new Set<string>();
  return games.filter(game => {
    if (seen.has(game.id) || !Number.isFinite(history[game.id]) || history[game.id] <= 0) return false;
    seen.add(game.id); return true;
  }).sort((a, b) => history[b.id] - history[a.id]).slice(0, 12);
}

export function newHomeUniqueProducts(products: readonly CatalogProduct[]): CatalogProduct[] {
  const seen = new Set<string>();
  return products.filter(product => {
    const id = product.productId.toUpperCase();
    if (!id || seen.has(id)) return false;
    seen.add(id); return true;
  });
}

export function newHomeAccountKey(auth: AppSnapshot['auth']): string | null {
  return auth.stored === true && !auth.running ? JSON.stringify([auth.username ?? null, auth.gamertag ?? null]) : null;
}

/** A catalog card opens its details. It does not establish access or launch. */
export function openNewHomeProduct(product: CatalogProduct, navigation: Pick<NewExperienceHomeProps, 'go' | 'openProduct'>): void {
  if (navigation.openProduct) navigation.openProduct(product);
  else navigation.go('store');
}

function HomeArtwork({ source, eager = false }: { source?: string; eager?: boolean }) {
  const [failed, setFailed] = useState<string>();
  return source && failed !== source ? <img src={source} alt="" loading={eager ? 'eager' : 'lazy'} onError={() => setFailed(source)} />
    : <span className="new-home-art-fallback" aria-hidden="true"><Gamepad2 /></span>;
}

function scrollBehavior(): ScrollBehavior {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
}

function FeaturedCarousel({ products, open }: { products: readonly CatalogProduct[]; open: (product: CatalogProduct) => void }) {
  const { text } = useReferenceLocale(), rail = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  const [perPage, setPerPage] = useState(2);
  const tiles = products.slice(0, 6), pages = Math.ceil(tiles.length / perPage);
  const identity = tiles.map(product => product.productId).join('|');
  useEffect(() => { setPage(0); if (rail.current) rail.current.scrollLeft = 0; }, [identity]);
  useEffect(() => {
    const node = rail.current; if (!node) return;
    const update = () => {
      const card = node.children[0] as HTMLElement | undefined;
      if (card?.offsetWidth) setPerPage(Math.max(1, Math.min(2, Math.round(node.clientWidth / card.offsetWidth))));
    };
    update();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update);
    observer?.observe(node); window.addEventListener('resize', update);
    return () => { observer?.disconnect(); window.removeEventListener('resize', update); };
  }, [identity]);
  useEffect(() => { setPage(current => Math.min(current, pages - 1)); }, [pages]);
  const position = (index: number) => {
    const node = rail.current, child = node?.children[index * perPage] as HTMLElement | undefined;
    if (!node || !child) return;
    const left = child.offsetLeft - (node.children[0] as HTMLElement).offsetLeft;
    node.scrollTo({ left, behavior: scrollBehavior() });
    setPage(index);
  };
  return <div className="new-home-featured-carousel" aria-roledescription="carousel" aria-label={text('Featured games', 'Επιλεγμένα παιχνίδια')}>
    <div className="new-home-featured-rail" ref={rail} data-gamepad-action-row onScroll={() => {
      const node = rail.current; if (!node || node.children.length < 2) return;
      const stride = (node.children[1] as HTMLElement).offsetLeft - (node.children[0] as HTMLElement).offsetLeft;
      if (stride > 0) setPage(Math.min(pages - 1, Math.max(0, Math.round(node.scrollLeft / (stride * perPage)))));
    }}>
      {tiles.map((product, index) => <button type="button" key={product.productId} className="new-home-featured-card" data-product-id={product.productId}
        aria-label={text(`View game details: ${product.title}`, `Προβολή λεπτομερειών παιχνιδιού: ${product.title}`)}
        onFocus={event => event.currentTarget.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'auto' })} onClick={() => open(product)}>
        <HomeArtwork source={product.heroUrl ?? product.posterUrl} eager={index < 2} />
        <span className="new-home-featured-copy"><strong>{product.title}</strong>{product.publisher ? <span>{product.publisher}</span> : null}</span>
      </button>)}
    </div>
    {pages > 1 ? <>
      <button type="button" className="new-home-featured-previous" disabled={page === 0} aria-label={text('Previous featured games', 'Προηγούμενα επιλεγμένα παιχνίδια')} onClick={() => position(page - 1)}><ChevronLeft /></button>
      <button type="button" className="new-home-featured-next" disabled={page === pages - 1} aria-label={text('Next featured games', 'Επόμενα επιλεγμένα παιχνίδια')} onClick={() => position(page + 1)}><ChevronRight /></button>
      <div className="new-home-featured-pages" role="group" aria-label={text('Featured pages', 'Σελίδες επιλεγμένων')}>{Array.from({ length: pages }, (_, index) => <button type="button" key={index}
        aria-label={text(`Show featured page ${index + 1}`, `Εμφάνιση σελίδας επιλεγμένων ${index + 1}`)} aria-pressed={page === index} onClick={() => position(index)}><span /></button>)}</div>
    </> : null}
  </div>;
}

function ProductShelf({ title, products, open, browse }: { title: string; products: readonly CatalogProduct[]; open: (product: CatalogProduct) => void; browse: () => void }) {
  const { text } = useReferenceLocale();
  return <section className="new-home-shelf"><header><button type="button" className="new-home-section-link" onClick={browse}><h2>{title}</h2><ChevronRight /></button></header>
    <div className="new-home-product-rail" data-gamepad-grid>{products.map(product => <button type="button" className="new-home-product" key={product.productId} data-product-id={product.productId}
      aria-label={text(`View game details: ${product.title}`, `Προβολή λεπτομερειών παιχνιδιού: ${product.title}`)} onClick={() => open(product)}>
      <span className="new-home-product-art"><HomeArtwork source={product.heroUrl ?? product.posterUrl} /></span>
      {product.purchasePrice || product.includedWith ? <span className="new-home-product-facts">{product.purchasePrice ? <span>{product.purchasePrice}</span> : null}{product.includedWith ? <small>{product.includedWith}</small> : null}</span> : null}
      <strong title={product.title}>{product.title}</strong>{product.categories.length ? <span className="new-home-product-categories">{product.categories.slice(0, 3).join(' · ')}</span> : null}
    </button>)}</div>
  </section>;
}

export interface NewExperienceHomeContentProps extends Pick<NewExperienceHomeProps, 'go' | 'openGame' | 'openProduct'> {
  recentGames: readonly Game[];
  products: readonly CatalogProduct[];
  catalogStatus: NewHomeStatus;
  retryCatalog: () => void;
  gamePassProducts?: readonly CatalogProduct[];
  gamePassStatus?: NewHomeStatus;
  retryGamePass?: () => void;
}

export function NewExperienceHomeContent({ recentGames, products: returned, catalogStatus, retryCatalog, gamePassProducts = [], gamePassStatus = 'idle', retryGamePass, ...navigation }: NewExperienceHomeContentProps) {
  const { text } = useReferenceLocale();
  const products = newHomeUniqueProducts(returned);
  const open = (product: CatalogProduct) => openNewHomeProduct(product, navigation);
  const catalogLabel = text('Loading featured games…', 'Φόρτωση επιλεγμένων παιχνιδιών…');
  return <main className="page new-experience-home" data-new-experience-home aria-label={text('Home', 'Αρχική')}>
    {recentGames.length ? <section className="new-home-mru" aria-label={text('Jump back in', 'Επιστροφή')}><h2>{text('Jump back in', 'Επιστροφή')}</h2>
      <div className="new-home-recent-rail" data-gamepad-action-row>{recentGames.map(game => <button type="button" key={game.id} className="new-home-recent-game"
        aria-label={text(`View game details: ${game.title}`, `Προβολή λεπτομερειών παιχνιδιού: ${game.title}`)} data-game-id={game.id}
        onClick={() => navigation.openGame ? navigation.openGame(game.id) : navigation.go('library')}>
        <span><HomeArtwork source={game.coverUrl ?? game.coverDataUrl ?? game.heroUrl} /></span><strong>{game.title}</strong>
      </button>)}</div>
    </section> : null}
    <section className="new-home-featured" aria-labelledby="new-home-featured-title"><h2 id="new-home-featured-title">{text('Featured', 'Επιλεγμένα')}</h2>
      {products.length ? <FeaturedCarousel products={products} open={open} /> : catalogStatus === 'loading' ? <div className="new-home-featured-loading" role="status" aria-label={catalogLabel}><span /><span /><span className="new-home-screen-reader">{catalogLabel}</span></div>
        : <div className="new-home-state" role="status">{catalogStatus === 'error' ? <CircleAlert /> : <Gamepad2 />}<p>{catalogStatus === 'error'
          ? text('Featured games could not be loaded.', 'Δεν ήταν δυνατή η φόρτωση των επιλεγμένων παιχνιδιών.')
          : text('There are no featured games available right now.', 'Δεν υπάρχουν διαθέσιμα επιλεγμένα παιχνίδια αυτή τη στιγμή.')}</p>
          <button type="button" onClick={retryCatalog}>{text('Try again', 'Δοκιμή ξανά')}</button><button type="button" onClick={() => navigation.go('library')}>{text('Open library', 'Άνοιγμα βιβλιοθήκης')}</button>
        </div>}
    </section>
    {gamePassProducts.length ? <ProductShelf title={text('Your Game Pass library', 'Η βιβλιοθήκη Game Pass σου')} products={newHomeUniqueProducts(gamePassProducts)} open={open} browse={() => navigation.go('gamepass')} />
      : gamePassStatus === 'loading' ? <section className="new-home-shelf"><h2>{text('Your Game Pass library', 'Η βιβλιοθήκη Game Pass σου')}</h2><div className="new-home-account-loading" role="status"><LoaderCircle className="spin" />{text('Loading Game Pass library…', 'Φόρτωση βιβλιοθήκης Game Pass…')}</div></section>
        : gamePassStatus === 'error' ? <section className="new-home-shelf"><h2>{text('Your Game Pass library', 'Η βιβλιοθήκη Game Pass σου')}</h2><div className="new-home-state" role="status"><p>{text('Your Game Pass library could not be loaded.', 'Δεν ήταν δυνατή η φόρτωση της βιβλιοθήκης Game Pass σου.')}</p><button type="button" onClick={retryGamePass}>{text('Try again', 'Δοκιμή ξανά')}</button></div></section> : null}
    {products.length ? <ProductShelf title={text("What everyone's playing", 'Τι παίζουν όλοι')} products={products} open={open} browse={() => navigation.go('store')} /> : null}
  </main>;
}

export function NewExperienceHome({ data, go, openGame, openProduct, bridge }: NewExperienceHomeProps) {
  const api = bridge ?? (typeof window === 'undefined' ? undefined : window.launcher);
  const market = data.settings.market, accountKey = newHomeAccountKey(data.auth);
  const { collections } = useLibraryCollections(data.auth);
  const recentGames = useMemo(() => newHomeRecentGames(data.games, collections.history), [data.games, collections.history]);
  const [retryCatalog, setRetryCatalog] = useState(0), [retryGamePass, setRetryGamePass] = useState(0);
  const [catalog, setCatalog] = useState<{ market: string; status: NewHomeStatus; result?: CatalogSearchResult }>({ market, status: 'loading' });
  const [account, setAccount] = useState<{ key: string | null; market: string; status: NewHomeStatus; result?: AccountLibraryPage }>({ key: null, market, status: 'idle' });
  useEffect(() => {
    let current = true;
    setCatalog({ market, status: 'loading' });
    if (!api?.getFeaturedCatalog) { setCatalog({ market, status: 'error' }); return; }
    void api.getFeaturedCatalog().then(result => { if (current) setCatalog({ market, status: 'ready', result }); })
      .catch(() => { if (current) setCatalog({ market, status: 'error' }); });
    return () => { current = false; };
  }, [api, market, retryCatalog]);
  useEffect(() => {
    let current = true;
    if (accountKey === null || !api?.getAccountLibrary) { setAccount({ key: null, market, status: 'idle' }); return; }
    setAccount({ key: accountKey, market, status: 'loading' });
    void api.getAccountLibrary('gamepass').then(result => { if (current) setAccount({ key: accountKey, market, status: 'ready', result }); })
      .catch(() => { if (current) setAccount({ key: accountKey, market, status: 'error' }); });
    return () => { current = false; };
  }, [api, accountKey, market, retryGamePass]);
  const catalogCurrent = catalog.market === market;
  const accountCurrent = accountKey !== null && account.key === accountKey && account.market === market;
  return <NewExperienceHomeContent recentGames={recentGames} products={catalogCurrent ? catalog.result?.products ?? [] : []}
    catalogStatus={catalogCurrent ? catalog.status : 'loading'} retryCatalog={() => setRetryCatalog(value => value + 1)}
    gamePassProducts={accountCurrent ? (account.result?.products ?? []).filter(product => product.access === 'gamepass') : []}
    gamePassStatus={accountCurrent ? account.status : 'idle'} retryGamePass={() => setRetryGamePass(value => value + 1)} go={go} openGame={openGame} openProduct={openProduct} />;
}
