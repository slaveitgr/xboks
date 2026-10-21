// Real Gio/St settings on an isolated bus and in-memory GSettings backend.
// No Shell actors, display connection, live settings or host bus are used.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St?version=51';
import {SwitcherTheme, switcherColorVariant} from '../../../desktop/gnome/xboks-experience@slaveitgr.github.io/switcher-theme.js';

function check(condition, message) { if (!condition) throw Error(message); }
check(GLib.getenv('GSETTINGS_BACKEND') === 'memory', 'Isolated memory settings required');
check(!GLib.getenv('DISPLAY') && !GLib.getenv('WAYLAND_DISPLAY'), 'Display access is not needed');

const settings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
const original = settings.get_string('color-scheme');
const actor = {
    classes: new Set(), updates: 0,
    add_style_class_name(name) { this.classes.add(name); this.updates++; },
    remove_style_class_name(name) { this.classes.delete(name); },
};
const schemeValues = {}, variants = [];
let theme;
function update(preference, variant, nativeValue) {
    check(settings.set_string('color-scheme', preference), `Could not set private ${preference}`);
    Gio.Settings.sync();
    const context = GLib.MainContext.default();
    for (let i = 0; i < 100 && context.pending(); i++) context.iteration(false);
    check(actor.classes.size === 1 && actor.classes.has(`xboks-theme-${variant}`), `Wrong ${preference} theme`);
    schemeValues[preference] = St.Settings.get().color_scheme;
    check(schemeValues[preference] === nativeValue, `Unexpected native ${preference} enum`);
    variants.push(variant);
}
try {
    theme = new SwitcherTheme(actor);
    update('prefer-dark', 'dark', St.SystemColorScheme.PREFER_DARK);
    update('prefer-light', 'light', St.SystemColorScheme.PREFER_LIGHT);
    update('default', 'light', St.SystemColorScheme.DEFAULT);
    update('prefer-dark', 'dark', St.SystemColorScheme.PREFER_DARK);
    check(switcherColorVariant('default', St.SystemColorScheme.PREFER_DARK) === 'light', 'Desktop default must retain the day palette');
    check(switcherColorVariant(undefined, St.SystemColorScheme.PREFER_DARK) === 'dark', 'Native dark fallback failed');
    check(switcherColorVariant(undefined, St.SystemColorScheme.PREFER_LIGHT) === 'light', 'Native light fallback failed');
    const subscriptions = [...theme._signals];
    check(subscriptions.length === 2 && subscriptions.every(([source, id]) => GObject.signal_handler_is_connected(source, id)), 'Settings subscriptions missing');
    theme.destroy(); theme.destroy();
    check(subscriptions.every(([source, id]) => !GObject.signal_handler_is_connected(source, id)), 'Settings subscription leaked');
    const updates = actor.updates;
    settings.set_string('color-scheme', 'prefer-light'); Gio.Settings.sync();
    check(actor.updates === updates, 'Destroyed theme received settings changes');
    theme = new SwitcherTheme(actor);
    check(actor.classes.has('xboks-theme-light') && actor.classes.size === 1, 'Reopened theme missed the current preference');
    const stylesheet = Gio.File.new_for_path('desktop/gnome/xboks-experience@slaveitgr.github.io/stylesheet.css');
    const nativeTheme = new St.Theme();
    nativeTheme.load_stylesheet(stylesheet);
    nativeTheme.unload_stylesheet(stylesheet);
} finally {
    theme?.destroy();
    settings.set_string('color-scheme', original); Gio.Settings.sync();
}
check(settings.get_string('color-scheme') === original, 'Private settings restoration failed');
print(JSON.stringify({status: 'passed', backend: 'memory', nativeSessionChanged: false, restored: true, variants, schemeValues, nativeStylesheetParsed: true}));
