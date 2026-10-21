import {useEffect, useMemo, useRef, useState} from 'react';
import {ArrowLeft, Cloud, RefreshCw, Search} from './XboxIcons';
import {LoaderCircle} from 'lucide-react';
import type {AuthStatus, GameStoreDetails} from '../shared/types';
import type {CloudCollection, CloudProduct, CloudPublicCatalog, CloudStreamApi} from '../shared/cloud-library';
import type {CloudAccountCatalog} from '../shared/cloud-stream';
import {useReferenceLocale} from './ReferenceLocale';
import {useBackHandler} from './GamepadNavigation';
import {CloudRegionSettings} from './CloudRegionSettings';
import type {CloudLoginCountry} from '../shared/cloud-region';
import {sharedCloudProductLoader} from './cloud-product-loader';
import {CloudPlayAction} from './CloudPlayAction';
import './cloud-library.css';

type Bridge = Partial<CloudStreamApi> & {getCatalogDetails?: (id: string) => Promise<GameStoreDetails | undefined>};
const empty: CloudAccountCatalog = {status: 'signed-out', titles: [], recentProductIds: [], checkedAt: ''};
const closed = () => {};
export function cloudCollectionIds(catalog: CloudPublicCatalog, account: CloudAccountCatalog, collection: CloudCollection): string[] {
  const available = new Set(account.titles.map(title => title.productId));
  const source = catalog.collections[collection];
  return account.status === 'ready' ? source.filter(id => available.has(id)) : source;
}
export function CloudLibraryPage({bridge = typeof window === 'undefined' ? undefined : window.launcher, auth, signIn = closed, country = 'auto', saveCountry, query: controlledQuery, onQueryChange}: {
  bridge?: Bridge; auth?: AuthStatus; signIn?: () => void; country?: CloudLoginCountry; saveCountry?: (country: CloudLoginCountry) => Promise<unknown>; query?: string; onQueryChange?: (value: string) => void;
}) {
  const {text: t} = useReferenceLocale();
  const [catalog, setCatalog] = useState<CloudPublicCatalog>(), [accountSnapshot, setAccountSnapshot] = useState({revision: -1, value: empty});
  const [products, setProducts] = useState<Record<string, CloudProduct>>({}), [view, setView] = useState<'home' | 'all' | 'own'>('home');
  const [loading, setLoading] = useState(true), [loadingProducts, setLoadingProducts] = useState(false), [error, setError] = useState(''), [accountLoading, setAccountLoading] = useState(false);
  const [selected, setSelected] = useState<CloudProduct>(), [details, setDetails] = useState<GameStoreDetails>(), [launching, setLaunching] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [localQuery, setLocalQuery] = useState(''), [settledQuery, setSettledQuery] = useState(''), [sort, setSort] = useState('relevance'), [filters, setFilters] = useState(false), [input, setInput] = useState('all');
  const query = controlledQuery ?? localQuery, searchText = query.trim(), searching = Boolean(searchText), searchReady = settledQuery.length >= 2 && searchText.length >= 2;
  const setQuery = (value: string) => {if (controlledQuery === undefined) setLocalQuery(value); onQueryChange?.(value);};
  const [coverage, setCoverage] = useState({key: '', done: 0, total: 0, failed: false});
  const loader = useMemo(() => bridge?.getCloudProducts ? sharedCloudProductLoader(bridge, ids => bridge.getCloudProducts!(ids)) : undefined, [bridge]);
  const [limit, setLimit] = useState(60), [refresh, setRefresh] = useState(0);
  const generation = useRef(0), request = useRef<{epoch: number; productId: string}>(), origin = useRef<HTMLElement | null>(null), detailRoot = useRef<HTMLElement>(null);
  const accountKey = `${auth?.stored}:${auth?.username ?? ''}:${auth?.running}:${country}`;
  const identityKey = `${accountKey}:${refresh}`, accountScope = useRef({identity: identityKey, revision: 0});
  if (accountScope.current.identity !== identityKey) accountScope.current = {identity: identityKey, revision: accountScope.current.revision + 1};
  const account = accountSnapshot.revision === accountScope.current.revision ? accountSnapshot.value : empty;
  useEffect(() => {const timer = setTimeout(() => setSettledQuery(searchText), 250); return () => clearTimeout(timer);}, [searchText]);
  useEffect(() => {setSelected(undefined); setLimit(60);}, [searchText]);
  useEffect(() => {
    const epoch = ++generation.current, identity = accountScope.current.revision; request.current = undefined; setLaunching(false); setLoading(true); setError(''); setAccountSnapshot({revision: identity, value: empty}); setSelected(undefined); setAccountLoading(true);
    const current = () => generation.current === epoch;
    if (!bridge?.getCloudPublicCatalog) {setLoading(false); setAccountLoading(false); return;}
    void bridge.getCloudPublicCatalog(refresh > 0).then(value => {if (current()) setCatalog(value);}).catch(() => {if (current()) setError(t('The cloud catalog could not load. Try again.', 'Ο κατάλογος cloud δεν φορτώθηκε. Δοκιμάστε ξανά.'));}).finally(() => {if (current()) setLoading(false);});
    if (bridge.getCloudAccountCatalog) void bridge.getCloudAccountCatalog(refresh > 0).then(value => {if (current()) setAccountSnapshot({revision: identity, value});})
      .catch(() => {if (current()) setAccountSnapshot({revision: identity, value: {...empty, status: 'error'}});}).finally(() => {if (current()) setAccountLoading(false);});
    else setAccountLoading(false);
    return () => {generation.current++; request.current = undefined;};
  }, [bridge, accountKey, refresh]);
  const searchIds = catalog ? [...new Set(account.status === 'ready' ? account.titles.map(title => title.productId) : [...catalog.collections.all, ...catalog.collections.own])] : [];
  const catalogTooLarge = searching && searchIds.length > 5000;
  const ids = catalog ? searching ? searchIds.slice(0, 5000) : cloudCollectionIds(catalog, account, view === 'own' ? 'own' : 'all') : [];
  const recent = account.status === 'ready' ? account.recentProductIds : [];
  const rows: {key: CloudCollection | 'mru'; title: string; ids: string[]}[] = catalog ? [
    ...(recent.length ? [{key: 'mru' as const, title: t('Jump back in', 'Επιστροφή'), ids: recent}] : []),
    {key: 'popular' as const, title: t('Most popular on cloud', 'Δημοφιλή στο cloud'), ids: cloudCollectionIds(catalog, account, 'popular')},
    {key: 'recent' as const, title: t('Recently added', 'Προστέθηκαν πρόσφατα'), ids: cloudCollectionIds(catalog, account, 'recent')},
    {key: 'ea' as const, title: 'EA Play', ids: cloudCollectionIds(catalog, account, 'ea')},
    {key: 'own' as const, title: t('Stream your own game', 'Παίξτε τα δικά σας παιχνίδια στο cloud'), ids: cloudCollectionIds(catalog, account, 'own')},
  ].filter(row => row.ids.length) : [];
  const fullMetadata = searchReady || sort === 'name' || input !== 'all';
  const needed = searching ? searchReady ? ids : [] : view === 'home' ? [...new Set(rows.flatMap(row => row.ids.slice(0, 8)))] : fullMetadata ? ids : ids.slice(0, limit);
  const neededKey = needed.join(',');
  useEffect(() => {
    const controller = new AbortController(), epoch = generation.current, missing = needed.filter(id => !products[id]);
    let done = needed.length - missing.length, failed = false;
    const current = () => !controller.signal.aborted && epoch === generation.current;
    setCoverage({key: neededKey, done, total: needed.length, failed: false});
    if (!missing.length || !loader) {setLoadingProducts(false); return () => controller.abort();}
    setLoadingProducts(true);
    const batches = Array.from({length: Math.ceil(missing.length / 60)}, (_, index) => missing.slice(index * 60, index * 60 + 60));
    void Promise.all(batches.map(async batch => {
      try {
        const result = await loader.describe(batch, controller.signal);
        if (!current()) return;
        const accepted = result.filter(product => batch.includes(product.productId));
        if (new Set(accepted.map(product => product.productId)).size !== batch.length) failed = true;
        setProducts(previous => {
          const merged = {...previous, ...Object.fromEntries(accepted.map(product => [product.productId, product]))};
          if (Object.keys(merged).length <= 5000) return merged;
          const keep = [...new Set([...needed, ...Object.keys(merged).reverse()])].slice(0, 5000);
          return Object.fromEntries(keep.flatMap(id => merged[id] ? [[id, merged[id]]] : []));
        });
      } catch {if (current()) failed = true;}
      finally {if (current()) {done += batch.length; setCoverage({key: neededKey, done, total: needed.length, failed});}}
    })).finally(() => {if (current()) {setLoadingProducts(false); if (failed) setError(t('Some game details could not load. Refresh to try again.', 'Ορισμένες πληροφορίες δεν φορτώθηκαν. Ανανεώστε για νέα προσπάθεια.'));}});
    return () => controller.abort();
  }, [neededKey, loader, refresh, accountKey]);
  useEffect(() => {
    setDetails(undefined); setDetailsLoading(false); if (!selected || !bridge?.getCatalogDetails) return;
    setDetailsLoading(true);
    let active = true; void bridge.getCatalogDetails(selected.productId).then(value => {if (active && value?.productId === selected.productId) setDetails(value);}).catch(() => {}).finally(() => {if (active) setDetailsLoading(false);});
    return () => {active = false;};
  }, [selected?.productId, bridge]);
  useEffect(() => {if (selected) detailRoot.current?.querySelector<HTMLElement>('button')?.focus();}, [selected?.productId]);
  const dismiss = () => {setSelected(undefined); requestAnimationFrame(() => origin.current?.isConnected && origin.current.focus({preventScroll: true}));};
  useBackHandler(() => {if (selected) dismiss(); else if (searching) setQuery(''); else if (view !== 'home') setView('home'); else return false; return true;}, Boolean(selected) || searching || view !== 'home', selected ? () => detailRoot.current : undefined);
  const changeView = (value: typeof view) => {setView(value); setQuery(''); setInput('all'); setLimit(60); setFilters(false);};
  const tile = (id: string, index: number) => {
    const product = products[id];
    return product ? <button key={id} className="cloud-product" data-product-id={id} data-gamepad-initial={index === 0 || undefined} onClick={event => {origin.current = event.currentTarget; setSelected(product);}}>
      <div className="cloud-product-art">{product.posterUrl ? <img src={product.posterUrl} alt="" loading="lazy"/> : <Cloud/>}<Cloud className="cloud-product-cloud" size={17}/></div>
      <div><strong>{product.title}</strong><span>{product.publisher}</span><small>{t('Show details', 'Προβολή λεπτομερειών')}</small></div>
    </button> : <div key={id} className="cloud-product cloud-product-placeholder" aria-hidden="true"><div/><span/></div>;
  };
  const availableTitles = new Map(account.titles.map(title => [title.productId, title]));
  const matching = ids.filter(id => {
    const product = products[id], title = availableTitles.get(id);
    return (!searching || (searchReady && settledQuery === searchText && Boolean(product) && `${product!.title} ${product!.publisher ?? ''}`.toLocaleLowerCase().includes(settledQuery.toLocaleLowerCase()))) &&
      (input === 'all' || title?.supportedInputTypes.some(value => (input === 'gamepad' ? /gamepad|controller/i.test(value) : value.toLowerCase().includes(input))));
  }).sort((a, b) => sort === 'name' ? (products[a]?.title ?? a).localeCompare(products[b]?.title ?? b) : 0);
  const shown = matching.slice(0, limit);
  const complete = coverage.key === neededKey && coverage.done === coverage.total && !coverage.failed && !loadingProducts && !catalogTooLarge;
  const searchPending = searching && searchText.length >= 2 && !catalogTooLarge && (settledQuery !== searchText || !complete);
  const selectedTitle = selected ? availableTitles.get(selected.productId) ?? (details?.primaryProductId ? availableTitles.get(details.primaryProductId) : undefined) : undefined;
  async function play(productId: string) {
    if (!selected || auth?.stored !== true || auth.running || account.status !== 'ready' || accountLoading || !availableTitles.get(productId)?.hasEntitlement || !bridge?.startCloudStream || request.current) return;
    const owned = {epoch: generation.current, productId}; request.current = owned; setLaunching(true); setError('');
    try {await bridge.startCloudStream(productId);} catch {if (request.current === owned && owned.epoch === generation.current) setError(t('The cloud session could not start. Refresh your account and try again.', 'Η συνεδρία cloud δεν ξεκίνησε. Ανανεώστε τον λογαριασμό και δοκιμάστε ξανά.'));}
    finally {if (request.current === owned) {request.current = undefined; setLaunching(false);}}
  }
  return <main className="cloud-library-page" data-cloud-page={searching ? 'search' : view}>
    <header className="cloud-library-header"><div><h1>{searching ? t('Search cloud games', 'Αναζήτηση παιχνιδιών cloud') : view === 'own' ? t('Stream your own game', 'Παίξτε τα δικά σας παιχνίδια στο cloud') : view === 'all' ? t('All cloud games', 'Όλα τα παιχνίδια cloud') : t('Cloud Gaming', 'Cloud Gaming')}</h1>
      <p>{searching ? t(`Results for “${searchText}”`, `Αποτελέσματα για «${searchText}»`) : view === 'own' ? t('Buy and stream select games. A supported Game Pass plan and ownership may be required.', 'Αγοράστε και παίξτε επιλεγμένα παιχνίδια. Ενδέχεται να απαιτούνται υποστηριζόμενη συνδρομή Game Pass και κατοχή.') : t('Console games on your PC, streamed from Xbox.', 'Παιχνίδια κονσόλας στον υπολογιστή σας, μέσω streaming από το Xbox.')}</p></div>
      <div className="cloud-library-header-actions"><CloudRegionSettings value={country} save={saveCountry}/><button className="cloud-refresh" aria-label={t('Refresh cloud catalog', 'Ανανέωση καταλόγου cloud')} disabled={loading || accountLoading} onClick={() => setRefresh(value => value + 1)}><RefreshCw/></button></div></header>
    <nav className="cloud-library-tabs" aria-label={t('Cloud collections', 'Συλλογές cloud')} data-gamepad-section-tabs>
      {([['home', t('Discover', 'Ανακαλύψτε')], ['all', t('All games', 'Όλα τα παιχνίδια')], ['own', t('Stream your own game', 'Τα δικά σας παιχνίδια')]] as const).map(([value, label]) => <button key={value} role="tab" aria-selected={!searching && view === value} onClick={() => changeView(value)}>{label}</button>)}
    </nav>
    <div className="cloud-account-status" role="status"><Cloud size={18}/><span>{accountLoading ? t('Connecting your XBOKS account…', 'Σύνδεση του λογαριασμού XBOKS…') : account.status === 'ready' ? t('Ready to play with your XBOKS account', 'Έτοιμο για παιχνίδι με τον λογαριασμό XBOKS') : account.reasonCode === 'region-not-supported' ? t('Xbox Cloud Gaming is not available in your current country.', 'Το Xbox Cloud Gaming δεν είναι διαθέσιμο στην τρέχουσα χώρα σας.') : account.status === 'signed-out' ? t('Sign in to XBOKS to play', 'Συνδεθείτε στο XBOKS για να παίξετε') : t('Your cloud account could not connect. Refresh to try again.', 'Ο λογαριασμός cloud δεν συνδέθηκε. Ανανεώστε για νέα προσπάθεια.')}</span>
      {account.status === 'signed-out' && !accountLoading ? <button onClick={signIn}>{t('Sign in', 'Σύνδεση')}</button> : null}</div>
    {error ? <p className="cloud-library-error" role="alert">{error}<button onClick={() => setRefresh(value => value + 1)}>{t('Retry', 'Νέα προσπάθεια')}</button></p> : null}
    {loading ? <div className="cloud-library-loading" role="status"><LoaderCircle className="spin"/>{t('Loading cloud games…', 'Φόρτωση παιχνιδιών cloud…')}</div> : null}
    {!loading && !catalog ? <p>{t('The cloud catalog requires the desktop XBOKS application and an internet connection.', 'Ο κατάλογος cloud απαιτεί την εφαρμογή XBOKS και σύνδεση στο internet.')}</p> : null}
    {catalog && view === 'home' && !searching ? <><section className="cloud-library-banner"><div><h2>{t('Play your next favorite game', 'Παίξτε το επόμενο αγαπημένο σας παιχνίδι')}</h2><p>{t('Discover cloud games and the games you can stream from your own collection.', 'Ανακαλύψτε παιχνίδια cloud και τίτλους που μπορείτε να παίξετε από τη συλλογή σας.')}</p><button onClick={() => changeView('all')}>{t('Browse all games', 'Όλα τα παιχνίδια')}</button></div><Cloud size={124}/></section>
      {rows.map(row => <section key={row.key} className={`cloud-game-row cloud-game-row-${row.key}`}><header><h2>{row.title}</h2>{row.key === 'own' ? <button onClick={() => changeView('own')}>{t('See all', 'Προβολή όλων')}</button> : null}</header><div className="cloud-row-cards">{row.ids.slice(0, 8).map(tile)}</div></section>)}</> : null}
    {catalog && (view !== 'home' || searching) ? <><div className="cloud-library-controls"><label>{t('Sort by:', 'Ταξινόμηση:')} <select value={sort} onChange={event => setSort(event.target.value)}><option value="relevance">{t('Relevance', 'Συνάφεια')}</option><option value="name">{t('Name (A–Z)', 'Όνομα (Α–Ω)')}</option></select></label><span>{searching || input !== 'all' ? matching.length : ids.length} {t('games', 'παιχνίδια')}</span><button aria-expanded={filters} onClick={() => setFilters(value => !value)}>{t('Filters', 'Φίλτρα')}</button></div>
      {filters ? <div className="cloud-library-filters"><label><Search size={18}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder={t('Search cloud games', 'Αναζήτηση παιχνιδιών cloud')}/></label><label>{t('Input', 'Χειρισμός')}<select value={input} onChange={event => setInput(event.target.value)} disabled={account.status !== 'ready'}><option value="all">{t('All', 'Όλα')}</option><option value="gamepad">{t('Controller', 'Χειριστήριο')}</option><option value="touch">{t('Touch', 'Αφή')}</option></select></label></div> : null}
      {searching && searchText.length < 2 ? <p className="cloud-search-progress" role="status">{t('Type at least two characters to search cloud games.', 'Πληκτρολογήστε τουλάχιστον δύο χαρακτήρες για αναζήτηση παιχνιδιών cloud.')}</p> : null}
      {searchPending && !coverage.failed ? <p className="cloud-search-progress" role="status"><LoaderCircle className="spin"/>{t('Searching the cloud catalog…', 'Αναζήτηση στον κατάλογο cloud…')} {coverage.key === neededKey && coverage.total ? `${coverage.done} / ${coverage.total}` : ''}</p> : null}
      {catalogTooLarge ? <p className="cloud-library-error" role="alert">{t('The cloud catalog is too large to search completely. Refresh and try again.', 'Ο κατάλογος cloud είναι πολύ μεγάλος για πλήρη αναζήτηση. Ανανεώστε και δοκιμάστε ξανά.')}</p> : null}
      <div className="cloud-library-grid">{shown.map(tile)}</div>{!shown.length && !loading && !loadingProducts && complete && (!searching || (searchText.length >= 2 && settledQuery === searchText)) ? <p className="cloud-search-empty" role="status">{t('No games match these filters.', 'Δεν βρέθηκαν παιχνίδια με αυτά τα φίλτρα.')}</p> : null}
      <footer className="cloud-library-more"><span>{Math.min(limit, matching.length)} / {matching.length} {t('games shown', 'παιχνίδια εμφανίζονται')}</span>{limit < matching.length ? <button disabled={loadingProducts} onClick={() => setLimit(value => value + 60)}>{loadingProducts ? t('Loading…', 'Φόρτωση…') : t('Load more', 'Περισσότερα')}</button> : null}</footer></> : null}
    {selected ? <section className="cloud-product-detail" role="dialog" aria-modal="true" aria-label={selected.title} ref={detailRoot} data-gamepad-detail={selected.productId} onKeyDown={event => {
        if (event.key !== 'Tab') return;
        const controls = [...detailRoot.current!.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,[tabindex="0"]')].filter(node => node.getClientRects().length);
        if (event.shiftKey && document.activeElement === controls[0]) {event.preventDefault(); controls.at(-1)?.focus();}
        else if (!event.shiftKey && document.activeElement === controls.at(-1)) {event.preventDefault(); controls[0]?.focus();}
      }}>
      <button className="cloud-detail-back" data-gamepad-initial data-gamepad-cancel onClick={dismiss}><ArrowLeft/>{t('Back', 'Πίσω')}</button><div className="cloud-detail-hero" style={(details?.heroUrl ?? selected.heroUrl) ? {backgroundImage: `linear-gradient(90deg,#191b1d 0%,#191b1d88 70%),url(${JSON.stringify(details?.heroUrl ?? selected.heroUrl)})`} : undefined}>
        <div><p className="cloud-detail-label"><Cloud/> XBOX CLOUD GAMING</p><h1>{selected.title}</h1><p>{selected.publisher}</p><div className="cloud-detail-actions"><CloudPlayAction productId={selected.productId} primaryProductId={details?.primaryProductId} auth={auth} country={country} account={account} accountLoading={accountLoading} disabled={launching} bridge={bridge} onPlay={play}/>{account.status !== 'ready' ? <button onClick={() => setRefresh(value => value + 1)}><RefreshCw/>{t('Reconnect account', 'Επανασύνδεση λογαριασμού')}</button> : null}</div>
          <p className="cloud-detail-requirements">{selectedTitle?.hasEntitlement === false ? t('This account does not have access to this cloud title.', 'Αυτός ο λογαριασμός δεν έχει πρόσβαση σε αυτόν τον τίτλο cloud.') : !selectedTitle ? t('Cloud access has not been confirmed for this account.', 'Δεν έχει επιβεβαιωθεί πρόσβαση cloud για αυτόν τον λογαριασμό.') : t('Availability depends on your account, region, plan and game license.', 'Η διαθεσιμότητα εξαρτάται από λογαριασμό, περιοχή, συνδρομή και άδεια παιχνιδιού.')}</p></div>
        {selected.posterUrl ? <img src={selected.posterUrl} alt=""/> : null}</div>
      <section className="cloud-detail-description"><h2>{t('Description', 'Περιγραφή')}</h2><p>{details?.description || selected.description || (detailsLoading ? t('Loading game details…', 'Φόρτωση πληροφοριών παιχνιδιού…') : t('A description is not available for this game.', 'Δεν διατίθεται περιγραφή για αυτό το παιχνίδι.'))}</p><p>{(details?.categories ?? selected.categories).join(' · ')}</p>{details?.screenshots.length ? <div className="cloud-detail-screenshots">{details.screenshots.map(url => <img key={url} src={url} alt={t('Game screenshot', 'Στιγμιότυπο παιχνιδιού')} loading="lazy"/>)}</div> : null}</section>
      {error ? <p className="cloud-library-error" role="alert">{error}</p> : null}</section> : null}
  </main>;
}
