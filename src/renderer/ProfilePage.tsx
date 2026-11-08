import { useEffect, useRef, useState } from 'react';
import type { AuthStatus, Game, GameAchievements } from '../shared/types';
import { parseXboxSelfProfileDetails } from '../shared/xbox-profile';
import { CircleUserRound, RefreshCw, Settings, Users } from './XboxIcons';
import { SubscriptionBadge } from './SubscriptionBadge';
import { useReferenceLocale } from './ReferenceLocale';
import { useLibraryCollections } from './LibraryChrome';
import './profile-page.css';

export function profileAccountKey(auth: AuthStatus): string | undefined {
  return auth.stored === true && !auth.running && Boolean(auth.username || auth.gamertag) ? JSON.stringify([auth.username ?? null, auth.gamertag ?? null]) : undefined;
}
export function profileRecentGames(games: readonly Game[], history: Readonly<Record<string, number>>): Game[] {
  const seen = new Set<string>();
  return games.filter(game => {
    if (seen.has(game.id) || !Number.isFinite(history[game.id]) || history[game.id] <= 0) return false;
    seen.add(game.id); return true;
  }).sort((left, right) => history[right.id] - history[left.id]).slice(0, 6);
}

export function ProfilePage({ auth, refresh, settings, friends, games = [], openGame, achievementsSupported = false }: {
  auth: AuthStatus; refresh?: () => Promise<void>; settings: () => void; friends: () => void;
  games?: Game[]; openGame?: (id: string) => void; achievementsSupported?: boolean;
}) {
  const { text:t, language } = useReferenceLocale();
  const [busy, setBusy] = useState(false), [error, setError] = useState(false), [missingAvatar, setMissingAvatar] = useState<string>();
  const identity = profileAccountKey(auth), revision = useRef(0), pending = useRef(false);
  const {collections} = useLibraryCollections(auth);
  const recent = identity ? profileRecentGames(games, collections.history) : [];
  const recentKey = recent.map(game => game.id).join('\u0000');
  const [achievements, setAchievements] = useState<{owner?: string; rows: Record<string, GameAchievements>}>({rows: {}});
  useEffect(() => {
    let current = true; setAchievements({owner: identity, rows: {}});
    if (identity && achievementsSupported) for (const game of recent) {
      window.launcher.getGameAchievements(game.id).then(result => {
        if (current) setAchievements(previous => previous.owner === identity ? {...previous, rows: {...previous.rows, [game.id]: result}} : previous);
      }).catch(() => { if (current) setAchievements(previous => ({...previous, rows: {...previous.rows, [game.id]: {status: 'error'}}})); });
    }
    return () => { current = false; };
  }, [identity, recentKey, achievementsSupported]);
  useEffect(() => { revision.current++; setError(false); setBusy(false); pending.current = false; return () => { revision.current++; }; }, [identity]);
  if (auth.stored !== true || auth.running) return <main className="page profile-page"><h1>{t('Your Xbox profile','Το προφίλ σας στο Xbox')}</h1><div className="profile-empty"><CircleUserRound/><h2>{auth.running ? t('Checking your account…','Έλεγχος λογαριασμού…') : t('Sign in to view your profile','Συνδεθείτε για να δείτε το προφίλ σας')}</h2><button className="primary" data-gamepad-initial onClick={settings}>{t('Account settings','Ρυθμίσεις λογαριασμού')}</button></div></main>;
  const profile = auth.profile, details = parseXboxSelfProfileDetails(profile);
  const gamertag = profile?.gamertag ?? auth.gamertag ?? t('Xbox profile','Προφίλ Xbox');
  const avatar = profile?.avatarDataUrl ?? auth.avatarDataUrl;
  const hasAbout = Boolean(details.bio || details.location || details.realName || details.gameDisplayName || details.appDisplayName);
  async function update() {
    if (pending.current || !refresh) return;
    pending.current = true; setBusy(true); setError(false); const current = revision.current;
    try { await refresh(); } catch { if (current === revision.current) setError(true); }
    finally { if (current === revision.current) { pending.current = false; setBusy(false); } }
  }
  return <main className="page profile-page" data-profile-account={identity ? 'signed-in' : 'unavailable'}>
    <section className="profile-hero" aria-labelledby="profile-gamertag">
      <div className="profile-identity"><div className="profile-gamerpic">{avatar && missingAvatar !== avatar ? <img src={avatar} alt={t('Xbox profile picture','Εικόνα προφίλ Xbox')} onError={() => setMissingAvatar(avatar)} /> : <CircleUserRound/>}</div>
        <div><h1 id="profile-gamertag">{gamertag}</h1>{details.uniqueModernGamertag && details.uniqueModernGamertag !== gamertag ? <p className="profile-modern-tag">{details.uniqueModernGamertag}</p>:null}
          <div className="profile-summary">{details.realName ? <span className="profile-real-name">{details.realName}</span> : null}
          {details.gamerscore !== undefined ? <p className="profile-gamerscore"><span aria-hidden="true">Ⓖ</span> <strong>{details.gamerscore.toLocaleString(language === 'el' ? 'el-GR' : 'en-US')}</strong><span className="profile-score-label">{t('Gamerscore','Βαθμολογία παίκτη')}</span></p>:null}<SubscriptionBadge value={profile?.subscription ?? auth.subscription}/></div></div>
      </div>
      <div className="profile-actions"><button data-gamepad-initial onClick={settings}><Settings/>{t('Account settings','Ρυθμίσεις λογαριασμού')}</button><button onClick={friends}><Users/>{t('Friends','Φίλοι')}</button><button disabled={busy || auth.profileRefreshing || !refresh || auth.running} onClick={() => void update()}><RefreshCw/>{busy || auth.profileRefreshing ? t('Refreshing…','Ανανέωση…') : t('Refresh profile','Ανανέωση προφίλ')}</button></div>
    </section>
    {recent.length ? <><section className="profile-recent"><h2>{t('Recently played','Πρόσφατα παιχνίδια')}</h2><div className="profile-recent-row">{recent.map(game => <button key={game.id} disabled={!openGame} onClick={() => openGame?.(game.id)}>
      {game.heroUrl || game.coverUrl ? <img src={game.heroUrl ?? game.coverUrl} alt="" /> : <div className="profile-game-art"><CircleUserRound/></div>}<strong>{game.title}</strong>{game.publisher ? <small>{game.publisher}</small> : null}
    </button>)}</div></section><section className="profile-achievements"><h2>{t('Achievements','Επιτεύγματα')}</h2>{recent.map(game => {
      const result = achievements.owner === identity ? achievements.rows[game.id] : undefined;
      const items = result?.status === 'available' ? result.items ?? [] : undefined;
      const earned = items?.filter(item => item.state === 'unlocked' && !item.revoked);
      const progress = items?.length ? Math.round((earned?.length ?? 0) / items.length * 100) : undefined;
      return <button className="profile-achievement-game" key={game.id} disabled={!openGame} onClick={() => openGame?.(game.id)}>
        {game.coverUrl || game.heroUrl ? <img src={game.coverUrl ?? game.heroUrl} alt=""/> : <span className="profile-game-art"/>}<span className="profile-achievement-copy"><strong>{game.title}</strong>
          {progress !== undefined && !result?.partial ? <><span>{earned?.length ?? 0}/{items?.length} {t('unlocked','ξεκλειδωμένα')}<b>{progress}%</b></span><progress max={100} value={progress} aria-label={`${game.title}: ${progress}%`}/></> : <small>{!achievementsSupported ? t('Achievement information is unavailable.','Τα στοιχεία επιτευγμάτων δεν είναι διαθέσιμα.') : !result ? t('Loading achievements…','Φόρτωση επιτευγμάτων…') : result.partial ? t('Some achievements are unavailable.','Ορισμένα επιτεύγματα δεν είναι διαθέσιμα.') : t('No achievement information was returned.','Δεν επιστράφηκαν στοιχεία επιτευγμάτων.')}</small>}
        </span></button>;
    })}</section></> : null}
    <div className="profile-content"><section className="profile-about"><h2>{t('About','Πληροφορίες')}</h2>{hasAbout ? <><dl>{details.realName ? <div><dt>{t('Name','Όνομα')}</dt><dd>{details.realName}</dd></div>:null}{details.location ? <div><dt>{t('Location','Τοποθεσία')}</dt><dd>{details.location}</dd></div>:null}{details.gameDisplayName || details.appDisplayName ? <div><dt>{t('Display name','Εμφανιζόμενο όνομα')}</dt><dd>{details.gameDisplayName ?? details.appDisplayName}</dd></div>:null}</dl>{details.bio ? <p className="profile-biography">{details.bio}</p>:null}</> : <p className="profile-muted">{t('No biography or location was returned for this profile.','Δεν επιστράφηκε βιογραφικό ή τοποθεσία για αυτό το προφίλ.')}</p>}</section>
      <section className="profile-account"><h2>{t('Xbox account','Λογαριασμός Xbox')}</h2><p>{gamertag}</p>{details.gamerscore === undefined ? <p className="profile-muted">{t('Gamerscore is unavailable.','Η βαθμολογία παίκτη δεν είναι διαθέσιμη.')}</p>:null}</section>
    </div>
    {auth.profileSource === 'cache' ? <p className="profile-muted" role="status">{t('Showing saved profile information. Refresh to check for changes.','Εμφανίζονται αποθηκευμένα στοιχεία προφίλ. Ανανεώστε για να ελέγξετε για αλλαγές.')}</p>:null}
    {error || auth.profileError ? <p className="profile-error" role="alert">{t('Your Xbox profile could not be refreshed. Try again.','Το προφίλ Xbox δεν ανανεώθηκε. Δοκιμάστε ξανά.')}</p>:null}
  </main>;
}
