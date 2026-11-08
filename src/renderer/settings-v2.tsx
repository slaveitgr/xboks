import { createContext, useContext, type ReactNode } from 'react';
import type { SettingsSection } from './SettingsFrame';

export type SettingsV2Group = 'account' | 'devices' | 'system' | 'play-social' | 'apps' | 'accessibility';
export type SettingsV2Route = 'profile' | 'subscriptions' | 'purchase-sign-in' | 'licenses' | 'input' | 'permissions' | 'audio' | 'display' | 'xbox-mode' | 'languages' | 'storage' | 'startup' | 'notifications' | 'notifications-general' | 'notifications-social' | 'notifications-achievements' | 'notifications-promotions' | 'notifications-store' | 'developer' | 'about' | 'streaming' | 'privacy' | 'manage-games' | 'library' | 'accessibility' | 'audio-visual' | 'high-contrast';
export const settingsV2Groups: ReadonlyArray<{ id: SettingsV2Group; en: string; el: string; description: string; descriptionEl: string }> = [
  { id: 'account', en: 'Account', el: 'Λογαριασμός', description: 'Profile, connected accounts and subscriptions', descriptionEl: 'Προφίλ, συνδεδεμένοι λογαριασμοί και συνδρομές' },
  { id: 'devices', en: 'Devices & connections', el: 'Συσκευές και συνδέσεις', description: 'Audio and connected devices', descriptionEl: 'Ήχος και συνδεδεμένες συσκευές' },
  { id: 'system', en: 'System', el: 'Σύστημα', description: 'Display, storage, startup and app preferences', descriptionEl: 'Εμφάνιση, αποθήκευση, εκκίνηση και προτιμήσεις εφαρμογής' },
  { id: 'play-social', en: 'Play & social', el: 'Παιχνίδι και κοινωνικά', description: 'Streaming, activity and privacy', descriptionEl: 'Streaming, δραστηριότητα και απόρρητο' },
  { id: 'apps', en: 'Apps', el: 'Εφαρμογές', description: 'Your library and launcher integrations', descriptionEl: 'Βιβλιοθήκη και ενσωματώσεις εκκινητών' },
  { id: 'accessibility', en: 'Accessibility', el: 'Προσβασιμότητα', description: 'Motion, backgrounds and accessibility preferences', descriptionEl: 'Κίνηση, φόντα και προτιμήσεις προσβασιμότητας' },
];
export const settingsV2Routes: ReadonlyArray<{ id: SettingsV2Route; group: SettingsV2Group; section: SettingsSection; en: string; el: string; description: string; descriptionEl: string }> = [
  { id: 'profile', group: 'account', section: 'account', en: 'Account & profile', el: 'Λογαριασμός και προφίλ', description: 'Microsoft sign-in, Xbox profile and connected accounts', descriptionEl: 'Σύνδεση Microsoft, προφίλ Xbox και συνδεδεμένοι λογαριασμοί' },
  { id: 'subscriptions', group: 'account', section: 'subscriptions', en: 'Subscriptions', el: 'Συνδρομές', description: 'Your Game Pass plan and Microsoft billing', descriptionEl: 'Το Game Pass σας και χρεώσεις Microsoft' },
  { id: 'purchase-sign-in', group: 'account', section: 'account', en: 'Purchase sign-in', el: 'Είσοδος για αγορές', description: 'Authentication for Microsoft Store purchases', descriptionEl: 'Πιστοποίηση για αγορές Microsoft Store' },
  { id: 'privacy', group: 'account', section: 'account', en: 'Privacy & safety', el: 'Απόρρητο και ασφάλεια', description: 'Xbox privacy, safety and activity', descriptionEl: 'Απόρρητο, ασφάλεια και δραστηριότητα Xbox' },
  { id: 'licenses', group: 'account', section: 'library', en: 'Disc to digital license history', el: 'Ιστορικό μετατροπής αδειών δίσκου σε ψηφιακές', description: 'Digital game license history', descriptionEl: 'Ιστορικό ψηφιακών αδειών παιχνιδιών' },
  { id: 'input', group: 'devices', section: 'application', en: 'Input', el: 'Είσοδος', description: 'Controllers, mouse and keyboard', descriptionEl: 'Χειριστήρια, ποντίκι και πληκτρολόγιο' },
  { id: 'notifications', group: 'system', section: 'notifications', en: 'Notifications', el: 'Ειδοποιήσεις', description: 'General, social, achievements and Store notifications', descriptionEl: 'Γενικά, κοινωνικά, επιτεύγματα και ειδοποιήσεις Store' },
  { id: 'display', group: 'system', section: 'application', en: 'Display', el: 'Εμφάνιση', description: 'App appearance and status indicators', descriptionEl: 'Εμφάνιση εφαρμογής και ενδείξεις κατάστασης' },
  { id: 'xbox-mode', group: 'system', section: 'application', en: 'Xbox mode', el: 'Λειτουργία Xbox', description: 'Gaming home and desktop experience', descriptionEl: 'Αρχική παιχνιδιών και εμπειρία επιφάνειας εργασίας' },
  { id: 'audio', group: 'system', section: 'audio', en: 'Audio', el: 'Ήχος', description: 'Input, output and voice preferences', descriptionEl: 'Είσοδος, έξοδος και προτιμήσεις φωνής' },
  { id: 'languages', group: 'system', section: 'application', en: 'Language & region', el: 'Γλώσσα και περιοχή', description: 'Choose the app language', descriptionEl: 'Επιλογή γλώσσας εφαρμογής' },
  { id: 'storage', group: 'system', section: 'install', en: 'Install & storage', el: 'Εγκατάσταση και αποθήκευση', description: 'Game installs, download settings and XBOKS Engine', descriptionEl: 'Εγκαταστάσεις, λήψεις και XBOKS Engine' },
  { id: 'startup', group: 'system', section: 'application', en: 'App startup', el: 'Εκκίνηση εφαρμογής', description: 'Login, background and tray behavior', descriptionEl: 'Σύνδεση, παρασκήνιο και συμπεριφορά περιοχής συστήματος' },
  { id: 'notifications-general', group: 'system', section: 'notifications', en: 'General', el: 'Γενικά', description: 'Downloads and general alerts', descriptionEl: 'Λήψεις και γενικές ειδοποιήσεις' },
  { id: 'notifications-social', group: 'system', section: 'notifications', en: 'Social & messaging', el: 'Κοινωνικά και μηνύματα', description: 'Friends, messages and party notifications', descriptionEl: 'Φίλοι, μηνύματα και ειδοποιήσεις ομάδας' },
  { id: 'notifications-achievements', group: 'system', section: 'notifications', en: 'Achievements', el: 'Επιτεύγματα', description: 'Achievement notifications', descriptionEl: 'Ειδοποιήσεις επιτευγμάτων' },
  { id: 'notifications-promotions', group: 'system', section: 'notifications', en: 'Promotions & marketing', el: 'Προσφορές και προωθήσεις', description: 'Game Pass news and promotions', descriptionEl: 'Νέα και προσφορές Game Pass' },
  { id: 'notifications-store', group: 'system', section: 'notifications', en: 'Store updates', el: 'Ενημερώσεις Store', description: 'Wishlist and Store notifications', descriptionEl: 'Λίστα επιθυμιών και ειδοποιήσεις Store' },
  { id: 'developer', group: 'system', section: 'application', en: 'Developer', el: 'Προγραμματιστής', description: 'Show developer settings', descriptionEl: 'Εμφάνιση ρυθμίσεων προγραμματιστή' },
  { id: 'about', group: 'system', section: 'about', en: 'About', el: 'Πληροφορίες', description: 'Versions, updates, credits and licenses', descriptionEl: 'Εκδόσεις, ενημερώσεις, συντελεστές και άδειες' },
  { id: 'permissions', group: 'play-social', section: 'application', en: 'Offline play', el: 'Παιχνίδι εκτός σύνδεσης', description: 'Device permissions for your Microsoft Store account', descriptionEl: 'Δικαιώματα συσκευής για τον λογαριασμό Microsoft Store' },
  { id: 'manage-games', group: 'play-social', section: 'library', en: 'Manage games', el: 'Διαχείριση παιχνιδιών', description: 'Games and save management', descriptionEl: 'Παιχνίδια και διαχείριση αποθηκεύσεων' },
  { id: 'streaming', group: 'play-social', section: 'application', en: 'Cloud Gaming', el: 'Cloud Gaming', description: 'Cloud sign-in region and streaming preferences', descriptionEl: 'Περιοχή σύνδεσης cloud και προτιμήσεις streaming' },
  { id: 'library', group: 'apps', section: 'library', en: 'Library & extensions', el: 'Βιβλιοθήκη και επεκτάσεις', description: 'Other launchers, installed games and app integrations', descriptionEl: 'Άλλοι εκκινητές, εγκατεστημένα παιχνίδια και ενσωματώσεις' },
  { id: 'accessibility', group: 'accessibility', section: 'accessibility', en: 'Visuals & motion', el: 'Εικόνα και κίνηση', description: 'Backgrounds, animation and accessible gaming', descriptionEl: 'Φόντα, κινήσεις και προσβάσιμα παιχνίδια' },
  { id: 'audio-visual', group: 'accessibility', section: 'accessibility', en: 'Audio & visual assist', el: 'Βοήθεια ήχου και εικόνας', description: 'Accessibility preferences for audio and visuals', descriptionEl: 'Προτιμήσεις προσβασιμότητας ήχου και εικόνας' },
  { id: 'high-contrast', group: 'accessibility', section: 'accessibility', en: 'High contrast', el: 'Υψηλή αντίθεση', description: 'Operating system contrast settings', descriptionEl: 'Ρυθμίσεις αντίθεσης λειτουργικού συστήματος' },
];
const sectionRoutes: Record<SettingsSection, SettingsV2Route> = { account: 'profile', application: 'display', subscriptions: 'subscriptions', notifications: 'notifications', install: 'storage', library: 'library', audio: 'audio', accessibility: 'accessibility', about: 'about' };
export function settingsV2RouteForSection(section: SettingsSection) { return settingsV2Routes.find(route => route.id === sectionRoutes[section])!; }
export function settingsV2RouteParent(route: SettingsV2Route): SettingsV2Route | undefined {
  return route.startsWith('notifications-') ? 'notifications' : undefined;
}
export function settingsV2CategoryRoutes(group: SettingsV2Group) {
  const routes = settingsV2Routes.filter(route => route.group === group && !settingsV2RouteParent(route.id));
  const systemOrder: SettingsV2Route[] = ['notifications','display','xbox-mode','storage','audio','languages','startup','developer','about'];
  return group === 'system' ? routes.sort((left,right) => systemOrder.indexOf(left.id)-systemOrder.indexOf(right.id)) : routes;
}
const SettingsV2Context = createContext<SettingsV2Route | undefined>(undefined);
export const SettingsV2RouteProvider = SettingsV2Context.Provider;
export const useSettingsV2Route = () => useContext(SettingsV2Context);

export function SettingsV2RouteOnly({ routes, children }: { routes: readonly SettingsV2Route[]; children: ReactNode }) {
  const route = useSettingsV2Route();
  return !route || routes.includes(route) ? <>{children}</> : null;
}
export function settingsV2PartVisible(route: SettingsV2Route | undefined, part: string | undefined): boolean {
  if (!route || !part) return true;
  const allowed: Partial<Record<SettingsV2Route, readonly string[]>> = {
    display: ['display'], startup: ['startup'], languages: ['languages'], developer: ['developer'],
    permissions: ['permissions'], profile: ['account-profile', 'redeem', 'linked'], privacy: ['privacy'], 'purchase-sign-in': ['purchase'],
    'notifications-general': ['notifications-general'], 'notifications-social': ['notifications-social'],
    'notifications-achievements': ['notifications-achievements'], 'notifications-promotions': ['notifications-promotions'], 'notifications-store': ['notifications-store'],
    'audio-visual': ['accessibility-visual', 'accessibility-audio', 'accessibility-more'], 'high-contrast': ['high-contrast'],
  };
  return !allowed[route] || allowed[route]!.includes(part);
}
