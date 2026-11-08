// SPDX-License-Identifier: MIT
import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import GioUnix from 'gi://GioUnix';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {HOME_APPS, homeLaunchSpec, normalizeHomeApp} from './home-apps.js';

const SCHEMA = 'org.gnome.shell.extensions.linux-gaming-mode';
const BUS = 'org.slaveitgr.Xboks.Experience';
const HOME_OBJECT = '/org/slaveitgr/Xboks/Experience/Home1';
const HOME_INTERFACE = `${BUS}.Home1`;

export default class LinuxGamingModePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const el = (GLib.get_language_names()[0] ?? 'en').toLowerCase().startsWith('el');
        const text = (en, greek) => el ? greek : en;
        const settings = this.getSettings(SCHEMA);
        const cancellable = new Gio.Cancellable();
        let closing = false, refreshing = false, busy = false, installed = [], entries = new Map();
        const names = {
            none: text('None', 'Καμία'),
            steam: 'Steam Big Picture',
            xboks: 'XBOKS Fullscreen',
            'original-xbox': 'Original Xbox (Xbox mode)',
        };
        const descriptions = {
            none: text('Keep using your desktop. Choose a gaming home to enable Linux Gaming Mode.',
                'Συνεχίστε στην επιφάνεια εργασίας. Επιλέξτε αρχική εφαρμογή για να ενεργοποιήσετε το Linux Gaming Mode.'),
            steam: text('Start Steam with its controller interface.', 'Εκκίνηση του Steam με το περιβάλλον χειριστηρίου.'),
            xboks: text('Start XBOKS in its integrated Fullscreen Experience.', 'Εκκίνηση του XBOKS στο ενσωματωμένο Fullscreen Experience.'),
            'original-xbox': text('Experimental. Requires the original Xbox client and a prepared Wine-UWP runtime connected to Linux Gaming Mode. An installed launcher alone does not establish compatibility.',
                'Πειραματική υποστήριξη. Απαιτεί τον αυθεντικό Xbox client και προετοιμασμένο Wine-UWP συνδεδεμένο με το Linux Gaming Mode. Η παρουσία συντόμευσης δεν επιβεβαιώνει τη συμβατότητα.'),
        };

        window.set_title('Linux Gaming Mode (Fullscreen Experience)');
        const page = new Adw.PreferencesPage({title: text('Gaming mode', 'Λειτουργία gaming'), icon_name: 'applications-games-symbolic'});
        const group = new Adw.PreferencesGroup({title: 'Linux Gaming Mode',
            description: text('Choose the home application for your controller gaming experience.',
                'Επιλέξτε την αρχική εφαρμογή για την εμπειρία gaming με χειριστήριο.')});
        page.add(group);
        const model = new Gtk.StringList();
        const homeRow = new Adw.ComboRow({title: text('Gaming home app', 'Αρχική εφαρμογή gaming'), model});
        group.add(homeRow);
        const details = new Adw.ActionRow({title: text('Selected home', 'Επιλεγμένη αρχική εφαρμογή'), subtitle_lines: 0});
        group.add(details);
        const startup = new Adw.SwitchRow({title: text('Enter gaming mode at sign-in', 'Είσοδος σε λειτουργία gaming κατά τη σύνδεση'),
            subtitle: text('Start the selected home automatically after you sign in. Choose a home application first.',
                'Αυτόματη εκκίνηση της επιλεγμένης αρχικής εφαρμογής μετά τη σύνδεση. Επιλέξτε πρώτα αρχική εφαρμογή.')});
        settings.bind('enter-on-login', startup, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(startup);

        const performance = new Adw.PreferencesGroup({title: text('Performance', 'Επιδόσεις')});
        page.add(performance);
        const gameMode = new Adw.SwitchRow({title: text('Request Feral GameMode optimizations', 'Αίτημα βελτιστοποιήσεων Feral GameMode'),
            subtitle: text('Use the installed GameMode service during gaming sessions.', 'Χρήση της εγκατεστημένης υπηρεσίας GameMode κατά τη λειτουργία gaming.'),
            tooltip_text: text('Requires Feral GameMode. Requests follow the daemon configuration; an FPS increase is not guaranteed.',
                'Απαιτεί το Feral GameMode. Τα αιτήματα ακολουθούν τις ρυθμίσεις της υπηρεσίας· δεν εξασφαλίζεται αύξηση FPS.')});
        settings.bind('use-feral-gamemode', gameMode, 'active', Gio.SettingsBindFlags.DEFAULT);
        performance.add(gameMode);
        const performanceStatus = new Adw.ActionRow({title: text('GameMode status', 'Κατάσταση GameMode'), subtitle_lines: 0,
            subtitle: text('Checking service status…', 'Έλεγχος κατάστασης υπηρεσίας…')});
        performance.add(performanceStatus);
        const refreshStatus = () => {
            if (closing) return;
            Gio.DBus.session.call(BUS, HOME_OBJECT, HOME_INTERFACE, 'GetState', null, null,
                Gio.DBusCallFlags.NONE, 5000, cancellable, (connection, result) => {
                    try {
                        const reply = connection.call_finish(result).deepUnpack();
                        const current = JSON.parse(reply[0]);
                        if (closing) return;
                        const labels = {
                            disabled: text('Disabled', 'Απενεργοποιημένο'),
                            requesting: text('Requesting optimizations…', 'Αίτημα βελτιστοποιήσεων…'),
                            active: text('Active — the GameMode service acknowledged the session.', 'Ενεργό — η υπηρεσία GameMode επιβεβαίωσε τη συνεδρία.'),
                            unavailable: text('Unavailable — install Feral GameMode to use this option.', 'Μη διαθέσιμο — εγκαταστήστε το Feral GameMode για αυτή την επιλογή.'),
                            error: text('The optimization request failed. Check the GameMode service configuration.', 'Το αίτημα βελτιστοποιήσεων απέτυχε. Ελέγξτε τις ρυθμίσεις της υπηρεσίας GameMode.'),
                        };
                        performanceStatus.subtitle = labels[current?.performance?.state] ?? text('Status unavailable', 'Η κατάσταση δεν είναι διαθέσιμη');
                    } catch {
                        if (!closing) performanceStatus.subtitle = text('Status unavailable. Enable the extension to check the service.',
                            'Η κατάσταση δεν είναι διαθέσιμη. Ενεργοποιήστε το extension για έλεγχο της υπηρεσίας.');
                    }
                });
        };

        const actions = new Adw.PreferencesGroup({title: text('Switch modes', 'Εναλλαγή λειτουργίας')});
        page.add(actions);
        const launchRow = new Adw.ActionRow({title: text('Enter gaming mode', 'Είσοδος σε λειτουργία gaming'),
            subtitle: text('Open the selected gaming home.', 'Άνοιγμα της επιλεγμένης αρχικής εφαρμογής.')});
        const launch = new Gtk.Button({label: text('Enter now', 'Είσοδος τώρα'), valign: Gtk.Align.CENTER, css_classes: ['suggested-action']});
        launchRow.add_suffix(launch); launchRow.activatable_widget = launch; actions.add(launchRow);
        const leaveRow = new Adw.ActionRow({title: text('Return to desktop', 'Επιστροφή στην επιφάνεια εργασίας'),
            subtitle: text('Restore the desktop without closing your applications.', 'Επαναφορά της επιφάνειας εργασίας χωρίς κλείσιμο των εφαρμογών σας.')});
        const leave = new Gtk.Button({label: text('Desktop', 'Επιφάνεια εργασίας'), valign: Gtk.Align.CENTER});
        leaveRow.add_suffix(leave); leaveRow.activatable_widget = leave; actions.add(leaveRow);
        const status = new Adw.ActionRow({title: text('Status', 'Κατάσταση'), subtitle_lines: 0,
            subtitle: text('Enable this extension before entering gaming mode. Ctrl+Super+Esc returns to the desktop.',
                'Ενεργοποιήστε αυτό το extension πριν την είσοδο. Το Ctrl+Super+Esc επιστρέφει στην επιφάνεια εργασίας.')});
        actions.add(status);

        const available = new Adw.PreferencesGroup({title: text('Supported home applications', 'Υποστηριζόμενες αρχικές εφαρμογές'),
            description: text('Applications are detected from their installed desktop launchers.', 'Οι εφαρμογές εντοπίζονται από τις εγκατεστημένες συντομεύσεις τους.')});
        page.add(available);
        for (const app of HOME_APPS.filter(item => item.id !== 'none')) {
            const row = new Adw.ActionRow({title: names[app.id], subtitle_lines: 0});
            available.add(row); entries.set(app.id, row);
        }
        const refreshRow = new Adw.ActionRow({title: text('Refresh applications', 'Ανανέωση εφαρμογών')});
        const refresh = new Gtk.Button({icon_name: 'view-refresh-symbolic', valign: Gtk.Align.CENTER,
            tooltip_text: text('Refresh installed applications', 'Ανανέωση εγκατεστημένων εφαρμογών')});
        refreshRow.add_suffix(refresh); refreshRow.activatable_widget = refresh; available.add(refreshRow);

        const updateSelection = () => {
            if (closing) return;
            const id = normalizeHomeApp(settings.get_string('home-app'));
            refreshing = true;
            homeRow.selected = HOME_APPS.findIndex(app => app.id === id);
            refreshing = false;
            details.title = names[id];
            const found = homeLaunchSpec(id, installed);
            details.subtitle = descriptions[id] + (id !== 'none' && !found
                ? text(' Install this application to use it as your gaming home.', ' Εγκαταστήστε την εφαρμογή για να τη χρησιμοποιήσετε ως αρχική.') : '');
            launch.sensitive = !busy && Boolean(found);
            homeRow.sensitive = !busy;
            startup.sensitive = id !== 'none';
        };
        const refreshApplications = () => {
            if (closing) return;
            installed = [];
            for (const app of HOME_APPS) {
                for (const desktopId of app.desktopIds) {
                    try { if (GioUnix.DesktopAppInfo.new(desktopId)) installed.push(desktopId); }
                    catch { /* Invalid or missing launchers stay unavailable. */ }
                }
            }
            const labels = HOME_APPS.map(app => app.id === 'none' || homeLaunchSpec(app.id, installed) ? names[app.id]
                : `${names[app.id]} — ${text('not installed', 'δεν έχει εγκατασταθεί')}`);
            refreshing = true; model.splice(0, model.get_n_items(), labels); refreshing = false;
            for (const app of HOME_APPS.filter(item => item.id !== 'none')) {
                const found = homeLaunchSpec(app.id, installed);
                entries.get(app.id).subtitle = found
                    ? text('Launcher installed', 'Η συντόμευση είναι εγκατεστημένη') + (app.id === 'original-xbox'
                        ? text(' · Experimental runtime required', ' · Απαιτείται πειραματικό runtime') : '')
                    : text('Not installed', 'Δεν έχει εγκατασταθεί');
            }
            updateSelection(); refreshStatus();
        };
        const request = method => {
            if (busy || closing) return;
            if (method === 'LaunchHome' && !homeLaunchSpec(settings.get_string('home-app'), installed)) return;
            busy = true; updateSelection(); leave.sensitive = false;
            status.subtitle = method === 'LaunchHome'
                ? text('Starting the selected gaming home…', 'Εκκίνηση της επιλεγμένης αρχικής εφαρμογής…')
                : text('Returning to the desktop…', 'Επιστροφή στην επιφάνεια εργασίας…');
            Gio.DBus.session.call(BUS, HOME_OBJECT, HOME_INTERFACE, method, null, null,
                Gio.DBusCallFlags.NONE, 15000, cancellable, (connection, result) => {
                    try {
                        connection.call_finish(result);
                        if (!closing) status.subtitle = method === 'LaunchHome'
                            ? text('The gaming home launch was requested. The original Xbox runtime can take longer to start.',
                                'Ζητήθηκε εκκίνηση της αρχικής εφαρμογής. Το runtime του αυθεντικού Xbox μπορεί να χρειαστεί περισσότερο χρόνο.')
                            : text('The desktop restoration was requested.', 'Ζητήθηκε επαναφορά της επιφάνειας εργασίας.');
                    } catch {
                        if (!closing) status.subtitle = method === 'LaunchHome'
                            ? text('The gaming home could not be started. Enable the extension and check that the selected application supports its gaming mode.',
                                'Δεν ήταν δυνατή η εκκίνηση. Ενεργοποιήστε το extension και ελέγξτε ότι η εφαρμογή υποστηρίζει την αντίστοιχη λειτουργία gaming.')
                            : text('The desktop could not be restored. Use Ctrl+Super+Esc if gaming mode is active.',
                                'Δεν ήταν δυνατή η επαναφορά. Χρησιμοποιήστε Ctrl+Super+Esc αν η λειτουργία gaming είναι ενεργή.');
                    } finally {
                        busy = false;
                        if (!closing) { leave.sensitive = true; updateSelection(); refreshStatus(); }
                    }
                });
        };
        homeRow.connect('notify::selected', () => {
            if (!refreshing && !closing && HOME_APPS[homeRow.selected])
                settings.set_string('home-app', HOME_APPS[homeRow.selected].id);
        });
        launch.connect('clicked', () => request('LaunchHome'));
        leave.connect('clicked', () => request('LeaveMode'));
        refresh.connect('clicked', refreshApplications);
        const changed = settings.connect('changed::home-app', updateSelection);
        const performanceChanged = settings.connect('changed::use-feral-gamemode', refreshStatus);
        const appMonitor = Gio.AppInfoMonitor.get();
        const appChanged = appMonitor.connect('changed', refreshApplications);
        window.connect('close-request', () => {
            closing = true; cancellable.cancel();
            settings.disconnect(changed); settings.disconnect(performanceChanged); appMonitor.disconnect(appChanged);
            return false;
        });
        refreshApplications(); window.add(page);
    }
}
