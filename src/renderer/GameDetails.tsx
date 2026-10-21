import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { LoaderCircle } from 'lucide-react';
import { ArrowLeft, Images } from './XboxIcons';
import { Check, ChevronLeft, ChevronRight, Clock3, Gamepad2, MoreHorizontal, RefreshCw, X } from './XboxIcons';
import type { AppSnapshot, Game, GameActivity, GameStoreDetails } from '../shared/types';
import './game-details.css';
import { Achievements } from './Achievements';
import { useBackHandler } from './GamepadNavigation';
import { ReferenceMenu, referenceMenuPosition, referenceMenuTrigger, type ReferenceMenuAnchor, type ReferenceMenuItem } from './ReferenceMenu';
import { useReferenceLocale } from './ReferenceLocale';
import { HandheldCompatibilityEntry, HandheldCompatibilityDialog } from './HandheldCompatibility';

const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export function formatMinutes(minutes?: number): string {
  if (minutes === undefined || !Number.isFinite(minutes) || minutes < 0) return 'Unavailable';
  if (minutes === 0) return '0 min';
  if (minutes < 1) return '<1 min';
  const hours = Math.floor(minutes / 60), remainder = Math.floor(minutes % 60);
  return hours ? `${hours} h${remainder ? ` ${remainder} min` : ''}` : `${remainder} min`;
}

function activityNote(activity?: GameActivity): string {
  switch (activity?.status) {
    case 'signed-out': return 'Sign in to view Xbox activity.';
    case 'unsupported': return 'Update the backend to read Xbox activity.';
    case 'error': return 'Xbox activity could not be loaded. Try refreshing.';
    case 'unavailable': return 'Xbox has no activity available for this game.';
    default: return activity?.partial ? 'Some Xbox activity could not be retrieved.' : 'From Xbox';
  }
}

function Artwork({ src, alt, ...props }: { src?: string; alt: string; className?: string; loading?: 'lazy' }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return src && !failed ? <img src={src} alt={alt} {...props} referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <span className="gd-artwork-unavailable"><Gamepad2 /><span>{alt || 'Artwork unavailable'}</span></span>;
}

export function galleryIndex(index: number, length: number): number {
  return length > 0 && Number.isFinite(index) ? Math.max(0, Math.min(Math.floor(index), length - 1)) : 0;
}

export function Gallery({ title, images, initial, close }: { title: string; images: string[]; initial: number; close: () => void }) {
  const [selected, setIndex] = useState(() => galleryIndex(initial, images.length));
  const index = galleryIndex(selected, images.length);
  const ref = useRef<HTMLElement>(null), onClose = useRef(close); onClose.current = close;
  useBackHandler(() => { onClose.current(); return true; }, true, () => ref.current);
  useBrowserLayoutEffect(() => {
    const origin = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    ref.current?.querySelector<HTMLButtonElement>('[data-gamepad-cancel]')?.focus({ preventScroll: true });
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !ref.current?.contains(document.activeElement)) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose.current(); }
      if ((event.key === 'ArrowRight' || event.key === 'ArrowLeft') && images.length) { event.preventDefault(); setIndex(i => (galleryIndex(i, images.length) + (event.key === 'ArrowRight' ? 1 : images.length - 1)) % images.length); }
      if (event.key === 'Tab') {
        const buttons = [...ref.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
        if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1)?.focus(); }
        if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0]?.focus(); }
      }
    };
    document.addEventListener('keydown', key);
    const root = ref.current;
    return () => {
      document.removeEventListener('keydown', key);
      if (origin?.isConnected && (document.activeElement === document.body || root?.contains(document.activeElement))) origin.focus({ preventScroll: true });
    };
  }, [images.length]);
  return <div className="gd-lightbox-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <section ref={ref} className="gd-lightbox" role="dialog" aria-modal="true" aria-label={`${title} screenshots`} data-gamepad-gallery="">
      <header><span>{title}<small aria-live="polite">{images.length ? index + 1 : 0} / {images.length} · Microsoft Store</small></span><button className="secondary gd-gallery-close" data-gamepad-cancel aria-label="Close gallery" onClick={close}><X />Close<span className="gd-controller-hint" aria-hidden="true">B</span></button></header>
      <div className="gd-lightbox-image"><Artwork src={images[index]} alt={`${title} screenshot ${index + 1}`} /></div>
      <footer><button className="secondary" data-gamepad-gallery-previous aria-label="Previous screenshot" disabled={images.length < 2} onClick={() => setIndex((index - 1 + images.length) % images.length)}><span className="gd-controller-hint" aria-hidden="true">L1</span><ChevronLeft />Previous</button><button className="secondary" data-gamepad-gallery-next aria-label="Next screenshot" disabled={images.length < 2} onClick={() => setIndex((index + 1) % images.length)}>Next<ChevronRight /><span className="gd-controller-hint" aria-hidden="true">R1</span></button></footer>
    </section>
  </div>;
}

interface PageProps {
  game: Game;
  back: () => void;
  play: ReactNode;
  manage: ReactNode;
  manageItems?: readonly ReferenceMenuItem[];
  notices?: ReactNode;
  technical?: ReactNode;
  achievements?: ReactNode;
}
interface ContentProps extends PageProps {
  details?: GameStoreDetails;
  activity?: GameActivity;
  metadataLoading?: boolean;
  activityLoading?: boolean;
  metadataError?: boolean;
  refresh: () => void;
}

/** Compatibility path for an existing opaque action component. Capture closes
 * its popup before the child's callback; explicit item definitions use the
 * shared ReferenceMenu above this path. */
function LegacyManageMenu({ anchor, children, close }: { anchor: HTMLElement; children: ReactNode; close: () => void }) {
  const ref = useRef<HTMLDivElement>(null), onClose = useRef(close); onClose.current = close;
  useBackHandler(() => { onClose.current(); return true; }, true, () => ref.current);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const fit = () => {
      const position = referenceMenuPosition(anchor.getBoundingClientRect(), root.getBoundingClientRect(), { width: innerWidth, height: innerHeight }, 'end');
      Object.assign(root.style, { left: `${position.left}px`, top: `${position.top}px` });
    };
    fit(); root.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !root.contains(event.target) && !anchor.contains(event.target)) onClose.current(); };
    document.addEventListener('pointerdown', outside, true); window.addEventListener('resize', fit); document.addEventListener('scroll', fit, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true); window.removeEventListener('resize', fit); document.removeEventListener('scroll', fit, true);
      if (anchor.isConnected && (document.activeElement === document.body || root.contains(document.activeElement))) anchor.focus({ preventScroll: true });
    };
  }, [anchor]);
  return <div ref={ref} className="reference-menu gd-legacy-menu" data-game-menu role="menu" aria-label="Manage game" onClick={event => event.stopPropagation()}
    onClickCapture={event => {
      const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button') : null;
      if (target && !target.disabled && target.getAttribute('aria-disabled') !== 'true') { anchor.focus({ preventScroll: true }); onClose.current(); }
    }}
    onMouseOver={event => { const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button') : null; if (button && !button.disabled) button.focus({ preventScroll: true }); }}
    onKeyDown={event => {
      if (event.key === 'Escape' || event.key === 'Tab') { if (event.key === 'Escape') event.preventDefault(); event.stopPropagation(); anchor.focus({ preventScroll: true }); onClose.current(); return; }
      if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const buttons = [...ref.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled):not([aria-disabled="true"])')];
      const index = buttons.findIndex(button => button === document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus({ preventScroll: true });
    }}>{children}</div>;
}

/** Descriptive data never gates Play or changes package/licensing decisions. */
export function GameDetailsContent({ game, back, play, manage, manageItems, notices, technical, achievements, details, activity, metadataLoading, activityLoading, metadataError, refresh }: ContentProps) {
  const { text } = useReferenceLocale();
  const root = useRef<HTMLElement>(null), manageButton = useRef<HTMLButtonElement>(null);
  const [gallery, setGallery] = useState<number>();
  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState<'details' | 'reviews' | 'more'>('details');
  const [manageAnchor, setManageAnchor] = useState<ReferenceMenuAnchor>();
  const [handheld, setHandheld] = useState(false);
  const backToLibrary = () => {
    const previousRoot = root.current;
    back();
    requestAnimationFrame(() => {
      if (document.activeElement !== document.body && !previousRoot?.contains(document.activeElement)) return;
      [...document.querySelectorAll<HTMLElement>('[data-gamepad-detail-target]')]
        .find(card => card.getAttribute('data-gamepad-detail-target') === game.id)?.focus({ preventScroll: true });
    });
  };
  useBackHandler(() => { backToLibrary(); return true; }, !manageAnchor && gallery === undefined && !handheld);
  const manageTrigger = referenceMenuTrigger({ onOpen: setManageAnchor });
  const images = details?.screenshots ?? [];
  useEffect(() => { if (!images.length) setGallery(undefined); }, [images.length]);
  const description = details?.description ?? '';
  const shortDescription = description.split(/\r?\n\s*\r?\n/)[0];
  const artwork = details?.heroUrl ?? game.heroUrl ?? game.coverUrl ?? game.coverDataUrl;
  const release = details?.releaseDate && Number.isFinite(Date.parse(details.releaseDate)) ? new Date(details.releaseDate).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : undefined;
  const lastPlayed = activity?.lastPlayed && Number.isFinite(Date.parse(activity.lastPlayed)) ? new Date(activity.lastPlayed).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Unavailable';
  useEffect(() => { setGallery(undefined); setExpanded(false); setTab('details'); setManageAnchor(undefined); setHandheld(false); }, [game.id]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== 'Escape' || manageAnchor || gallery !== undefined || document.querySelector('[role="dialog"][aria-modal="true"],[data-game-menu]')) return;
      event.preventDefault(); backToLibrary();
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [back, manageAnchor, gallery, game.id]);
  const tabPrefix = `installed-${encodeURIComponent(game.id)}`;
  return <section ref={root} className="game-details-page" data-gamepad-detail={game.id} style={artwork ? { '--gd-art': `url(${JSON.stringify(artwork)})` } as CSSProperties : undefined}>
    <button className="gd-back sr-only" data-gamepad-detail-back data-gamepad-skip onClick={backToLibrary}><ArrowLeft />{text('Back to library', 'Επιστροφή στη βιβλιοθήκη')}<span className="gd-back-hint" aria-hidden="true">B</span></button>
    <section className="gd-hero">
      <div className="gd-hero-copy">
        <span className={`gd-ready ${game.installState}`}><Check />{game.installState === 'ready' ? text('Installed', 'Εγκατεστημένο') : game.installState === 'incomplete' ? text('Incomplete', 'Ελλιπής εγκατάσταση') : text('Imported', 'Έχει εισαχθεί')}</span>
        <h1>{game.title}</h1>
        <HandheldCompatibilityEntry value={details?.handheldCompatibility} open={() => setHandheld(true)} />
        <p className="gd-hero-description">{metadataLoading ? text('Loading game information…', 'Φόρτωση πληροφοριών παιχνιδιού…') : shortDescription || text('Game information is unavailable.', 'Οι πληροφορίες παιχνιδιού δεν είναι διαθέσιμες.')}</p>
        <section className="gd-play-controls" data-gamepad-action-row aria-label={text('Game actions', 'Ενέργειες παιχνιδιού')}>
          {play}
          <button ref={manageButton} className="secondary gd-manage-trigger" data-game-menu-trigger aria-haspopup="menu" aria-expanded={Boolean(manageAnchor)} aria-label={text('More game actions', 'Περισσότερες ενέργειες παιχνιδιού')}
            {...manageTrigger} onClick={event => setManageAnchor(manageAnchor ? undefined : { element: event.currentTarget, align: 'end' })}><MoreHorizontal /><span className="sr-only">{text('Manage', 'Διαχείριση')}</span></button>
        </section>
      </div>
      <div className="gd-hero-media">
        <Artwork className="gd-hero-art" src={artwork} alt={game.title} />
        <div className="gd-hero-thumbnails">{images.slice(0, 6).map((url, index) => <button key={`${url}-${index}`} aria-label={`Open screenshot ${index + 1}`} onClick={() => setGallery(index)}><Artwork loading="lazy" src={url} alt={`${game.title} screenshot ${index + 1}`} /></button>)}</div>
        {!images.length ? <p className="gd-empty">{metadataLoading ? text('Loading screenshots…', 'Φόρτωση στιγμιότυπων…') : text('No screenshots available.', 'Δεν υπάρχουν διαθέσιμα στιγμιότυπα.')}</p> : null}
      </div>
    </section>
    <section className="gd-meta-bar" aria-label={text('Game information', 'Πληροφορίες παιχνιδιού')}>
      <div><strong>{details?.publisher ?? game.publisher ?? text('Publisher not provided', 'Ο εκδότης δεν έχει δοθεί')}</strong><span>{details?.categories.join(' · ') || text('Categories unavailable', 'Οι κατηγορίες δεν είναι διαθέσιμες')}</span></div>
      <div><span>{text('Release date', 'Ημερομηνία κυκλοφορίας')}</span><strong>{release ?? text('Unavailable', 'Μη διαθέσιμη')}</strong>{details ? <small>Microsoft Store</small> : null}</div>
    </section>
    {notices ? <div className="gd-notices">{notices}</div> : null}
    <nav className="gd-tabs" data-gamepad-section-tabs role="tablist" aria-label={text('Game information', 'Πληροφορίες παιχνιδιού')}>{(['details', 'reviews', 'more'] as const).map((value, index, values) => <button key={value} role="tab" id={`${tabPrefix}-tab-${value}`} aria-controls={`${tabPrefix}-panel-${value}`} aria-selected={tab === value} tabIndex={tab === value ? 0 : -1} onClick={() => setTab(value)} onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? values.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + values.length) % values.length;
      setTab(values[next]); requestAnimationFrame(() => document.getElementById(`${tabPrefix}-tab-${values[next]}`)?.focus());
    }}>{value === 'details' ? text('Details', 'Λεπτομέρειες') : value === 'reviews' ? text('Reviews', 'Κριτικές') : text('More', 'Περισσότερα')}</button>)}</nav>
    <div className="gd-page-content">
      <section role="tabpanel" id={`${tabPrefix}-panel-details`} aria-labelledby={`${tabPrefix}-tab-details`} hidden={tab !== 'details'}>
      <section className="gd-activity-row" aria-label={text('Xbox activity', 'Δραστηριότητα Xbox')}>
        <div className="gd-stat"><Clock3 /><div><span>Xbox time played <button className="gd-refresh" aria-label="Refresh Xbox activity" disabled={activityLoading} onClick={refresh}>{activityLoading ? <LoaderCircle className="spin" /> : <RefreshCw />}</button></span><strong>{activityLoading && !activity ? 'Loading…' : formatMinutes(activity?.minutesPlayed)}</strong><small>{activityLoading ? 'Reading Xbox activity…' : activityNote(activity)}</small></div></div>
        <div className="gd-stat gd-last-played"><div><span>Last played</span><strong>{activityLoading && !activity ? 'Loading…' : lastPlayed}</strong></div></div>
      </section>
      {achievements}
      <div className="gd-detail-columns">
        <div className="gd-description-column">
          <section className="gd-about"><header><h2>About the game</h2>{images.length ? <button className="gd-text-button" onClick={() => setGallery(0)}><Images />{text('View all screenshots', 'Προβολή όλων των στιγμιότυπων')} ({images.length})</button> : null}</header><p>{metadataLoading ? 'Loading game information…' : description ? expanded ? description : shortDescription : metadataError ? 'Game information could not be loaded. You can still play.' : 'Microsoft Store did not provide a description for this game.'}</p>{description !== shortDescription ? <button className="gd-text-button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? 'Show less' : 'Read more'}<ChevronRight /></button> : null}</section>
        </div>
        <aside className="gd-facts"><h2>Game information</h2><dl><div><dt>Publisher</dt><dd>{details?.publisher ?? game.publisher ?? 'Unavailable'}</dd></div><div><dt>Release date</dt><dd>{release ?? 'Unavailable'}</dd></div><div><dt>Categories</dt><dd>{details?.categories.length ? details.categories.join(' · ') : 'Unavailable'}</dd></div>{details ? <div><dt>Metadata source</dt><dd>Microsoft Store</dd></div> : null}</dl></aside>
      </div>
      <p className="gd-disclaimer">Xbox activity may be delayed or unavailable for some games. Local session time is not added to the Xbox total.</p>
      </section>
      <section role="tabpanel" id={`${tabPrefix}-panel-reviews`} aria-labelledby={`${tabPrefix}-tab-reviews`} hidden={tab !== 'reviews'}><h2>{text('Reviews', 'Κριτικές')}</h2><p>{text('Reviews are not returned by the connected catalog service.', 'Η συνδεδεμένη υπηρεσία καταλόγου δεν επιστρέφει κριτικές.')}</p>{game.storeId ? <a href={`https://www.microsoft.com/store/productId/${encodeURIComponent(game.storeId)}`} target="_blank" rel="noreferrer">{text('View on Microsoft Store', 'Προβολή στο Microsoft Store')}</a> : null}</section>
      <section role="tabpanel" id={`${tabPrefix}-panel-more`} aria-labelledby={`${tabPrefix}-tab-more`} hidden={tab !== 'more'}><h2>{text('Additional information', 'Πρόσθετες πληροφορίες')}</h2><details className="gd-installation-details"><summary>{text('Installation details', 'Λεπτομέρειες εγκατάστασης')}</summary>{technical}</details><details className="gd-technical-actions"><summary>{text('xboks Engine / Proton options', 'Επιλογές xboks Engine / Proton')}</summary><div role="menu" aria-label={text('xboks Engine / Proton options', 'Επιλογές xboks Engine / Proton')}>{manage}</div></details></section>
    </div>
    {manageAnchor ? manageItems ? <ReferenceMenu id={`installed-game-options-${game.id}`} label={text('Game options', 'Επιλογές παιχνιδιού')} anchor={manageAnchor} items={manageItems} onDismiss={() => setManageAnchor(undefined)} /> : manageButton.current ? <LegacyManageMenu anchor={manageButton.current} close={() => setManageAnchor(undefined)}>{manage}</LegacyManageMenu> : null : null}
    {gallery !== undefined && images.length ? <Gallery title={game.title} images={images} initial={gallery} close={() => setGallery(undefined)} /> : null}
    {handheld ? <HandheldCompatibilityDialog title={game.title} value={details?.handheldCompatibility} close={() => setHandheld(false)} /> : null}
  </section>;
}

export function GameDetails(props: PageProps & { data: AppSnapshot }) {
  const { game, data } = props;
  const [details, setDetails] = useState<GameStoreDetails>();
  const [metadataLoading, setMetadataLoading] = useState(true);
  const [metadataError, setMetadataError] = useState(false);
  const [activity, setActivity] = useState<GameActivity>();
  const [activityLoading, setActivityLoading] = useState(true);
  const request = useRef(0);
  useEffect(() => {
    let live = true; setDetails(undefined); setMetadataLoading(true); setMetadataError(false);
    window.launcher.getGameDetails(game.id).then(value => { if (live) setDetails(value); }).catch(() => { if (live) setMetadataError(true); }).finally(() => { if (live) setMetadataLoading(false); });
    return () => { live = false; };
  }, [game.id, data.settings.market]);
  const loadActivity = useCallback((refresh = false) => {
    const id = ++request.current; setActivityLoading(true);
    void window.launcher.getGameActivity(game.id, refresh).then(value => { if (request.current === id) setActivity(value); }).catch(() => { if (request.current === id) setActivity({ status: 'error' }); }).finally(() => { if (request.current === id) setActivityLoading(false); });
  }, [game.id, data.auth.username, data.auth.stored, data.auth.running, data.backend.binaryPath]);
  useEffect(() => { setActivity(undefined); loadActivity(); return () => { request.current++; }; }, [loadActivity]);
  return <GameDetailsContent {...props} details={details} activity={activity} metadataLoading={metadataLoading} metadataError={metadataError} activityLoading={activityLoading} refresh={() => loadActivity(true)} achievements={<Achievements gameId={game.id} title={game.title} data={data} />} />;
}
