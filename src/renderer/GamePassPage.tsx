import { useEffect, useRef, useState } from 'react';
import type { AppSnapshot, CatalogProduct, Page } from '../shared/types';
import { ChevronRight, ExternalLink, GamePassBadge, Gift, RefreshCw } from './XboxIcons';
import { ReferenceMenu } from './ReferenceMenu';
import { useReferenceLocale } from './ReferenceLocale';
import { createGamePassLibraryLoader, gamePassLibraryScope, type GamePassLibrarySnapshot, type GamePassLibraryState } from './gamepass-library';

/** Account-backed collection; promotional inclusion never becomes ownership. */
export function GamePassPage({ data, go, select, playLater, active = true }: {
  data: AppSnapshot; go: (page: Page) => void; select: (product: CatalogProduct) => void; playLater?: () => void; active?: boolean;
}) {
  const { text } = useReferenceLocale(), scope = gamePassLibraryScope(data);
  const [reading, setReading] = useState<{ epoch: number; state: GamePassLibraryState }>({ epoch: -1, state: { status: 'loading' } });
  const [filter, setFilter] = useState<{ epoch: number; genre: string }>({ epoch: -1, genre: '' });
  const [genreAnchor, setGenreAnchor] = useState<{ epoch: number; element: HTMLElement }>();
  const loader = useRef<ReturnType<typeof createGamePassLibraryLoader>>();
  const api = typeof window === 'undefined' ? undefined : window.launcher;
  const supported = data.backend.capabilities.library === true && Boolean(api?.getAccountLibrary);
  const ownership = useRef({scope, api, supported, epoch: 0});
  const cached = useRef<{epoch: number; snapshot: GamePassLibrarySnapshot}>();
  if (ownership.current.scope !== scope || ownership.current.api !== api || ownership.current.supported !== supported) {
    ownership.current = {scope, api, supported, epoch: ownership.current.epoch + 1}; cached.current = undefined;
  }
  const epoch = ownership.current.epoch, activeNow = useRef(active); activeNow.current = active;
  useEffect(() => {
    setGenreAnchor(undefined);
    if (reading.epoch !== epoch) setReading({epoch, state: {status: 'loading'}});
    if (filter.epoch !== epoch) setFilter({epoch, genre: ''});
    if (!active || !scope || !supported || !api) return;
    const seed = cached.current?.epoch === epoch ? cached.current.snapshot : undefined;
    const owner = createGamePassLibraryLoader(api, state => {
      if (!activeNow.current || ownership.current.epoch !== epoch) return;
      setReading({epoch, state});
      const snapshot = owner.snapshot(); if (snapshot) cached.current = {epoch, snapshot};
    }, seed); loader.current = owner;
    if (seed) setReading({epoch, state: seed.state}); else void owner.load();
    return () => { owner.dispose(); if (loader.current === owner) loader.current = undefined; };
  }, [scope, supported, api, active, epoch]);
  const state = scope && reading.epoch === epoch ? reading.state : { status: 'loading' as const };
  const result = scope && supported ? state.result : undefined;
  const allProducts = result?.products ?? [];
  const genre = filter.epoch === epoch ? filter.genre : '';
  const genres = [...new Set(allProducts.flatMap(product => product.categories))].sort();
  const products = genre ? allProducts.filter(product => product.categories.includes(genre)) : allProducts;
  const scrollGames = () => { if (activeNow.current) document.getElementById('game-pass-games')?.scrollIntoView({ behavior: 'smooth' }); };
  const navigate = (page: Page) => { if (activeNow.current) go(page); };
  const open = (product: CatalogProduct) => { if (activeNow.current) select(product); };
  const changeGenre = (genre: string) => { if (activeNow.current) setFilter({epoch, genre}); };
  const read = (method: 'refresh' | 'retry' | 'more') => { if (activeNow.current) void loader.current?.[method](); };
  const accountPending = data.auth.running || data.auth.stored === null;
  const loading = Boolean(scope && supported && state.status === 'loading');
  return <main className="page game-pass-page" data-gamepass-active={active ? 'true' : 'false'} aria-busy={active && (loading || state.loadingMore) || undefined}>
    <button className="game-pass-banner" onClick={scrollGames}><strong>{text('Discover Xbox Game Pass', 'Ανακαλύψτε το XBOX Game Pass')}</strong><span>{products.length
      ? text(`${products.length}${result?.cursor ? '+' : ''} games`, `${products.length}${result?.cursor ? '+' : ''} παιχνίδια`)
      : text('Explore Game Pass', 'Εξερευνήστε το Game Pass')}<ChevronRight /></span></button>
    <div className="game-pass-hero-row">{products.slice(0, 3).map(product => <button className="home-feature-tile" key={product.productId} data-product-id={product.productId} onClick={() => open(product)}>
      {product.heroUrl || product.posterUrl ? <img src={product.heroUrl ?? product.posterUrl} alt="" /> : null}<span className="feature-copy"><strong>{product.title}</strong><span>{product.publisher}</span></span>
    </button>)}</div>
    <div className="game-pass-actions">
      <button onClick={() => { changeGenre(''); scrollGames(); }}><GamePassBadge />{text('All games', 'Όλα τα παιχνίδια')}</button>
      <button disabled={!genres.length} aria-haspopup="menu" aria-expanded={active && genreAnchor?.epoch === epoch} onClick={event => { if (activeNow.current) setGenreAnchor({epoch, element: event.currentTarget}); }}><Gift />{genre || text('Pin a genre', 'Καρφίτσωμα είδους')}</button>
      <button onClick={() => { if (activeNow.current) { if (playLater) playLater(); else go('library'); } }}>{text('Play later', 'Αναπαραγωγή αργότερα')}<ChevronRight /></button>
      <button disabled title={text('Game Pass benefits are not returned by the connected service', 'Η συνδεδεμένη υπηρεσία δεν επιστρέφει τα πλεονεκτήματα του Game Pass')}><Gift />{text('My benefits', 'Τα πλεονεκτήματά μου')}</button>
      <a href="https://www.xbox.com/xbox-game-pass" target="_blank" rel="noreferrer" onClick={event => {if (!activeNow.current) event.preventDefault();}}>{text('Get Game Pass', 'Αποκτήστε το Game Pass')}<ExternalLink /></a>
    </div>
    {active && genreAnchor?.epoch === epoch && genreAnchor && scope ? <ReferenceMenu id="game-pass-genres" label={text('Pin a genre', 'Καρφίτσωμα είδους')} anchor={{ element: genreAnchor.element }} onDismiss={() => setGenreAnchor(undefined)}
      items={genres.map(category => ({ id: category, label: category, onSelect: () => changeGenre(category) }))} /> : null}
    <section id="game-pass-games"><h1>{text('Game Pass games', 'Παιχνίδια Game Pass')}</h1><p>{text('Explore games available through your Xbox account.', 'Εξερευνήστε παιχνίδια διαθέσιμα μέσω του λογαριασμού Xbox σας.')}</p>
      {scope && supported ? <button type="button" className="game-pass-refresh secondary" disabled={loading || state.loadingMore} onClick={() => read('refresh')}><RefreshCw />{text('Refresh games', 'Ανανέωση παιχνιδιών')}</button> : null}
      <div className="home-catalog-row" data-gamepad-grid>{products.map(product => <button className="home-product" key={product.productId} data-product-id={product.productId} onClick={() => open(product)}>
        {product.posterUrl ? <img src={product.posterUrl} alt="" /> : <GamePassBadge />}<span><strong>{product.title}</strong><small>{product.publisher}</small></span>
      </button>)}</div>
      {!scope ? <div className="home-catalog-state" role="status">{accountPending ? text('Checking your account…', 'Έλεγχος λογαριασμού…')
        : data.auth.stored === true ? text('Your account identity is unavailable. Open Account settings to refresh it.', 'Η ταυτότητα λογαριασμού δεν είναι διαθέσιμη. Ανοίξτε τις ρυθμίσεις λογαριασμού για ανανέωση.')
          : text('Sign in to see your Game Pass games.', 'Συνδεθείτε για να δείτε τα παιχνίδια Game Pass σας.')}
        <button className="secondary" disabled={accountPending} onClick={() => navigate('settings')}>{text('Account settings', 'Ρυθμίσεις λογαριασμού')}</button></div>
        : !supported ? <div className="home-catalog-state" role="status">{text('The connected Engine does not provide the Game Pass library.', 'Το συνδεδεμένο Engine δεν παρέχει τη βιβλιοθήκη Game Pass.')}
          <button className="secondary" onClick={() => navigate('settings')}>{text('Account settings', 'Ρυθμίσεις λογαριασμού')}</button></div>
          : loading ? <p className="home-catalog-state" role="status">{text('Loading Game Pass games…', 'Φόρτωση παιχνιδιών Game Pass…')}</p>
            : state.status === 'error' ? <div className="home-catalog-state" role="alert"><p>{state.failedMore ? text('More Game Pass games could not be loaded. Your current games are still shown.', 'Δεν φορτώθηκαν περισσότερα παιχνίδια Game Pass. Τα τρέχοντα παιχνίδια παραμένουν ορατά.')
              : text('The Game Pass library could not be loaded.', 'Δεν ήταν δυνατή η φόρτωση της βιβλιοθήκης Game Pass.')}</p><button className="secondary" onClick={() => read('retry')}>{text('Try again', 'Δοκιμή ξανά')}</button></div>
              : !products.length ? <div className="home-catalog-state" role="status">{genre ? text('No games in this genre have been returned yet.', 'Δεν έχουν επιστραφεί παιχνίδια αυτού του είδους ακόμη.')
                : text('No Game Pass games were returned for this account.', 'Δεν επιστράφηκαν παιχνίδια Game Pass για αυτόν τον λογαριασμό.')}</div> : null}
      {result?.skippedEntitlements ? <p role="status">{text('Some account licenses could not be validated. Refresh later to check again.', 'Ορισμένες άδειες λογαριασμού δεν επιβεβαιώθηκαν. Ανανεώστε αργότερα για νέο έλεγχο.')}</p> : null}
      {result?.cursor && !state.failedMore ? <button type="button" className="secondary" disabled={state.loadingMore} onClick={() => read('more')}>{state.loadingMore ? text('Loading…', 'Φόρτωση…') : text('Load more', 'Φόρτωση περισσότερων')}</button> : null}
    </section>
  </main>;
}
