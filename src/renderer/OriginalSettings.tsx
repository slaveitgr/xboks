import { Bluetooth } from 'lucide-react';
import { useBatteryPercentage } from './BatteryStatus';
import { KeyringSetup } from './KeyringSetup';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { type LibraryProviderStatus } from '../shared/library-providers';
import type { AppSnapshot } from '../shared/types';
import type { SettingsSection } from './SettingsFrame';
import { ChevronLeft, ChevronRight, CircleUserRound, ExternalLink, Info, Gamepad2 } from './XboxIcons';
import { accountIdentityViews } from '../shared/account-identities';
import { subscriptionBadge } from '../shared/subscription';
import { animationLevel, type AnimationLevel, type Appearance } from './appearance';
import type { InterfaceLanguage, InterfaceLanguagePreference } from './ReferenceLocale';
import { runtimeDisplay } from '../shared/runtime-display';
import { settingsV2PartVisible, useSettingsV2Route } from './settings-v2';

const localize = (language: InterfaceLanguage) => (en: string, el: string) => language === 'el' ? el : en;
export function SettingGroup({ title, children, action, className = '', part }: { title: string; children: ReactNode; action?: ReactNode; className?: string; part?: string }) {
  const route = useSettingsV2Route();
  if (!settingsV2PartVisible(route, part)) return null;
  return <section className={`original-setting-group ${className}`}><h2><span>{title}</span>{action}</h2>{children}</section>;
}
export function SettingToggle({ label, checked = false, change, reason, switchStyle = false, disabled = false }: { label: string; checked?: boolean; change?: (value: boolean) => void; reason?: string; switchStyle?: boolean; disabled?: boolean }) {
  const reasonId = useId();
  const unavailable = disabled || !change;
  return <div className="original-setting-control" title={reason}><label className={switchStyle ? 'original-setting-switch' : 'original-setting-check'}><span>{label}</span><input type="checkbox" role={switchStyle ? 'switch' : undefined} checked={checked} disabled={unavailable} onChange={event => { if (!unavailable) change?.(event.target.checked); }} aria-describedby={reason ? reasonId : undefined} /></label>{reason ? <small className="settings-control-reason" id={reasonId}>{reason}</small> : null}</div>;
}
export function SettingLink({ href, children }: { href: string; children: ReactNode }) { return <a className="original-setting-link" href={href} target="_blank" rel="noreferrer">{children}<ExternalLink /></a>; }
export function NexusSettings({ children, language = 'en' }: { children: ReactNode; language?: InterfaceLanguage }) {
  return <details className="settings-nexus-extension"><summary>{localize(language)('XBOKS Engine settings', 'Ρυθμίσεις XBOKS Engine')}</summary><div>{children}</div></details>;
}
/** OS session facts are deliberately separate from compact UI and window fullscreen. */
export function applicationControlState(data: AppSnapshot, appearance: Appearance, battery: number | null) {
  const session = data.desktopSettings;
  const fullscreenExperience = session?.fullscreenExperience === true;
  const autostartDisabled = session?.canSetAutostart !== true || fullscreenExperience;
  return { fullscreenExperience, batteryDisabled: !appearance.compactMode || battery === null, autostartDisabled,
    backgroundVisible: data.settings.launchOnLogin === true,
    backgroundDisabled: autostartDisabled || data.settings.launchOnLogin !== true,
    trayDisabled: fullscreenExperience || session?.gameBarResident === true || session?.trayAvailable === false };
}
/** Closing social UI is a required first step when entering the compact shell. */
export function changeCompactMode(value: boolean, change: (patch: Partial<Appearance>) => void, closeSocialSurface?: () => void, announce?: (value: boolean) => void) {
  if (value) closeSocialSurface?.();
  announce?.(value);
  change({ compactMode: value });
}
export function OriginalSettings({ section, data, appearance, changeAppearance, gameBar, notificationChange, desktopChange, accountSettings, editAccount, language = 'en', languagePreference = 'system', changeLanguage, closeSocialSurface, openSystemSettings }: {
  section: SettingsSection; data: AppSnapshot; appearance: Appearance; changeAppearance: (value: Partial<Appearance>) => void;
  accountSettings?: () => void; editAccount?: () => void; language?: InterfaceLanguage; languagePreference?: InterfaceLanguagePreference;
  changeLanguage?: (value: InterfaceLanguagePreference) => void; closeSocialSurface?: () => void; openSystemSettings?: () => void;
  desktopChange: (patch: { launchOnLogin?: boolean; launchInBackground?: boolean; minimizeToTray?: boolean }) => void;
  gameBar: () => void; notificationChange: (value: boolean) => void;
}) {
  const t = localize(language), battery = useBatteryPercentage(), route = useSettingsV2Route();
  const [announcement, announce] = useState('');
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer); }, []);
  const serviceUnavailable = t('Requires an Xbox service connection that is not implemented yet.', 'Απαιτείται σύνδεση με υπηρεσία Xbox που δεν έχει υλοποιηθεί ακόμη.');
  const controls = applicationControlState(data, appearance, battery);
  const startupReason = controls.fullscreenExperience ? t('Startup options are managed by Xbox mode.', 'Οι επιλογές εκκίνησης ελέγχονται από τη λειτουργία Xbox.') : data.desktopSettings?.autostartReason ?? t('Desktop startup settings are unavailable in this session.', 'Οι ρυθμίσεις εκκίνησης δεν είναι διαθέσιμες σε αυτήν τη συνεδρία.');
  if (section === 'application' && route === 'permissions' && !accountIdentityViews(data.auth, now).store.name) return <div className="original-settings"><SettingGroup title={t('Offline permissions', 'Δικαιώματα εκτός σύνδεσης')}><p role="status">{t('A verified Microsoft Store account is required. Device licensing is managed by Microsoft.', 'Απαιτείται επιβεβαιωμένος λογαριασμός Microsoft Store. Η Microsoft διαχειρίζεται τις άδειες της συσκευής.')}</p></SettingGroup></div>;
  if (route === 'input') return <DevicesAndConnectionsSettings language={language} />;
  if (route === 'licenses') return <div className="original-settings"><SettingGroup title={t('Disc to digital license history', 'Ιστορικό μετατροπής αδειών δίσκου σε ψηφιακές')}><p role="status">{t('The connected service does not provide disc-to-digital license history.', 'Η συνδεδεμένη υπηρεσία δεν παρέχει ιστορικό μετατροπής αδειών δίσκου σε ψηφιακές.')}</p></SettingGroup></div>;
  if (route === 'manage-games') return <div className="original-settings"><SettingGroup title={t('Manage games', 'Διαχείριση παιχνιδιών')}><p>{t('Installed games on this computer', 'Εγκατεστημένα παιχνίδια σε αυτόν τον υπολογιστή')}</p>{data.games.length ? <ul className="settings-v2-game-list">{data.games.map(game => <li key={game.id}>{game.title}</li>)}</ul> : <p>{t('No local games were found.', 'Δεν βρέθηκαν τοπικά παιχνίδια.')}</p>}<p role="status">{t('Per-game save management is not available from this connection.', 'Η διαχείριση αποθηκεύσεων ανά παιχνίδι δεν είναι διαθέσιμη από αυτήν τη σύνδεση.')}</p></SettingGroup></div>;
  if (section === 'application' && route === 'streaming') return null;
  if (section === 'application' && route === 'xbox-mode') return <XboxModeSettings data={data} language={language} />;
  if (section === 'application' && route === 'languages') return <div className="original-settings"><SettingGroup title={t('App language', 'Γλώσσα εφαρμογής')}><LanguageSetting language={language} preference={languagePreference} change={changeLanguage} /></SettingGroup></div>;
  if (section === 'application') return <div className="original-settings original-application-settings">
    <SettingGroup part="display" title={t('General', 'Γενικά')}>
      <SettingToggle switchStyle label={t('Compact mode', 'Περιεκτική λειτουργία')} checked={appearance.compactMode} change={value => changeCompactMode(value, changeAppearance, closeSocialSurface, enabled => announce(enabled ? t('Compact mode enabled', 'Η περιεκτική λειτουργία ενεργοποιήθηκε') : t('Compact mode disabled', 'Η περιεκτική λειτουργία απενεργοποιήθηκε')))} />
      <SettingToggle switchStyle label={t('Show battery percentage', 'Εμφάνιση ποσοστού ένδειξης μπαταρίας')} checked={appearance.showBattery} disabled={controls.batteryDisabled} change={value => changeAppearance({ showBattery: value })} reason={!appearance.compactMode ? t('Available in compact mode.', 'Διαθέσιμο στην περιεκτική λειτουργία.') : battery === null ? t('No battery is reported by this device.', 'Δεν αναφέρεται μπαταρία από αυτήν τη συσκευή.') : undefined} />
    </SettingGroup>
    <SettingGroup part="startup" title={t('Startup', 'Εκκίνηση')}>
      {controls.fullscreenExperience ? <div className="original-setting-info settings-startup-notice"><Info /><div><strong>{t('Startup options are disabled', 'Οι επιλογές εκκίνησης είναι απενεργοποιημένες')}</strong><p>{t('These settings do not apply while Xbox mode is enabled.', 'Οι ρυθμίσεις δεν ισχύουν όταν είναι ενεργοποιημένη η λειτουργία Xbox.')}</p><button className="original-setting-text-button" disabled={!openSystemSettings} onClick={openSystemSettings}>{t('Open system settings', 'Άνοιγμα ρυθμίσεων συστήματος')}</button></div></div> : null}
      <SettingToggle switchStyle label={t('Launch Xbox when I start my computer', 'Εκκίνηση του XBOX κατά την εκκίνηση του υπολογιστή μου')} checked={data.settings.launchOnLogin === true} disabled={controls.autostartDisabled} change={value => desktopChange({ launchOnLogin: value })} reason={controls.autostartDisabled ? startupReason : undefined} />
      {controls.backgroundVisible ? <SettingToggle switchStyle label={t('Launch the app in the background', 'Εκκίνηση της εφαρμογής στο παρασκήνιο')} checked={data.settings.launchInBackground === true} disabled={controls.backgroundDisabled} change={value => desktopChange({ launchInBackground: value })} reason={controls.backgroundDisabled ? startupReason : undefined} /> : null}
      <SettingToggle switchStyle label={t('On close, minimize the app to the system tray', 'Κατά το κλείσιμο, ελαχιστοποιήστε την εφαρμογή στην περιοχή συστήματος')} checked={data.settings.minimizeToTray === true} disabled={controls.trayDisabled} change={value => desktopChange({ minimizeToTray: value })} reason={controls.trayDisabled ? controls.fullscreenExperience ? startupReason : data.desktopSettings?.gameBarResident ? t('Game Bar stays in the background when you close the app. Reopen XBOKS from the application menu or the configured Game Bar shortcut. Explicit Quit stops the current process.', 'Το Game Bar παραμένει στο παρασκήνιο όταν κλείνετε την εφαρμογή. Ανοίξτε το XBOKS από το μενού εφαρμογών ή τη ρυθμισμένη συντόμευση Game Bar. Η ρητή Έξοδος σταματά την τρέχουσα διεργασία.') : t('The system tray is unavailable in this desktop session.', 'Η περιοχή συστήματος δεν είναι διαθέσιμη σε αυτήν τη συνεδρία.') : undefined} />
    </SettingGroup>
    {accountIdentityViews(data.auth, now).store.name ? <SettingGroup part="permissions" title={t('Offline permissions', 'Δικαιώματα κοινής χρήσης')}><SettingToggle switchStyle label={t('Offline permissions enabled', 'Τα δικαιώματα κοινής χρήσης είναι ενεργοποιημένα')} reason={t('Xbox device licensing cannot be changed by this client.', 'Τα δικαιώματα συσκευής Xbox δεν μπορούν να αλλάξουν από αυτήν την εφαρμογή.')} /><p>{t('Allow other people to play your games on this device. Microsoft manages device authorization and change limits.', 'Επιτρέψτε σε άλλα άτομα να παίζουν τα παιχνίδια σας σε αυτήν τη συσκευή. Η Microsoft διαχειρίζεται την εξουσιοδότηση και τα όρια αλλαγών της συσκευής.')}</p></SettingGroup> : null}
    <SettingGroup part="developer" title={t('Developer', 'Προγραμματιστής')}><SettingToggle switchStyle label={t('Show developer options', 'Εμφάνιση επιλογών προγραμματιστή')} checked={appearance.developerOptions} change={value => changeAppearance({ developerOptions: value })} /></SettingGroup>
    {!route ? <NexusSettings language={language}><LanguageSetting language={language} preference={languagePreference} change={changeLanguage} /></NexusSettings> : null}
    <span className="settings-announcement" role="status" aria-live="polite">{announcement}</span>
  </div>;
  if (section === 'notifications') return <div className="original-settings">
    <SettingGroup part="notifications-promotions" title="Game Pass"><SettingToggle label={t('Notify me when changes are made to the Game Pass catalog', 'Να ειδοποιούμαι όταν γίνονται αλλαγές στον κατάλογο του Game Pass')} reason={serviceUnavailable} /></SettingGroup>
    <SettingGroup part="notifications-store" title="Store"><SettingToggle label={t('Notify me when something on my wishlist is on sale', 'Να ειδοποιούμαι όταν πωλείται κάτι στη λίστα επιθυμιών μου')} reason={serviceUnavailable} /><SettingToggle label={t('Notify me when something on my wishlist is available in Game Pass', 'Να ειδοποιούμαι όταν κάτι από τη λίστα επιθυμιών μου διατίθεται στο Game Pass')} reason={serviceUnavailable} /><SettingToggle label={t('Notify me when a pre-order on my wishlist is available to buy', 'Να ειδοποιούμαι όταν ένα στοιχείο προπαραγγελίας στη λίστα επιθυμιών μου είναι διαθέσιμο για αγορά')} reason={serviceUnavailable} /></SettingGroup>
    <SettingGroup part="notifications-social" title={t('More notification settings', 'Περισσότερες ρυθμίσεις ειδοποιήσεων')}><button className="original-setting-text-button" onClick={gameBar}>Game Bar <ExternalLink /></button><p>{t('Manage notifications for messages, followers and friends in Game Bar.', 'Διαχειριστείτε ειδοποιήσεις για τα μηνύματα, τους ακολούθους σας και τους φίλους σας.')}</p></SettingGroup>
    <SettingGroup part="notifications-general" title={t('Downloads', 'Λήψεις')}><SettingToggle label={t('Notify me when a game download finishes', 'Ειδοποίηση ολοκλήρωσης λήψης παιχνιδιού')} checked={data.settings.downloadNotifications !== false} change={notificationChange} /></SettingGroup>
    <SettingGroup part="notifications-achievements" title={t('Achievements', 'Επιτεύγματα')}><SettingToggle switchStyle label={t('Show achievement notifications', 'Εμφάνιση ειδοποιήσεων επιτευγμάτων')} reason={t('Achievement notification preferences are not available for this connection.', 'Οι προτιμήσεις ειδοποιήσεων επιτευγμάτων δεν είναι διαθέσιμες για αυτήν τη σύνδεση.')} /></SettingGroup>
  </div>;
  if (section === 'accessibility' && route === 'high-contrast') return <HighContrastSettings language={language} />;
  if (section === 'accessibility') return <div className="original-settings">
    <SettingGroup part="accessibility-visual" title={t('Audio and visuals', 'Ήχος και απεικονίσεις')}>
      <SettingToggle switchStyle label={t('Show themes on profiles', 'Εμφάνιση θεμάτων σε προφίλ')} reason={serviceUnavailable} />
      <SettingToggle switchStyle label={t('Show video preview on hover', 'Εμφάνιση προεπισκόπησης βίντεο με κατάδειξη')} reason={t('The catalog does not provide video previews yet.', 'Ο κατάλογος δεν παρέχει ακόμη προεπισκοπήσεις βίντεο.')} />
      <SettingToggle switchStyle label={t('Disable background images', 'Απενεργοποίηση εικόνων φόντου')} checked={appearance.hideBackground} change={value => changeAppearance({ hideBackground: value })} />
      <div className="settings-v2-motion"><h3>{t('Motion', 'Κίνηση')}</h3><label>{t('Select option to control motion and transitions', 'Επιλέξτε πώς θα ελέγχονται η κίνηση και οι μεταβάσεις')}<select aria-label={t('Motion', 'Κίνηση')} value={animationLevel(appearance)} onChange={event => { const value = event.target.value as AnimationLevel; if (['auto','full','simple','off'].includes(value)) changeAppearance({animationLevel:value,reduceMotion:value==='off'}); }}><option value="auto">{t('System default', 'Προεπιλογή συστήματος')}</option><option value="full">{t('Full', 'Πλήρης')}</option><option value="simple">{t('Reduced', 'Μειωμένη')}</option><option value="off">{t('Off', 'Ανενεργή')}</option></select></label></div>

    </SettingGroup>
    <SettingGroup part="accessibility-more" title={t('More accessibility settings', 'Περισσότερες ρυθμίσεις προσβασιμότητας')}><button className="original-setting-text-button" onClick={gameBar}>Game Bar <ExternalLink /></button><p>{t('Game chat transcription and other Game Bar accessibility features require platform support.', 'Η μεταγραφή συνομιλίας παιχνιδιού και άλλες λειτουργίες Game Bar απαιτούν υποστήριξη πλατφόρμας.')}</p><button className="original-setting-text-button" disabled={!openSystemSettings} onClick={openSystemSettings}>{t('System settings', 'Ρυθμίσεις συστήματος')}</button><p>{t('Change display size, color filters and other desktop accessibility settings.', 'Αλλαγή μεγέθους οθόνης, φίλτρων χρωμάτων και άλλων ρυθμίσεων προσβασιμότητας.')}</p><SettingLink href="https://www.xbox.com/accessories">{t('Xbox Accessories app', 'Εφαρμογή Αξεσουάρ XBOX')}</SettingLink><p>{t('Controller configuration requires support from your Linux desktop or gaming session.', 'Η προσαρμογή του χειριστηρίου απαιτεί υποστήριξη από τη συνεδρία Linux.')}</p><SettingLink href="https://www.xbox.com/community/for-everyone/accessibility">{t('Learn more about accessible gaming', 'Μάθετε περισσότερα σχετικά με τα προσβάσιμα παιχνίδια')}</SettingLink></SettingGroup>
  </div>;
  if (section === 'account') return <div className="original-settings">
    <SettingGroup part="account-profile" title={t('Account', 'Λογαριασμός')} action={<button className="settings-heading-action" disabled={!editAccount} onClick={editAccount}>{t('Edit', 'Επεξεργασία')}</button>}><div className="original-account-profile">{data.auth.stored === true && data.auth.avatarDataUrl ? <img src={data.auth.avatarDataUrl} alt={t('Xbox profile', 'Προφίλ Xbox')} /> : <CircleUserRound />}<strong>{data.auth.stored === true ? data.auth.gamertag ?? data.auth.username ?? t('Profile unavailable', 'Μη διαθέσιμο προφίλ') : t('Not signed in', 'Δεν έχετε συνδεθεί')}</strong><SettingLink href="https://social.xbox.com/changegamertag">{t('Change gamertag', 'Αλλαγή ετικέτας παίκτη')}</SettingLink></div><div className="original-account-links"><SettingLink href="https://account.microsoft.com/billing/orders">{t('View order history', 'Προβολή ιστορικού παραγγελιών')}</SettingLink><SettingLink href="https://support.xbox.com/help/subscriptions-billing/buy-games-apps/refund-orders">{t('Request a refund', 'Αίτηση επιστροφής χρημάτων')}</SettingLink><SettingLink href="https://account.microsoft.com/">{t('Manage Microsoft account', 'Διαχείριση λογαριασμού Microsoft')}</SettingLink></div></SettingGroup>
    <SettingGroup part="redeem" title={t('Redeem a code', 'Εξαργύρωση κωδικού')}><a className="primary original-redeem" href="https://redeem.microsoft.com/" target="_blank" rel="noreferrer">{t('Redeem', 'Εξαργύρωση')}</a></SettingGroup>
    <SettingGroup part="linked" title={t('Linked accounts', 'Συνδεδεμένοι λογαριασμοί')}><p>{t('Connect with friends from social networks.', 'Συνδεθείτε με φίλους από τα κοινωνικά δίκτυα.')}</p><p role="status">{t('Linked account information is not available in this client.', 'Οι πληροφορίες συνδεδεμένων κοινωνικών λογαριασμών δεν είναι διαθέσιμες.')}</p></SettingGroup>
    <SettingGroup part="privacy" title={t('Privacy settings', 'Ρυθμίσεις απορρήτου')} action={<SettingLink href="https://account.xbox.com/settings">{t('Manage', 'Διαχείριση')}</SettingLink>}><h4>{t('Others can see your PC game activity', 'Οι άλλοι μπορούν να δουν τη δραστηριότητα παιχνιδιού στον υπολογιστή σας')}</h4><p>{t('Manage who can see your activity and online presence in your Microsoft Xbox privacy settings.', 'Διαχειριστείτε ποιος μπορεί να βλέπει τη δραστηριότητα και την παρουσία σας στις ρυθμίσεις απορρήτου Xbox.')}</p><select aria-label={t('PC game activity visibility', 'Ορατότητα δραστηριότητας παιχνιδιού')} disabled><option>{t('Managed by Xbox privacy settings', 'Διαχείριση από τις ρυθμίσεις απορρήτου Xbox')}</option></select></SettingGroup>
    <SettingGroup part="purchase" title={t('Purchase sign-in', 'Είσοδος για αγορές')}><SettingToggle label={t('Skip sign-in for purchases', 'Παράλειψη εισόδου για αγορές')} reason={t("Purchases are handled on Microsoft's website.", 'Οι αγορές πραγματοποιούνται στον ιστότοπο της Microsoft.')} /></SettingGroup>
  </div>;
  if (section === 'subscriptions') return <div className="original-settings original-subscriptions-settings"><SettingGroup title={t('Subscriptions', 'Συνδρομές')}><div className="original-subscription"><h3><img className="settings-gamepass-brand" src="./original-xbox/icons/GamePassInline5.svg" alt="" aria-hidden="true" /><span className="settings-gamepass-fallback">XBOX GAME PASS</span></h3><dl><div><dt>{t('Plan', 'Σχέδιο')}</dt><dd>{data.auth.stored === true ? subscriptionBadge(data.auth.subscription) ?? '—' : '—'}</dd></div><div><dt>{t('Status', 'Κατάσταση')}</dt><dd>{data.auth.stored === true ? t('Billing status unavailable', 'Μη διαθέσιμη κατάσταση χρέωσης') : t('Sign in required', 'Απαιτείται σύνδεση')}</dd></div><div><dt>{t('Expiration date', 'Ημερομηνία λήξης')}</dt><dd>—</dd></div></dl><h3>{t('Billing', 'Εξόφληση')}</h3><dl><div><dt>{t('Price', 'Τιμή')}</dt><dd>—</dd></div><div><dt>{t('Next payment', 'Επόμενη εξόφληση')}</dt><dd>—</dd></div><div><dt>{t('Last payment', 'Τελευταία εξόφληση')}</dt><dd><SettingLink href="https://account.microsoft.com/billing/orders">{t('History', 'Ιστορικό')}</SettingLink></dd></div></dl><div className="settings-subscription-manage"><SettingLink href="https://account.microsoft.com/services">{t('Manage', 'Διαχείριση')}</SettingLink></div></div><p className="settings-account-source-note">{t('Renewal dates, payment errors and prices are not returned by the backend. View current details on Microsoft.', 'Η υπηρεσία δεν επιστρέφει ημερομηνίες ανανέωσης, σφάλματα πληρωμής ή τιμές. Δείτε τα τρέχοντα στοιχεία στη Microsoft.')}</p></SettingGroup><ConnectedSubscriptionAccounts data={data} accountSettings={accountSettings} language={language} /></div>;
  if (section === 'library') return <WindowsLibrarySettings data={data} language={language} />;
  if (section === 'about') return <div className="original-settings original-about-settings"><SettingGroup title={t('Version', 'Έκδοση')}><p>{data.launcherUpdate?.currentVersion ?? t('Development build', 'Έκδοση ανάπτυξης')} (XBOKS)<br />{data.backend.version ? `${data.backend.version} (XBOKS Engine)` : t('XBOKS Engine version unavailable', 'Μη διαθέσιμη έκδοση XBOKS Engine')}<br />{runtimeDisplay(data.runtime).version} (Proton)</p></SettingGroup><SettingGroup title={t('Device', 'Συσκευή')}><p>{data.desktopSettings?.desktop ?? 'Linux'}{data.desktopSettings?.sessionType ? ` · ${data.desktopSettings.sessionType}` : ''}</p><p>{t('Xbox network device identity is not available.', 'Το αναγνωριστικό συσκευής δικτύου Xbox δεν είναι διαθέσιμο.')}</p></SettingGroup><SettingGroup title={t('PC Insider program', 'Πρόγραμμα Insider υπολογιστή')}><p>{t('Windows Xbox Insider enrollment is not available on Linux.', 'Η εγγραφή Xbox Insider των Windows δεν είναι διαθέσιμη στο Linux.')}</p><SettingLink href="https://insider.xbox.com/">Xbox Insider</SettingLink></SettingGroup><SettingGroup title={t('Credits and licenses', 'Συντελεστές και άδειες')}><p>{t('XBOKS Engine builds on Xodus and Xodus Nexus. XBOKS is independently maintained and is not an official project of their upstream developers or Microsoft.', 'Το XBOKS Engine βασίζεται στα Xodus και Xodus Nexus. Το XBOKS συντηρείται ανεξάρτητα και δεν είναι επίσημο έργο των αρχικών δημιουργών τους ή της Microsoft.')}</p><p>{t('Copyright © 2026 Xodus Nexus contributors. The launcher retains its MIT license. Engine and runtime components retain their respective licenses.', 'Copyright © 2026 Xodus Nexus contributors. Ο launcher διατηρεί την άδεια MIT. Τα μέρη του engine και του runtime διατηρούν τις αντίστοιχες άδειές τους.')}</p><SettingLink href="https://github.com/xodus-gaming/xodus">Xodus</SettingLink><SettingLink href="https://github.com/domsvoboda/xodus-nexus">Xodus Nexus</SettingLink><SettingLink href="https://github.com/slaveitgr/xboks/blob/HEAD/LICENSE">{t('Launcher license (MIT)', 'Άδεια launcher (MIT)')}</SettingLink><SettingLink href="https://github.com/xodus-gaming/xodus/blob/HEAD/LICENSE">{t('Xodus license', 'Άδεια Xodus')}</SettingLink><SettingLink href="https://github.com/domsvoboda/xodus-nexus/blob/HEAD/LICENSE">{t('Xodus Nexus license', 'Άδεια Xodus Nexus')}</SettingLink><SettingLink href="https://github.com/xodus-gaming/Proton">{t('Runtime source and licenses', 'Πηγαίος κώδικας και άδειες runtime')}</SettingLink></SettingGroup><SettingGroup title={t('Links', 'Συνδέσεις')}>{[
    ['https://support.xbox.com/', t('Help', 'Βοήθεια')], ['https://www.microsoft.com/storedocs/terms-of-sale', t('Microsoft Store terms of sale', 'Όροι πώλησης του Microsoft Store')], ['https://privacy.microsoft.com/privacystatement', t('Microsoft privacy statement', 'Δήλωση προστασίας προσωπικών δεδομένων της Microsoft')], ['https://www.microsoft.com/servicesagreement', t('Microsoft services agreement', 'Σύμβαση παροχής υπηρεσιών της Microsoft')], ['https://www.xbox.com/legal/usage-rules', t('Terms of use', 'Όροι χρήσης')], ['https://github.com/slaveitgr/xboks', t('Third-party notices and source', 'Γνωστοποιήσεις τρίτων μερών και πηγαίος κώδικας')], ['https://www.xbox.com/community/for-everyone/accessibility', t('Accessible gaming on Xbox and Windows', 'Προσβάσιμα παιχνίδια στο XBOX και τα Windows')],
  ].map(([href, label]) => <SettingLink key={href} href={href}>{label}</SettingLink>)}</SettingGroup><NexusSettings language={language}><KeyringSetup compact disabled={data.auth.running} /></NexusSettings></div>;
  return null;
}


export function DevicesAndConnectionsSettings({ language = 'en' }: { language?: InterfaceLanguage }) {
  const t = localize(language);
  const [controllers, setControllers] = useState<Array<{index: number; name: string}>>();
  const [error, setError] = useState('');
  const [opening, setOpening] = useState(false);
  const pending = useRef(false), mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const update = () => {
      try {
        const pads = navigator.getGamepads?.();
        if (!pads) { setControllers(undefined); return; }
        setControllers(Array.from(pads).filter((pad): pad is Gamepad => Boolean(pad?.connected)).map(pad => ({index: pad.index,
          name: pad.id.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 160)})));
      } catch { setControllers(undefined); }
    };
    update(); const timer = window.setInterval(update, 1000);
    window.addEventListener('gamepadconnected', update); window.addEventListener('gamepaddisconnected', update);
    return () => { mounted.current = false; clearInterval(timer); window.removeEventListener('gamepadconnected', update); window.removeEventListener('gamepaddisconnected', update); };
  }, []);
  const canOpen = typeof window !== 'undefined' && typeof window.launcher?.openGuideSystemSettings === 'function';
  async function openBluetooth() {
    if (pending.current || !canOpen) return;
    pending.current = true; setOpening(true); setError('');
    try { await window.launcher.openGuideSystemSettings('bluetooth'); }
    catch { if (mounted.current) setError(t('Device settings could not be opened.', 'Δεν ήταν δυνατό το άνοιγμα των ρυθμίσεων συσκευών.')); }
    finally { pending.current = false; if (mounted.current) setOpening(false); }
  }
  return <div className="original-settings"><SettingGroup title={t('Controllers', 'Χειριστήρια')}>
    {controllers?.length ? <ul className="settings-v2-device-list">{controllers.map(controller => <li key={controller.index}><Gamepad2 /><span><strong>{controller.name}</strong><small>{t('Connected', 'Σε σύνδεση')}</small></span></li>)}</ul> : <p role="status">{controllers ? t('No controller is currently reported by the app.', 'Δεν αναφέρεται συνδεδεμένο χειριστήριο από την εφαρμογή.') : t('Controller status is unavailable until the app can read connected devices.', 'Η κατάσταση χειριστηρίων δεν είναι διαθέσιμη μέχρι η εφαρμογή να μπορεί να διαβάσει τις συνδεδεμένες συσκευές.')}</p>}
    <button className="secondary" disabled={!canOpen || opening} onClick={() => void openBluetooth()}><Bluetooth />{opening ? t('Opening…', 'Άνοιγμα…') : t('Bluetooth device settings', 'Ρυθμίσεις συσκευών Bluetooth')}</button>
    {error ? <p role="alert">{error}</p> : null}
  </SettingGroup><SettingGroup title={t('Mouse & keyboard', 'Ποντίκι και πληκτρολόγιο')}><p>{t('Pointer speed, acceleration and keyboard layout are managed by your Linux desktop.', 'Η ταχύτητα δείκτη, η επιτάχυνση και η διάταξη πληκτρολογίου ρυθμίζονται από την επιφάνεια εργασίας Linux.')}</p></SettingGroup></div>;
}

function HighContrastSettings({ language }: { language: InterfaceLanguage }) {
  const t = localize(language);
  const [reported, setReported] = useState<boolean>();
  useEffect(() => {
    const media = window.matchMedia?.('(forced-colors: active)');
    if (!media) return;
    const update = () => setReported(media.matches);
    update(); media.addEventListener('change', update); return () => media.removeEventListener('change', update);
  }, []);
  return <div className="original-settings"><SettingGroup title={t('High contrast', 'Υψηλή αντίθεση')}><p role="status">{reported === undefined ? t('Checking the operating system contrast preference…', 'Έλεγχος προτίμησης αντίθεσης λειτουργικού συστήματος…') : reported ? t('The operating system reports forced colors as active.', 'Το λειτουργικό σύστημα αναφέρει ενεργά εξαναγκασμένα χρώματα.') : t('The operating system does not report forced colors as active.', 'Το λειτουργικό σύστημα δεν αναφέρει ενεργά εξαναγκασμένα χρώματα.')}</p><p>{t('Manage contrast and color filters in your Linux desktop accessibility settings.', 'Διαχειριστείτε την αντίθεση και τα φίλτρα χρωμάτων στις ρυθμίσεις προσβασιμότητας της επιφάνειας εργασίας Linux.')}</p></SettingGroup></div>;
}

function LanguageSetting({ language, preference, change }: { language: InterfaceLanguage; preference: InterfaceLanguagePreference; change?: (value: InterfaceLanguagePreference) => void }) {
  const t = localize(language);
  return <label className="settings-language-field">{t('Interface language', 'Γλώσσα περιβάλλοντος')}<select value={preference} disabled={!change} onChange={event => { const value = event.target.value; if (value === 'system' || value === 'en' || value === 'el') change?.(value); }}><option value="system">{t('System', 'Σύστημα')}</option><option value="en">English</option><option value="el">Ελληνικά</option></select></label>;
}
export async function changeSettingsXboxMode(bridge: Pick<Window['launcher'], 'setFullscreenExperience'>, enabled: boolean) {
  const state = await bridge.setFullscreenExperience(enabled);
  if (!state || state.active !== enabled || enabled && state.available !== true) throw Error('unconfirmed');
  return state;
}

export function XboxModeSettings({ data, language = 'en' }: { data: AppSnapshot; language?: InterfaceLanguage }) {
  const t = localize(language), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const active = data.fullscreenExperience?.active === true || data.desktopSettings?.fullscreenExperience === true;
  const nativeSession = data.fullscreenExperience?.source === 'session' || data.desktopSettings?.fullscreenExperienceSource === 'environment';
  const available = data.fullscreenExperience?.available === true || nativeSession;
  const mounted = useRef(true), pending = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function change(enabled: boolean) {
    if (pending.current || nativeSession || !available) return;
    pending.current = true; setBusy(true); setError('');
    try { await changeSettingsXboxMode(window.launcher, enabled); }
    catch { if (mounted.current) setError(t('We could not change Xbox mode. Try again.', 'Δεν ήταν δυνατή η αλλαγή λειτουργίας Xbox. Δοκιμάστε ξανά.')); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  return <div className="original-settings"><SettingGroup title={t('Play in XBOX Mode', 'Παίξτε σε λειτουργία XBOX')}>
    <p>{t('Switch to a full-screen Xbox experience designed for gaming. You can return to desktop mode at any time.', 'Μεταβείτε σε εμπειρία Xbox πλήρους οθόνης σχεδιασμένη για παιχνίδια. Μπορείτε να επιστρέψετε στην επιφάνεια εργασίας ανά πάσα στιγμή.')}</p>
    <SettingToggle switchStyle label={t('Xbox mode', 'Λειτουργία Xbox')} checked={active} disabled={busy || nativeSession || !available} change={enabled => { void change(enabled); }} />
    <p role="status">{busy ? active ? t('Switching to desktop mode…', 'Μετάβαση στην επιφάνεια εργασίας…') : t('Switching to Xbox mode…', 'Μετάβαση σε λειτουργία Xbox…') : active ? t('Xbox mode is active', 'Η λειτουργία Xbox είναι ενεργή') : available ? t('Desktop mode', 'Επιφάνεια εργασίας') : data.fullscreenExperience?.reason || t('XBOX mode is unavailable in this session. Enable Linux Gaming Mode to use this option.', 'Η λειτουργία XBOX δεν είναι διαθέσιμη σε αυτήν τη συνεδρία. Ενεργοποιήστε το Linux Gaming Mode για να χρησιμοποιήσετε αυτήν την επιλογή.')}</p>
    {nativeSession ? <p>{t('Leave the gaming session through the system session controls.', 'Αποχωρήστε από τη συνεδρία παιχνιδιών μέσω των χειριστηρίων συστήματος.')}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
  </SettingGroup></div>;
}

export function ConnectedSubscriptionAccounts({ data, accountSettings, language = 'en' }: { data: AppSnapshot; accountSettings?: () => void; editAccount?: () => void; language?: InterfaceLanguage }) {
  const t = localize(language), [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer); }, []);
  const identities = accountIdentityViews(data.auth, now);
  const xboxStatus = data.auth.stored === false ? t('Not signed in', 'Δεν έχετε συνδεθεί') : data.auth.stored === true ? data.auth.gamertag ? t('Xbox profile available', 'Διαθέσιμο προφίλ Xbox') : t('Microsoft credentials stored', 'Αποθηκευμένα διαπιστευτήρια Microsoft') : t('Account status unavailable', 'Μη διαθέσιμη κατάσταση λογαριασμού');
  return <SettingGroup title={t('Connected accounts', 'Συνδεδεμένοι λογαριασμοί')}><div className="settings-identity-list">
    <article className="settings-connected-account" aria-label={t('Xbox gaming account', 'Λογαριασμός παιχνιδιών Xbox')}>
      {data.auth.stored === true && data.auth.avatarDataUrl ? <img src={data.auth.avatarDataUrl} alt={t('Xbox profile', 'Προφίλ Xbox')} /> : <CircleUserRound />}
      <div><small>{t('Xbox gaming account', 'Λογαριασμός παιχνιδιών Xbox')}</small>{identities.xbox.name ? <strong>{identities.xbox.name}</strong> : null}{identities.xbox.detail && identities.xbox.detail !== identities.xbox.name ? <span>{identities.xbox.detail}</span> : null}<small>{xboxStatus}</small></div>
      <button className="secondary" disabled={!accountSettings} onClick={accountSettings}>{t('Manage account', 'Διαχείριση λογαριασμού')}</button>
    </article>
    <article className="settings-connected-account" aria-label={t('Microsoft Store account', 'Λογαριασμός Microsoft Store')}><CircleUserRound /><div><small>{t('Microsoft Store account', 'Λογαριασμός Microsoft Store')}</small>{identities.store.name ? <strong>{identities.store.name}</strong> : null}<small>{identities.store.name ? t('Store identity verified by backend', 'Η ταυτότητα Store επιβεβαιώθηκε από την υπηρεσία') : t('Store identity unavailable', 'Μη διαθέσιμη ταυτότητα Store')}</small></div><SettingLink href="https://account.microsoft.com/">{t('Manage on Microsoft', 'Διαχείριση στη Microsoft')}</SettingLink></article>
    </div>{data.auth.stored === false ? <p>{t('No Xbox account is connected.', 'Δεν έχει συνδεθεί λογαριασμός Xbox.')}</p> : null}
    {identities.namesDiffer ? <p className="original-setting-info" role="status">{t('Xbox and Store use different sign-in names. Store purchases belong to the Store account.', 'Το Xbox και το Store χρησιμοποιούν διαφορετικά ονόματα σύνδεσης. Οι αγορές Store ανήκουν στον λογαριασμό Store.')}</p> : null}
    <p className="settings-account-source-note">{t("Xbox profile and Microsoft Store identity are checked separately. Opening Microsoft's website does not connect a Store account to XBOKS.", 'Το προφίλ Xbox και η ταυτότητα Microsoft Store ελέγχονται χωριστά. Το άνοιγμα του ιστότοπου Microsoft δεν συνδέει λογαριασμό Store στο XBOKS.')}</p>
  </SettingGroup>;
}
/** 2612 Apps contains detected native providers plus compatible account providers. */
export const referenceLibraryProviders = [
  { id: 'battlenet', name: 'Battle.net', extension: false, site: 'https://download.battle.net/' },
  { id: 'steam', name: 'Steam', extension: false, site: 'https://store.steampowered.com/about/' },
  { id: 'ubisoft', name: 'Ubisoft Connect', extension: true, site: 'https://www.ubisoft.com/ubisoft-connect' },
  { id: 'ea', name: 'EA app', extension: true, site: 'https://www.ea.com/ea-app' },
  { id: 'epic', name: 'Epic Games Store', extension: false, site: 'https://store.epicgames.com/download' },
  { id: 'gog', name: 'GOG GALAXY', extension: false, site: 'https://www.gog.com/galaxy' },
  { id: 'riot', name: 'Riot Games', extension: false, site: 'https://www.riotgames.com/' },
] as const;
type ReferenceProvider = typeof referenceLibraryProviders[number];
const showMyAppsKey = 'xboks.library.show-apps';
export function readShowMyAppsPreference(): boolean {
  try { return localStorage.getItem(showMyAppsKey) !== 'false'; } catch { return true; }
}
export function saveShowMyAppsPreference(value: boolean): boolean {
  try { localStorage.setItem(showMyAppsKey, String(value)); }
  catch { return false; }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('xboks-library-apps-changed', {detail: value}));
  return true;
}
export function WindowsLibrarySettings({ data, language = 'en' }: { data: AppSnapshot; language?: InterfaceLanguage }) {
  const t = localize(language);
  const [providers, setProviders] = useState<LibraryProviderStatus[]>();
  const [busy, setBusy] = useState(true), [error, setError] = useState(''), [importing, setImporting] = useState(false);
  const [showMyApps, setShowMyApps] = useState(readShowMyAppsPreference);
  const [page, setPage] = useState<ReferenceProvider['id']>();
  const generation = useRef(0), surface = useRef<HTMLDivElement>(null), returnFocus = useRef<HTMLButtonElement | null>(null);
  async function refresh() {
    const request = ++generation.current; setBusy(true); setError('');
    try { const result = await window.launcher.getLibraryProviders(); if (request === generation.current) setProviders(result); }
    catch { if (request === generation.current) setError(t('App detection failed. Try again.', 'Ο εντοπισμός εφαρμογών απέτυχε. Δοκιμάστε ξανά.')); }
    finally { if (request === generation.current) setBusy(false); }
  }
  useEffect(() => { void refresh(); return () => { generation.current++; }; }, []);
  useEffect(() => { const update = () => setShowMyApps(readShowMyAppsPreference()); window.addEventListener('xboks-library-apps-changed', update); return () => window.removeEventListener('xboks-library-apps-changed', update); }, []);
  useEffect(() => { if (page) { surface.current?.querySelector<HTMLButtonElement>('[data-settings-subpage-back]')?.focus(); const content = surface.current?.closest('.xbox-settings-content'); if (content) content.scrollTop = 0; } }, [page]);
  async function importGame() {
    setImporting(true); setError('');
    try { await window.launcher.importGame(); } catch { setError(t('The game could not be imported.', 'Δεν ήταν δυνατή η εισαγωγή του παιχνιδιού.')); }
    finally { setImporting(false); }
  }
  const detected = (id: ReferenceProvider['id']) => providers?.some(value => value.id === id && value.installed) === true;
  const card = (provider: ReferenceProvider, installed = false) => <button key={provider.id} className="settings-v2-provider-card" onClick={event => { returnFocus.current = event.currentTarget; setPage(provider.id); }} aria-label={`${provider.name} · ${t('Settings', 'Ρυθμίσεις')}`}><ProviderLogo id={provider.id} /><span><strong>{provider.name}</strong>{installed ? <small>{t('Account connection unavailable', 'Μη διαθέσιμη σύνδεση λογαριασμού')}</small> : null}</span></button>;
  const selected = referenceLibraryProviders.find(provider => provider.id === page);
  const back = () => { setPage(undefined); requestAnimationFrame(() => returnFocus.current?.focus()); };
  return <div ref={surface} className="original-settings settings-v2-apps-page">
    <div hidden={Boolean(page)}>
      <section className="settings-v2-apps-section"><h2>{t('Detected apps', 'Εντοπισμένες εφαρμογές')}</h2><p>{t("Apps and services we've detected on your device or connected to your account.", 'Εφαρμογές και υπηρεσίες που εντοπίσαμε στη συσκευή σας ή συνδέονται με τον λογαριασμό σας.')}</p>
        <SettingToggle switchStyle label={t('Display My apps in library', 'Εμφάνιση των εφαρμογών μου στη βιβλιοθήκη')} checked={showMyApps} change={value => { if (saveShowMyAppsPreference(value)) setShowMyApps(value); else setError(t('The library preference could not be saved.', 'Η προτίμηση βιβλιοθήκης δεν αποθηκεύτηκε.')); }} />
        {busy ? <p role="status">{t('Checking installed apps…', 'Έλεγχος εγκατεστημένων εφαρμογών…')}</p> : providers ? providers.some(value => value.installed) ? <div className="settings-v2-provider-grid">{referenceLibraryProviders.filter(provider => detected(provider.id)).map(provider => card(provider, true))}</div> : <p role="status">{t('No supported apps were detected on this PC.', 'Δεν εντοπίστηκαν υποστηριζόμενες εφαρμογές σε αυτόν τον υπολογιστή.')}</p> : <p role="status">{t('App detection is unavailable.', 'Ο εντοπισμός εφαρμογών δεν είναι διαθέσιμος.')}</p>}
      </section>
      <section className="settings-v2-apps-section"><h2>{t('Compatible apps', 'Συμβατές εφαρμογές')}</h2><p>{t("Apps that work with XBOX but aren't currently connected or detected.", 'Εφαρμογές που λειτουργούν με το XBOX αλλά δεν έχουν συνδεθεί ή εντοπιστεί αυτήν τη στιγμή.')}</p><div className="settings-v2-provider-grid">{referenceLibraryProviders.filter(provider => !detected(provider.id)).map(provider => card(provider))}</div></section>
      <NexusSettings language={language}><p>{t(`${data.games.length} games in your local library.`, `${data.games.length} παιχνίδια στην τοπική βιβλιοθήκη σας.`)}</p><button className="secondary" disabled={importing} onClick={() => void importGame()}>{importing ? t('Importing…', 'Εισαγωγή…') : t('Add a game', 'Προσθήκη παιχνιδιού')}</button><button className="secondary" disabled={busy} onClick={() => void refresh()}>{busy ? t('Checking apps…', 'Έλεγχος εφαρμογών…') : t('Check again', 'Νέος έλεγχος')}</button><p>{t('Detection uses Linux desktop launchers. It does not connect provider accounts or import their libraries.', 'Ο εντοπισμός χρησιμοποιεί συντομεύσεις Linux. Δεν συνδέει λογαριασμούς παρόχων και δεν εισάγει τις βιβλιοθήκες τους.')}</p></NexusSettings>
    </div>
    {selected ? <div className="settings-provider-detail"><button className="settings-subpage-back" data-settings-subpage-back onClick={back}><ChevronLeft />{t('Apps', 'Εφαρμογές')}</button><SettingGroup title={selected.name}><div className="settings-provider-detail-identity"><ProviderLogo id={selected.id} /><p>{busy ? t('Checking…', 'Έλεγχος…') : detected(selected.id) ? t('Detected on this PC', 'Εντοπίστηκε σε αυτόν τον υπολογιστή') : t('Not detected on this PC', 'Δεν εντοπίστηκε σε αυτόν τον υπολογιστή')}</p></div><SettingToggle switchStyle label={t('Display installed games', 'Εμφάνιση εγκατεστημένων παιχνιδιών')} reason={t('Automatic library discovery for this provider is not implemented.', 'Ο αυτόματος εντοπισμός βιβλιοθήκης για αυτόν τον πάροχο δεν έχει υλοποιηθεί.')} />{selected.extension ? <SettingToggle switchStyle label={t('Enable extension', 'Ενεργοποίηση επέκτασης')} reason={t('The Windows Xbox extension requires a Linux integration.', 'Η επέκταση Xbox των Windows απαιτεί ενσωμάτωση στο Linux.')} /> : null}<SettingLink href={selected.site}>{t('Provider website', 'Ιστότοπος παρόχου')}</SettingLink><NexusSettings language={language}><button className="secondary" disabled={importing} onClick={() => void importGame()}>{t('Add a game manually', 'Χειροκίνητη προσθήκη παιχνιδιού')}</button></NexusSettings></SettingGroup></div> : null}
    {error ? <p role="alert">{error}</p> : null}
  </div>;
}

function ProviderLogo({ id }: { id: ReferenceProvider['id'] }) {
  const [missing, setMissing] = useState(false);
  return <span className="settings-provider-logo" aria-hidden="true">{missing ? <span>{referenceLibraryProviders.find(provider => provider.id === id)?.name.slice(0, 1)}</span> : <img src={`./original-xbox/providers/${id}.png`} alt="" onError={() => setMissing(true)} />}</span>;
}
