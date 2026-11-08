// Real GTK widgets with isolated memory settings. Never present or launch apps.
import Gtk from 'gi://Gtk?version=4.0';
import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Preferences from './prefs.js';

Gtk.init(); Adw.init();
let checks = 0, performanceState = 'active';
const calls = [];
globalThis.testDbusCall = (...args) => {
    const method = args[3]; calls.push(method);
    const result = method === 'GetState'
        ? new GLib.Variant('(s)', [JSON.stringify({selected: 'steam', active: true, loading: false, performance: {state: performanceState}})])
        : new GLib.Variant('()', []);
    args.at(-1)({call_finish: () => result}, null);
};
function check(condition, label) { checks++; if (!condition) throw Error(label); }
function children(widget) {
    const out = [widget];
    for (let child = widget.get_first_child?.(); child; child = child.get_next_sibling()) out.push(...children(child));
    return out;
}
const window = new Adw.PreferencesWindow();
new Preferences().fillPreferencesWindow(window);
let widgets = children(window);
const combo = widgets.find(widget => widget instanceof Adw.ComboRow);
const startup = widgets.find(widget => widget instanceof Adw.SwitchRow && widget.title.includes('sign-in'));
const performance = widgets.find(widget => widget instanceof Adw.SwitchRow && widget.title.includes('Feral'));
const performanceStatus = widgets.find(widget => widget instanceof Adw.ActionRow && widget.title === 'GameMode status');
const settings = new Gio.Settings({schema_id: 'org.gnome.shell.extensions.linux-gaming-mode'});
check(Boolean(combo), 'home selector exists'); check(Boolean(startup), 'startup switch exists');
check(Boolean(performance) && !performance.active, 'GameMode is optional and disabled by default');
check(combo.model.get_n_items() === 4, 'four supported choices');
check(combo.selected === 0, 'none is the default'); check(startup.active, 'startup defaults enabled');
check(!startup.sensitive, 'startup requires a gaming home');
check(performanceStatus.subtitle.startsWith('Active'), 'performance status follows the acknowledged state');
combo.selected = 1;
check(settings.get_string('home-app') === 'steam', 'selection persists'); check(startup.sensitive, 'home selection permits startup');
widgets = children(window);
const enter = widgets.find(widget => widget instanceof Gtk.Button && widget.label === 'Enter now');
check(enter.sensitive, 'installed Steam can launch'); enter.emit('clicked');
check(calls.includes('LaunchHome'), 'launch uses Home1');
combo.selected = 3;
check(settings.get_string('home-app') === 'original-xbox', 'original selection persists');
check(enter.sensitive, 'original installed launcher selectable');
const desktop = widgets.find(widget => widget instanceof Gtk.Button && widget.label === 'Desktop'); desktop.emit('clicked');
check(calls.includes('LeaveMode'), 'desktop restoration uses Home1');
performanceState = 'unavailable'; performance.active = true;
check(settings.get_boolean('use-feral-gamemode'), 'GameMode preference persists');
check(performanceStatus.subtitle.startsWith('Unavailable'), 'the preference does not infer active GameMode');
settings.set_string('home-app', 'none');
while (GLib.MainContext.default().pending()) GLib.MainContext.default().iteration(false);
check(combo.selected === 0 && !enter.sensitive, 'external settings update cannot launch an empty home');
check(!window.visible, 'test never presents a window');
check(GLib.getenv('GDK_BACKEND') === 'broadway' && !GLib.getenv('DISPLAY') && !GLib.getenv('WAYLAND_DISPLAY'), 'no host display');
check(GLib.getenv('GSETTINGS_BACKEND') === 'memory', 'no persistent settings writes');
window.emit('close-request'); window.destroy();
print(JSON.stringify({checks, calls, hostBusUsed: false, hostDisplayUsed: false, applicationLaunched: false}));
