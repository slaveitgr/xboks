import { useEffect, useRef, useState } from 'react';
import type { AppSnapshot, Settings } from '../shared/types';
import { SettingGroup, SettingToggle } from './OriginalSettings';
import { useReferenceLocale } from './ReferenceLocale';

export type InstallPreferencePatch = Partial<Pick<Settings, 'installRoot' | 'createDesktopShortcut' | 'downloadSpeedUnit'>>;
type InstallPreferenceState = { read: () => Settings; write: (value: Settings) => void; latestSnapshot: () => Settings };
/** Keep the selected preference optimistic, commit the backend's normalized result,
 * and restore authoritative state on failure. Folder-picker cancellation is a no-op.
 * A newer snapshot received while saving must not be discarded by rollback. */
export async function applyInstallPreferenceAction(selectPatch: () => Promise<InstallPreferencePatch | undefined>, state: InstallPreferenceState, persist: (patch: InstallPreferencePatch) => Promise<Settings>) {
  const previous = state.read(), snapshot = state.latestSnapshot();
  const authoritative = () => { const latest = state.latestSnapshot(); return latest !== snapshot ? latest : previous; };
  let patch: InstallPreferencePatch | undefined;
  try { patch = await selectPatch(); }
  catch (failure) { if (state.latestSnapshot() !== snapshot) state.write(authoritative()); throw failure; }
  if (!patch) { if (state.latestSnapshot() !== snapshot) state.write(authoritative()); return false; }
  state.write({ ...authoritative(), ...patch });
  try { state.write(await persist(patch)); }
  catch (failure) { state.write(authoritative()); throw failure; }
  return true;
}

/** Original install groups with separate provider capability and display units.
 * Provider-only settings stay disabled until a Linux adapter can read/apply them. */
export function InstallSettings({ data, working, disabled = false }: { data: AppSnapshot; working: (value: boolean) => void; disabled?: boolean }) {
  const { text } = useReferenceLocale();
  const [value, setValue] = useState(data.settings);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const current = useRef(value), latest = useRef(data.settings), pending = useRef(false);
  function publish(next: Settings) { current.current = next; setValue(next); }
  useEffect(() => { latest.current = data.settings; if (!pending.current) publish(data.settings); }, [data.settings]);
  async function perform(selectPatch: () => Promise<InstallPreferencePatch | undefined>) {
    if (pending.current || disabled) return;
    pending.current = true; setBusy(true); working(true); setError('');
    try { await applyInstallPreferenceAction(selectPatch, { read: () => current.current, write: publish, latestSnapshot: () => latest.current }, patch => window.launcher.updateSettings(patch)); }
    catch (failure) { setError(failure instanceof Error ? failure.message : text('The setting could not be saved.', 'Δεν ήταν δυνατή η αποθήκευση της ρύθμισης.')); }
    finally { pending.current = false; setBusy(false); working(false); }
  }
  function save(patch: InstallPreferencePatch) { return perform(async () => patch); }
  function chooseLocation() { return perform(async () => { const selected = await window.launcher.chooseDirectory(current.current.installRoot); return selected ? { installRoot: selected } : undefined; }); }
  return <div className="original-settings original-install-settings"><SettingGroup title={text('Game installation options', 'Επιλογές εγκατάστασης παιχνιδιού')}>
    <p className="original-install-description">{text('Change the default location where this app installs games', 'Αλλαγή του προεπιλεγμένου σημείου όπου αυτή η εφαρμογή εγκαθιστά παιχνίδια')}</p>
    <select aria-label={text('Default install location', 'Προεπιλεγμένο σημείο εγκατάστασης')} disabled={busy || disabled} value={value.installRoot} onChange={event => { if (event.target.value === '__choose__') void chooseLocation(); }}>
      <option value={value.installRoot}>{value.installRoot}</option><option value="__choose__">{text('Choose another folder…', 'Επιλογή άλλου φακέλου…')}</option>
    </select>
    <SettingToggle label={text('Create a desktop shortcut on install', 'Δημιουργία συντόμευσης επιφάνειας εργασίας κατά την εγκατάσταση')} checked={value.createDesktopShortcut === true} disabled={busy || disabled} change={checked => { void save({ createDesktopShortcut: checked }); }} />
    <div className="original-install-divider" />
    <SettingToggle label={text('Enable automatic updates', 'Ενεργοποίηση αυτόματων ενημερώσεων')} reason={text('Automatic provider updates are unavailable. Check for updates in your library.', 'Οι αυτόματες ενημερώσεις παρόχου δεν είναι διαθέσιμες. Ελέγξτε για ενημερώσεις στη βιβλιοθήκη.')} />
    <p className="original-install-update-note">{text('Includes pre-download updates', 'Περιλαμβάνει ενημερώσεις πριν από τη λήψη')}</p>
    <SettingToggle label={text('Enable downloads and updates during gameplay', 'Ενεργοποίηση λήψεων και ενημερώσεων κατά τη διάρκεια του παιχνιδιού')} reason={text('The provider does not expose a gameplay-download policy setting. Downloads are not automatically paused by this app.', 'Ο πάροχος δεν εκθέτει ρύθμιση λήψεων κατά το παιχνίδι. Αυτή η εφαρμογή δεν διακόπτει αυτόματα τις λήψεις.')} />
    <div className="original-install-divider" />
    <label className="original-install-unit">{text('Download speed unit', 'Μονάδα ταχύτητας λήψης')}<select aria-label={text('Download speed unit', 'Μονάδα ταχύτητας λήψης')} disabled={busy || disabled} value={value.downloadSpeedUnit ?? 'bytes'} onChange={event => { void save({ downloadSpeedUnit: event.target.value === 'bits' ? 'bits' : 'bytes' }); }}>
      <option value="bits">{text('Bits per second', 'Bit ανά δευτερόλεπτο')}</option><option value="bytes">{text('Bytes per second', 'Byte ανά δευτερόλεπτο')}</option>
    </select></label>
    {error ? <p role="alert">{error}</p> : null}
  </SettingGroup></div>;
}
