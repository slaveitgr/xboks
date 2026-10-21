// Read-only typelib inspection: no actors, grabs, Shell calls or bus connection.
imports.gi.versions.Clutter = '51';
imports.gi.versions.Shell = '51';
imports.gi.versions.St = '51';
imports.gi.versions.Meta = '51';
const {Clutter, Shell, St, Meta, GObject} = imports.gi;
const checks = {
    keyController: typeof Clutter.KeyController === 'function',
    keyPress: GObject.signal_lookup('key-press', Clutter.KeyController.$gtype) > 0,
    modifierChange: GObject.signal_lookup('modifier-change', Clutter.KeyController.$gtype) > 0,
    translatedBackwardTab: typeof Clutter.KEY_ISO_Left_Tab === 'number',
    keyTuple: typeof Clutter.KeyController.prototype.get_key === 'function',
    modifierTuple: typeof Clutter.KeyController.prototype.get_state === 'function',
    actorAction: typeof Clutter.Actor.prototype.add_action === 'function',
    revokedGrab: typeof Clutter.Grab.prototype.is_revoked === 'function',
    revokedProperty: Boolean(Clutter.Grab.find_property('revoked')),
    modifierMasks: ['SHIFT_MASK', 'CONTROL_MASK', 'SUPER_MASK', 'MOD1_MASK']
        .every(key => typeof Clutter.ModifierType[key] === 'number'),
    liveClone: typeof Clutter.Clone === 'function',
    fixedLayout: typeof Clutter.FixedLayout === 'function',
    shellModalMode: typeof Shell.ActionMode.ALL === 'number',
    appIcon: typeof Shell.App.prototype.create_icon_texture === 'function',
    nativeWidgets: typeof St.Widget === 'function' && typeof St.Button === 'function',
    desktopColorScheme: Boolean(St.Settings.find_property('color-scheme')) && typeof St.Settings.get === 'function',
    desktopColorSchemeValues: St.SystemColorScheme.DEFAULT === 0 && St.SystemColorScheme.PREFER_DARK === 1 && St.SystemColorScheme.PREFER_LIGHT === 2,
    nativeStyleClasses: ['add_style_class_name', 'remove_style_class_name'].every(name => typeof St.Widget.prototype[name] === 'function'),
    nativeRadialGradient: typeof St.GradientType.RADIAL === 'number',
    nativeWindowState: ['is_fullscreen', 'make_fullscreen', 'unmake_fullscreen', 'get_maximize_flags',
        'set_maximize_flags', 'set_unmaximize_flags', 'can_maximize', 'maximize', 'minimize', 'unminimize', 'raise']
        .every(name => typeof Meta.Window.prototype[name] === 'function'),
    nativeWindowClassification: ['get_window_type', 'is_attached_dialog', 'get_transient_for', 'is_override_redirect', 'get_title']
        .every(name => typeof Meta.Window.prototype[name] === 'function'),
    nativeWindowProperties: ['fullscreen', 'minimized', 'mapped', 'maximized-horizontally', 'maximized-vertically', 'title', 'window-type', 'skip-taskbar']
        .every(name => Boolean(Meta.Window.find_property(name))),
    nativeWindowUnmanaged: ['unmanaging', 'unmanaged'].every(name => GObject.signal_lookup(name, Meta.Window.$gtype) > 0),
    nativeWindowMap: GObject.signal_lookup('map', Shell.WM.$gtype) > 0,
    nativeTrackerChanged: GObject.signal_lookup('tracked-windows-changed', Shell.WindowTracker.$gtype) > 0,
    nativeMaximizeSignatures: Meta.Window.prototype.maximize.length === 0 &&
        Meta.Window.prototype.set_maximize_flags.length === 1 && Meta.Window.prototype.set_unmaximize_flags.length === 1,
    nativeMaximizeAxes: Meta.MaximizeFlags.BOTH === (Meta.MaximizeFlags.HORIZONTAL | Meta.MaximizeFlags.VERTICAL),
    nativeNormalWindow: typeof Meta.WindowType.NORMAL === 'number',
};
if (!Object.values(checks).every(Boolean)) throw Error('Unsupported Shell51 native API');
print(JSON.stringify({status: 'passed', shellMajor: 51, nativeSessionChanged: false, fullscreenCapabilityQuery: typeof Meta.Window.prototype.can_fullscreen === 'function', checks}));
