import {useEffect, useRef, useState} from 'react';
import {ArrowLeft, Cloud, Play, RefreshCw, Search} from './XboxIcons';
import {LoaderCircle} from 'lucide-react';
import type {AuthStatus, GameStoreDetails} from '../shared/types';
import type {CloudCollection, CloudProduct, CloudPublicCatalog, CloudStreamApi} from '../shared/cloud-library';
import type {CloudAccountCatalog} from '../shared/cloud-stream';
import {useReferenceLocale} from './ReferenceLocale';
import {useBackHandler} from './GamepadNavigation';
import {CloudRegionSettings} from './CloudRegionSettings';
import type {CloudLoginCountry} from '../shared/cloud-region';
import './cloud-library.css';

type Bridge = Partial<CloudStreamApi> & {getCatalogDetails?: (id: string) => Promise<GameStoreDetails | undefined>};
const empty: CloudAccountCatalog = {status: 'signed-out', titles: [], recentProductIds: [], checkedAt: ''};
const closed = () => {};
export function cloudCollectionIds(catalog: CloudPublicCatalog, account: CloudAccountCatalog, collection: CloudCollection): string[] {
  const available = new Set(account.titles.map(title => title.productId));
  const source = catalog.collections[collection];
  return account.status === 'ready' ? source.filter(id => available.has(id)) : source;
}
export function CloudLibraryPage({bridge = typeof window === 'undefined' ? undefined : window.launcher, auth, signIn = closed, country = 'auto', saveCountry}: {
  bridge?: Bridge; auth?: AuthStatus; signIn?: () => void; country?: CloudLoginCountry; saveCountry?: (country: CloudLoginCountry) => Promise<unknown>;
}) {
  const {text: t} = useReferenceLocale();
  const [catalog, setCatalog] = useState<CloudPublicCatalog>(), [account, setAccount] = useState(empty);
  const [products, setProducts] = useState<Record<string, CloudProduct>>({}), [view, setView] = useState<'home' | 'all' | 'own'>('home');
  const [loading, setLoading] = useState(true), [loadingProducts, setLoadingProducts] = useState(false), [error, setError] = useState(''), [accountLoading, setAccountLoading] = useState(false);
  const [selected, setSelected] = useState<CloudProduct>(), [details, setDetails] = useState<GameStoreDetails>(), [launching, setLaunching] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [query, setQuery] = useState(''), [sort, setSort] = useState('relevance'), [filters, setFilters] = useState(false), [input, setInput] = useState('all');
  const [limit, setLimit] = useState(60), [refresh, setRefresh] = useState(0);
  const generation = useRef(0), request = useRef(false), origin = useRef<HTMLElement | null>(null), detailRoot = useRef<HTMLElement>(null);
  const accountKey = `${auth?.stored}:${auth?.username ?? ''}:${auth?.running}:${country}`;
  useEffect(() => {
    const epoch = ++generation.current; setLoading(true); setError(''); setAccount(empty); setSelected(undefined); setAccountLoading(true);
    const current = () => generation.current === epoch;
    if (!bridge?.getCloudPublicCatalog) {setLoading(false); setAccountLoading(false); return;}
    void bridge.getCloudPublicCatalog(refresh > 0).then(value => {if (current()) setCatalog(value);}).catch(() => {if (current()) setError(t('The cloud catalog could not load. Try again.', 'Ο κατάλογος cloud δεν φορτώθηκε. Δοκιμάστε ξανά.'));}).finally(() => {if (current()) setLoading(false);});
    if (bridge.getCloudAccountCatalog) void bridge.getCloudAccountCatalog(refresh > 0).then(value => {if (current()) setAccount(value);})
      .catch(() => {if (current()) setAccount({...empty, status: 'error'});}).finally(() => {if (current()) setAccountLoading(false);});
    else setAccountLoading(false);
    return () => {generation.current++;};
  }, [bridge, accountKey, refresh]);
  const ids = catalog ? cloudCollectionIds(catalog, account, view === 'own' ? 'own' : 'all') : [];
  const recent = account.status === 'ready' ? account.recentProductIds : [];
  const rows: {key: CloudCollection | 'mru'; title: string; ids: string[]}[] = catalog ? [
    ...(recent.length ? [{key: 'mru' as const, title: t('Jump back in', 'Επιστροφή'), ids: recent}] : []),
    {key: 'popular' as const, title: t('Most popular on cloud', 'Δημοφιλή στο cloud'), ids: cloudCollectionIds(catalog, account, 'popular')},
    {key: 'recent' as const, title: t('Recently added', 'Προστέθηκαν πρόσφατα'), ids: cloudCollectionIds(catalog, account, 'recent')},
    {key: 'ea' as const, title: 'EA Play', ids: cloudCollectionIds(catalog, account, 'ea')},
    {key: 'own' as const, title: t('Stream your own game', 'Παίξτε τα δικά σας παιχνίδια στο cloud'), ids: cloudCollectionIds(catalog, account, 'own')},
  ].filter(row => row.ids.length) : [];
  const needed = view === 'home' ? [...new Set(rows.flatMap(row => row.ids.slice(0, 8)))] : ids.slice(0, limit);
  const neededKey = needed.join(',');
  useEffect(() => {
    if (!bridge?.getCloudProducts) return;
    const epoch = generation.current, missing = needed.filter(id => !products[id]); let cancelled = false;
    if (!missing.length) {setLoadingProducts(false); return;} setLoadingProducts(true);
    void (async () => {for (let offset = 0; offset < missing.length; offset += 60) {
      if (cancelled || epoch !== generation.current) break;
      const result = await bridge.getCloudProducts!(missing.slice(offset, offset + 60));
      if (!cancelled && epoch === generation.current) setProducts(previous => ({...previous, ...Object.fromEntries(result.map(product => [product.productId, product]))}));
    }})().catch(() => {if (!cancelled) setError(t('Some game details could not load. Refresh to try again.', 'Ορισμένες πληροφορίες δεν φορτώθηκαν. Ανανεώστε για νέα προσπάθεια.'));})
      .finally(() => {if (!cancelled) setLoadingProducts(false);});
    return () => {cancelled = true;};
  }, [neededKey, bridge, refresh, accountKey]);
  useEffect(() => {
    setDetails(undefined); setDetailsLoading(false); if (!selected || !bridge?.getCatalogDetails) return;
    setDetailsLoading(true);
    let active = true; void bridge.getCatalogDetails(selected.productId).then(value => {if (active && value?.productId === selected.productId) setDetails(value);}).catch(() => {}).finally(() => {if (active) setDetailsLoading(false);});
    return () => {active = false;};
  }, [selected?.productId, bridge]);
  useEffect(() => {if (selected) detailRoot.current?.querySelector<HTMLElement>('button')?.focus();}, [selected?.productId]);
  const dismiss = () => {setSelected(undefined); requestAnimationFrame(() => origin.current?.isConnected && origin.current.focus({preventScroll: true}));};
  useBackHandler(() => {if (selected) dismiss(); else if (view !== 'home') setView('home'); else return false; return true;}, Boolean(selected) || view !== 'home', selected ? () => detailRoot.current : undefined);
  const changeView = (value: typeof view) => {setView(value); setQuery(''); setInput('all'); setLimit(60); setFilters(false);};
  const tile = (id: string, index: number) => {
    const product = products[id];
    return product ? <button key={id} className="cloud-product" data-product-id={id} data-gamepad-initial={index === 0 || undefined} onClick={event => {origin.current = event.currentTarget; setSelected(product);}}>
      <div className="cloud-product-art">{product.posterUrl ? <img src={product.posterUrl} alt="" loading="lazy"/> : <Cloud/>}<Cloud className="cloud-product-cloud" size={17}/></div>
      <div><strong>{product.title}</strong><span>{product.publisher}</span><small>{t('Show details', 'Προβολή λεπτομερειών')}</small></div>
    </button> : <div key={id} className="cloud-product cloud-product-placeholder" aria-hidden="true"><div/><span/></div>;
  };
  const availableTitles = new Map(account.titles.map(title => [title.productId, title]));
  const shown = ids.slice(0, limit).filter(id => {
    const product = products[id], title = availableTitles.get(id);
    return (!query || `${product?.title ?? ''} ${product?.publisher ?? ''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())) &&
      (input === 'all' || title?.supportedInputTypes.some(value => (input === 'gamepad' ? /gamepad|controller/i.test(value) : value.toLowerCase().includes(input))));
  }).sort((a, b) => sort === 'name' ? (products[a]?.title ?? a).localeCompare(products[b]?.title ?? b) : 0);
  const selectedTitle = selected ? availableTitles.get(selected.productId) : undefined;
  const canPlay = account.status === 'ready' && selectedTitle && selectedTitle.hasEntitlement !== false && Boolean(bridge?.startCloudStream);
  async function play() {
    if (!selected || !canPlay || request.current) return; request.current = true; setLaunching(true); setError('');
    try {await bridge!.startCloudStream!(selected.productId);} catch {setError(t('The cloud session could not start. Refresh your account and try again.', 'Η συνεδρία cloud δεν ξεκίνησε. Ανανεώστε τον λογαριασμό και δοκιμάστε ξανά.'));}
    finally {request.current = false; setLaunching(false);}
  }
  return <main className="cloud-library-page" data-cloud-page={view}>
    <header className="cloud-library-header"><div><h1>{view === 'own' ? t('Stream your own game', 'Παίξτε τα δικά σας παιχνίδια στο cloud') : view === 'all' ? t('All cloud games', 'Όλα τα παιχνίδια cloud') : t('Cloud Gaming', 'Cloud Gaming')}</h1>
      <p>{view === 'own' ? t('Buy and stream select games. A supported Game Pass plan and ownership may be required.', 'Αγοράστε και παίξτε επιλεγμένα παιχνίδια. Ενδέχεται να απαιτούνται υποστηριζόμενη συνδρομή Game Pass και κατοχή.') : t('Console games on your PC, streamed from Xbox.', 'Παιχνίδια κονσόλας στον υπολογιστή σας, μέσω streaming από το Xbox.')}</p></div>
      <div className="cloud-library-header-actions"><CloudRegionSettings value={country} save={saveCountry}/><button className="cloud-refresh" aria-label={t('Refresh cloud catalog', 'Ανανέωση καταλόγου cloud')} disabled={loading || accountLoading} onClick={() => setRefresh(value => value + 1)}><RefreshCw/></button></div></header>
    <nav className="cloud-library-tabs" aria-label={t('Cloud collections', 'Συλλογές cloud')} data-gamepad-section-tabs>
      {([['home', t('Discover', 'Ανακαλύψτε')], ['all', t('All games', 'Όλα τα παιχνίδια')], ['own', t('Stream your own game', 'Τα δικά σας παιχνίδια')]] as const).map(([value, label]) => <button key={value} role="tab" aria-selected={view === value} onClick={() => changeView(value)}>{label}</button>)}
    </nav>
    <div className="cloud-account-status" role="status"><Cloud size={18}/><span>{accountLoading ? t('Connecting your XBOKS account…', 'Σύνδεση του λογαριασμού XBOKS…') : account.status === 'ready' ? t('Ready to play with your XBOKS account', 'Έτοιμο για παιχνίδι με τον λογαριασμό XBOKS') : account.reasonCode === 'region-not-supported' ? t('Xbox Cloud Gaming is not available in your current country.', 'Το Xbox Cloud Gaming δεν είναι διαθέσιμο στην τρέχουσα χώρα σας.') : account.status === 'signed-out' ? t('Sign in to XBOKS to play', 'Συνδεθείτε στο XBOKS για να παίξετε') : t('Your cloud account could not connect. Refresh to try again.', 'Ο λογαριασμός cloud δεν συνδέθηκε. Ανανεώστε για νέα προσπάθεια.')}</span>
      {account.status === 'signed-out' && !accountLoading ? <button onClick={signIn}>{t('Sign in', 'Σύνδεση')}</button> : null}</div>
    {error ? <p className="cloud-library-error" role="alert">{error}<button onClick={() => setRefresh(value => value + 1)}>{t('Retry', 'Νέα προσπάθεια')}</button></p> : null}
    {loading ? <div className="cloud-library-loading" role="status"><LoaderCircle className="spin"/>{t('Loading cloud games…', 'Φόρτωση παιχνιδιών cloud…')}</div> : null}
    {!loading && !catalog ? <p>{t('The cloud catalog requires the desktop XBOKS application and an internet connection.', 'Ο κατάλογος cloud απαιτεί την εφαρμογή XBOKS και σύνδεση στο internet.')}</p> : null}
    {catalog && view === 'home' ? <><section className="cloud-library-banner"><div><h2>{t('Play your next favorite game', 'Παίξτε το επόμενο αγαπημένο σας παιχνίδι')}</h2><p>{t('Discover cloud games and the games you can stream from your own collection.', 'Ανακαλύψτε παιχνίδια cloud και τίτλους που μπορείτε να παίξετε από τη συλλογή σας.')}</p><button onClick={() => changeView('all')}>{t('Browse all games', 'Όλα τα παιχνίδια')}</button></div><Cloud size={124}/></section>
      {rows.map(row => <section key={row.key} className={`cloud-game-row cloud-game-row-${row.key}`}><header><h2>{row.title}</h2>{row.key === 'own' ? <button onClick={() => changeView('own')}>{t('See all', 'Προβολή όλων')}</button> : null}</header><div className="cloud-row-cards">{row.ids.slice(0, 8).map(tile)}</div></section>)}</> : null}
    {catalog && view !== 'home' ? <><div className="cloud-library-controls"><label>{t('Sort by:', 'Ταξινόμηση:')} <select value={sort} onChange={event => setSort(event.target.value)}><option value="relevance">{t('Relevance', 'Συνάφεια')}</option><option value="name">{t('Loaded games A–Z', 'Φορτωμένα παιχνίδια Α–Ω')}</option></select></label><span>{ids.length} {t('games', 'παιχνίδια')}</span><button aria-expanded={filters} onClick={() => setFilters(value => !value)}>{t('Filters', 'Φίλτρα')}</button></div>
      {filters ? <div className="cloud-library-filters"><label><Search size={18}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder={t('Search loaded games', 'Αναζήτηση φορτωμένων παιχνιδιών')}/></label><label>{t('Input', 'Χειρισμός')}<select value={input} onChange={event => setInput(event.target.value)} disabled={account.status !== 'ready'}><option value="all">{t('All', 'Όλα')}</option><option value="gamepad">{t('Controller', 'Χειριστήριο')}</option><option value="touch">{t('Touch', 'Αφή')}</option></select></label></div> : null}
      <div className="cloud-library-grid">{shown.map(tile)}</div>{!shown.length ? <p role="status">{t('No games match these filters.', 'Δεν βρέθηκαν παιχνίδια με αυτά τα φίλτρα.')}</p> : null}
      <footer className="cloud-library-more"><span>{Math.min(limit, ids.length)} / {ids.length} {t('catalog entries loaded', 'εγγραφές καταλόγου φορτώθηκαν')}</span>{limit < ids.length ? <button disabled={loadingProducts} onClick={() => setLimit(value => value + 60)}>{loadingProducts ? t('Loading…', 'Φόρτωση…') : t('Load more', 'Περισσότερα')}</button> : null}</footer></> : null}
    {selected ? <section className="cloud-product-detail" role="dialog" aria-modal="true" aria-label={selected.title} ref={detailRoot} data-gamepad-detail={selected.productId} onKeyDown={event => {
        if (event.key !== 'Tab') return;
        const controls = [...detailRoot.current!.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,[tabindex="0"]')].filter(node => node.getClientRects().length);
        if (event.shiftKey && document.activeElement === controls[0]) {event.preventDefault(); controls.at(-1)?.focus();}
        else if (!event.shiftKey && document.activeElement === controls.at(-1)) {event.preventDefault(); controls[0]?.focus();}
      }}>
      <button className="cloud-detail-back" data-gamepad-initial data-gamepad-cancel onClick={dismiss}><ArrowLeft/>{t('Back', 'Πίσω')}</button><div className="cloud-detail-hero" style={(details?.heroUrl ?? selected.heroUrl) ? {backgroundImage: `linear-gradient(90deg,#191b1d 0%,#191b1d88 70%),url(${JSON.stringify(details?.heroUrl ?? selected.heroUrl)})`} : undefined}>
        <div><p className="cloud-detail-label"><Cloud/> XBOX CLOUD GAMING</p><h1>{selected.title}</h1><p>{selected.publisher}</p><div className="cloud-detail-actions"><button className="primary" disabled={!canPlay || launching || accountLoading} onClick={() => void play()}><Play/>{launching ? t('Starting…', 'Εκκίνηση…') : t('Play', 'Παίξτε')}</button>{account.status !== 'ready' ? <button onClick={() => setRefresh(value => value + 1)}><RefreshCw/>{t('Reconnect account', 'Επανασύνδεση λογαριασμού')}</button> : null}</div>
          <p className="cloud-detail-requirements">{selectedTitle?.hasEntitlement === false ? t('This account does not have access to this cloud title.', 'Αυτός ο λογαριασμός δεν έχει πρόσβαση σε αυτόν τον τίτλο cloud.') : !selectedTitle ? t('Cloud access has not been confirmed for this account.', 'Δεν έχει επιβεβαιωθεί πρόσβαση cloud για αυτόν τον λογαριασμό.') : t('Availability depends on your account, region, plan and game license.', 'Η διαθεσιμότητα εξαρτάται από λογαριασμό, περιοχή, συνδρομή και άδεια παιχνιδιού.')}</p></div>
        {selected.posterUrl ? <img src={selected.posterUrl} alt=""/> : null}</div>
      <section className="cloud-detail-description"><h2>{t('Description', 'Περιγραφή')}</h2><p>{details?.description || selected.description || (detailsLoading ? t('Loading game details…', 'Φόρτωση πληροφοριών παιχνιδιού…') : t('A description is not available for this game.', 'Δεν διατίθεται περιγραφή για αυτό το παιχνίδι.'))}</p><p>{(details?.categories ?? selected.categories).join(' · ')}</p>{details?.screenshots.length ? <div className="cloud-detail-screenshots">{details.screenshots.map(url => <img key={url} src={url} alt={t('Game screenshot', 'Στιγμιότυπο παιχνιδιού')} loading="lazy"/>)}</div> : null}</section>
      {error ? <p className="cloud-library-error" role="alert">{error}</p> : null}</section> : null}
  </main>;
}
