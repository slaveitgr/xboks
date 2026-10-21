// SPDX-License-Identifier: MIT
import Gio from 'gi://Gio';
import St from 'gi://St';

export function switcherColorVariant(desktopPreference, systemPreference) {
    // Shell51's own default variant can be dark while the desktop preference
    // is default/light. Follow the user's desktop choice, not Shell chrome or
    // a guessed day/night hour. St is a fallback if the schema is unavailable.
    if (desktopPreference === 'prefer-dark') return 'dark';
    if (desktopPreference === 'prefer-light' || desktopPreference === 'default') return 'light';
    return systemPreference === St.SystemColorScheme.PREFER_DARK ? 'dark' : 'light';
}

export class SwitcherTheme {
    constructor(actor) {
        this._actor = actor;
        this._signals = [];
        this._desktop = null;
        this._system = null;
        try {
            const schema = Gio.SettingsSchemaSource.get_default()?.lookup('org.gnome.desktop.interface', true);
            if (schema?.has_key('color-scheme')) {
                this._desktop = new Gio.Settings({settings_schema: schema});
                this._watch(this._desktop, 'changed::color-scheme');
            }
        } catch { /* A missing desktop schema still permits the native fallback. */ }
        try {
            this._system = St.Settings.get();
            this._watch(this._system, 'notify::color-scheme');
        } catch { /* Default to the light desktop surface if both are unavailable. */ }
        try { this._update(); } catch (error) { this.destroy(); throw error; }
    }

    _watch(settings, signal) {
        const id = settings.connect(signal, () => this._update());
        this._signals.push([settings, id]);
    }

    _update() {
        if (!this._actor) return;
        let preference;
        try { preference = this._desktop?.get_string('color-scheme'); } catch { /* Use St. */ }
        const variant = switcherColorVariant(preference, this._system?.color_scheme);
        this._actor.remove_style_class_name(`xboks-theme-${variant === 'dark' ? 'light' : 'dark'}`);
        this._actor.add_style_class_name(`xboks-theme-${variant}`);
    }

    destroy() {
        this._actor = null;
        for (const [settings, id] of this._signals.splice(0)) {
            try { settings.disconnect(id); } catch { /* Settings may already be disposed. */ }
        }
        this._desktop = null;
        this._system = null;
    }
}
