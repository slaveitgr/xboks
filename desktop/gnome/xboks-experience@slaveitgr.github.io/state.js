// SPDX-License-Identifier: MIT
// GI-independent lease and restoration logic, also exercised in Node tests.
export class ExperienceLease {
    constructor(apply, restore, changed = () => {}) {
        this.owner = null;
        this._apply = apply;
        this._restore = restore;
        this._changed = changed;
    }

    get active() { return this.owner !== null; }
    state(sender) { return {active: this.active, owned: this.active && this.owner === sender}; }

    enter(sender, authorized) {
        if (this.active && this.owner !== sender)
            throw new Error('busy');
        if (this.owner === sender)
            return;
        if (!/^:\d+\.\d+$/.test(sender ?? '') || !authorized)
            throw new Error('not-authorized');
        this.owner = sender;
        try {
            this._apply();
        } catch (error) {
            this.owner = null;
            this._restore();
            throw error;
        }
        this._changed(true);
    }

    leave(sender) {
        if (!this.active)
            return;
        if (this.owner !== sender)
            throw new Error('not-authorized');
        this.forceLeave();
    }

    ownerVanished(sender) {
        if (this.owner === sender)
            this.forceLeave();
    }

    forceLeave() {
        if (!this.active)
            return;
        this.owner = null;
        try {
            this._restore();
        } finally {
            this._changed(false);
        }
    }
}

export class ReversibleChanges {
    constructor() {
        this._undo = [];
        this._actors = new Set();
    }

    add(undo) { this._undo.push(undo); }

    property(object, name, value) {
        const original = object[name];
        object[name] = value;
        this.add(() => {
            if (object[name] === value)
                object[name] = original;
        });
    }

    method(object, name, replacement) {
        const original = object[name], own = Object.hasOwn(object, name);
        object[name] = replacement;
        this.add(() => {
            // Do not clobber a later extension's override.
            if (object[name] !== replacement)
                return;
            if (own)
                object[name] = original;
            else
                delete object[name];
        });
    }

    hideActor(actor) {
        if (!actor || this._actors.has(actor))
            return;
        this._actors.add(actor);
        const visible = actor.visible;
        let alive = true;
        const destroy = actor.connect('destroy', () => { alive = false; });
        const changed = actor.connect('notify::visible', () => {
            if (actor.visible)
                actor.hide();
        });
        this.add(() => {
            if (!alive)
                return;
            actor.disconnect(changed);
            actor.disconnect(destroy);
            actor.visible = visible;
        });
        actor.hide();
    }

    restore() {
        const errors = [];
        for (const undo of this._undo.splice(0).reverse()) {
            try { undo(); } catch (error) { errors.push(error); }
        }
        this._actors.clear();
        return errors;
    }
}

export function authorizedApplication({senderPid, parentPid, focusedPid, applicationId, wmClass, userSession}) {
    if (!userSession || !Number.isInteger(senderPid) || senderPid < 1 || !Number.isInteger(focusedPid) || focusedPid < 1)
        return false;
    const identity = String(applicationId ?? '').toLowerCase();
    const windowClass = String(wmClass ?? '').toLowerCase();
    const xboks = ['xboks.desktop', 'gr.slave.xboks.desktop', 'gr.slave.xboks'].includes(identity) || windowClass === 'xboks';
    return xboks && (senderPid === focusedPid || parentPid === focusedPid);
}
