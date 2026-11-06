import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import type { AppSnapshot, CatalogProduct, Game, Page } from '../shared/types';
import { CircleUserRound, Cloud, Gamepad2, GamePassBadge, Library, Search, Settings, Store } from './XboxIcons';
import { SubscriptionBadge } from './SubscriptionBadge';
import { useReferenceLocale } from './ReferenceLocale';
import './xbox-mode-home.css';

export interface XboxModeHomeItem {
  key: string;
  title: string;
  cover?: string;
  hero?: string;
  publisher?: string;
  game?: Game;
  product?: CatalogProduct;
}

/** Catalog metadata can improve local artwork, but never supplies installation
 * or account access. With an empty library, catalog items open Store details. */
export function xboxModeHomeItems(games: readonly Game[], products: readonly CatalogProduct[]): XboxModeHomeItem[] {
  const catalog = new Map(products.map(product => [product.productId.toUpperCase(), product]));
  const seen = new Set<string>();
  if (games.length) return games.filter(game => {
    if (seen.has(game.id)) return false;
    seen.add(game.id); return true;
  }).slice(0, 12).map(game => {
    const product = game.storeId ? catalog.get(game.storeId.toUpperCase()) : undefined;
    return { key: `game:${game.id}`, title: game.title, game,
      cover: game.coverUrl ?? game.coverDataUrl ?? product?.posterUrl,
      hero: game.heroUrl ?? product?.heroUrl ?? game.coverUrl ?? game.coverDataUrl ?? product?.posterUrl,
      publisher: game.publisher ?? product?.publisher };
  });
  return products.filter(product => {
    const id = product.productId.toUpperCase();
    if (seen.has(id)) return false;
    seen.add(id); return true;
  }).slice(0, 12).map(product => ({ key: `product:${product.productId}`, title: product.title, product,
    cover: product.posterUrl, hero: product.heroUrl ?? product.posterUrl, publisher: product.publisher }));
}

type Navigation = {
  go: (page: Page) => void;
  openGame?: (id: string) => void;
  openProduct?: (product: CatalogProduct) => void;
};

/** A on Home opens the existing details route. Neither focus nor this action
 * requests installation, claims entitlement or launches an executable. */
export function openXboxModeHomeItem(item: XboxModeHomeItem, navigation: Navigation): void {
  if (item.game) {
    if (navigation.openGame) navigation.openGame(item.game.id);
    else navigation.go('library');
  } else if (item.product && navigation.openProduct) navigation.openProduct(item.product);
  else navigation.go('store');
}

export interface XboxModeHomeProps extends Navigation {
  data: AppSnapshot;
  onSearch: () => void;
  onAccount?: () => void;
  onCustomize?: () => void;
  /** The shell owns clock/battery subscriptions; this slot avoids duplicates. */
  status?: ReactNode;
  /** Optional public metadata for previews or an already loaded catalog. */
  catalog?: readonly CatalogProduct[];
}

function Artwork({ source, className = '' }: { source?: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  return <span className={`console-home-art ${className}`}>
    {source && !failed ? <img src={source} alt="" onError={() => setFailed(true)} /> : <Gamepad2 />}
  </span>;
}

function Avatar({ source }: { source?: string }) {
  const [failed, setFailed] = useState(false);
  return <span className="console-home-avatar">{source && !failed
    ? <img src={source} alt="" onError={() => setFailed(true)} /> : <CircleUserRound />}</span>;
}

export function XboxModeHome({ data, go, openGame, openProduct, onSearch, onAccount, onCustomize, status, catalog }: XboxModeHomeProps) {
  const { text, language } = useReferenceLocale();
  const [fetched, setFetched] = useState<readonly CatalogProduct[]>([]);
  const [catalogState, setCatalogState] = useState<'loading' | 'available' | 'unavailable'>('loading');
  const [selectedKey, setSelectedKey] = useState<string>();
  const id = useId();
  useEffect(() => {
    if (catalog !== undefined) return;
    let alive = true;
    const bridge = typeof window === 'undefined' ? undefined : window.launcher;
    if (!bridge?.getFeaturedCatalog) { setCatalogState('unavailable'); return; }
    void bridge.getFeaturedCatalog().then(result => {
      if (alive) { setFetched(result.products); setCatalogState('available'); }
    }).catch(() => { if (alive) setCatalogState('unavailable'); });
    return () => { alive = false; };
  }, [catalog]);
  const products = catalog ?? fetched;
  const items = useMemo(() => xboxModeHomeItems(data.games, products), [data.games, products]);
  const selected = items.find(item => item.key === selectedKey) ?? items[0];
  const signedIn = data.auth.stored === true && !data.auth.running;
  const account = signedIn ? data.auth.gamertag ?? data.auth.profile?.gamertag ?? data.auth.username
    ?? text('Your profile', 'Το προφίλ σας') : text('Sign in', 'Σύνδεση');
  const avatar = signedIn ? data.auth.avatarDataUrl ?? data.auth.profile?.avatarDataUrl : undefined;
  const score = signedIn ? data.auth.profile?.gamerscore : undefined;
  const hasScore = typeof score === 'number' && Number.isSafeInteger(score) && score >= 0;
  const navigation = { go, openGame, openProduct };
  const featured = products[0];
  const select = (item: XboxModeHomeItem, target?: HTMLButtonElement) => {
    setSelectedKey(item.key);
    target?.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
  };
  const currentState = selected?.game
    ? data.gameOperation?.gameId === selected.game.id && data.gameOperation.status === 'running'
      ? text('Running', 'Εκτελείται') : selected.game.installState === 'ready'
        ? text('Installed', 'Εγκατεστημένο') : selected.game.installState === 'incomplete'
          ? text('Installation incomplete', 'Η εγκατάσταση δεν ολοκληρώθηκε') : text('Imported game', 'Εισηγμένο παιχνίδι')
    : selected?.product ? text('Microsoft Store', 'Microsoft Store') : undefined;

  return <main className="xbox-mode-home" aria-label={text('Xbox mode Home', 'Αρχική λειτουργίας Xbox')}>
    <div className="console-home-background" aria-hidden="true">{selected?.hero
      ? <img key={selected.hero} src={selected.hero} alt="" onError={event => { event.currentTarget.hidden = true; }} /> : null}</div>
    <header className="console-home-header">
      <button className="console-home-account" aria-label={signedIn ? text(`View profile: ${account}`, `Προβολή προφίλ: ${account}`) : account}
        onClick={onAccount ?? (() => go(signedIn ? 'profile' : 'settings'))}>
        <Avatar key={avatar ?? 'signed-out'} source={avatar} />
        <span className="console-home-account-copy"><span><strong>{account}</strong>{signedIn ? <SubscriptionBadge value={data.auth.subscription} /> : null}</span>
          {hasScore ? <span className="console-home-score" aria-label={text(`Gamerscore ${score}`, `Βαθμολογία παίκτη ${score}`)}><b aria-hidden="true">G</b>{new Intl.NumberFormat(language).format(score)}</span> : null}</span>
      </button>
      <nav className="console-home-shortcuts" data-gamepad-action-row="" aria-label={text('Xbox mode navigation', 'Πλοήγηση λειτουργίας Xbox')}>
        <button title={text('My Library', 'Η βιβλιοθήκη μου')} aria-label={text('My Library', 'Η βιβλιοθήκη μου')} onClick={() => go('library')}><Library /></button>
        <button title="Store" aria-label="Store" onClick={() => go('store')}><Store /></button>
        <button title="Game Pass" aria-label="Game Pass" onClick={() => go('gamepass')}><GamePassBadge /></button>
        <button title={text('Search', 'Αναζήτηση')} aria-label={text('Search', 'Αναζήτηση')} onClick={onSearch}><Search /></button>
        <button title={text('Settings', 'Ρυθμίσεις')} aria-label={text('Settings', 'Ρυθμίσεις')} onClick={() => go('settings')}><Settings /></button>
      </nav>
      <div className="console-home-status xbox-mode-home-status">{status}</div>
    </header>
    <div className="console-home-content">
      <section className="console-home-games" aria-labelledby={`${id}-row-title`}>
        <h2 id={`${id}-row-title`}>{data.games.length ? text('Jump back in', 'Επιστροφή') : text('Discover games', 'Ανακαλύψτε παιχνίδια')}</h2>
        {items.length ? <div className="console-home-game-row" data-gamepad-action-row="">
          {items.map((item, index) => <button key={item.key} className={`console-home-game${selected?.key === item.key ? ' selected' : ''}`}
            data-gamepad-initial={index === 0 ? '' : undefined} data-console-home-item={item.key}
            aria-label={text(`View game details: ${item.title}`, `Προβολή λεπτομερειών παιχνιδιού: ${item.title}`)}
            aria-describedby={selected?.key === item.key ? `${id}-selection` : undefined} title={item.title}
            onFocus={event => select(item, event.currentTarget)}
            onPointerEnter={event => { if (event.pointerType !== 'touch') select(item); }}
            onClick={() => openXboxModeHomeItem(item, navigation)}>
            <Artwork key={item.cover ?? item.key} source={item.cover} />
            <span className="console-home-game-caption">{item.title}</span>
          </button>)}
        </div> : <button className="console-home-empty" data-gamepad-initial onClick={() => go('library')}><Library />
          <span><strong>{text('Your next game starts here', 'Το επόμενο παιχνίδι σας ξεκινά εδώ')}</strong>
            <small>{text('Open your library to import or install a game', 'Ανοίξτε τη βιβλιοθήκη σας για εισαγωγή ή εγκατάσταση παιχνιδιού')}</small></span>
        </button>}
        <div className="console-home-selection" id={`${id}-selection`}>
          <h1 title={selected?.title}>{selected?.title ?? text('Welcome to XBOKS', 'Καλώς ήρθατε στο XBOKS')}</h1>
          <div>{currentState ? <span>{currentState}</span> : null}{selected?.publisher ? <span>{selected.publisher}</span> : null}
            {!items.length && catalog === undefined ? <span role="status">{catalogState === 'loading'
              ? text('Loading Store highlights…', 'Φόρτωση προτάσεων Store…')
              : text('Store highlights are unavailable. Your library is still available.', 'Οι προτάσεις Store δεν είναι διαθέσιμες. Η βιβλιοθήκη σας παραμένει διαθέσιμη.')}</span> : null}</div>
        </div>
      </section>
      <nav className="console-home-actions" data-gamepad-action-row="" aria-label={text('Explore Xbox mode', 'Εξερευνήστε τη λειτουργία Xbox')}>
        <button className="console-home-action console-home-library" onClick={() => go('library')}><Library /><strong>{text('Browse your games', 'Περιηγηθείτε στα παιχνίδια σας')}</strong></button>
        {onCustomize ? <button className="console-home-action console-home-customize" onClick={onCustomize}><Settings /><strong>{text('Appearance', 'Εμφάνιση')}</strong></button>
          : <button className="console-home-action console-home-gamepass" onClick={() => go('gamepass')}><GamePassBadge /><strong>{text('Explore Game Pass', 'Εξερευνήστε το Game Pass')}</strong></button>}
        {featured ? <button className="console-home-action console-home-featured" data-product-id={featured.productId} onClick={() => openProduct ? openProduct(featured) : go('store')}>
          <Artwork key={featured.heroUrl ?? featured.posterUrl ?? featured.productId} source={featured.heroUrl ?? featured.posterUrl} /><strong>{featured.title}</strong>
        </button> : <button className="console-home-action console-home-cloud" onClick={() => go('cloud')}><Cloud /><strong>{text('Cloud gaming', 'Παιχνίδια στο cloud')}</strong></button>}
        <button className="console-home-action console-home-store" onClick={() => go('store')}><Store /><strong>{text('Browse the Store', 'Περιηγηθείτε στο Store')}</strong></button>
      </nav>
    </div>
  </main>;
}
