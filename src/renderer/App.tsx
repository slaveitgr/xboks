import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Github, HardDrive, LoaderCircle, LogIn, Terminal } from 'lucide-react';
import { PackageCheck, Rocket } from './XboxIcons';
import { ArrowDownToLine, Info, ArrowDownWideNarrow, ListFilter, BookmarkPlus, ChevronUp, Bell, Cable, MonitorPlay, Users, ChevronLeft, Check, ChevronRight, CircleAlert, CircleUserRound, Clock3, Cog, Download, FolderOpen, Gamepad2, Home, Library, MoreHorizontal, Pause, Play, Plus, RefreshCw, Search, Settings2, Store, Trash2, X, Maximize, Minimize } from './XboxIcons';
import type { AccountLibraryPage, AppSnapshot, CatalogProduct, CatalogSearchResult, DiagnosticLog, Game, GameContentPlan, GameLaunchOptions, Page, Settings } from '../shared/types';
import { downloadRateLabel } from '../shared/download-display';
import { estimateTimeRemaining } from '../shared/utils';
import { nexusRuntimeUpdateAvailable, runtimeDisplay } from '../shared/runtime-display';
import { subscriptionBadge } from '../shared/subscription';
import { defaultLaunchTools, normalizeLaunchTools } from '../shared/launch-tools';
import type { GameLaunchTools } from '../shared/types';
import { PackageInstallProvider, usePackageInstall } from './PackageInstall';
import { defaultLibraryFilters, loadLibraryFilters, saveLibraryFilters, type LibraryFilters } from './library-preferences';
import { InstalledCheck } from './XboxIcons';
import { LibraryTabs, useLibraryCollections, collectionKey, loadCollections, saveCollections, type LibraryView } from './LibraryChrome';
import { InstallQueueShortcut } from './InstallQueueShortcut';
import { dispatchBackHandlers } from './gamepad-navigation';
import { GamepadNavigation, useBackHandler } from './GamepadNavigation';
import { GamePassIcon, GamePassPage, ShellFlyout, type ShellPanel } from './XboxShell';
import { GuideOverlay, guideTabs, type GuideTab } from './GuideOverlay';
import { SettingsFrame, type SettingsSection } from './SettingsFrame';
import { LaunchExperience } from './LaunchExperience';
import { installationReadiness } from '../shared/installation-state';
import { BatteryStatus } from './BatteryStatus';
import { OriginalSettings } from './OriginalSettings';
import { InstallSettings } from './InstallSettings';
import { AudioSettings } from './AudioSettings';
import { applyAppearance, loadAppearance, saveAppearance } from './appearance';
import { ConfirmationProvider, useConfirmation } from './Confirmation';
import { GameRemovalContents } from './GameRemovalContents';
import { GameDetails } from './GameDetails';
import { CatalogDetails } from './CatalogDetails';
import { DownloadCancelDialog } from './DownloadCancelDialog';
import { KeyringSetup } from './KeyringSetup';
import { useReferenceLocale } from './ReferenceLocale';
import { installedCatalogGame, queuedCatalogProduct } from './catalog-navigation';
import { downloadMenuItems } from './queue-menu';
import { ReferenceMenu, referenceMenuTrigger, type ReferenceMenuItem } from './ReferenceMenu';
import type { DownloadCancelOptions } from '../shared/types';
export type { LibraryFilters } from './library-preferences';

const emptySnapshot: AppSnapshot = {
  backend: {
    available: false, source: 'none', updateAvailable: false, checking: false, updating: false,
    externalRoot: '',
    capabilities: { commands: [], account: false, login: false, logout: false, download: false, streaming: false, run: false },
    prerequisites: { git: false, cargo: false, rustc: false, protoc: false },
  },
  runtime: {
    installed: false, checking: false, updating: false,
    runtimeRoot: '', artifactAvailable: false,
    prerequisites: { gh: false, authenticated: false, tar: false, sha512sum: false },
  },
  games: [], downloads: [],
  settings: {
    installRoot: '', market: 'neutral', parallelDownloads: 4, winePath: '',
    externalXodusRoot: '', runtimeRoot: '', verboseLogs: false,
  },
  auth: { running: false, stored: null, note: '' },
};

type Toast = { kind: 'success' | 'error' | 'info'; message: string };
const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/^Error invoking remote method '[^']+': Error:\s*/, '');
}

function StatusDot({ tone = 'green' }: { tone?: 'green' | 'amber' | 'red' }) {
  return <span className={`status-dot ${tone}`} />;
}

export function GameTitle({ title }: { title: string }) {
  return <strong title={title}>{title}</strong>;
}

function NavItem({ active, icon, label, badge, onClick, autoSelect = false }: {
  active: boolean; icon: React.ReactNode; label: string; badge?: number; onClick: () => void; autoSelect?: boolean;
}) {
  return <button className={`nav-item ${active ? 'active' : ''}`} data-gamepad-auto-select={autoSelect ? '' : undefined} onClick={onClick} aria-label={label} title={label} aria-current={active ? 'page' : undefined}>
    {icon}<span>{label}</span>{badge ? <b>{badge}</b> : null}
  </button>;
}

export function Sidebar({ data, page, go, openGame, onPanel }: { data: AppSnapshot; page: Page; go: (page: Page) => void; openGame?: (id: string) => void; onPanel?: (panel: ShellPanel) => void }) {
  const { text } = useReferenceLocale();
  const account = data.auth.gamertag ?? data.auth.username ?? (data.auth.stored === true ? 'Microsoft account' : 'Sign in');
  return <aside className="sidebar">
    <button className="account-summary" aria-label={account} title={account} aria-haspopup="dialog" onClick={() => onPanel ? onPanel('account') : go('settings')}><AccountAvatar auth={data.auth} /><span><strong>{account}</strong><AccountMembership auth={data.auth} /></span><ChevronRight /></button>
    <nav><NavItem autoSelect active={page === 'home'} icon={<Home />} label={text('Home', 'Αρχική οθόνη')} onClick={() => go('home')} /><NavItem autoSelect active={page === 'gamepass'} icon={<GamePassIcon />} label="Game Pass" onClick={() => go('gamepass')} /><NavItem autoSelect active={page === 'library'} icon={<Library />} label={text('My Library', 'Η βιβλιοθήκη μου')} onClick={() => go('library')} /><NavItem autoSelect active={page === 'store'} icon={<Store />} label="Store" onClick={() => go('store')} /></nav><hr className="sidebar-divider" /><NavItem active={false} icon={<Users />} label={text('Friends', 'Φίλοι')} onClick={() => onPanel?.('friends')} />
    {data.games.length > 0 ? <div className="recents"><span>Most recent</span>{data.games.slice(0, 5).map(game => <button key={game.id} onClick={() => openGame ? openGame(game.id) : go('library')}><Cover game={game} /><GameTitle title={game.title} /></button>)}</div> : null}
    <div className="sidebar-bottom"><NavItem active={false} icon={<Bell />} label={text('Notifications', 'Ειδοποιήσεις')} onClick={() => onPanel?.('notifications')} /><NavItem active={false} icon={<MonitorPlay />} label="Remote Play" onClick={() => onPanel?.('remote-play')} /><InstallQueueShortcut downloads={data.downloads} games={data.games} active={page === 'downloads'} openQueue={() => go('downloads')} /></div>
  </aside>;
}

function AccountMembership({ auth }: { auth: AppSnapshot['auth'] }) {
  const label = auth.stored === true ? subscriptionBadge(auth.subscription) : undefined;
  if (label) return <small className="account-membership" title={`Subscription verified ${new Date(auth.subscription!.checkedAt).toLocaleString()}`}>{label}</small>;
  return auth.stored === true ? null : <small>{auth.stored === false ? 'Not signed in' : 'Status unavailable'}</small>;
}

function AccountAvatar({ auth, large = false }: { auth: AppSnapshot['auth']; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [auth.avatarDataUrl]);
  return <div className={`account-avatar${large ? ' large' : ''}`}>
    {auth.avatarDataUrl && !failed ? <img src={auth.avatarDataUrl} alt="Xbox profile picture" onError={() => setFailed(true)} /> : <CircleUserRound />}
  </div>;
}

export function TopStatus({ data, go }: { data: AppSnapshot; go: (page: Page) => void }) {
  const restart = data.launcherUpdate?.restartRequired;
  const updates = [
    data.launcherUpdate?.latestVersion && !restart ? `Launcher ${data.launcherUpdate.latestVersion}` : '',
    data.backend.releaseAvailable && data.backend.updateAvailable ? `Backend ${data.backend.releaseVersion ?? ''}`.trim() : '',
    nexusRuntimeUpdateAvailable(data.runtime) ? `Runtime ${data.runtime.nexusVersion?.replace(/^runtime-/, '') ?? ''}`.trim() : '',
  ].filter(Boolean);
  const updateTitle = [restart ? 'Restart to finish launcher update.' : '', updates.length ? `Available updates: ${updates.join(', ')}` : ''].filter(Boolean).join(' ');
  return <div className="top-status">
    {updates.length || restart ? <button className="update-notice" title={updateTitle} aria-label={updateTitle} onClick={() => go('settings')}><ArrowDownToLine /><strong>{restart ? 'Restart available' : 'Update available'}</strong></button> : null}
    <StatusDot tone={data.backend.available ? 'green' : 'red'} /><span>{data.backend.available ? 'xboks Engine ready' : 'Backend offline'}</span><button title="Settings" onClick={() => go('settings')}><Settings2 /></button>
  </div>;
}

export function DiagnosticDialog({ log, close, revealFile, copyLog }: { log: DiagnosticLog; close: () => void; revealFile?: () => Promise<void>; copyLog?: () => Promise<void> }) {
  const [copyStatus, setCopyStatus] = useState('Copy log');
  const [copying, setCopying] = useState(false);
  const [copyError, setCopyError] = useState('');
  const [fileError, setFileError] = useState(false);
  async function copy() {
    setCopying(true); setCopyError(''); setCopyStatus('Copy log');
    try {
      if (copyLog) await copyLog();
      else if (!log.truncated) await navigator.clipboard.writeText(log.content);
      else throw Error('The full log is no longer available.');
      setCopyStatus('Copied');
    } catch (error) {
      setCopyError(error instanceof Error && error.message.includes('too large for the clipboard')
        ? 'This log is too large for the clipboard. Use Show log file to attach the complete file.'
        : 'Could not copy the complete log. Try again or use Show log file.');
    } finally { setCopying(false); }
  }
  return <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}><section className="game-dialog diagnostic-dialog" role="dialog" aria-modal="true" aria-label="Diagnostic log"><h2>{log.name}</h2><p>Private diagnostic log, review before sharing.{log.truncated ? ' Preview shows the most recent 512 KiB. Copy log copies the complete file.' : ''}</p><pre>{log.content || 'The log is empty.'}</pre>{fileError ? <p role="alert">The log file is no longer available.</p> : null}{copyError ? <p role="alert">{copyError}</p> : null}<div className="dialog-actions">{revealFile ? <button className="secondary" onClick={() => { setFileError(false); void revealFile().catch(() => setFileError(true)); }}>Show log file</button> : null}<button className="secondary" disabled={copying} onClick={() => void copy()}>{copying ? 'Copying…' : copyStatus}</button><button className="secondary" data-gamepad-cancel onClick={close}>Close</button></div></section></div>;
}

export function BackendLogButton({ toast }: { toast: (value: Toast) => void }) {
  const [log, setLog] = useState<DiagnosticLog>();
  const [loading, setLoading] = useState(false);
  return <>
    <button className="secondary" disabled={loading} onClick={async () => {
      setLoading(true);
      try { setLog(await window.launcher.readBackendDiagnosticLog()); }
      catch { toast({ kind: 'error', message: 'Backend diagnostics could not be opened safely.' }); }
      finally { setLoading(false); }
    }}>{loading ? <LoaderCircle className="spin" /> : <Terminal />}Open backend diagnostic log</button>
    {log ? <DiagnosticDialog log={log} close={() => setLog(undefined)} /> : null}
  </>;
}

export function Cover({ game, className = '', variant = 'cover' }: { game: Game; className?: string; variant?: 'cover' | 'hero' }) {
  const sources = [...new Set([variant === 'hero' ? game.heroUrl : undefined, game.coverUrl, game.coverDataUrl].filter((url): url is string => Boolean(url)))];
  const key = sources.join('\n');
  const [failure, setFailure] = useState({ key: '', index: 0 });
  const index = failure.key === key ? failure.index : 0;
  const art = sources[index];
  if (art) return <img className={`game-cover ${art === game.coverDataUrl ? 'cover-local' : 'cover-store'} ${className}`} src={art} alt={`${game.title} artwork`} onError={() => setFailure({ key, index: index + 1 })} />;
  return <div className={`cover-placeholder ${className}`}><Gamepad2 /></div>;
}

function StatePill({ game }: { game: Game }) {
  const label = game.installState === 'ready' ? 'Ready' : game.installState === 'incomplete' ? 'Incomplete' : 'Imported';
  return <span className={`state-pill ${game.installState}`}>
    {game.installState === 'ready' ? <Check /> : <CircleAlert />}{label}
  </span>;
}

function SectionTitle({ title, action, onClick }: { title: string; action?: string; onClick?: () => void }) {
  return <div className="section-title"><h2>{title}</h2>{action && onClick ? <button onClick={onClick}>{action}<ChevronRight /></button> : null}</div>;
}

function useGameLaunchOptions(game: Game | undefined, data: AppSnapshot): GameLaunchOptions | undefined {
  const [options, setOptions] = useState<GameLaunchOptions>();
  useEffect(() => {
    setOptions(undefined);
    if (!game) return;
    let cancelled = false;
    window.launcher.getGameLaunchOptions(game.id)
      .then((value) => { if (!cancelled) setOptions(value); })
      .catch((error) => { if (!cancelled) setOptions({ cloudSaves: false, cloudReason: errorMessage(error), vcInstall: false, vcReason: errorMessage(error) }); });
    return () => { cancelled = true; };
  }, [game?.id, data.settings.winePath, data.settings.runtimeRoot, data.runtime.winePath, data.backend.binaryPath, data.backend.commit, data.backend.available]);
  return options;
}

export function HomePage({ data, go, action, openGame, openProduct }: {
  data: AppSnapshot; go: (page: Page) => void; action: (fn: () => Promise<unknown>, success?: string) => void;
  openGame?: (id: string) => void;
  openProduct?: (product: CatalogProduct) => void;
}) {
  const { text } = useReferenceLocale();
  const [catalog, setCatalog] = useState<CatalogSearchResult>();
  const [catalogError, setCatalogError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    window.launcher.getFeaturedCatalog().then(result => { if (!cancelled) setCatalog(result); })
      .catch(() => { if (!cancelled) setCatalogError(true); });
    return () => { cancelled = true; };
  }, []);
  const games = data.games.slice(0, 6);
  const products = catalog?.products ?? [];
  const art = games[0]?.heroUrl ?? games[0]?.coverUrl ?? products[0]?.heroUrl;
  const selectGame = (game: Game) => openGame ? openGame(game.id) : go('library');
  return <main className="page home-page dashboard-home" style={art ? { '--home-art': `url(${JSON.stringify(art)})` } as React.CSSProperties : undefined}>
    <section className="jump-back" aria-labelledby="jump-back-title">
      <h1 id="jump-back-title">{text('Jump back in', 'Επιστροφή')}</h1>
      <div className="jump-back-row">{games[0] ? <>
        <button className="resume-tile" onClick={() => selectGame(games[0])} title={games[0].title}><Cover game={games[0]} /><span><GameTitle title={games[0].title} /><StatePill game={games[0]} /></span></button>
        {games.length > 1 ? <div className="resume-group" role="group" aria-label="More recent games">{games.slice(1, 5).map(game => <button key={game.id} onClick={() => selectGame(game)} title={game.title} aria-label={game.title}><Cover game={game} /></button>)}</div> : null}
      </> : <button className="resume-empty" onClick={() => go('library')}><Library /><strong>Your next game starts here</strong><span>Open your library to import or install a game</span></button>}</div>
    </section>
    <section className="home-featured" aria-labelledby="home-featured-title">
      <h2 id="home-featured-title">{text('Featured', 'Επιλεγμένα')}</h2>
      <div className="home-feature-grid">
        <button className="home-feature-tile" onClick={() => games[0] ? selectGame(games[0]) : go('store')}>
          {art ? <img src={art} alt="" /> : <div className="feature-fallback"><Gamepad2 /></div>}
          <span className="feature-copy"><strong>{games[0]?.title ?? 'Discover your next favorite'}</strong><span>{games[0] ? 'Play now' : 'Explore PC games in the Store'}</span></span>
        </button>
        <button className="home-feature-tile" data-product-id={products[0]?.productId} onClick={() => products[0] && openProduct ? openProduct(products[0]) : go('store')}>
          {products[0]?.heroUrl || products[0]?.posterUrl ? <img src={products[0].heroUrl ?? products[0].posterUrl} alt="" /> : <div className="feature-fallback discovery-fallback"><Store /></div>}
          <span className="feature-copy"><strong>{products[0]?.title ?? 'Find something new to play'}</strong><span>Browse the live PC catalog</span></span>
        </button>
        <div className="home-feature-stack">{[0, 1].map(index => {
          const product = products[index + 1];
          const image = product?.heroUrl ?? product?.posterUrl;
          return <button className="home-feature-tile utility-tile" key={index} data-product-id={product?.productId} onClick={() => product && openProduct ? openProduct(product) : go(product || index === 0 ? 'store' : 'library')}>
            {image ? <img src={image} alt="" /> : index === 0 ? <Store /> : <Library />}
            <span className="feature-copy"><strong>{product?.title ?? (index === 0 ? 'Explore PC games' : 'Your library')}</strong><span>{product?.publisher ?? (index === 0 ? 'Discover the Store catalog' : 'Find your next game')}</span></span>
          </button>;
        })}</div>
      </div>
    </section>
    <section className="home-discover" aria-labelledby="home-discover-title">
      <div className="home-discover-heading"><h2 id="home-discover-title">{text('Discover PC games', 'Ανακαλύψτε παιχνίδια υπολογιστή')}</h2><p>{text('Explore the Microsoft Store catalog', 'Ανακαλύψτε τον κατάλογο του Microsoft Store')}</p></div>
      {products.length ? <div className="home-catalog-row">{products.slice(0, 8).map(product => <button className="home-product" key={product.productId} data-product-id={product.productId} onClick={() => openProduct ? openProduct(product) : go('store')}>
        {product.posterUrl ? <img src={product.posterUrl} alt="" loading="lazy" /> : <div className="cover-placeholder"><Gamepad2 /></div>}<span><GameTitle title={product.title} /><small>{product.publisher ?? 'Microsoft Store'}</small></span>
      </button>)}</div> : <div className="home-catalog-state" role="status">{catalogError ? <><CircleAlert /><span>Store highlights are unavailable. Your local library is still available.</span><button className="secondary" onClick={() => go('store')}>Open Store</button></> : <><LoaderCircle className="spin" /><span>Loading Store highlights…</span></>}</div>}
    </section>
    {games[0]?.installState === 'ready' && data.backend.capabilities.run && (data.settings.winePath || data.runtime.winePath) ? <button className="primary home-launch" onClick={() => action(() => window.launcher.launchGame(games[0].id))}><Play />Launch {games[0].title}</button> : null}
  </main>;
}

function XboxFullButton({ onError }: { onError: (message: string) => void }) {
  const [full, setFull] = useState(() => document.documentElement.hasAttribute('data-fullscreen-experience'));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const changed = () => {
      if (!document.fullscreenElement && document.documentElement.hasAttribute('data-fullscreen-experience')) {
        document.documentElement.removeAttribute('data-fullscreen-experience');
        window.dispatchEvent(new CustomEvent('xboks-fullscreen-experience', { detail: false }));
      }
      setFull(Boolean(document.fullscreenElement) && document.documentElement.hasAttribute('data-fullscreen-experience'));
    };
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);
  async function toggle() {
    setBusy(true);
    try {
      if (full) {
        if (document.fullscreenElement) await document.exitFullscreen();
        document.documentElement.removeAttribute('data-fullscreen-experience'); setFull(false);
        window.dispatchEvent(new CustomEvent('xboks-fullscreen-experience', { detail: false }));
      } else {
        if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
        document.documentElement.setAttribute('data-fullscreen-experience', ''); setFull(true);
        window.dispatchEvent(new CustomEvent('xboks-fullscreen-experience', { detail: true }));
      }
    } catch (error) { onError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  return <button className="xbox-full-toggle" aria-label={full ? 'Exit Fullscreen Experience' : 'Fullscreen Experience'} aria-pressed={full} disabled={busy} title={full ? 'Return to windowed mode' : 'Fullscreen Experience with controller navigation'} onClick={() => void toggle()}>
    {full ? <Minimize /> : <Maximize />}<span>{full ? 'Exit Fullscreen Experience' : 'Fullscreen Experience'}</span>
  </button>;
}

function ShellClock() {
  const { language } = useReferenceLocale();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 30000); return () => window.clearInterval(timer); }, []);
  return <time className="shell-clock" dateTime={now.toISOString()}>{now.toLocaleTimeString(language === 'el' ? 'el-GR' : [], { hour: '2-digit', minute: '2-digit' })}</time>;
}

export function StoreProductCard({ product, selected, select }: {
  product: CatalogProduct; selected: boolean; disabled: boolean; label: string;
  select: (product: CatalogProduct) => void; install: (product: CatalogProduct) => void;
}) {
  return <article className={`catalog-card ${selected ? 'selected' : ''}`} data-gamepad-card data-product-id={product.productId}>
    <button className="catalog-card-main" data-gamepad-auto-select="focus" data-gamepad-card-activate aria-label={`View game details: ${product.title}`}
      onClick={() => select(product)}>
      {product.posterUrl ? <img src={product.posterUrl} alt={`${product.title} cover`} /> : <div className="catalog-cover-placeholder"><Gamepad2 /></div>}
      <div><GameTitle title={product.title} /><small>{product.publisher ?? product.productId}</small><span>{product.purchasePrice ?? 'Price unavailable'}{product.includedWith ? ` · ${product.includedWith}` : ''}</span></div>
    </button>
  </article>;
}

function StorePage({ data, toast, go, initialQuery, initialProduct, openProduct, back, openGame }: { initialProduct?: CatalogProduct; openProduct?: (product: CatalogProduct) => void; back?: () => void; openGame?: (id: string) => void; data: AppSnapshot; toast: (value: Toast) => void; go: (page: Page) => void; initialQuery: string }) {
  const startPackageInstall = usePackageInstall();
  const [catalog, setCatalog] = useState<CatalogSearchResult>();
  const [featured, setFeatured] = useState<CatalogSearchResult>();
  const [featuredLoading, setFeaturedLoading] = useState(true);
  const [featuredError, setFeaturedError] = useState<string>();
  const [selected, setSelected] = useState<CatalogProduct | undefined>(initialProduct);
  useEffect(() => { setSelected(initialProduct); if (initialProduct) setDestination(installDestination(initialProduct)); }, [initialProduct]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [manualProductId, setManualProductId] = useState('');
  const [manualTitle, setManualTitle] = useState('');
  const [destination, setDestination] = useState(data.settings.installRoot);
  const [busy, setBusy] = useState<string>();
  useEffect(() => { if (!selected) setDestination(data.settings.installRoot); }, [data.settings.installRoot, selected]);
  useEffect(() => {
    if (initialQuery.trim().length < 2) return;
    let cancelled = false;
    window.launcher.searchCatalog(initialQuery).then((result) => {
      if (!cancelled) { setCatalog(result); setSelected(undefined); }
    }).catch((error) => { if (!cancelled) toast({ kind: 'error', message: errorMessage(error) }); });
    return () => { cancelled = true; };
  }, [initialQuery]);
  useEffect(() => {
    let cancelled = false;
    window.launcher.getFeaturedCatalog()
      .then((result) => { if (!cancelled) setFeatured(result); })
      .catch((error) => { if (!cancelled) setFeaturedError(errorMessage(error)); })
      .finally(() => { if (!cancelled) setFeaturedLoading(false); });
    return () => { cancelled = true; };
  }, []);

  function installDestination(product: CatalogProduct): string {
    const folder = product.title.normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 80) || product.productId;
    return `${data.settings.installRoot.replace(/\/+$/, '')}/${folder}`;
  }

  function selectProduct(product: CatalogProduct) {
    openProduct?.(product);
    setSelected(product);
    setDestination(installDestination(product));
  }

  async function loadMore() {
    if (!catalog?.cursor) return;
    setLoadingMore(true);
    try {
      const next = await window.launcher.searchCatalog(catalog.query, catalog.cursor);
      setCatalog({ ...next, products: [...catalog.products, ...next.products] });
    } catch (error) { toast({ kind: 'error', message: errorMessage(error) }); }
    finally { setLoadingMore(false); }
  }

  async function install(product: CatalogProduct, target = installDestination(product)) {
    setBusy(product.productId);
    try {
      if (!await startPackageInstall({ productId: product.installProductId ?? product.productId, title: product.title, destination: target })) return;
      toast({ kind: 'success', message: `xboks Engine is checking the license and installing ${product.title}.` });
      go('downloads');
    } catch (error) { toast({ kind: 'error', message: errorMessage(error) }); }
    finally { setBusy(undefined); }
  }

  async function manualInstall(event: FormEvent) {
    event.preventDefault(); setBusy('manual');
    try {
      if (!await startPackageInstall({ productId: manualProductId, title: manualTitle, destination })) return;
      toast({ kind: 'success', message: 'xboks Engine streaming started.' }); go('downloads');
    } catch (error) { toast({ kind: 'error', message: errorMessage(error) }); }
    finally { setBusy(undefined); }
  }

  async function chooseDestination() {
    const selected = await window.launcher.chooseDirectory(destination);
    if (selected) setDestination(selected);
  }

  const installedIds = new Set(data.games.flatMap((game) => game.storeId?.toUpperCase() ?? []));
  const isInstalled = (product: CatalogProduct) => installedIds.has(product.productId) || Boolean(product.installProductId && installedIds.has(product.installProductId));
  const queuedIds = new Set(data.downloads.filter(task => ['running', 'queued', 'paused'].includes(task.status)).map(task => task.productId.toUpperCase()));
  const isQueued = (product: CatalogProduct) => queuedIds.has(product.productId) || Boolean(product.installProductId && queuedIds.has(product.installProductId));
  const productGrid = (products: CatalogProduct[]) => <div className="catalog-grid" data-gamepad-grid>{products.map((product) => {
    const installed = isInstalled(product);
    return <StoreProductCard key={product.productId} product={product} selected={selected?.productId === product.productId}
      disabled={product.installability !== 'supported' || Boolean(busy) || !data.backend.capabilities.streaming || installed || isQueued(product)}
      label={installed ? 'Installed' : isQueued(product) ? 'In Install Queue' : busy === product.productId ? 'Preparing…' : 'Install'}
      select={selectProduct} install={install} />;
  })}</div>;
  if (selected) return <CatalogDetails product={selected} back={back ?? (() => setSelected(undefined))}
    install={() => void install(selected)} busy={busy === selected.productId}
    installed={isInstalled(selected)} queued={isQueued(selected)}
    operation={data.downloads.find(task => task.productId.toUpperCase() === selected.productId.toUpperCase() || task.productId.toUpperCase() === selected.installProductId?.toUpperCase())} openQueue={() => go('downloads')}
    canInstall={selected.installability === 'supported' && data.backend.capabilities.streaming}
    openInstalled={() => { const game = installedCatalogGame(selected, data.games); if (game && openGame) openGame(game.id); else go('library'); }} />;
  return <main className="page store-page">
    <header className="page-header"><div><h1>Store</h1></div><span className="catalog-source"><StatusDot />Microsoft Store</span></header>
    {!catalog ? <section className="featured-catalog"><SectionTitle title="Featured" />{featuredLoading ? <div className="catalog-loading"><LoaderCircle className="spin" /><span>Loading live Store collection…</span></div> : featured?.products.length ? <><div className="featured-rail">{featured.products.slice(0, 3).map((product) => <button className="featured-tile" key={product.productId} onClick={() => selectProduct(product)}>{product.heroUrl || product.posterUrl ? <img src={product.heroUrl ?? product.posterUrl} alt="" /> : <div className="featured-tile-placeholder"><Gamepad2 /></div>}<span className="featured-tile-copy"><GameTitle title={product.title} /><small>{product.publisher ?? 'Microsoft Store'} · {product.installability === 'supported' ? 'PC package verified' : 'Check package support'}</small></span></button>)}</div><SectionTitle title="Trending PC games" />{productGrid(featured.products.slice(3))}</> : <div className="catalog-empty"><Store /><h2>Featured games are temporarily unavailable</h2><p>{featuredError ?? 'Search still works with live Microsoft Store data.'}</p></div>}</section> : null}



    {catalog ? <><SectionTitle title={`Results for “${catalog.query}”`} />{productGrid(catalog.products)}{catalog.products.length === 0 ? <div className="empty-state compact"><div><Search /></div><h2>No games found</h2><p>Try a different title or a Microsoft Store Product ID.</p></div> : null}{catalog.hasMore ? <div className="load-more"><button className="secondary" disabled={loadingMore} onClick={loadMore}>{loadingMore ? <LoaderCircle className="spin" /> : <Plus />}Load more results</button></div> : null}</> : null}

    <SectionTitle title="Install by Product ID" />
    <form className="manual-install" onSubmit={manualInstall}><label>Product ID<input value={manualProductId} onChange={(event) => setManualProductId(event.target.value)} placeholder="For example: 9N4PT8HGCDHQ" required /></label><label>Queue name <em>Optional</em><input value={manualTitle} onChange={(event) => setManualTitle(event.target.value)} /></label><label>Install location<div className="input-action"><input value={destination} onChange={(event) => setDestination(event.target.value)} required /><button type="button" onClick={chooseDestination}><FolderOpen /></button></div></label><button className="secondary" disabled={Boolean(busy) || !data.backend.capabilities.streaming}>{busy === 'manual' ? <LoaderCircle className="spin" /> : <Terminal />}Install unlisted ID</button></form>
  </main>;
}

interface GameMenuActionsProps {
  onDetails?: () => void;
  onPlayLater?: () => void; saved?: boolean;
  game: Game; options?: GameLaunchOptions; busy: boolean;
  onBrowse: () => void; onSettings: () => void; onInstallVc: () => void; onRemove: () => void;
  onShortcut?: (destination: 'desktop' | 'applications' | 'steam') => void;
  onUpdate?: () => void; updateDisabled?: boolean; updateLabel?: string;
  onContent?: () => void; contentDisabled?: boolean;
  onPlay?: () => void; playDisabled?: boolean;
}

export function GameMenuActions({ game, options, busy, onBrowse, onSettings, onInstallVc, onRemove, onShortcut, onUpdate, updateDisabled, updateLabel, onContent, contentDisabled, onPlayLater, saved, onDetails }: GameMenuActionsProps) {
  return <>
    {onDetails ? <button role="menuitem" onClick={onDetails}><Info />View game details</button> : null}
    {onPlayLater ? <button role="menuitem" onClick={onPlayLater}><BookmarkPlus />{saved ? 'Remove from Play later' : 'Add to Play later'}</button> : null}
    {onUpdate ? <button role="menuitem" disabled={busy || updateDisabled} onClick={onUpdate}><RefreshCw />{updateLabel ?? 'Check for updates'}</button> : null}
    <button role="menuitem" onClick={onBrowse}><FolderOpen />Browse game files</button>
    {onContent ? <button role="menuitem" disabled={busy || contentDisabled} onClick={onContent}><PackageCheck />Manage content</button> : null}
    <button role="menuitem" onClick={onSettings}><Settings2 />Game settings</button>
    <button role="menuitem" disabled={!onShortcut || game.installState !== 'ready'} onClick={() => onShortcut?.('desktop')}><Plus />Create desktop shortcut</button>
    <button role="menuitem" disabled={!onShortcut || game.installState !== 'ready'} onClick={() => onShortcut?.('applications')}><Plus />Add to applications menu</button>
    <button role="menuitem" disabled={!onShortcut || game.installState !== 'ready'} title="Add a shortcut with available artwork, including while Steam is running." onClick={() => onShortcut?.('steam')}><Plus />Add to Steam</button>
    <button role="menuitem" disabled={busy || game.installState !== 'ready' || !options?.vcInstall} title={options?.vcReason} onClick={onInstallVc}><Download />Install / update VC++</button>
    <button role="menuitem" className="danger" disabled={busy} onClick={onRemove}><Trash2 />Remove game…</button>
  </>;
}

export function gameContextMenuItems(actions: GameMenuActionsProps, text = (en: string, _el: string) => en): ReferenceMenuItem[] {
  return [
    { id: 'details', label: text('View game details', 'Προβολή λεπτομερειών παιχνιδιού'), icon: <Info />, hidden: !actions.onDetails, onSelect: () => actions.onDetails?.() },
    { id: 'play', label: text('Play', 'Παίξτε'), icon: <Play />, hidden: !actions.onPlay, disabled: actions.busy || actions.playDisabled, onSelect: () => actions.onPlay?.() },
    { id: 'later', label: actions.saved ? text('Remove from Play later', 'Κατάργηση από την Αναπαραγωγή αργότερα') : text('Add to Play later', 'Προσθήκη στην Αναπαραγωγή αργότερα'), icon: <BookmarkPlus />, hidden: !actions.onPlayLater, onSelect: () => actions.onPlayLater?.() },
    { id: 'content', label: text('Manage installation', 'Διαχείριση εγκατάστασης'), icon: <PackageCheck />, hidden: !actions.onContent, disabled: actions.busy || actions.contentDisabled, onSelect: () => actions.onContent?.() },
    { id: 'shortcut', label: text('Create desktop shortcut', 'Δημιουργία συντόμευσης επιφάνειας εργασίας'), icon: <Plus />, disabled: actions.busy || !actions.onShortcut || actions.game.installState !== 'ready', onSelect: () => actions.onShortcut?.('desktop') },
    { id: 'settings', label: text('xboks Engine / Proton options', 'Επιλογές xboks Engine / Proton'), icon: <Settings2 />, disabled: actions.busy, onSelect: actions.onSettings },
    { id: 'remove', label: actions.game.installState === 'imported' ? text('Remove from library', 'Κατάργηση από τη βιβλιοθήκη') : text('Uninstall', 'Κατάργηση εγκατάστασης'), icon: <Trash2 />, disabled: actions.busy, onSelect: actions.onRemove },
  ];
}
export function GameContextMenu({ x, y, dismiss = () => {}, restoreFocusTo, ...actions }: GameMenuActionsProps & { x: number; y: number; dismiss?: () => void; restoreFocusTo?: HTMLElement }) {
  const { text } = useReferenceLocale();
  return <ReferenceMenu id={`game-menu-${actions.game.id}`} label={text('Game options', 'Επιλογές παιχνιδιού')} anchor={{ x, y, restoreFocusTo }} onDismiss={dismiss} items={gameContextMenuItems(actions, text)} />;
}

interface AccountGamesProps {
  data: AppSnapshot; toast: (value: Toast) => void; selectedId?: string;
  select?: (game: Game, openDetails?: boolean) => void; menu?: (game: Game, x: number, y: number) => void;
  openProduct?: (product: CatalogProduct) => void;
  filters?: LibraryFilters; onFiltersChange?: (filters: LibraryFilters) => void;
  onImport?: () => void; lastPlayed?: Record<string, number>; localOnly?: boolean; onCheckUpdates?: () => void; checkingUpdates?: boolean;
}

export function LibraryPagination({ loading, hasMore, load, searching = false }: { loading: boolean; hasMore: boolean; load: () => void; searching?: boolean }) {
  if (searching) return <div className="library-pagination"><span className="library-loading" role="status"><LoaderCircle className="spin" />Searching all library games…</span></div>;
  if (!loading && !hasMore) return null;
  return <div className="library-pagination">
    {hasMore ? <button className="secondary" disabled={loading} onClick={load}>
      {loading ? <><LoaderCircle className="spin" />Loading games…</> : 'Load more games'}
    </button> : <span className="library-loading" role="status"><LoaderCircle className="spin" />Loading account games…</span>}
  </div>;
}

export function LibraryProductCard({ product, present, downloading, installing, canInstall, install, select }: {
  product: AccountLibraryPage['products'][number]; present: boolean; downloading: boolean; installing?: string; canInstall: boolean; install: (product: CatalogProduct) => void;
  select?: (product: CatalogProduct) => void;
}) {
  const disabled = present || downloading || Boolean(installing) || !canInstall;
  const label = present ? 'Installed' : downloading ? 'In Install Queue' : installing === product.productId ? 'Preparing…' : 'Install';
  const card = useRef<HTMLElement>(null);
  useBrowserLayoutEffect(() => {
    if (!disabled && document.activeElement === card.current) card.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  }, [disabled]);
  return <article ref={card} className="catalog-card" data-gamepad-card data-product-id={product.productId} tabIndex={select ? undefined : disabled ? 0 : -1} aria-label={!select && disabled ? `${product.title}, ${label}. Action unavailable` : undefined}>
    {select ? <button className="catalog-card-main" data-gamepad-auto-select="focus" data-gamepad-card-activate onClick={() => select(product)} aria-label={`View game details: ${product.title}`}>{product.posterUrl ? <img src={product.posterUrl} alt={`${product.title} cover`} loading="lazy" /> : <div className="catalog-cover-placeholder"><Gamepad2 /></div>}<div><GameTitle title={product.title} /><small>{product.publisher ?? product.productId}</small><span>{product.access === 'owned' ? 'Owned' : 'Game Pass'}</span></div></button> : <><div className="catalog-card-main">{product.posterUrl ? <img src={product.posterUrl} alt={`${product.title} cover`} loading="lazy" /> : <div className="catalog-cover-placeholder"><Gamepad2 /></div>}<div><GameTitle title={product.title} /><small>{product.publisher ?? product.productId}</small></div></div><button className="catalog-card-install" disabled={disabled} onClick={() => install(product)}>{present ? <Check /> : <Download />}{label}</button></>}
  </article>;
}

export function AccountGames({ data, toast, selectedId, select, menu, filters, onFiltersChange, onImport, lastPlayed = {}, localOnly = false, onCheckUpdates, checkingUpdates = false, openProduct }: AccountGamesProps) {
  const startPackageInstall = usePackageInstall();
  const [showFilters, setShowFilters] = useState(false);
  const [sort, setSort] = useState<'recent' | 'title' | 'added'>('recent');
  const [localFilters, setLocalFilters] = useState<LibraryFilters>(defaultLibraryFilters);
  const selectedFilters = filters ?? localFilters;
  const { kind, playState, query } = selectedFilters;
  const updateFilters = (patch: Partial<LibraryFilters>) => (onFiltersChange ?? setLocalFilters)({ ...selectedFilters, ...patch });
  const setKind = (kind: LibraryFilters['kind']) => updateFilters({ kind });
  const setPlayState = (playState: LibraryFilters['playState']) => updateFilters({ playState });
  const setQuery = (query: string) => updateFilters({ query });
  const [result, setResult] = useState<AccountLibraryPage>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [installing, setInstalling] = useState<string>();
  const [searchTerm, setSearchTerm] = useState('');
  useEffect(() => {
    if (!query.trim()) { setSearchTerm(''); return; }
    const timer = window.setTimeout(() => setSearchTerm(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);
  const identity = `${data.auth.stored}:${data.auth.username}:${data.auth.running}:${data.settings.market}:${data.backend.binaryPath}:${kind}`;
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const [loadedIdentity, setLoadedIdentity] = useState(identity);
  const available = !localOnly && data.auth.stored === true && !data.auth.running && data.backend.capabilities.library;
  useEffect(() => {
    let cancelled = false;
    setResult(undefined); setLoadedIdentity(identity); setError(undefined);
    if (!available) { setBusy(false); return; }
    setBusy(true);
    window.launcher.getAccountLibrary(kind).then(value => { if (!cancelled) setResult(value); })
      .catch(error => { if (!cancelled) setError(errorMessage(error)); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [identity, available]);
  // Never display the previous account's cards while the identity effect settles.
  const visible = loadedIdentity === identity ? result : undefined;
  // Installed games are already in the snapshot. Account searches must also
  // resolve every remaining licensed page before reporting no matches.
  const searching = available && playState !== 'installed' && Boolean(query.trim()) && !error && (busy || Boolean(visible?.cursor));
  useEffect(() => {
    if (!searching || busy || !visible?.cursor || searchTerm !== query.trim()) return;
    void load();
  }, [identity, searching, busy, visible?.cursor, searchTerm, query]);
  const installed = new Set(data.games.flatMap(game => game.storeId?.toUpperCase() ?? []));
  const queued = new Set(data.downloads.filter(task => ['running', 'queued', 'paused'].includes(task.status)).map(task => task.productId.toUpperCase()));
  const products = (visible?.products ?? []).filter(product => !installed.has(product.productId) && !installed.has(product.installProductId ?? ''));
  const access = (game: Game) => game.storeId ? visible?.accessByProductId[game.storeId.toUpperCase()] : undefined;
  const rows = [
    ...data.games.filter(game => playState !== 'installable' && (kind === 'all' || access(game) === kind)).sort((a, b) => a.title.localeCompare(b.title))
      .map(game => ({ id: game.id, title: game.title, game, product: undefined })),
    ...products.filter(() => !localOnly && playState !== 'installed').map(product => ({ id: product.productId, title: product.title, product, game: undefined })),
  ].filter(row => row.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).sort((a, b) => {
    if (sort === 'title') return a.title.localeCompare(b.title);
    const date = (row: typeof a) => sort === 'recent' && row.game && lastPlayed[row.game.id] ? lastPlayed[row.game.id] : Date.parse(row.game?.addedAt ?? '') || 0;
    return date(b) - date(a) || a.title.localeCompare(b.title);
  });
  async function load(refresh = false) {
    setBusy(true); setError(undefined);
    try {
      const next = await window.launcher.getAccountLibrary(kind, refresh ? undefined : visible?.cursor, refresh);
      if (currentIdentity.current !== identity) return;
      if (!refresh && visible?.cursor && next.cursor === visible.cursor) throw Error('Library pagination did not advance. Refresh the library to try again.');
      // This instance is remounted on identity changes, so pending callbacks
      // cannot publish another account's products into the active component.
      setResult(old => ({ ...next, products: refresh ? next.products : [...(old?.products ?? []), ...next.products.filter(p => !old?.products.some(old => old.productId === p.productId))] }));
    } catch (error) { if (currentIdentity.current === identity) setError(errorMessage(error)); }
    finally { if (currentIdentity.current === identity) setBusy(false); }
  }
  async function install(product: CatalogProduct) {
    setInstalling(product.productId);
    try {
      const folder = product.title.normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 80) || product.productId;
      if (!await startPackageInstall({ productId: product.installProductId ?? product.productId, title: product.title,
        destination: `${data.settings.installRoot.replace(/\/+$/, '')}/${folder}` })) return;
      toast({ kind: 'success', message: `${product.title} added to Install Queue.` });
    } catch (error) { toast({ kind: 'error', message: errorMessage(error) }); }
    finally { setInstalling(undefined); }
  }
  return <section className="account-games">
    <div className="library-filters" data-gamepad-filters>
      <button className="library-filter-count" aria-label="Show library filters" aria-expanded={showFilters} onClick={() => setShowFilters(value => !value)}><ListFilter />{[kind !== 'all', playState !== 'all', Boolean(query)].filter(Boolean).length ? `(${[kind !== 'all', playState !== 'all', Boolean(query)].filter(Boolean).length})` : null}</button>
      <label className="library-platform"><span className="sr-only">Platform</span><select aria-label="Platform" defaultValue="pc"><option value="pc">PC</option></select></label>
      <label><span className="sr-only">Access</span><select aria-label="Access" disabled={localOnly} value={kind} onChange={event => setKind(event.target.value as AccountLibraryPage['kind'])}><option value="all">Access</option><option value="owned">Owned</option><option value="gamepass">In Game Pass</option></select></label>
      <label><span className="sr-only">Play state</span><select aria-label="Play state" value={playState} onChange={event => setPlayState(event.target.value as typeof playState)}><option value="all">Play state</option><option value="installed">Installed</option><option value="installable">Ready to install</option></select></label>
      <label className="library-sort"><ArrowDownWideNarrow /><select aria-label="Sort games" value={sort} onChange={event => setSort(event.target.value as typeof sort)}><option value="recent">Recently used</option><option value="title">Name A–Z</option><option value="added">Recently added</option></select></label>
      <span className="library-game-count">{rows.length}{visible?.cursor && playState !== 'installed' ? '+' : ''} {rows.length === 1 ? 'game' : 'games'}</span>
      <button className="secondary library-refresh" aria-label="Refresh library" title="Refresh library" disabled={!available || busy} onClick={() => load(true)}>{busy ? <LoaderCircle className="spin" /> : <RefreshCw />}</button>
      {onImport ? <button className="library-import" aria-label="Import game" title="Import game" onClick={onImport}><Plus /></button> : null}
    </div>
    <div className="library-filter-chips">{kind !== 'all' ? <button onClick={() => setKind('all')}>{kind === 'owned' ? 'Owned' : 'Game Pass'}<X /></button> : null}{playState !== 'all' ? <button onClick={() => setPlayState('all')}>{playState === 'installed' ? 'Installed' : 'Ready to install'}<X /></button> : null}{query ? <button onClick={() => setQuery('')}>{query}<X /></button> : null}</div>
    <header data-gamepad-library-header className="library-filter-drawer" hidden={!showFilters}><label>Search<input aria-label="Search library" placeholder="Search your games" value={query} onChange={event => setQuery(event.target.value)} /></label>{onCheckUpdates ? <button className="secondary" disabled={checkingUpdates || data.auth.stored !== true} onClick={onCheckUpdates}><RefreshCw />Check game updates</button> : null}{onImport ? <button className="secondary" onClick={onImport}><Plus />Import game</button> : null}</header>
    <div className="account-games-results">
    {!available && !localOnly ? <p>{data.auth.stored !== true ? 'Sign in to load your account games. Installed games remain available.' : !data.backend.capabilities.library ? 'Update xboks Engine to load account licenses.' : 'Wait for sign-in to finish.'}</p> : null}
      {error ? <div className="alert amber"><CircleAlert /><span>{error}</span><BackendLogButton toast={toast} /></div> : null}
      {visible?.skippedEntitlements ? <div className="alert amber"><CircleAlert /><span>Some license records could not be verified and were omitted. This list may be incomplete.</span><BackendLogButton toast={toast} /></div> : null}
      <div className="catalog-grid" data-gamepad-grid>{rows.map(row => {
        if (row.game) {
          const game = row.game;
          const license = access(game);
          return <div className={`library-card-wrap catalog-card ${selectedId === game.id ? 'selected' : ''}`} data-gamepad-card key={game.id} onContextMenu={event => { event.preventDefault(); menu?.(game, event.clientX, event.clientY); }}>
            <button className="library-card catalog-card-main" data-gamepad-auto-select="focus" data-gamepad-detail-target={game.id} onFocus={() => select?.(game, false)} onClick={() => select?.(game, true)} onKeyDown={event => { if (event.key === 'F10' && event.shiftKey) { event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); menu?.(game, rect.left + 16, rect.top + 16); } }}><Cover game={game} /><div><GameTitle title={game.title} /></div></button>
            <span className="catalog-card-status" title={game.installMessage}>{game.installState === 'incomplete' ? <><CircleAlert />Incomplete</> : game.installState === 'imported' ? <><FolderOpen />Imported</> : <><InstalledCheck />{data.gameUpdates?.[game.id]?.available ? 'Update available' : 'Installed'}</>}</span>
            <button className="library-card-menu-button" data-game-menu-trigger data-gamepad-skip aria-label={`Options for ${game.title}`} aria-haspopup="menu" title={`Options for ${game.title}`} onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); menu?.(game, rect.right, rect.bottom); }}><MoreHorizontal /></button>
          </div>;
        }
        const product = row.product!;
        const present = installed.has(product.productId) || installed.has(product.installProductId ?? '');
        const downloading = queued.has(product.productId) || queued.has(product.installProductId ?? '');
        return <LibraryProductCard key={product.productId} product={product} present={present} downloading={downloading} installing={installing} canInstall={data.backend.capabilities.streaming} install={install} select={openProduct} />;
      })}</div>
      {!busy && !searching && !error && !rows.length ? <p>{visible?.cursor && playState !== 'installed' ? 'No games match these filters in the loaded results. Load more to continue.' : 'No games match these filters.'}</p> : null}
      <div data-gamepad-library-footer><LibraryPagination loading={busy} hasMore={Boolean(visible?.cursor)} searching={searching} load={() => { void load(); }} />
</div>
    </div>
  </section>;
}

function AccountGamesForUser(props: AccountGamesProps) {
  const { data } = props;
  return <AccountGames key={`${data.auth.username}:${data.auth.stored}:${data.auth.running}:${data.settings.market}:${data.backend.binaryPath}`} {...props} />;
}

export function ContentList({ plan, disabled, pending, install }: { plan: GameContentPlan; disabled: boolean; pending?: string; install: (id: string) => void }) {
  return <div className="content-list">{plan.items.length ? plan.items.map(item => <article key={item.productId}>
    <div><strong title={item.title}>{item.title}</strong><small>{item.access === 'owned' ? 'Owned' : item.access === 'gamepass' ? 'Game Pass' : 'License not verified'} · {item.status === 'installed' ? 'Installed' : item.status === 'available' ? 'Not installed' : item.status === 'unsupported' ? 'Unsupported package' : 'Unavailable'}</small>
      {item.downloadBytes ? <small>Download: {(item.downloadBytes / 1024 ** 2).toFixed(1)} MiB</small> : null}<small>{item.note}</small></div>
    <button className="secondary" disabled={disabled || Boolean(pending) || !item.access || !['available', 'installed'].includes(item.status)} onClick={() => install(item.productId)}><Download />{pending === item.productId ? 'Preparing…' : item.status === 'installed' ? 'Repair' : 'Install'}</button>
  </article>) : <p>No related content packages are declared by this game.</p>}</div>;
}

function GameContentDialog({ game, data, close, toast }: { game: Game; data: AppSnapshot; close: () => void; toast: (value: Toast) => void }) {
  const confirm = useConfirmation();
  const [plan, setPlan] = useState<GameContentPlan>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<string>();
  const [revision, setRevision] = useState(0);
  const queue = data.downloads.filter(task => task.kind === 'content' && task.gameId === game.id);
  const queueState = queue.map(task => task.id + ':' + task.status).join(',');
  const busy = data.downloads.some(task => ['running', 'paused', 'queued'].includes(task.status)) || Boolean(data.gameOperation && ['preparing', 'running', 'stopping'].includes(data.gameOperation.status));
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(undefined); setPlan(undefined);
    window.launcher.getGameContent(game.id).then(value => { if (!cancelled) setPlan(value); })
      .catch(error => { if (!cancelled) setError(errorMessage(error)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [game.id, data.auth.username, data.auth.stored, data.auth.running, data.backend.binaryPath, data.settings.market, revision, queueState]);
  async function install(id: string) {
    const item = plan?.items.find(item => item.productId === id);
    if (!item || !await confirm({ title: `${item.status === 'installed' ? 'Repair' : 'Install'} ${item.title}?`, message: 'This downloads licensed content into a separate managed folder. Close the game first.', confirmLabel: item.status === 'installed' ? 'Repair' : 'Install' })) return;
    setPending(id); setError(undefined);
    try { await window.launcher.installGameContent(game.id, id); toast({ kind: 'success', message: 'Content added to Install Queue.' }); }
    catch (error) { setError(errorMessage(error)); }
    finally { setPending(undefined); }
  }
  return <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !pending) close(); }}><section className="game-dialog content-dialog" role="dialog" aria-modal="true" aria-label={`Content for ${game.title}`}>
    <h2>Manage content</h2><p>{game.title}</p><p>Only verified licensed PC content can be installed. Content stays separate from the base game. Restart the game after installation. Requires a runtime with Store content support.</p>
    {loading ? <p role="status"><LoaderCircle className="spin" />Checking account licenses and packages…</p> : null}
    {error ? <p role="alert" className="error-text">{error}</p> : null}
    {plan?.runtimeSupported === false ? <p className="error-text">Update the xboks Engine runtime in Settings before installing related content.</p> : null}
    {plan && !loading ? <ContentList plan={plan} disabled={busy || !data.backend.capabilities.streaming || plan.runtimeSupported === false} pending={pending} install={id => { void install(id); }} /> : null}
    {queue.some(task => ['running', 'paused', 'queued'].includes(task.status)) ? <p>Content download is in Install Queue. Pause, resume or cancel it there.</p> : null}
    <div className="dialog-actions"><button className="secondary" disabled={loading || Boolean(pending)} onClick={() => setRevision(value => value + 1)}><RefreshCw />Refresh</button><button className="secondary" disabled={Boolean(pending)} data-gamepad-cancel onClick={close}>Close</button></div>
  </section></div>;
}

export function GameLaunchToolFields({ value, change }: { value: GameLaunchTools; change: (value: GameLaunchTools) => void }) {
  const update = (patch: Partial<GameLaunchTools>) => change({ ...value, ...patch });
  return <fieldset className="game-launch-tools"><legend>Launch tools</legend>
    <label className="tool-checkbox"><input type="checkbox" checked={value.dualSenseCompatibility === true} onChange={event => update({ dualSenseCompatibility: event.target.checked })} /><span>DualSense compatibility mode</span></label>
    <small>Try this if a standard DualSense controller is not detected. Disables its native HIDRAW input for this game only. Advanced haptics and adaptive triggers may be unavailable. Does not change Xbox controller settings.</small>
    <label className="tool-checkbox"><input type="checkbox" checked={value.mangoHud} onChange={event => update({ mangoHud: event.target.checked })} /><span>Enable MangoHud</span></label>
    <label className="tool-checkbox"><input type="checkbox" checked={value.gamescope} onChange={event => update({ gamescope: event.target.checked })} /><span>Run in gamescope</span></label>
    {value.gamescope ? <label>Gamescope options<input value={value.gamescopeArgs} maxLength={2048} placeholder="-W 1920 -H 1080 -f" onChange={event => update({ gamescopeArgs: event.target.value })} /><small>Only options. xboks Engine adds the game command. MangoHud with gamescope requires mangoapp.</small></label> : null}
    <label>Launch options<textarea rows={3} value={value.launchOptions} maxLength={2048} placeholder="PROTON_ENABLE_WAYLAND=1 gamemoderun %command% --launcher-skip" onChange={event => update({ launchOptions: event.target.value })} /><small>NAME=value and wrappers before %command%, game arguments after it. Quotes are supported, not shell expansion. Variables are passed to Wine; Proton-script-only options depend on runtime support.</small></label>
    <small>Tools must already be installed. Applies to this game and its shortcuts, not the launcher.</small>
  </fieldset>;
}

export function LibraryPage({ data, toast, filters, onFiltersChange, selection, view: selectedView, onView, openProduct, openGame, backToOrigin }: Pick<AccountGamesProps, 'data' | 'toast' | 'filters' | 'onFiltersChange' | 'openProduct'> & { selection?: { id: string }; view?: LibraryView; onView?: (view: LibraryView) => void; openGame?: (id: string) => void; backToOrigin?: () => void }) {
  const { text } = useReferenceLocale();
  const confirm = useConfirmation();
  const [localView, setLocalView] = useState<LibraryView>('games');
  const view = selectedView ?? localView;
  const changeView = onView ?? setLocalView;
  const { collections, update: updateCollections } = useLibraryCollections(data.auth);
  const collectionGames = view === 'later' ? data.games.filter(game => collections.later.includes(game.id)) : view === 'history' ? data.games.filter(game => collections.history[game.id]) : data.games;
  const [selectedId, setSelectedId] = useState<string | undefined>(selection?.id);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number }>();
  const [dialogGame, setDialogGame] = useState<{ id: string; kind: 'settings' | 'remove' }>();
  const [editTitle, setEditTitle] = useState('');
  const [editLocale, setEditLocale] = useState('');
  const [editTools, setEditTools] = useState<GameLaunchTools>({ ...defaultLaunchTools });
  const [localeOptions, setLocaleOptions] = useState<string[]>([]);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [diagnosticLog, setDiagnosticLog] = useState<{ log: DiagnosticLog; operationId: string }>();
  const [contentGameId, setContentGameId] = useState<string>();
  const [detailOpen, setDetailOpen] = useState(Boolean(selection));
  const pageRef = useRef<HTMLElement>(null);
  const gameDialogRef = useRef<HTMLElement>(null);
  const savedScroll = useRef(0);
  const wasOpen = useRef(false);
  const selected = data.games.find((game) => game.id === selectedId) ?? data.games[0];
  useBackHandler(() => { if (!dialogBusy) setDialogGame(undefined); return true; }, Boolean(dialogGame), () => gameDialogRef.current);
  useBrowserLayoutEffect(() => {
    if (!dialogGame || !gameDialogRef.current) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = gameDialogRef.current;
    dialog.querySelector<HTMLElement>('[data-gamepad-cancel]:not(:disabled),input:not(:disabled),button:not(:disabled)')?.focus();
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const controls = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]')].filter(control => control.getClientRects().length > 0);
      const target = event.shiftKey ? controls.at(-1) : controls[0];
      if (target && (event.shiftKey ? document.activeElement === controls[0] : document.activeElement === controls.at(-1))) { event.preventDefault(); target.focus(); }
    };
    dialog.addEventListener('keydown', trapFocus);
    return () => { dialog.removeEventListener('keydown', trapFocus); if (previous?.isConnected && !previous.closest('[hidden],[inert]')) previous.focus({ preventScroll: true }); };
  }, [dialogGame?.id, dialogGame?.kind]);
  useEffect(() => {
    if (dialogGame?.kind !== 'settings') return;
    let current = true;
    void window.launcher.getGameLocales(dialogGame.id).then(locales => { if (current) setLocaleOptions(locales); })
      .catch(error => { if (current) toast({ kind: 'error', message: errorMessage(error) }); });
    return () => { current = false; };
  }, [dialogGame?.id, dialogGame?.kind, toast]);
  function selectGame(game: Game, openDetails = false) {
    setSelectedId(game.id);
    if (openDetails && openGame) openGame(game.id);
    else if (openDetails) { savedScroll.current = pageRef.current?.closest('.page-scroll')?.scrollTop ?? 0; setDetailOpen(true); }
  }
  useBrowserLayoutEffect(() => {
    const scroll = pageRef.current?.closest('.page-scroll');
    if (detailOpen) {
      if (scroll) scroll.scrollTop = 0;
      pageRef.current?.querySelector<HTMLElement>('[data-gamepad-play]:not(:disabled),[data-gamepad-detail-back]')?.focus({ preventScroll: true });
    } else if (wasOpen.current) {
      if (scroll) scroll.scrollTop = savedScroll.current;
      [...pageRef.current?.querySelectorAll<HTMLElement>('[data-gamepad-detail-target]') ?? []].find(card => card.getAttribute('data-gamepad-detail-target') === selected?.id)?.focus({ preventScroll: true });
    }
    wasOpen.current = detailOpen;
  }, [detailOpen, selected?.id]);
  useEffect(() => { if (!selectedId && data.games[0]) setSelectedId(data.games[0].id); }, [data.games, selectedId]);
  useEffect(() => {
    if (!selection) { if (openGame) setDetailOpen(false); return; }
    if (!data.games.some(game => game.id === selection.id)) return;
    if (!detailOpen) savedScroll.current = pageRef.current?.closest('.page-scroll')?.scrollTop ?? 0;
    setSelectedId(selection.id);
    setMenu(undefined);
    setDetailOpen(true);
  }, [selection, Boolean(openGame)]);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(undefined);
    const outside = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('[data-game-menu], [data-game-menu-trigger]')) close();
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('pointerdown', outside);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', escape);
    return () => { window.removeEventListener('pointerdown', outside); window.removeEventListener('scroll', close, true); window.removeEventListener('keydown', escape); };
  }, [menu]);

  function openMenu(game: Game, x: number, y: number) {
    setSelectedId(game.id);
    setMenu({ id: game.id, x: Math.max(8, Math.min(x, window.innerWidth - 230)), y: Math.max(8, Math.min(y, window.innerHeight - 380)) });
  }

  function openDialog(game: Game, kind: 'settings' | 'remove') {
    setMenu(undefined);
    setEditTitle(game.title);
    setEditLocale(game.locale ?? '');
    setEditTools({ ...defaultLaunchTools, ...game.launchTools });
    setLocaleOptions([]);
    setDialogGame({ id: game.id, kind });
  }

  async function saveGameSettings(event: FormEvent) {
    event.preventDefault();
    if (!dialogGame) return;
    setDialogBusy(true);
    try {
      await window.launcher.updateGame(dialogGame.id, { title: editTitle.trim(), locale: editLocale, launchTools: normalizeLaunchTools(editTools) });
      toast({ kind: 'success', message: 'Game settings saved.' });
      setDialogGame(undefined);
    } catch (error) { toast({ kind: 'error', message: errorMessage(error) }); }
    finally { setDialogBusy(false); }
  }

  async function removeGame(mode: 'library' | 'delete-files') {
    if (!dialogGame) return;
    setDialogBusy(true);
    try {
      await window.launcher.removeGame(dialogGame.id, mode);
      setSelectedId(undefined);
      setDialogGame(undefined);
      toast({ kind: 'success', message: mode === 'library' ? 'Removed from library. Game files were kept.' : 'Game files permanently deleted.' });
    } catch (error) { toast({ kind: 'error', message: errorMessage(error) }); }
    finally { setDialogBusy(false); }
  }

  async function importGame() {
    try {
      const game = await window.launcher.importGame();
      if (game) { setSelectedId(game.id); toast({ kind: 'success', message: `Imported ${game.title}.` }); }
    } catch (error) { toast({ kind: 'error', message: errorMessage(error) }); }
  }

  async function play() {
    if (!selected) return;
    try { await window.launcher.launchGame(selected.id); }
    catch (error) { toast({ kind: 'error', message: errorMessage(error) }); }
  }

  async function stopGame() {
    try { await window.launcher.cancelGame(); }
    catch (error) { toast({ kind: 'error', message: errorMessage(error) }); }
  }

  async function installVc(game: Game) {
    try {
      await window.launcher.installGameVcRuntime(game.id);
      toast({ kind: 'success', message: 'Microsoft VC++ is ready in this game’s Proton prefix. Press Play.' });
    } catch (error) { toast({ kind: 'error', message: errorMessage(error) }); }
  }

  async function updateInstalledGame(game = selected) {
    if (!game || !await confirm({ title: `Update ${game.title}?`, message: 'xboks Engine may replace changed game files in place. Do not run the game until the update finishes.', confirmLabel: 'Update game' })) return;
    try {
      await window.launcher.updateInstalledGame(game.id);
      toast({ kind: 'success', message: `Update started for ${game.title}. See Install Queue.` });
    } catch (error) { toast({ kind: 'error', message: errorMessage(error) }); }
  }

  async function checkUpdates(id?: string) {
    try { await window.launcher.checkGameUpdates(id); }
    catch (error) { toast({ kind: 'error', message: errorMessage(error) }); }
  }
  async function openDiagnosticLog(id: string) {
    try { setDiagnosticLog({ log: await window.launcher.readDiagnosticLog(id), operationId: id }); }
    catch (error) { toast({ kind: 'error', message: errorMessage(error) }); }
  }

  const selectedOperation = selected && data.gameOperation?.gameId === selected.id ? data.gameOperation : undefined;
  const gameBusy = Boolean(selectedOperation && ['preparing', 'running', 'stopping'].includes(selectedOperation.status));
  const launchOptions = useGameLaunchOptions(selected, data);
  const menuGame = data.games.find((game) => game.id === menu?.id);
  const modalGame = data.games.find((game) => game.id === dialogGame?.id);
  const managementProps = (game: Game): GameMenuActionsProps => ({
    onDetails: () => { setMenu(undefined); selectGame(game, true); },
    onPlay: () => { setMenu(undefined); void play(); },
    playDisabled: game.installState !== 'ready' || !data.backend.capabilities.run || !(data.settings.winePath || data.runtime.winePath),
    saved: collections.later.includes(game.id),
    onPlayLater: () => {
      const later = collections.later.includes(game.id) ? collections.later.filter(id => id !== game.id) : [...collections.later,game.id];
      if (!updateCollections({ ...collections,later })) toast({ kind:'error',message:'Play later could not be saved on this device.' });
      setMenu(undefined);
    },
    game, options: launchOptions, busy: gameBusy,
    onBrowse: () => { setMenu(undefined); void window.launcher.openPath(game.path).catch(error => toast({ kind: 'error', message: errorMessage(error) })); },
    onSettings: () => openDialog(game, 'settings'),
    onInstallVc: () => { setMenu(undefined); void installVc(game); },
    onRemove: () => openDialog(game, 'remove'),
    onShortcut: destination => {
      setMenu(undefined);
      void (destination === 'steam' ? window.launcher.addToSteam(game.id) : window.launcher.createGameShortcut(game.id, destination))
        .then(() => toast({ kind: 'success', message: destination === 'steam' ? 'Game added to Steam with available artwork.' : destination === 'desktop' ? 'Desktop shortcut created. Your desktop may ask you to allow launching it.' : 'Game added to applications menu.' }))
        .catch(error => toast({ kind: 'error', message: errorMessage(error) }));
    },
    onUpdate: () => { setMenu(undefined); if (data.gameUpdates?.[game.id]?.available) void updateInstalledGame(game); else void checkUpdates(game.id); },
    updateLabel: data.gameUpdates?.[game.id]?.checking ? 'Checking…' : data.gameUpdates?.[game.id]?.available ? 'Update game' : 'Check for updates',
    updateDisabled: Boolean(data.gameUpdates?.[game.id]?.checking || !game.storeId || game.installState !== 'ready' || !data.backend.capabilities.streaming || data.downloads.some(task => task.status === 'running')),
    onContent: () => { setMenu(undefined); setContentGameId(game.id); },
    contentDisabled: !game.storeId || data.auth.stored !== true || !data.backend.capabilities.library,
  });
  const selectedPanel = selected && detailOpen ? <GameDetails key={`${selected.id}:${data.auth.username}:${data.auth.stored}:${data.auth.running}:${data.backend.binaryPath}:${data.settings.market}`} game={selected} data={data} back={() => { if (selection && backToOrigin) backToOrigin(); else setDetailOpen(false); }} play={<>
          <button className="primary" data-gamepad-play disabled={gameBusy || selected.installState !== 'ready' || !data.backend.capabilities.run || !(data.settings.winePath || data.runtime.winePath)} onClick={() => play()}>{gameBusy ? <LoaderCircle className="spin" /> : <Play fill="currentColor" />}{gameBusy ? 'Working…' : 'Play'}</button>
          {gameBusy && !(selectedOperation?.kind === 'prerequisite' && selectedOperation.status === 'running') ? <button className="secondary danger" onClick={stopGame}><X />Stop</button> : null}
        </>} manageItems={gameContextMenuItems(managementProps(selected), text)} manage={<GameMenuActions {...managementProps(selected)} />} technical={<dl><div><dt>Store ID</dt><dd>{selected.storeId ?? 'Not found'}</dd></div><div><dt>Executable</dt><dd>{selected.executable ?? 'Not found'}</dd></div><div><dt>Location</dt><dd>{selected.path}</dd></div></dl>} notices={<>
      {selected.installMessage ? <div className="alert amber"><CircleAlert /><span>{selected.installMessage}</span></div> : null}
      <div className="game-update-status">{data.gameUpdates?.[selected.id]?.available ? <p className="success-text">Update available · {selected.installedVersion ?? 'Installed version'} → {data.gameUpdates[selected.id].latestVersion}</p> : data.gameUpdates?.[selected.id]?.available === false ? <p>Up to date · {data.gameUpdates[selected.id].latestVersion}</p> : null}{data.gameUpdates?.[selected.id]?.error ? <p className="error-text">{data.gameUpdates[selected.id].error}</p> : null}</div>
      {selectedOperation ? <details key={selectedOperation.id} className={`game-operation ${selectedOperation.status}`}><summary><strong>{selectedOperation.kind === 'prerequisite' ? selectedOperation.status === 'failed' ? 'Prerequisite failed' : selectedOperation.status === 'complete' ? 'Prerequisite ready' : 'Installing prerequisite' : selectedOperation.status === 'failed' ? 'Launch failed' : selectedOperation.status === 'complete' ? 'Game exited' : 'Launching game'}</strong><span>{selectedOperation.phase}</span></summary>{selectedOperation.log.length > 0 ? <pre>{selectedOperation.log.slice(-12).join('\n')}</pre> : null}{selectedOperation.logPath ? <button className="secondary" onClick={() => openDiagnosticLog(selectedOperation.id)}><FolderOpen />Open diagnostic log</button> : null}</details> : null}
    </>} /> : null;
  return <main ref={pageRef} className={`page library-page${detailOpen && selected ? ' library-detail-open' : ''}`}>
    <div hidden={Boolean(detailOpen && selected)}>
    <LibraryTabs active={view} select={changeView} />
    <h1 className="sr-only">My Library</h1>
    <div className="library-layout" role="tabpanel" aria-labelledby={`library-tab-${view}`}>
      <AccountGamesForUser data={{ ...data, games: collectionGames }} toast={toast} filters={view === 'games' ? filters : undefined} onFiltersChange={view === 'games' ? onFiltersChange : undefined} selectedId={selected?.id} select={selectGame} menu={openMenu} openProduct={openProduct} onImport={importGame} onCheckUpdates={() => void checkUpdates()} checkingUpdates={gameBusy || Object.values(data.gameUpdates ?? {}).some(update => update.checking)} lastPlayed={collections.history} localOnly={view !== 'games'} />
      {view !== 'games' && !collectionGames.length ? <p className="library-collection-empty">{view === 'later' ? 'Add games to Play later from their Options menu.' : 'Games launched through xboks will appear here. History is stored on this device.'}</p> : null}
    </div>
    </div>
    {selectedPanel}
    {menu && menuGame ? <GameContextMenu x={menu.x} y={menu.y} dismiss={() => setMenu(undefined)} restoreFocusTo={[...pageRef.current?.querySelectorAll<HTMLElement>('[data-gamepad-detail-target]') ?? []].find(card => card.getAttribute('data-gamepad-detail-target') === menu.id)} {...managementProps(menuGame)} /> : null}
{diagnosticLog ? <DiagnosticDialog log={diagnosticLog.log} close={() => setDiagnosticLog(undefined)} revealFile={() => window.launcher.revealDiagnosticLog(diagnosticLog.operationId)} copyLog={() => window.launcher.copyDiagnosticLog(diagnosticLog.operationId)} /> : null}
    {contentGameId && data.games.find(game => game.id === contentGameId) ? <GameContentDialog key={`${contentGameId}:${data.auth.username}:${data.auth.stored}`} game={data.games.find(game => game.id === contentGameId)!} data={data} close={() => setContentGameId(undefined)} toast={toast} /> : null}
    {dialogGame && modalGame ? <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !dialogBusy) setDialogGame(undefined); }}><section ref={gameDialogRef} className="game-dialog" role="dialog" aria-modal="true" aria-label={dialogGame.kind === 'remove' ? `Remove ${modalGame.title}` : `Settings for ${modalGame.title}`}>
      {dialogGame.kind === 'remove' ? <GameRemovalContents game={modalGame} busy={dialogBusy} close={() => setDialogGame(undefined)} remove={mode => { void removeGame(mode); }} /> : <form onSubmit={saveGameSettings}>
        <h2>Game settings</h2>
        <label>Display name<input required value={editTitle} onChange={(event) => setEditTitle(event.target.value)} /></label>
        <label>Game language<select value={editLocale} onChange={(event) => setEditLocale(event.target.value)}><option value="">System default</option>{localeOptions.map((locale) => <option key={locale} value={locale}>{locale}</option>)}{editLocale && !localeOptions.some((locale) => locale.toLowerCase() === editLocale.toLowerCase()) ? <option value={editLocale}>{editLocale}</option> : null}</select></label>
        <p>Available languages come from the game manifest. All games use the active compatibility runtime.</p>
        <GameLaunchToolFields value={editTools} change={setEditTools} />
        <div className="dialog-actions"><button type="button" className="secondary" disabled={dialogBusy} data-gamepad-cancel onClick={() => setDialogGame(undefined)}>Cancel</button><button className="primary" disabled={dialogBusy || !editTitle.trim()}><Check />Save</button></div>
      </form>}
    </section></div> : null}
  </main>;
}

export function DownloadsPage({ data, toast, onView = () => {}, installOptions, onDetails }: { data: AppSnapshot; toast: (value: Toast) => void; onView?: (view: LibraryView) => void; installOptions?: () => void; onDetails?: (task: AppSnapshot['downloads'][number]) => void }) {
  const startPackageInstall = usePackageInstall();
  const [expanded, setExpanded] = useState<string>();
  const [rowMenu, setRowMenu] = useState<string>();
  const [groupOpen, setGroupOpen] = useState(true);
  const [batchBusy, setBatchBusy] = useState(false);
  const queueRoot = useRef<HTMLElement>(null);
  const { text } = useReferenceLocale();
  const [queueAnchor, setQueueAnchor] = useState<HTMLElement | { x: number; y: number }>();
  const menuTask = data.downloads.find(task => task.id === rowMenu);
  function openQueueMenu(taskId: string, anchor: HTMLElement | { x: number; y: number }) {
    if (anchor instanceof HTMLElement) {
      const row = (anchor.closest('article') ?? anchor).getBoundingClientRect();
      setQueueAnchor({ x: row.right, y: row.bottom });
    } else setQueueAnchor(anchor);
    setRowMenu(taskId);
  }
  async function changeAll(resume: boolean) {
    setBatchBusy(true);
    const tasks = data.downloads.filter(task => task.status === (resume ? 'paused' : 'running') && task.canPause && !task.controlPending && !task.cancelling);
    let failed = 0;
    for (const task of tasks) { try { if (resume) await window.launcher.resumeDownload(task.id); else await window.launcher.pauseDownload(task.id); } catch { failed++; } }
    setBatchBusy(false);
    if (failed) toast({ kind: 'error', message: `${failed} installation controls failed. Check each installation before trying again.` });
  }
  const [retrying, setRetrying] = useState<string>();
  const [cancelId, setCancelId] = useState<string>(), [cancelOptions, setCancelOptions] = useState<DownloadCancelOptions>();
  const [checkingCancel, setCheckingCancel] = useState(false), [cancelling, setCancelling] = useState(false), [cancelError, setCancelError] = useState<string>();
  const cancelTask = data.downloads.find(task => task.id === cancelId);
  useEffect(() => {
    if (!cancelId) return;
    let current = true; setCancelOptions(undefined); setCheckingCancel(true); setCancelError(undefined);
    void window.launcher.getDownloadCancelOptions(cancelId).then(options => { if (current) setCancelOptions(options); })
      .catch(() => { if (current) setCancelOptions({ deleteFilesAllowed: false, reason: 'File ownership could not be verified. You can still cancel and keep the files.' }); })
      .finally(() => { if (current) setCheckingCancel(false); });
    return () => { current = false; };
  }, [cancelId]);
  async function cancel(mode: 'keep' | 'delete-files') {
    if (!cancelId || cancelling) return;
    setCancelling(true); setCancelError(undefined);
    try { await window.launcher.cancelDownload(cancelId, mode); setCancelId(undefined); toast({ kind: 'success', message: mode === 'delete-files' ? 'Download cancelled. Downloaded files were deleted.' : 'Download cancelled. Files were kept.' }); }
    catch (error) { setCancelError(errorMessage(error)); }
    finally { setCancelling(false); }
  }
  async function pauseOrResume(task: AppSnapshot['downloads'][number]) {
    try {
      if (task.status === 'paused') await window.launcher.resumeDownload(task.id);
      else await window.launcher.pauseDownload(task.id);
    } catch (error) { toast({ kind: 'error', message: errorMessage(error) }); }
  }
  async function remove(id: string) {
    try { await window.launcher.removeDownload(id); if (expanded === id) setExpanded(undefined); }
    catch (error) { toast({ kind: 'error', message: errorMessage(error) }); }
  }
  async function clearFinished() {
    try { await window.launcher.clearFinishedDownloads(); setExpanded(undefined); toast({ kind: 'success', message: 'Finished queue entries cleared. Game files were kept.' }); }
    catch (error) { toast({ kind: 'error', message: errorMessage(error) }); }
  }
  async function retry(task: AppSnapshot['downloads'][number]) {
    setRetrying(task.id);
    try {
      if (task.kind === 'update' && task.gameId) await window.launcher.updateInstalledGame(task.gameId);
      else if (task.kind === 'content') {
        if (!task.gameId) throw Error('This content download has no parent game.');
        await window.launcher.installGameContent(task.gameId, task.productId);
      }
      else if (!await startPackageInstall({ productId: task.productId, title: task.title, destination: task.destination })) return;
      toast({ kind: 'success', message: `Retrying ${task.title} with xboks Engine.` });
    } catch (error) { toast({ kind: 'error', message: errorMessage(error) }); }
    finally { setRetrying(undefined); }
  }

  const size = (bytes: number) => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GiB` : bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MiB` : `${Math.round(bytes / 1024)} KiB`;
  const finishedCount = data.downloads.filter((task) => !['running', 'paused', 'queued'].includes(task.status)).length;
  const ordered = [
    ...data.downloads.filter(task => task.status === 'running' || task.status === 'paused'),
    ...data.downloads.filter(task => task.status === 'queued').reverse(),
    ...data.downloads.filter(task => !['running', 'paused', 'queued'].includes(task.status)),
  ];
  return <main ref={queueRoot} className="page downloads-page">
    <LibraryTabs active="queue" select={onView} /><h1 className="sr-only">Install Queue</h1>
    <div className="queue-toolbar"><button className="secondary" disabled={!installOptions} onClick={installOptions}><Settings2 />Install options</button><button className="queue-update-check" disabled={data.auth.stored !== true || Object.values(data.gameUpdates ?? {}).some(update => update.checking)} onClick={() => { void window.launcher.checkGameUpdates().catch(error => toast({ kind: 'error', message: errorMessage(error) })); }}><RefreshCw />Check for updates</button></div>
    <div className="queue-group-heading"><button className="queue-group-toggle" aria-expanded={groupOpen} onClick={() => setGroupOpen(value => !value)}><ChevronUp style={{ transform: groupOpen ? undefined : 'rotate(180deg)' }} />Installations ({ordered.length})</button><div><button className="secondary" disabled={batchBusy || !data.downloads.some(task => task.status === 'paused' && task.canPause && !task.controlPending && !task.cancelling)} onClick={() => void changeAll(true)}><Download />Resume all</button><button className="secondary" disabled={batchBusy || !data.downloads.some(task => task.status === 'running' && task.canPause && !task.controlPending && !task.cancelling)} onClick={() => void changeAll(false)}><Pause />Pause all</button></div></div>
    {data.downloadProgressSupported === false ? <div className="alert amber"><CircleAlert /><span>Update xboks Engine in Settings for numeric download progress and Pause/Resume. Downloads still work with an older backend.</span></div> : null}
    {data.downloads.length === 0 ? <div className="empty-state"><div><Download /></div><h2>Nothing in the queue</h2><p>Installations started from Store will appear here.</p></div> : <div className="download-list" hidden={!groupOpen}>{ordered.map((task) => {
      const running = task.status === 'running'; const paused = task.status === 'paused'; const queued = task.status === 'queued'; const active = running || paused || queued; const failed = task.status === 'failed';
      return <article className={`download-item ${task.status}`} key={task.id} {...referenceMenuTrigger({ onOpen: anchor => openQueueMenu(task.id, 'element' in anchor ? anchor.element : { x: anchor.x, y: anchor.y }) })}>
        <div className="download-status">{task.coverUrl ? <img className="download-cover" src={task.coverUrl} alt={`${task.title} artwork`} /> : running ? <LoaderCircle className="spin" /> : queued ? <Clock3 /> : paused ? <Pause /> : failed ? <CircleAlert /> : task.status === 'complete' ? <PackageCheck /> : <X />}{task.coverUrl && (running || failed) ? <span className={`download-badge ${failed ? 'failed' : ''}`}>{running ? <LoaderCircle className="spin" /> : <CircleAlert />}</span> : null}</div>
        <div className="download-main"><div className="download-heading"><div><h3>{task.kind === 'update' ? `Update · ${task.title}` : task.title}</h3><span>{task.productId} · {task.destination}</span></div><strong>{task.progress === null ? (running ? 'Active' : task.status) : `${Math.round(task.progress)}%`}</strong></div><div className={`progress-track ${task.progress === null && running ? 'indeterminate' : ''}`}><i style={task.progress !== null ? { width: `${Math.max(0, Math.min(100, task.progress))}%` } : running ? undefined : { width: 0 }} /></div><p className={failed ? 'error-text' : ''}>{task.error ?? task.phase}{task.totalBytes ? ` · ${size(task.downloadedBytes ?? 0)} / ${size(task.totalBytes)}` : ''}{task.transferRate ? ` · ${downloadRateLabel(task.transferRate, data.settings.downloadSpeedUnit)}` : ''}{running && estimateTimeRemaining(task.transferRate, task.downloadedBytes, task.totalBytes) ? ` · ${estimateTimeRemaining(task.transferRate, task.downloadedBytes, task.totalBytes)}` : ''}</p><span className={`queue-readiness${installationReadiness(task, data.games).ready ? ' ready' : ''}`}>{installationReadiness(task, data.games).label}</span>{expanded === task.id ? <pre className="task-log">{task.log.length ? task.log.join('\n') : 'xboks Engine has not emitted text output yet.'}</pre> : null}</div>
        <button className="queue-row-options" data-queue-options={task.id} aria-label={`Options for ${task.title}`} aria-haspopup="menu" aria-expanded={rowMenu === task.id} onClick={event => { if (rowMenu === task.id) setRowMenu(undefined); else openQueueMenu(task.id, event.currentTarget); }}><MoreHorizontal /></button>

      </article>;
    })}</div>}
    {menuTask && queueAnchor ? <ReferenceMenu id={`queue-menu-${menuTask.id}`} label={`${text('Installation options for', 'Επιλογές εγκατάστασης για')} ${menuTask.title}`}
      anchor={queueAnchor instanceof HTMLElement ? { element: queueAnchor, align: 'end' } : { ...queueAnchor, restoreFocusTo: queueRoot.current?.querySelector<HTMLElement>(`[data-queue-options="${CSS.escape(menuTask.id)}"]`) ?? undefined }}
      onDismiss={() => setRowMenu(undefined)} items={downloadMenuItems(menuTask, {
        details: onDetails, retry: task => { void retry(task); }, pauseOrResume: task => { void pauseOrResume(task); },
        cancel: setCancelId, log: id => setExpanded(expanded === id ? undefined : id), remove: id => { void remove(id); },
      }, { retrying }, text)} /> : null}
    {finishedCount ? <button className="secondary queue-clear" disabled={data.downloads.some(task => task.cancelling)} onClick={clearFinished}><Trash2 />Clear finished</button> : null}
    {cancelTask ? <DownloadCancelDialog task={cancelTask} options={cancelOptions} loading={checkingCancel} busy={cancelling || Boolean(cancelTask.cancelling)} error={cancelError} close={() => setCancelId(undefined)} choose={mode => { void cancel(mode); }} /> : null}
  </main>;
}

function ToggleStatus({ ok, label }: { ok: boolean; label: string }) {
  return <span className={`dependency ${ok ? 'ok' : ''}`}>{ok ? <Check /> : <X />}{label}</span>;
}

export function SettingsPage({ data, toast, close = () => {}, initialSection = 'account' }: { data: AppSnapshot; toast: (value: Toast) => void; close?: () => void; initialSection?: SettingsSection }) {
  const locale = useReferenceLocale();
  const confirm = useConfirmation();
  const [section, setSection] = useState<SettingsSection>(initialSection);
  const [appearance, setAppearance] = useState(loadAppearance);
  async function requestClose() {
    if (busy) return;
    if (JSON.stringify(form) !== JSON.stringify(data.settings) && !await confirm({ title: 'Discard unsaved settings?', message: 'Unsaved installation and runtime settings will be discarded.', confirmLabel: 'Discard changes' })) return;
    close();
  }
  function appearanceChange(patch: Partial<typeof appearance>) {
    const next = { ...appearance, ...patch }; setAppearance(next);
    if (!saveAppearance(next)) toast({ kind: 'error', message: 'Appearance applied for this session, but could not be saved.' });
  }
  const [form, setForm] = useState<Settings>(data.settings);
  const [busy, setBusy] = useState<string>();
  const [logs, setLogs] = useState<string[]>([]);
  const [runtimeLogs, setRuntimeLogs] = useState<string[]>([]);
  useEffect(() => setForm(data.settings), [data.settings]);
  useEffect(() => window.launcher.onOperationLog(({ scope, line }) => {
    if (scope === 'backend') setLogs((items) => [...items.slice(-199), line]);
    if (scope === 'runtime') setRuntimeLogs((items) => [...items.slice(-199), line]);
  }), []);

  async function invoke(name: string, fn: () => Promise<unknown>, success?: string) {
    setBusy(name);
    try { await fn(); if (success) toast({ kind: 'success', message: success }); }
    catch (error) { toast({ kind: 'error', message: errorMessage(error) }); }
    finally { setBusy(undefined); }
  }

  async function pick(kind: 'install' | 'backend' | 'runtime' | 'wine') {
    const selected = kind === 'wine'
      ? await window.launcher.chooseFile(form.winePath)
      : await window.launcher.chooseDirectory(kind === 'install' ? form.installRoot : kind === 'backend' ? form.externalXodusRoot : form.runtimeRoot);
    if (selected) setForm((current) => ({ ...current, [kind === 'install' ? 'installRoot' : kind === 'backend' ? 'externalXodusRoot' : kind === 'runtime' ? 'runtimeRoot' : 'winePath']: selected }));
  }

  const caps = data.backend.capabilities;
  const runtimeInfo = runtimeDisplay(data.runtime);
  const runtimeArchiveTools = data.runtime.prerequisites.tar && data.runtime.prerequisites.sha512sum;
  return <SettingsFrame language={locale.language} active={section} select={setSection} close={() => void requestClose()} busy={Boolean(busy)}>
    <fieldset className="original-settings-fieldset" disabled={Boolean(busy)}><OriginalSettings language={locale.language} languagePreference={locale.preference} changeLanguage={locale.setPreference}
      closeSocialSurface={() => window.dispatchEvent(new Event('xboks-close-social'))}
      editAccount={() => { const pane = document.getElementById('account-session-controls') as HTMLDetailsElement | null; if (pane) { pane.open = true; pane.scrollIntoView({ block: 'nearest' }); pane.querySelector<HTMLElement>('button:not(:disabled)')?.focus(); } }}
      accountSettings={() => setSection('account')} desktopChange={patch => { void invoke('desktop-preferences', () => window.launcher.updateSettings(patch)); }} section={section} data={data} appearance={appearance} changeAppearance={appearanceChange}
      gameBar={() => { if (window.desktopGuide) void invoke('game-bar', () => window.desktopGuide!.toggle()); }}
      notificationChange={value => { void invoke('notification-preference', () => window.launcher.updateSettings({ downloadNotifications: value })); }} /></fieldset>
    {section === 'audio' ? <AudioSettings /> : null}

    <section className="settings-card compact launcher-card" hidden={section !== 'about'}>
      {data.launcherUpdate?.phase ? <p>{data.launcherUpdate.phase}</p> : null}
      {data.launcherUpdate?.updating ? <div className="progress-track"><i style={{ width: `${data.launcherUpdate.progress ?? 0}%` }} /></div> : null}
      {data.launcherUpdate?.error ? <div className="alert amber"><CircleAlert /><span>{data.launcherUpdate.error}</span></div> : null}
      <div className="settings-heading"><div className="settings-icon"><Rocket /></div><div><span className="overline">XBOKS</span><h2>{data.launcherUpdate?.currentVersion ?? 'Development build'}</h2><p>{data.launcherUpdate?.latestVersion ? `Version ${data.launcherUpdate.latestVersion} is available.` : 'Check GitHub for launcher updates.'}</p></div></div>
      <div className="button-row">
        {data.launcherUpdate?.latestVersion && data.launcherUpdate.canInstall && !data.launcherUpdate.restartRequired ? <button className="primary" disabled={data.launcherUpdate.updating || Boolean(busy)} onClick={async () => { if (await confirm({ title: 'Install launcher update?', message: 'The current AppImage will be backed up. Games and downloads must be stopped first.', confirmLabel: 'Install update' })) void invoke('launcher-install', () => window.launcher.installLauncherUpdate()); }}><ArrowDownToLine />{data.launcherUpdate.updating ? 'Updating…' : 'Install launcher update'}</button> : null}
        {data.launcherUpdate?.releaseUrl && !data.launcherUpdate.canInstall ? <a className="primary" href={data.launcherUpdate.releaseUrl} target="_blank" rel="noreferrer"><ArrowDownToLine />Download update</a> : null}
        {data.launcherUpdate?.restartRequired ? <button className="primary" onClick={() => invoke('launcher-restart', () => window.launcher.restartLauncher())}><RefreshCw />Restart launcher</button> : null}
        {data.launcherUpdate?.canRollback ? <button className="secondary" disabled={data.launcherUpdate.updating || Boolean(busy)} onClick={async () => { if (await confirm({ title: 'Restore previous launcher?', message: 'Your settings and games will not change.', confirmLabel: 'Restore launcher' })) void invoke('launcher-rollback', () => window.launcher.rollbackLauncherUpdate()); }}>Restore previous launcher</button> : null}
        <button className="secondary" disabled={data.launcherUpdate?.checking || data.launcherUpdate?.updating || data.launcherUpdate?.restartRequired} onClick={() => invoke('update-check', () => window.launcher.checkLauncherUpdate(), 'Update check finished.')}>{data.launcherUpdate?.checking ? <LoaderCircle className="spin" /> : <RefreshCw />}Check for updates</button>
        <button className="secondary" disabled={Boolean(busy)} title="Add xboks with artwork, including while Steam is running." onClick={() => invoke('steam-launcher', () => window.launcher.addToSteam(), 'xboks added to Steam.')}><Plus />Add xboks to Steam</button>
      </div>
    </section>

    <details id="account-session-controls" className="settings-card account-card original-account-session" hidden={section !== 'account'}><summary>{locale.text('Account sign-in and session', 'Σύνδεση και συνεδρία λογαριασμού')}</summary>
      <div className="settings-heading"><AccountAvatar auth={data.auth} large /><div><span className="overline">MICROSOFT ACCOUNT</span><h2>{data.auth.gamertag ?? data.auth.username ?? (data.auth.stored === false ? 'Not signed in' : 'Account status unavailable')}</h2><p>{data.auth.stored === true ? 'Signed in on this computer' : 'Sign in with your Microsoft account'}</p></div><span className={`status-label ${data.auth.stored === true ? 'ready' : data.auth.stored === false ? 'off' : 'unknown'}`}><StatusDot tone={data.auth.stored === true ? 'green' : data.auth.stored === false ? 'red' : 'amber'} />{data.auth.stored === true ? 'STORED' : data.auth.stored === false ? 'SIGNED OUT' : 'UNKNOWN'}</span></div>
      <div className="account-note"><CircleAlert /><span>{data.auth.note}</span></div>
      <KeyringSetup compact disabled={data.auth.running} />
      <div className="button-row"><button className="primary" disabled={!caps.login || data.auth.running} onClick={() => invoke('login', () => window.launcher.login(), 'Microsoft sign-in completed.')}>{data.auth.running ? <LoaderCircle className="spin" /> : <LogIn />}{data.auth.stored ? 'Sign in again' : 'Sign in with Microsoft'}</button><button className="secondary" disabled={!caps.logout || data.auth.running || data.auth.stored === false} onClick={() => invoke('logout', () => window.launcher.logout(), 'Stored account credentials were removed.')}>Sign out</button><button className="secondary" disabled={!caps.account || data.auth.running} onClick={() => invoke('account', () => window.launcher.refreshAccount())}><RefreshCw />Refresh status</button></div>
      <PasskeySignInNotice />
    </details>

    {section === 'install' ? <InstallSettings data={data} disabled={Boolean(busy)} working={value => setBusy(value ? 'install-preferences' : undefined)} /> : null}
    <details className="nexus-settings-extra" hidden={section !== 'install'}><summary>{locale.text('xboks Engine / Proton settings', 'Ρυθμίσεις xboks Engine / Proton')}</summary>
    <section className="settings-card" hidden={section !== 'install'}>
      <div className="settings-heading"><div className="settings-icon"><Terminal /></div><div><h2>xboks Engine</h2><p>{data.backend.version ? `xboks Engine ${data.backend.version}` : data.backend.available ? `Backend CLI ${data.backend.capabilities.version ?? 'unknown version'}` : 'Install the prebuilt xboks Engine'}</p></div><span className={`status-label ${data.backend.available ? 'ready' : 'off'}`}><StatusDot tone={data.backend.available ? 'green' : 'red'} />{data.backend.available ? 'VALIDATED' : 'OFFLINE'}</span></div>
      {data.backend.blockReason ? <div className="alert amber"><CircleAlert /><span>{data.backend.blockReason}</span></div> : null}
      {data.backend.phase ? <p className="runtime-phase">{data.backend.phase}</p> : null}
      <div className="backend-diagnostic-action"><BackendLogButton toast={toast} /><p className="fine-print">Local operation results and safe error codes. No passwords, tokens or account contents are recorded.</p></div>
      <div className="button-row end"><button className="secondary" disabled={Boolean(busy) || data.backend.checking || data.backend.updating} onClick={() => invoke('backend-check', () => window.launcher.checkBackendUpdate())}>{busy === 'backend-check' || data.backend.checking ? <LoaderCircle className="spin" /> : <RefreshCw />}Check for updates</button>{data.backend.releaseAvailable && data.backend.updateAvailable ? <button className="primary" disabled={Boolean(busy) || data.backend.updating || data.backend.checking} onClick={() => invoke('backend-update', () => window.launcher.updateBackend(), 'xboks Engine was verified, installed and activated.')}>{busy === 'backend-update' || data.backend.updating ? <LoaderCircle className="spin" /> : <ArrowDownToLine />}{data.backend.available ? 'Update backend' : 'Install backend'}</button> : null}</div>
    </section>

    <section className="settings-card" hidden={section !== 'install'}>
      <div className="settings-heading"><div className="settings-icon"><Gamepad2 /></div><div><h2>xboks Engine runtime</h2><p>Managed Proton compatibility runtime for Windows PC games.</p><p>{data.runtime.installed ? `Active: ${runtimeInfo.title} · ${runtimeInfo.version}` : 'No runtime selected'}</p></div><span className={`status-label ${data.runtime.installed && runtimeInfo.source === 'xboks Engine runtime' ? 'ready' : 'unknown'}`}><StatusDot tone={data.runtime.installed && runtimeInfo.source === 'xboks Engine runtime' ? 'green' : 'amber'} />{!data.runtime.installed ? 'MISSING' : runtimeInfo.source === 'xboks Engine runtime' ? 'READY' : 'OTHER RUNTIME'}</span></div>
      {data.runtime.nexusError ? <div className="alert amber"><CircleAlert /><span>{data.runtime.nexusError}</span></div> : null}
      {data.runtime.error ? <div className="alert amber"><CircleAlert /><span>{data.runtime.error}</span></div> : null}{data.runtime.phase ? <div className="runtime-phase"><LoaderCircle className={data.runtime.updating ? 'spin' : ''} /><span>{data.runtime.phase}</span></div> : null}
      {!runtimeArchiveTools ? <p className="fine-print">Install tar and sha512sum to install runtime archives.</p> : null}
      <div className="button-row end">
        <button className="secondary" disabled={Boolean(busy) || data.runtime.nexusChecking} onClick={() => invoke('runtime-check', () => window.launcher.checkNexusRuntime())}>{busy === 'runtime-check' || data.runtime.nexusChecking ? <LoaderCircle className="spin" /> : <RefreshCw />}Check for updates</button>
        {nexusRuntimeUpdateAvailable(data.runtime) ? <button className="primary" disabled={Boolean(busy) || data.runtime.updating || !runtimeArchiveTools} onClick={() => invoke('runtime-install-nexus', () => window.launcher.installNexusRuntime(), 'xboks Engine runtime was verified, installed, and selected.')}>{busy === 'runtime-install-nexus' || data.runtime.updating ? <LoaderCircle className="spin" /> : <ArrowDownToLine />}Install xboks Engine runtime{data.runtime.nexusVersion ? ` ${data.runtime.nexusVersion.replace(/^runtime-/, '')}` : ''}</button> : null}
      </div>
      {data.runtime.updating || runtimeLogs.length > 0 ? <pre className="build-log">{runtimeLogs.join('\n') || 'Waiting for output…'}</pre> : null}
    </section>

    <div className="settings-storage" hidden={section !== 'install'}>
      <section className="settings-card compact">
        <div className="settings-heading"><div className="settings-icon"><Download /></div><div><h2>Downloads</h2><p>Limit the combined game download speed across all parallel streams.</p></div></div>
        <div className="form-grid"><label>Download speed limit (MiB/s)<input type="number" min="0" max="1024" step="0.1" value={form.downloadLimitMiB ?? 0} onChange={event => setForm({...form, downloadLimitMiB:Number(event.target.value)})} /></label></div>
        <div className="save-row"><span>0 = unlimited. Applies to active and future game downloads.</span><button className="primary" disabled={Boolean(busy) || Boolean((form.downloadLimitMiB ?? 0) > 0 && !data.backend.capabilities.streamingBandwidthLimit)} onClick={() => invoke('save-bandwidth', () => window.launcher.updateSettings({downloadLimitMiB:form.downloadLimitMiB ?? 0}), 'Download speed limit saved.')}>{busy === 'save-bandwidth' ? <LoaderCircle className="spin" /> : <Check />}Save download limit</button></div>
      </section>
      <section className="settings-card compact"><div className="settings-heading"><div className="settings-icon"><HardDrive /></div><div><h2>Storage and launch paths</h2><p>The external engine source is never modified.</p></div></div><div className="form-grid"><label>Default game location<div className="input-action"><input value={form.installRoot} onChange={(event) => setForm({ ...form, installRoot: event.target.value })} /><button onClick={() => pick('install')}><FolderOpen /></button></div></label><label>Market<input value={form.market} onChange={(event) => setForm({ ...form, market: event.target.value })} /></label><label>Parallel streams<input type="number" min="1" max="16" value={form.parallelDownloads} onChange={(event) => setForm({ ...form, parallelDownloads: Number(event.target.value) })} /></label><label>External engine source<div className="input-action"><input value={form.externalXodusRoot} onChange={(event) => setForm({ ...form, externalXodusRoot: event.target.value })} /><button onClick={() => pick('backend')}><FolderOpen /></button></div></label><label>Versioned runtime directory<div className="input-action"><input value={form.runtimeRoot} onChange={(event) => setForm({ ...form, runtimeRoot: event.target.value })} /><button onClick={() => pick('runtime')}><FolderOpen /></button></div></label><label>Wine / Proton binary<div className="input-action"><input value={form.winePath} onChange={(event) => setForm({ ...form, winePath: event.target.value })} placeholder="Selected automatically by the runtime manager" /><button onClick={() => pick('wine')}><FolderOpen /></button></div></label></div><div className="save-row"><span>Settings are stored locally in Electron userData.</span><button className="primary" disabled={busy === 'save'} onClick={() => invoke('save', () => window.launcher.updateSettings(form), 'Settings saved.')}>{busy === 'save' ? <LoaderCircle className="spin" /> : <Check />}Save</button></div></section>
    </div>
    <details className="settings-card settings-diagnostics" hidden={section !== 'install'}>
      <summary><Settings2 /><span>Advanced / Diagnostics</span><ChevronRight /></summary>
      <div className="diagnostics-content">
        <section><h3>Game logging</h3><div className="toggle-row"><label className="toggle"><input type="checkbox" checked={form.verboseLogs} onChange={(event) => setForm({ ...form, verboseLogs: event.target.checked })} /><span>Verbose game logs</span></label><p>Writes full Wine, vkd3d-proton and xboks Engine diagnostics to the per-game log file and stops coalescing repeated lines. Slower and much larger logs; use temporarily when diagnosing a crash.</p></div><div className="button-row"><button className="secondary" disabled={Boolean(busy)} onClick={() => invoke('save-diagnostics', () => window.launcher.updateSettings({ verboseLogs: form.verboseLogs }), 'Logging settings saved.')}>Save diagnostics</button></div></section>
        <section><h3>Backend details</h3><p className="diagnostic-path mono">{data.backend.binaryPath ?? 'No backend selected'}</p><div className="meta-grid"><div><span>SOURCE</span><strong>{data.backend.source === 'external' ? 'External installation · read-only' : data.backend.delivery === 'release' ? 'xboks Engine release' : data.backend.source === 'managed' ? 'Local versioned build' : '—'}</strong></div><div><span>COMMIT</span><strong className="mono">{data.backend.commit?.slice(0, 12) ?? '—'}</strong></div></div><div className="button-row"><button className="secondary" disabled={Boolean(busy) || data.backend.updating || data.backend.checking} onClick={() => invoke('backend-rebuild', () => window.launcher.rebuildBackend(), 'Pinned backend source was built and activated.')}><Github />Build backend from source</button></div>{data.backend.updating || logs.length > 0 ? <pre className="build-log">{logs.join('\n') || 'Waiting for backend output…'}</pre> : null}</section>
        <section><h3>Runtime details</h3><p className="diagnostic-path mono">{data.runtime.winePath ?? 'No runtime selected'}</p><div className="meta-grid"><div><span>SOURCE</span><strong>{runtimeInfo.source}</strong></div><div><span>BUILD</span><strong className="mono">{data.runtime.commit ?? '—'}</strong></div></div></section>
        <section><h3>Build dependencies</h3><div className="dependency-grid"><ToggleStatus ok={data.backend.prerequisites.git} label="Git" /><ToggleStatus ok={data.backend.prerequisites.cargo} label="Cargo" /><ToggleStatus ok={data.backend.prerequisites.rustc} label="Rust 1.99" /><ToggleStatus ok={data.backend.prerequisites.protoc} label="protoc" /></div><p className="fine-print">Building xboks Engine also requires a C/C++ toolchain, CMake, OpenSSL 3 and D-Bus development packages.</p></section>
      </div>
    </details>
    </details>
  </SettingsFrame>;
}

function backendSetupHint(backend: AppSnapshot['backend']): string {
  if (backend.checking) return 'Checking for xboks Engine…';
  if (backend.updating) return backend.phase ? `Installing xboks Engine… ${backend.phase}` : 'Installing xboks Engine…';
  if (backend.blockReason) return backend.blockReason;
  return 'Sign-in unlocks once xboks Engine is installed.';
}

function PasskeySignInNotice() {
  return <p className="passkey-sign-in-notice">Passkey sign-in requires Google Chrome installed on this computer. Other browsers are not supported. If Microsoft sign-in gets stuck, choose Continue in browser in the sign-in window.</p>;
}

export function FirstRunWizard({ data, toast }: { data: AppSnapshot; toast: (value: Toast) => void }) {
  const [installRoot, setInstallRoot] = useState(data.settings.installRoot);
  const [saving, setSaving] = useState(false);
  const [signingIn, setSigningIn] = useState(false);

  async function browse() {
    try {
      const picked = await window.launcher.chooseDirectory(installRoot);
      if (picked) setInstallRoot(picked);
    } catch (error) { toast({ kind: 'error', message: errorMessage(error) }); }
  }
  async function signIn() {
    setSigningIn(true);
    try { await window.launcher.login(); }
    catch (error) { toast({ kind: 'error', message: errorMessage(error) }); }
    finally { setSigningIn(false); }
  }
  async function finish() {
    setSaving(true);
    try {
      await window.launcher.updateSettings({ installRoot, firstRunCompleted: true });
      toast({ kind: 'success', message: 'Welcome to xboks. Install a game from the Store to get started.' });
    } catch (error) { toast({ kind: 'error', message: errorMessage(error) }); }
    finally { setSaving(false); }
  }

  return <div className="wizard-overlay">
    <div className="wizard" role="dialog" aria-modal="true" aria-label="Set up xboks">
      <div><span className="overline">WELCOME</span><h1>Set up xboks</h1></div>
      <section className="wizard-disclaimer" role="note" aria-labelledby="wizard-disclaimer-title">
        <CircleAlert aria-hidden="true" />
        <div><h2 id="wizard-disclaimer-title">Independent, unofficial project</h2>
          <p>xboks is an <strong>independent, unofficial Linux client</strong>. It is not affiliated with or endorsed by Microsoft or Xbox. Upstream credits and licenses are available in Settings → About.</p>
          <p>Please report xboks issues in the <a href="https://github.com/slaveitgr/xboks/issues" target="_blank" rel="noopener noreferrer">xboks repository</a>.</p>
        </div>
      </section>
      <p>Choose where games install. Everything else can be changed later in Settings.</p>
      <label className="wizard-field">Games folder
        <div className="input-action"><input data-gamepad-initial value={installRoot} onChange={(event) => setInstallRoot(event.target.value)} /><button onClick={() => void browse()} title="Browse"><FolderOpen /></button></div>
        <small>New games download and extract into this folder.</small>
      </label>
      <KeyringSetup compact disabled={signingIn || data.auth.running} />
      <div className="wizard-account">
        <div><strong>Microsoft account</strong><small>{data.backend.available ? (data.auth.stored === true ? `Signed in as ${data.auth.username ?? 'stored account'}` : data.auth.stored === false ? 'Not signed in yet — Store browsing works without an account' : 'Account status is still being checked') : backendSetupHint(data.backend)}</small></div>
        <button className="secondary" disabled={!data.backend.capabilities.login || signingIn || data.auth.running} onClick={() => void signIn()}>{signingIn ? <LoaderCircle className="spin" /> : <LogIn />}{data.auth.stored ? 'Sign in again' : 'Sign in'}</button>
      </div>
      <div className="wizard-actions">
        <PasskeySignInNotice />
        <span>Signing in can also be done later from Settings.</span>
        <button className="primary" disabled={saving} onClick={() => void finish()}>{saving ? <LoaderCircle className="spin" /> : <Check />}Start using xboks</button>
      </div>
    </div>
  </div>;
}

export function GlobalSearch({ games, page, query, change, submit, select }: {
  games: Game[]; page: Page; query: string; change: (value: string) => void;
  submit: (value: string) => void; select: (id: string) => void;
}) {
  const { text } = useReferenceLocale();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [page]);
  const term = query.trim().toLowerCase();
  const results = term ? games.filter(game => `${game.title} ${game.storeId ?? ''}`.toLowerCase().includes(term)) : [];
  const visible = open && page !== 'store' && results.length > 0;
  return <div className="search-box" onFocus={() => setOpen(true)} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  }}><Search /><input value={query} onChange={event => { change(event.target.value); setOpen(true); }} onKeyDown={event => {
    if (event.key === 'Escape') setOpen(false);
    if (event.key === 'Enter' && term.length >= 2) { setOpen(false); submit(query.trim()); }
  }} aria-expanded={visible} aria-controls={visible ? 'global-search-results' : undefined} placeholder={text('Search for games, add-ons and more', 'Αναζήτηση για παιχνίδια, πρόσθετα και άλλα')} />
    {query ? <button aria-label="Clear search" onClick={() => { change(''); setOpen(false); }}><X /></button> : null}
    {visible ? <div className="search-results" id="global-search-results">{results.map(game => <button key={game.id} onClick={() => { setOpen(false); change(''); select(game.id); }}><Cover game={game} /><span><GameTitle title={game.title} /><small>{game.storeId ?? game.path}</small></span></button>)}</div> : null}
  </div>;
}

interface ShellLocation {
  page: Page; product?: CatalogProduct; query: string; game?: { id: string }; view: LibraryView;
  scrollTop: number; focusSelector?: string;
}

export default function App() {
  const [catalogProduct, setCatalogProduct] = useState<CatalogProduct>();
  const [page, setPage] = useState<Page>(() => window.location.hash === '#store' ? 'store' : 'home');
  const [data, setData] = useState<AppSnapshot>(emptySnapshot);
  const [loading, setLoading] = useState(true);
  const [dismissedLaunch, setDismissedLaunch] = useState<string>();
  const [toast, setToast] = useState<Toast>();
  const [search, setSearch] = useState('');
  const [libraryView, setLibraryView] = useState<LibraryView>('games');
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('account');
  const [shellPanel, setShellPanel] = useState<ShellPanel>();
  const [history, setHistory] = useState<ShellLocation[]>([]);
  const [returnPoint, setReturnPoint] = useState<ShellLocation>();
  const [guideOpen, setGuideOpen] = useState(false);
  const [guideTab, setGuideTab] = useState<GuideTab>('home');
  const previousPage = useRef<Page>('home');
  useEffect(() => { if (page !== 'settings') previousPage.current = page; }, [page]);
  useEffect(() => { applyAppearance(loadAppearance()); }, []);

  const contentPage = page === 'settings' ? previousPage.current : page;
  const [submittedSearch, setSubmittedSearch] = useState('');
  // App stays mounted while pages change, unlike LibraryPage/AccountGames.
  const [libraryFilters, setLibraryFilters] = useState<LibraryFilters>(() => loadLibraryFilters());
  const [librarySelection, setLibrarySelection] = useState<{ id: string }>();
  useEffect(() => window.desktopGuide?.onNavigate(({ page, gameId }) => {
    if (gameId) openLibraryGame(gameId);
    else navigate(page as Page);
  }), [data.games, page, catalogProduct, submittedSearch, librarySelection, libraryView]);

  useEffect(() => {
    void window.launcher.getSnapshot().then((value) => { setData(value); setLoading(false); }).catch((error) => { setToast({ kind: 'error', message: errorMessage(error) }); setLoading(false); });
    return window.launcher.onSnapshot(setData);
  }, []);
  useEffect(() => { if (!toast) return; const timeout = window.setTimeout(() => setToast(undefined), 5000); return () => window.clearTimeout(timeout); }, [toast]);
  useEffect(() => {
    // XODUS_DEMO_TOUR=1 cycles through the pages for screenshot capture.
    if (!window.launcher.isDemoTour()) return;
    const order: Page[] = ['home', 'library', 'store', 'downloads', 'settings'];
    let index = 0;
    const timer = window.setInterval(() => { index = (index + 1) % order.length; setPage(order[index]); }, 7000);
    return () => window.clearInterval(timer);
  }, []);


  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key.toLowerCase() === 'g' && !event.repeat) { event.preventDefault(); if (window.desktopGuide) void window.desktopGuide.toggle().catch(error => setToast({ kind: 'error', message: errorMessage(error) })); else setGuideOpen(value => !value); }
    };
    let held = false;
    const timer = window.setInterval(() => {
      const pressed = Array.from(navigator.getGamepads?.() ?? []).some(pad => pad?.buttons[16]?.pressed);
      if (pressed && !held) {
        if (window.desktopGuide) void window.desktopGuide.toggle().catch(error => setToast({ kind: 'error', message: errorMessage(error) }));
        else setGuideOpen(value => !value);
      }
      held = pressed;
    }, 100);
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('keydown', key); window.clearInterval(timer); };
  }, []);

  function changeLibraryFilters(filters: LibraryFilters) {
    setLibraryFilters(filters);
    if (!saveLibraryFilters(filters)) setToast({ kind: 'error', message: 'Library filters could not be saved. They may reset after restarting xboks.' });
  }

  function openLibraryGame(id: string) {
    if (!data.games.some(game => game.id === id)) return;
    rememberLocation();
    setShellPanel(undefined);
    setLibraryView('games');
    setLibrarySelection({ id });
    setSearch('');
    changeLibraryFilters({ ...defaultLibraryFilters, playState: 'installed' });
    setPage('library');
  }

  function action(fn: () => Promise<unknown>, success?: string) { void fn().then(() => success && setToast({ kind: 'success', message: success })).catch((error) => setToast({ kind: 'error', message: errorMessage(error) })); }

  useEffect(() => {
    const operation = data.gameOperation;
    if (operation?.kind !== 'launch' || operation.status !== 'running') return;
    const key = collectionKey(data.auth), saved = loadCollections(key);
    saved.history[operation.gameId] = Date.now(); saveCollections(key, saved);
  }, [data.gameOperation?.id, data.gameOperation?.status, data.auth.username]);

  function switchLibraryView(view: LibraryView) {
    if (view !== 'queue') setLibraryView(view);
    navigate(view === 'queue' ? 'downloads' : 'library');
  }
  function currentLocation(): ShellLocation {
    const active = document.activeElement as HTMLElement | null;
    const productOwner = active?.closest<HTMLElement>('[data-product-id]');
    const product = productOwner?.dataset.productId;
    const productSelector = product && productOwner ? `${productOwner.tagName.toLowerCase()}${productOwner.classList[0] ? `.${CSS.escape(productOwner.classList[0])}` : ''}[data-product-id="${CSS.escape(product)}"]${productOwner.matches('button,a') ? '' : productOwner.classList.contains('catalog-details-page') ? ' .catalog-detail-actions .primary' : ' button'}` : undefined;
    const game = active?.getAttribute('data-gamepad-detail-target');
    const operation = active?.closest<HTMLElement>('[data-queue-options]')?.dataset.queueOptions;
    return { page: page === 'settings' ? previousPage.current : page, product: contentPage === 'store' ? catalogProduct : undefined,
      query: contentPage === 'store' ? submittedSearch : '', game: contentPage === 'library' ? librarySelection : undefined, view: libraryView,
      scrollTop: document.querySelector('.page-scroll')?.scrollTop ?? 0,
      focusSelector: productSelector ?? (game ? `[data-gamepad-detail-target="${CSS.escape(game)}"]` : operation ? `[data-queue-options="${CSS.escape(operation)}"]` : undefined) };
  }
  function rememberLocation() {
    setReturnPoint(undefined);
    const location = currentLocation();
    setHistory(items => [...items, location]);
  }
  function navigate(next: Page) {
    setShellPanel(undefined);
    if (next === 'settings') { setSettingsSection('account'); setPage(next); return; }
    if (next !== contentPage || catalogProduct || librarySelection) rememberLocation();
    setCatalogProduct(undefined); setLibrarySelection(undefined);
    if (next === 'store') setSubmittedSearch('');
    setPage(next);
    document.querySelector('.page-scroll')?.scrollTo({ top: 0 });
  }
  function openCatalogProduct(product: CatalogProduct) {
    rememberLocation(); setShellPanel(undefined); setSubmittedSearch('');
    setCatalogProduct(product); setPage('store');
    document.querySelector('.page-scroll')?.scrollTo({ top: 0 });
  }
  function openSettings(section: SettingsSection) {
    setShellPanel(undefined); setSettingsSection(section); setPage('settings');
  }
  function back() {
    if (shellPanel) { setShellPanel(undefined); return; }
    if (page === 'settings') { setPage(previousPage.current); return; }
    const previous = history.at(-1);
    if (!previous) {
      setCatalogProduct(undefined); setLibrarySelection(undefined); setPage('home'); return;
    }
    setHistory(items => items.slice(0, -1));
    setCatalogProduct(previous.product); setSubmittedSearch(previous.query);
    setLibrarySelection(previous.game); setLibraryView(previous.view);
    setPage(previous.page); setReturnPoint(previous);
  }
  useBrowserLayoutEffect(() => {
    if (!returnPoint) return;
    const scroll = document.querySelector('.page-scroll');
    let frame = 0;
    const finish = () => { observer.disconnect(); clearTimeout(deadline); };
    const restore = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (scroll) scroll.scrollTop = returnPoint.scrollTop;
        const target = returnPoint.focusSelector ? document.querySelector<HTMLElement>(returnPoint.focusSelector) : undefined;
        if (target) { target.focus({ preventScroll: true }); finish(); }
        else if (!returnPoint.focusSelector) finish();
      });
    };
    const observer = new MutationObserver(restore);
    const deadline = setTimeout(finish, 2500);
    if (scroll) observer.observe(scroll, { childList: true, subtree: true });
    restore();
    return () => { finish(); cancelAnimationFrame(frame); };
  }, [returnPoint]);

  if (loading) return <div className="boot"><div className="brand-mark">X</div><LoaderCircle className="spin" /><span>Loading xboks</span></div>;
  return <ConfirmationProvider><PackageInstallProvider><div className="app-shell xbox-mode">
    {!data.settings.firstRunCompleted ? <FirstRunWizard data={data} toast={(value) => setToast(value)} /> : null}
    <Sidebar data={data} page={page} go={navigate} openGame={openLibraryGame} onPanel={setShellPanel} />

    <section className={`content-shell${contentPage === 'home' ? ' home-shell' : ''}`} style={contentPage === 'home' && (data.games[0]?.heroUrl || data.games[0]?.coverUrl) ? { '--shell-art': `url(${JSON.stringify(data.games[0].heroUrl ?? data.games[0].coverUrl)})` } as React.CSSProperties : undefined}>
      <header className="topbar">{page !== 'home' ? <button className="shell-back" aria-label="Back" onClick={() => { if (!dispatchBackHandlers(window, document)) back(); }}><ChevronLeft /></button> : null}<div className="shell-version">xboks · {data.launcherUpdate?.currentVersion ?? '0.3.11'}</div><GlobalSearch games={data.games} page={page} query={search} change={setSearch} submit={value => { rememberLocation(); setCatalogProduct(undefined); setSubmittedSearch(value); setPage('store'); }} select={openLibraryGame} /><div className="shell-tools"><XboxFullButton onError={message => setToast({ kind: 'error', message })} /><button className="guide-trigger" aria-label="Open Game Bar" title="Game Bar (Win+G)" onClick={() => { if (window.desktopGuide) action(() => window.desktopGuide!.toggle()); else setGuideOpen(true); }}><Gamepad2 /></button><span className="shell-power" title="Connected to desktop session"><Cable /></span><BatteryStatus /><ShellClock /></div></header>
      <div className="page-scroll">{contentPage === 'home' ? <HomePage data={data} go={navigate} action={action} openGame={openLibraryGame} openProduct={openCatalogProduct} /> : null}{contentPage === 'gamepass' ? <GamePassPage data={data} go={navigate} select={openCatalogProduct} playLater={() => switchLibraryView('later')} /> : null}{contentPage === 'store' ? <StorePage data={data} toast={setToast} go={navigate} initialQuery={submittedSearch} initialProduct={catalogProduct} openProduct={openCatalogProduct} back={back} openGame={openLibraryGame} /> : null}{contentPage === 'library' ? <LibraryPage data={data} toast={setToast} filters={libraryFilters} onFiltersChange={changeLibraryFilters} selection={librarySelection} view={libraryView} onView={switchLibraryView} openProduct={openCatalogProduct} openGame={openLibraryGame} backToOrigin={back} /> : null}{contentPage === 'downloads' ? <DownloadsPage data={data} toast={setToast} onView={switchLibraryView} installOptions={() => openSettings('install')} onDetails={task => {
      const game = data.games.find(game => game.id === task.gameId || game.storeId === task.productId);
      if (game) { setLibraryView('games'); openLibraryGame(game.id); }
      else { const product = queuedCatalogProduct(task); if (product) openCatalogProduct(product); else setToast({ kind: 'error', message: 'This queue entry has no Product ID.' }); }
    }} /> : null}</div>
    </section>
    {page === 'settings' ? <SettingsPage key={settingsSection} initialSection={settingsSection} data={data} toast={setToast} close={() => setPage(previousPage.current)} /> : null}
    {toast ? <div className={`toast ${toast.kind}`}>{toast.kind === 'success' ? <Check /> : toast.kind === 'error' ? <CircleAlert /> : <Terminal />}<span>{toast.message}</span><button onClick={() => setToast(undefined)}><X /></button></div> : null}
  </div>{data.gameOperation?.kind === 'launch' && ['preparing', 'failed'].includes(data.gameOperation.status) && dismissedLaunch !== `${data.gameOperation.id}:${data.gameOperation.startedAt}:${data.gameOperation.status}` ? <LaunchExperience key={`${data.gameOperation.id}:${data.gameOperation.startedAt}:${data.gameOperation.status}`} operation={data.gameOperation} game={data.games.find(game => game.id === data.gameOperation?.gameId)} close={() => setDismissedLaunch(`${data.gameOperation!.id}:${data.gameOperation!.startedAt}:${data.gameOperation!.status}`)} /> : null}{shellPanel ? <ShellFlyout panel={shellPanel} data={data} close={() => setShellPanel(undefined)} go={navigate} settings={openSettings} /> : null}{guideOpen ? <GuideOverlay data={data} tab={guideTab} setTab={setGuideTab} close={() => setGuideOpen(false)} go={setPage} openGame={openLibraryGame} /> : null}<GamepadNavigation back={() => { if (guideOpen) setGuideOpen(false); else back(); }} page={delta => {
    if (guideOpen) { setGuideTab(current => guideTabs[(guideTabs.indexOf(current) + delta + guideTabs.length) % guideTabs.length]); return; }
    if (page === 'settings') { window.dispatchEvent(new CustomEvent('xboks-settings-section', { detail: delta })); return; }
    setPage(current => {
    const pages: Page[] = ['home', 'gamepass', 'library', 'store'];
    const index = pages.indexOf(current);
    return index === -1 ? pages[delta > 0 ? 0 : pages.length - 1] : pages[(index + delta + pages.length) % pages.length];
  }); }} /></PackageInstallProvider></ConfirmationProvider>;
}
