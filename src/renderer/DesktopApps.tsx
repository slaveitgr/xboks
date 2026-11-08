import {useEffect, useRef, useState} from 'react';
import type {DesktopAppEntry, DesktopAppsResult} from '../shared/types';
import {Gamepad2, RefreshCw, Search} from './XboxIcons';
import {useReferenceLocale} from './ReferenceLocale';
import './desktop-apps.css';

export function appsLibraryVisible(storage?: Pick<Storage, 'getItem'>) {
  try {return (storage ?? localStorage).getItem('xboks.library.show-apps') !== 'false';} catch {return true;}
}
export function useAppsLibraryPreference() {
  const [visible, setVisible] = useState(appsLibraryVisible);
  useEffect(() => {const changed = () => setVisible(appsLibraryVisible()); window.addEventListener('xboks-library-apps-changed', changed); return () => window.removeEventListener('xboks-library-apps-changed', changed);}, []);
  return visible;
}

export function filterDesktopApps(apps: DesktopAppEntry[], query: string) {
  const term = query.trim().toLocaleLowerCase();
  return apps.filter(app => !term || `${app.name} ${app.description ?? ''}`.toLocaleLowerCase().includes(term));
}
function AppIcon({app}: {app: DesktopAppEntry}) {
  const [failed, setFailed] = useState<string>();
  return app.iconDataUrl && failed !== app.iconDataUrl ? <img src={app.iconDataUrl} alt="" onError={() => setFailed(app.iconDataUrl)}/> : <Gamepad2/>;
}
export function DesktopApps({onError}: {onError: (message: string) => void}) {
  const {text: t} = useReferenceLocale();
  const [result, setResult] = useState<DesktopAppsResult>(), [query, setQuery] = useState('');
  const [revision, setRevision] = useState(0), [launching, setLaunching] = useState<string>();
  const alive = useRef(true), pending = useRef(false);
  useEffect(() => { alive.current = true; return () => {alive.current = false;}; }, []);
  useEffect(() => {
    let current = true; setResult(undefined);
    if (typeof window.launcher.getDesktopApps !== 'function') {setResult({available:false,apps:[]}); return;}
    window.launcher.getDesktopApps().then(value => {if (current) setResult(value);})
      .catch(() => {if (current) setResult({available: false, apps: []});});
    return () => {current = false;};
  }, [revision]);
  async function launch(app: DesktopAppEntry) {
    if (pending.current) return;
    pending.current = true; setLaunching(app.id);
    try {await window.launcher.launchDesktopApp(app.id);}
    catch {if (alive.current) onError(t('This application could not be opened. Refresh your apps and try again.', 'Δεν ήταν δυνατό το άνοιγμα της εφαρμογής. Ανανεώστε τις εφαρμογές και δοκιμάστε ξανά.'));}
    finally {pending.current = false; if (alive.current) setLaunching(undefined);}
  }
  const apps = filterDesktopApps(result?.apps ?? [], query);
  return <section className="desktop-app-library" aria-label={t('Apps', 'Εφαρμογές')}>
    <div className="desktop-app-toolbar"><label><Search/><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={t('Search apps', 'Αναζήτηση εφαρμογών')} aria-label={t('Search apps', 'Αναζήτηση εφαρμογών')}/></label>
      <button type="button" onClick={() => setRevision(value => value + 1)} disabled={!result} aria-label={t('Refresh apps', 'Ανανέωση εφαρμογών')}><RefreshCw/></button></div>
    {!result ? <p role="status">{t('Loading your apps…', 'Φόρτωση εφαρμογών…')}</p> : !result.available ? <div className="desktop-app-empty" role="status"><h2>{t('Your apps could not be loaded', 'Δεν ήταν δυνατή η φόρτωση εφαρμογών')}</h2><p>{t('Refresh to try again.', 'Ανανεώστε για νέα προσπάθεια.')}</p></div> : !apps.length ? <div className="desktop-app-empty" role="status"><h2>{query ? t('No apps match your search', 'Δεν βρέθηκαν εφαρμογές') : t('Apps installed on this device will show here', 'Οι εφαρμογές αυτής της συσκευής θα εμφανίζονται εδώ')}</h2></div> : <div className="desktop-app-grid">{apps.map(app => <button key={app.id} type="button" data-desktop-app={app.id} data-gamepad-auto-select="focus" disabled={Boolean(launching)} aria-busy={launching === app.id} onClick={() => void launch(app)}><span className="desktop-app-icon"><AppIcon app={app}/></span><strong>{app.name}</strong>{app.description ? <small>{app.description}</small> : null}</button>)}</div>}
  </section>;
}
