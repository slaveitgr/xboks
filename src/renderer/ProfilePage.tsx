import { useEffect, useRef, useState } from 'react';
import type { AuthStatus } from '../shared/types';
import { parseXboxSelfProfileDetails } from '../shared/xbox-profile';
import { CircleUserRound, RefreshCw, Settings, Users } from './XboxIcons';
import { SubscriptionBadge } from './SubscriptionBadge';
import { useReferenceLocale } from './ReferenceLocale';
import './profile-page.css';

export function ProfilePage({ auth, refresh, settings, friends }: {
  auth: AuthStatus; refresh?: () => Promise<void>; settings: () => void; friends: () => void;
}) {
  const { text:t, language } = useReferenceLocale();
  const [busy, setBusy] = useState(false), [error, setError] = useState(false), [missingAvatar, setMissingAvatar] = useState<string>();
  const identity = auth.stored === true ? auth.username : undefined, revision = useRef(0), pending = useRef(false);
  useEffect(() => { revision.current++; setError(false); setBusy(false); pending.current = false; return () => { revision.current++; }; }, [identity]);
  if (auth.stored !== true) return <main className="page profile-page"><h1>{t('Your Xbox profile','Το προφίλ σας στο Xbox')}</h1><div className="profile-empty"><CircleUserRound/><h2>{t('Sign in to view your profile','Συνδεθείτε για να δείτε το προφίλ σας')}</h2><button className="primary" data-gamepad-initial onClick={settings}>{t('Account settings','Ρυθμίσεις λογαριασμού')}</button></div></main>;
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
        <div><h1 id="profile-gamertag">{gamertag}</h1>{details.uniqueModernGamertag && details.uniqueModernGamertag !== gamertag ? <p className="profile-modern-tag">{details.uniqueModernGamertag}</p>:null}<SubscriptionBadge value={profile?.subscription ?? auth.subscription}/>
          {details.gamerscore !== undefined ? <p className="profile-gamerscore"><span aria-hidden="true">Ⓖ</span> <strong>{details.gamerscore.toLocaleString(language === 'el' ? 'el-GR' : 'en-US')}</strong><span>{t('Gamerscore','Βαθμολογία παίκτη')}</span></p>:null}</div>
      </div>
      <div className="profile-actions"><button data-gamepad-initial onClick={settings}><Settings/>{t('Account settings','Ρυθμίσεις λογαριασμού')}</button><button onClick={friends}><Users/>{t('Friends','Φίλοι')}</button><button disabled={busy || auth.profileRefreshing || !refresh || auth.running} onClick={() => void update()}><RefreshCw/>{busy || auth.profileRefreshing ? t('Refreshing…','Ανανέωση…') : t('Refresh profile','Ανανέωση προφίλ')}</button></div>
    </section>
    <div className="profile-content"><section className="profile-about"><h2>{t('About','Πληροφορίες')}</h2>{hasAbout ? <><dl>{details.realName ? <div><dt>{t('Name','Όνομα')}</dt><dd>{details.realName}</dd></div>:null}{details.location ? <div><dt>{t('Location','Τοποθεσία')}</dt><dd>{details.location}</dd></div>:null}{details.gameDisplayName || details.appDisplayName ? <div><dt>{t('Display name','Εμφανιζόμενο όνομα')}</dt><dd>{details.gameDisplayName ?? details.appDisplayName}</dd></div>:null}</dl>{details.bio ? <p className="profile-biography">{details.bio}</p>:null}</> : <p className="profile-muted">{t('No biography or location was returned for this profile.','Δεν επιστράφηκε βιογραφικό ή τοποθεσία για αυτό το προφίλ.')}</p>}</section>
      <section className="profile-account"><h2>{t('Xbox account','Λογαριασμός Xbox')}</h2><p>{gamertag}</p>{identity ? <p className="profile-muted">{identity}</p>:null}{details.gamerscore === undefined ? <p className="profile-muted">{t('Gamerscore is unavailable.','Η βαθμολογία παίκτη δεν είναι διαθέσιμη.')}</p>:null}</section>
    </div>
    {auth.profileSource === 'cache' ? <p className="profile-muted" role="status">{t('Showing saved profile information. Refresh to check for changes.','Εμφανίζονται αποθηκευμένα στοιχεία προφίλ. Ανανεώστε για να ελέγξετε για αλλαγές.')}</p>:null}
    {error || auth.profileError ? <p className="profile-error" role="alert">{t('Your Xbox profile could not be refreshed. Try again.','Το προφίλ Xbox δεν ανανεώθηκε. Δοκιμάστε ξανά.')}</p>:null}
  </main>;
}
