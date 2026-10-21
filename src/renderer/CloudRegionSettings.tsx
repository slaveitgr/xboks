import {useEffect, useRef, useState} from 'react';
import {CLOUD_LOGIN_COUNTRIES, type CloudLoginCountry} from '../shared/cloud-region';
import {Settings, X} from './XboxIcons';
import {useReferenceLocale} from './ReferenceLocale';
import {useBackHandler} from './GamepadNavigation';
import './cloud-region.css';

export function CloudRegionSettings({value = 'auto', save, inline = false}: {
  value?: CloudLoginCountry; save?: (country: CloudLoginCountry) => Promise<unknown>; inline?: boolean;
}) {
  const {text: t} = useReferenceLocale();
  const [open, setOpen] = useState(false), [draft, setDraft] = useState(value), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const root = useRef<HTMLElement>(null), trigger = useRef<HTMLButtonElement>(null), mounted = useRef(true), pending = useRef(false);
  const labels: Record<CloudLoginCountry, string> = {auto: t('Automatic', 'Αυτόματη'), pl: t('Poland', 'Πολωνία'), us: t('United States', 'Ηνωμένες Πολιτείες'), br: t('Brazil', 'Βραζιλία'), jp: t('Japan', 'Ιαπωνία'), kr: t('South Korea', 'Νότια Κορέα')};
  useEffect(() => {mounted.current = true; return () => {mounted.current = false;};}, []);
  useEffect(() => {if (open) {setDraft(value); root.current?.querySelector('select')?.focus();}}, [open]);
  const close = () => {if (pending.current) return; setOpen(false); requestAnimationFrame(() => trigger.current?.focus());};
  useBackHandler(() => {close(); return true;}, open, () => root.current);
  async function submit() {
    if (!save || pending.current) return; pending.current = true; setBusy(true); setError('');
    try {await save(draft); if (mounted.current) {setOpen(false); requestAnimationFrame(() => trigger.current?.focus());}}
    catch {if (mounted.current) setError(t('The cloud country could not be saved. End any active cloud session and try again.', 'Η χώρα cloud δεν αποθηκεύτηκε. Τερματίστε τυχόν ενεργή συνεδρία cloud και δοκιμάστε ξανά.'));}
    finally {pending.current = false; if (mounted.current) setBusy(false);}
  }
  return <div className={inline ? 'cloud-region-inline' : 'cloud-region-entry'}>
    {inline ? <div><h2>{t('Cloud Gaming', 'Cloud Gaming')}</h2><p>{t('Country for cloud sign-in', 'Χώρα για τη σύνδεση cloud')}: {labels[value]}</p></div> : null}
    <button className="cloud-region-trigger" ref={trigger} aria-label={t('Cloud settings', 'Ρυθμίσεις cloud')} disabled={!save} onClick={() => {setError(''); setOpen(true);}}><Settings/>{inline ? t('Cloud settings', 'Ρυθμίσεις cloud') : null}</button>
    {open ? <div className="cloud-region-backdrop"><section className="cloud-region-dialog" role="dialog" aria-modal="true" aria-label={t('Cloud settings', 'Ρυθμίσεις cloud')} ref={root} onKeyDown={event => {
      if (event.key === 'Escape') {event.preventDefault(); event.stopPropagation(); close();}
      if (event.key === 'Tab') {
        const controls = [...root.current!.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled)')];
        if (event.shiftKey && document.activeElement === controls[0]) {event.preventDefault(); controls.at(-1)?.focus();}
        else if (!event.shiftKey && document.activeElement === controls.at(-1)) {event.preventDefault(); controls[0]?.focus();}
      }
    }}><header><h2>{t('Cloud settings', 'Ρυθμίσεις cloud')}</h2><button disabled={busy} aria-label={t('Close cloud settings', 'Κλείσιμο ρυθμίσεων cloud')} onClick={close}><X/></button></header>
      <label>{t('Country for cloud sign-in', 'Χώρα για τη σύνδεση cloud')}<select data-gamepad-initial value={draft} disabled={busy} onChange={event => setDraft(event.target.value as CloudLoginCountry)}>{CLOUD_LOGIN_COUNTRIES.map(country => <option key={country} value={country}>{labels[country]}</option>)}</select></label>
      <p>{t('Automatic uses the ordinary country check. Select a supported country to try login compatibility when the cloud service reports an unsupported location.', 'Η Αυτόματη χρησιμοποιεί τον συνήθη έλεγχο χώρας. Επιλέξτε υποστηριζόμενη χώρα για δοκιμή συμβατότητας σύνδεσης όταν η υπηρεσία cloud αναφέρει μη υποστηριζόμενη τοποθεσία.')}</p>
      <p>{t('This does not change your network route or subscription. Cloud access is still decided by Microsoft.', 'Αυτό δεν αλλάζει τη διαδρομή δικτύου ή τη συνδρομή σας. Η πρόσβαση στο cloud εξακολουθεί να ελέγχεται από τη Microsoft.')}</p>
      {error ? <p role="alert">{error}</p> : null}
      <footer><button disabled={busy} onClick={close}>{t('Cancel', 'Ακύρωση')}</button><button className="primary" disabled={busy} onClick={() => void submit()}>{busy ? t('Saving…', 'Αποθήκευση…') : t('Save', 'Αποθήκευση')}</button></footer>
    </section></div> : null}
  </div>;
}
