// Read-only typelib inspection: no actors, grabs, Shell calls or bus connection.
imports.gi.versions.Clutter = '51';
imports.gi.versions.Shell = '51';
imports.gi.versions.St = '51';
const {Clutter, Shell, St, GObject} = imports.gi;
const checks = {
    keyController: typeof Clutter.KeyController === 'function',
    keyPress: GObject.signal_lookup('key-press', Clutter.KeyController.$gtype) > 0,
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
};
if (!Object.values(checks).every(Boolean)) throw Error('Unsupported Shell51 native API');
print(JSON.stringify({status: 'passed', shellMajor: 51, nativeSessionChanged: false, checks}));
