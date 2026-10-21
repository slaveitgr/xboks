import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { AppSnapshot, CatalogProduct, DownloadTask, GameStoreDetails } from '../shared/types';
import {CloudPlayAction} from './CloudPlayAction';
import { ArrowLeft, Download, ExternalLink, Heart, Info, MoreHorizontal, RefreshCw } from './XboxIcons';
import { Gallery } from './GameDetails';
import { GamePassIcon } from './XboxShell';
import { useReferenceLocale } from './ReferenceLocale';
import { useBackHandler } from './GamepadNavigation';
import { ReferenceMenu } from './ReferenceMenu';
import './catalog-details.css';
import { HandheldCompatibilityEntry, HandheldCompatibilityDialog } from './HandheldCompatibility';

export function CatalogDetails({ product, back, install, busy, installed, queued, canInstall, openInstalled, operation, openQueue, data }: {
  product: CatalogProduct; back: () => void; install: () => void; busy: boolean;
  installed: boolean; queued: boolean; canInstall: boolean; openInstalled: () => void;
  operation?: DownloadTask; openQueue?: () => void;
  data?: AppSnapshot;
}) {
  const { text } = useReferenceLocale();
  const [details, setDetails] = useState<GameStoreDetails>();
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [tab, setTab] = useState<'details' | 'reviews' | 'more'>('details');
  const [gallery, setGallery] = useState<number>();
  const [menu, setMenu] = useState<HTMLElement>();
  const [handheld, setHandheld] = useState(false);
  const root = useRef<HTMLElement>(null);
  useBackHandler(() => { back(); return true; }, !menu && gallery === undefined && !handheld);
  useEffect(() => {
    let live = true;
    setDetails(undefined); setLoading(true); setFailed(false); setGallery(undefined); setTab('details'); setMenu(undefined); setHandheld(false);
    window.launcher.getCatalogDetails(product.productId).then(value => {
      if (live) { setDetails(value); setFailed(!value); }
    }).catch(() => { if (live) setFailed(true); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [product.productId, attempt]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== 'Escape' || menu || gallery !== undefined || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      event.preventDefault(); back();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [back, menu, gallery]);
  const artwork = details?.heroUrl ?? product.heroUrl ?? product.posterUrl;
  const description = details?.description || product.description;
  const screenshots = details?.screenshots ?? [];
  const storeUrl = product.storeUrl ?? `https://www.microsoft.com/store/productId/${encodeURIComponent(product.productId)}`;
  const currentOperation = operation && !['complete', 'cancelled'].includes(operation.status) ? operation : undefined;
  const hasProgress = Boolean(currentOperation && openQueue);
  const title = details?.title || product.title;
  return <main ref={root} className="catalog-details-page" data-gamepad-detail={product.productId} data-product-id={product.productId} aria-busy={loading} style={artwork ? { '--catalog-art': `url(${JSON.stringify(artwork)})` } as CSSProperties : undefined}>
    <button className="sr-only catalog-detail-back" data-gamepad-detail-back onClick={back} aria-label={text('Back to previous page', 'Επιστροφή στην προηγούμενη σελίδα')}><ArrowLeft />{text('Back', 'Πίσω')}</button>
    <section className="catalog-detail-hero">
      <div className="catalog-detail-summary">
        {product.includedWith?.toLowerCase().includes('game pass') ? <GamePassIcon wordmark /> : null}
        <h1>{title}</h1>
        <HandheldCompatibilityEntry value={details?.handheldCompatibility ?? product.handheldCompatibility} open={() => setHandheld(true)} />
        <p className="catalog-detail-description">{description.split(/\r?\n/)[0]}</p>
        <div className="catalog-detail-purchase">
          {product.includedWith ? <span>{product.includedWith}</span> : null}
          <div className="catalog-detail-actions">
            <button className={`primary${currentOperation?.status === 'failed' ? ' catalog-install-error' : ''}`} disabled={busy || (!installed && !hasProgress && (queued || !canInstall))}
              onClick={installed ? openInstalled : hasProgress ? openQueue : install}>
              <Download /><span>{installed ? text('View in library', 'Προβολή στη βιβλιοθήκη') : hasProgress ? <>{currentOperation?.status === 'failed' ? text('Error', 'Σφάλμα') : text('Installing', 'Εγκατάσταση')}{currentOperation?.progress !== null ? ` ${Math.round(currentOperation?.progress ?? 0)}%` : ''}<small>{text('View progress', 'Προβολή προόδου')}</small></> : queued ? text('In Install Queue', 'Στην ουρά εγκατάστασης') : busy ? text('Preparing…', 'Προετοιμασία…') : text('Install', 'Εγκατάσταση')}</span>
            </button>
            <CloudPlayAction productId={product.productId} primaryProductId={(details?.productId === product.productId ? details.primaryProductId : undefined) ?? product.primaryProductId}
              auth={data?.auth} country={data?.settings.cloudLoginCountry} market={data?.settings.market} identity={data?.backend.binaryPath} disabled={busy}/>
            {product.purchasePrice ? <a className="secondary catalog-buy-link" href={storeUrl} target="_blank" rel="noreferrer">{product.purchasePrice}<ExternalLink /></a> : null}
            <button className="secondary catalog-wishlist" disabled title={text('Wishlist service is unavailable', 'Η υπηρεσία λίστας επιθυμιών δεν είναι διαθέσιμη')} aria-label={text('Add to wishlist', 'Προσθήκη στη λίστα επιθυμιών')}><Heart /></button>
            <button className="secondary" aria-label={text('Game options', 'Επιλογές παιχνιδιού')} aria-haspopup="menu" aria-expanded={Boolean(menu)} onClick={event => setMenu(menu ? undefined : event.currentTarget)}><MoreHorizontal /></button>
          </div>
        </div>
      </div>
      <div className="catalog-detail-media">
        {artwork ? <img className="catalog-detail-art" src={artwork} alt={title} /> : <div className="catalog-art-skeleton" aria-hidden="true" />}
        <div className="catalog-detail-thumbnails">{screenshots.length ? screenshots.slice(0, 6).map((url, index) => <button key={url} aria-label={`${text('Open screenshot', 'Άνοιγμα στιγμιότυπου')} ${index + 1}`} onClick={() => setGallery(index)}><img src={url} alt="" /></button>) : loading ? Array.from({ length: 6 }, (_, index) => <span className="catalog-thumbnail-skeleton" key={index} />) : null}</div>
      </div>
    </section>
    <section className="catalog-detail-publisher" aria-label={text('Game information', 'Πληροφορίες παιχνιδιού')}>
      <div><strong>{details?.publisher ?? product.publisher ?? text('Publisher unavailable', 'Ο εκδότης δεν είναι διαθέσιμος')}</strong>{(details?.categories ?? product.categories).length ? <span>{(details?.categories ?? product.categories).join(' · ')}</span> : null}</div>
      <div><p>{text('Installation requires a valid license for the selected game and a compatible PC package.', 'Η εγκατάσταση απαιτεί έγκυρη άδεια χρήσης του παιχνιδιού και συμβατό πακέτο υπολογιστή.')}</p><a href={storeUrl} target="_blank" rel="noreferrer">{text('Learn more', 'Μάθετε περισσότερα')}<ExternalLink /></a></div>
    </section>
    <div className="catalog-detail-tabs" data-gamepad-section-tabs role="tablist" aria-label={text('Game information', 'Πληροφορίες παιχνιδιού')}>{(['details', 'reviews', 'more'] as const).map((value, index, values) => <button key={value} role="tab" id={`catalog-tab-${value}`} aria-controls={`catalog-panel-${value}`} aria-selected={tab === value} tabIndex={tab === value ? 0 : -1} onClick={() => setTab(value)} onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? values.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + values.length) % values.length;
      setTab(values[next]); requestAnimationFrame(() => document.getElementById(`catalog-tab-${values[next]}`)?.focus());
    }}>{value === 'details' ? text('Details', 'Λεπτομέρειες') : value === 'reviews' ? text('Reviews', 'Κριτικές') : text('More', 'Περισσότερα')}</button>)}</div>
    <section className="catalog-detail-body" id={`catalog-panel-${tab}`} role="tabpanel" aria-labelledby={`catalog-tab-${tab}`}>
      {loading ? <div className="catalog-body-skeleton" role="status"><span className="sr-only">{text('Loading game information…', 'Φόρτωση πληροφοριών παιχνιδιού…')}</span><div /><div /></div> : null}
      {failed ? <p role="alert">{text('Game information could not be loaded.', 'Δεν ήταν δυνατή η φόρτωση των πληροφοριών παιχνιδιού.')} <button className="secondary" onClick={() => setAttempt(value => value + 1)}><RefreshCw />{text('Retry', 'Επανάληψη')}</button></p> : null}
      {tab === 'details' && !loading ? <><article><h2>{text('Description', 'Περιγραφή')}</h2><p>{description || text('No description was returned for this product.', 'Δεν επιστράφηκε περιγραφή για αυτό το προϊόν.')}</p></article><article><h2>{text('Additional information', 'Πρόσθετες πληροφορίες')}</h2><dl><dt>{text('Published by', 'Δημοσίευση από')}</dt><dd>{details?.publisher ?? product.publisher ?? '—'}</dd><dt>{text('Release date', 'Ημερομηνία κυκλοφορίας')}</dt><dd>{details?.releaseDate ?? product.releaseDate ?? '—'}</dd></dl></article></> : tab === 'reviews' ? <article><h2>{text('Reviews', 'Κριτικές')}</h2><p>{text('Reviews are not returned by the connected catalog service.', 'Η συνδεδεμένη υπηρεσία καταλόγου δεν επιστρέφει κριτικές.')}</p><a href={storeUrl} target="_blank" rel="noreferrer">{text('View on Microsoft Store', 'Προβολή στο Microsoft Store')}<ExternalLink /></a></article> : tab === 'more' ? <article><h2>{text('Additional information', 'Πρόσθετες πληροφορίες')}</h2><p>{product.supportNote}</p><dl><dt>Product ID</dt><dd>{product.productId}</dd><dt>{text('Categories', 'Κατηγορίες')}</dt><dd>{(details?.categories ?? product.categories).join(' · ') || '—'}</dd></dl></article> : null}
    </section>
    {menu ? <ReferenceMenu id="catalog-product-options" label={text('Game options', 'Επιλογές παιχνιδιού')} anchor={{ element: menu }} onDismiss={() => setMenu(undefined)} items={[
      { id: 'store', label: text('View on Microsoft Store', 'Προβολή στο Microsoft Store'), icon: <ExternalLink />, onSelect: () => window.open(storeUrl, '_blank', 'noopener,noreferrer') },
      { id: 'refresh', label: text('Refresh game information', 'Ανανέωση πληροφοριών παιχνιδιού'), icon: <Info />, disabled: loading, onSelect: () => setAttempt(value => value + 1) },
    ]} /> : null}
    {gallery !== undefined && screenshots.length ? <Gallery title={title} images={screenshots} initial={gallery} close={() => setGallery(undefined)} /> : null}
    {handheld ? <HandheldCompatibilityDialog title={title} value={details?.handheldCompatibility ?? product.handheldCompatibility} close={() => setHandheld(false)} /> : null}
  </main>;
}
