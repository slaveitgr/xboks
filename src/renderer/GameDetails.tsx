import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, Check, ChevronLeft, ChevronRight, Clock3, Gamepad2, Images, LoaderCircle, MoreHorizontal, RefreshCw, X } from 'lucide-react';
import type { AppSnapshot, Game, GameActivity, GameStoreDetails } from '../shared/types';
import './game-details.css';
import { Achievements } from './Achievements';

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

export function Gallery({ title, images, initial, close }: { title: string; images: string[]; initial: number; close: () => void }) {
  const [index, setIndex] = useState(initial);
  const ref = useRef<HTMLElement>(null), onClose = useRef(close); onClose.current = close;
  useEffect(() => {
    const origin = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    ref.current?.querySelector<HTMLButtonElement>('[data-gamepad-cancel]')?.focus({ preventScroll: true });
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose.current(); }
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); setIndex(i => (i + (event.key === 'ArrowRight' ? 1 : images.length - 1)) % images.length); }
      if (event.key === 'Tab') {
        const buttons = [...ref.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
        if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1)?.focus(); }
        if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0]?.focus(); }
      }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); if (origin?.isConnected) origin.focus({ preventScroll: true }); };
  }, [images.length]);
  return <div className="gd-lightbox-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <section ref={ref} className="gd-lightbox" role="dialog" aria-modal="true" aria-label={`${title} screenshots`} data-gamepad-gallery="">
      <header><span>{title}<small aria-live="polite">{index + 1} / {images.length} · Microsoft Store</small></span><button className="secondary gd-gallery-close" data-gamepad-cancel aria-label="Close gallery" onClick={close}><X />Close<span className="gd-controller-hint" aria-hidden="true">B</span></button></header>
      <div className="gd-lightbox-image"><Artwork src={images[index]} alt={`${title} screenshot ${index + 1}`} /></div>
      <footer><button className="secondary" data-gamepad-gallery-previous aria-label="Previous screenshot" onClick={() => setIndex(i => (i - 1 + images.length) % images.length)}><span className="gd-controller-hint" aria-hidden="true">L1</span><ChevronLeft />Previous</button><button className="secondary" data-gamepad-gallery-next aria-label="Next screenshot" onClick={() => setIndex(i => (i + 1) % images.length)}>Next<ChevronRight /><span className="gd-controller-hint" aria-hidden="true">R1</span></button></footer>
    </section>
  </div>;
}

interface PageProps {
  game: Game;
  back: () => void;
  play: ReactNode;
  manage: ReactNode;
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

/** Descriptive data never gates Play or changes package/licensing decisions. */
export function GameDetailsContent({ game, back, play, manage, notices, technical, achievements, details, activity, metadataLoading, activityLoading, metadataError, refresh }: ContentProps) {
  const [gallery, setGallery] = useState<number>();
  const [expanded, setExpanded] = useState(false);
  const manageRef = useRef<HTMLDetailsElement>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const closeManage = (restoreFocus = true) => {
    if (manageRef.current) manageRef.current.open = false;
    setManageOpen(false);
    if (restoreFocus) manageRef.current?.querySelector<HTMLElement>('summary')?.focus({ preventScroll: true });
  };
  const images = details?.screenshots ?? [];
  const description = details?.description ?? '';
  const shortDescription = description.split(/\r?\n\s*\r?\n/)[0];
  const release = details?.releaseDate && Number.isFinite(Date.parse(details.releaseDate)) ? new Date(details.releaseDate).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : undefined;
  const lastPlayed = activity?.lastPlayed && Number.isFinite(Date.parse(activity.lastPlayed)) ? new Date(activity.lastPlayed).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Unavailable';
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      if (manageRef.current?.open) { event.preventDefault(); closeManage(); return; }
      if (!document.querySelector('[data-game-menu]')) { event.preventDefault(); back(); }
    };
    const outside = (event: PointerEvent) => { if (manageRef.current?.open && event.target instanceof Node && !manageRef.current.contains(event.target)) closeManage(false); };
    window.addEventListener('keydown', escape); document.addEventListener('pointerdown', outside);
    return () => { window.removeEventListener('keydown', escape); document.removeEventListener('pointerdown', outside); };
  }, [back]);
  return <section className="game-details-page" data-gamepad-detail={game.id}>
    <div className="gd-back-row"><button className="gd-back" data-gamepad-detail-back onClick={back}><ArrowLeft />Back to library<span className="gd-back-hint" aria-hidden="true">B</span></button></div>
    <section className="gd-hero">
      <Artwork className="gd-hero-art" src={details?.heroUrl ?? game.heroUrl ?? game.coverUrl} alt="" />
      <div className="gd-hero-shade" />
      <div className="gd-hero-copy"><span className={`gd-ready ${game.installState}`}><Check />{game.installState === 'ready' ? 'Installed' : game.installState === 'incomplete' ? 'Incomplete' : 'Imported'}</span><h1>{game.title}</h1><p>{details?.publisher ?? game.publisher ?? 'Publisher not provided'}</p><div className="gd-tags">{details?.categories.map(category => <span key={category}>{category}</span>)}</div></div>
    </section>
    <div className="gd-page-content">
      <section className="gd-play-row" data-gamepad-action-row aria-label="Game actions and activity">
        <div className="button-row gd-play-controls">{play}</div>
        <div className="gd-stat"><Clock3 /><div><span>Xbox time played <button className="gd-refresh" aria-label="Refresh Xbox activity" disabled={activityLoading} onClick={refresh}>{activityLoading ? <LoaderCircle className="spin" /> : <RefreshCw />}</button></span><strong>{activityLoading && !activity ? 'Loading…' : formatMinutes(activity?.minutesPlayed)}</strong><small>{activityLoading ? 'Reading Xbox activity…' : activityNote(activity)}</small></div></div>
        <div className="gd-stat gd-last-played"><div><span>Last played</span><strong>{activityLoading && !activity ? 'Loading…' : lastPlayed}</strong></div></div>
        <details ref={manageRef} className="gd-actions" data-game-menu={manageOpen ? '' : undefined} onToggle={event => setManageOpen(event.currentTarget.open)}><summary aria-label="More game actions"><MoreHorizontal /><span>Manage</span></summary><div onClick={event => { if ((event.target as HTMLElement).closest('button:not(:disabled)')) closeManage(); }}>{manage}</div></details>
      </section>
      {notices}
      {achievements}
      <div className="gd-detail-columns">
        <div className="gd-description-column">
          <section className="gd-about"><h2>About the game</h2><p>{metadataLoading ? 'Loading game information…' : description ? expanded ? description : shortDescription : metadataError ? 'Game information could not be loaded. You can still play.' : 'Microsoft Store did not provide a description for this game.'}</p>{description !== shortDescription ? <button className="gd-text-button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? 'Show less' : 'Read more'}<ChevronRight /></button> : null}</section>
          <section className="gd-gallery"><header><h2>Screenshots</h2>{images.length ? <button className="gd-text-button" onClick={() => setGallery(0)}><Images />View all {images.length}</button> : null}</header><div>{images.slice(0, 4).map((url, index) => <button key={url} aria-label={`Open screenshot ${index + 1}`} onClick={() => setGallery(index)}><Artwork loading="lazy" src={url} alt={`${game.title} screenshot ${index + 1}`} /></button>)}</div>{!images.length ? <p className="gd-empty">{metadataLoading ? 'Loading screenshots…' : 'No screenshots available.'}</p> : null}</section>
        </div>
        <aside className="gd-facts"><h2>Game information</h2><dl><div><dt>Publisher</dt><dd>{details?.publisher ?? game.publisher ?? 'Unavailable'}</dd></div><div><dt>Release date</dt><dd>{release ?? 'Unavailable'}</dd></div><div><dt>Categories</dt><dd>{details?.categories.length ? details.categories.join(' · ') : 'Unavailable'}</dd></div>{details ? <div><dt>Metadata source</dt><dd>Microsoft Store</dd></div> : null}</dl><details><summary>Installation details</summary>{technical}</details></aside>
      </div>
      <p className="gd-disclaimer">Xbox activity may be delayed or unavailable for some games. Local session time is not added to the Xbox total.</p>
    </div>
    {gallery !== undefined && images.length ? <Gallery title={game.title} images={images} initial={gallery} close={() => setGallery(undefined)} /> : null}
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
