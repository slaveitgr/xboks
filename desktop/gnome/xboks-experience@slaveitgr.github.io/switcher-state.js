// SPDX-License-Identifier: MIT
export const SWITCH_ACTIONS = Object.freeze(['toggle', 'open', 'next', 'previous', 'left', 'right', 'up', 'down', 'accept', 'cancel', 'desktop', 'xbox', 'close-window']);
export class SwitcherSelection {
    constructor() { this.entries = []; this.index = 0; this.area = 'windows'; this.mode = 'xbox'; }
    update(entries, focusedId) {
        const selected = this.entries[this.index]?.id ?? focusedId;
        const seen = new Set();
        this.entries = entries.filter(entry => typeof entry.id === 'string' && !seen.has(entry.id) && seen.add(entry.id)).slice(0, 32);
        const index = this.entries.findIndex(entry => entry.id === selected);
        this.index = index < 0 ? Math.min(this.index, Math.max(0, this.entries.length - 1)) : index;
    }
    select(index) { if (Number.isInteger(index) && index >= 0 && index < this.entries.length) { this.index = index; this.area = 'windows'; } }
    action(action) {
        if (!SWITCH_ACTIONS.includes(action)) throw Error('invalid-action');
        if (action === 'cancel') return 'cancel';
        if (action === 'desktop' || action === 'xbox') return action;
        if (action === 'down') this.area = 'modes';
        else if (action === 'up') this.area = 'windows';
        else if (['next', 'previous'].includes(action) || ['left', 'right'].includes(action) && this.area === 'windows') {
            const delta = ['next', 'right'].includes(action) ? 1 : -1;
            this.index = this.entries.length ? (this.index + delta + this.entries.length) % this.entries.length : 0;
            this.area = 'windows';
        } else if (action === 'left' || action === 'right') this.mode = action === 'left' ? 'xbox' : 'desktop';
        else if (action === 'accept') return this.area === 'modes' ? this.mode : this.entries.length ? 'activate' : undefined;
        else if (action === 'close-window') return this.area === 'windows' && this.entries.length ? 'close-window' : undefined;
        return undefined;
    }
}
export function boundedLabel(value, maximum = 256) {
    return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, maximum) : '';
}

// Match Shell51's shortcut semantics: Shift changes direction; releasing the
// primary shortcut modifier (Alt for Alt+Tab) commits the chosen window.
export function primaryModifier(mask) {
    if (!Number.isInteger(mask) || mask <= 0) return 0;
    let primary = 1;
    while (mask > 1) { mask >>>= 1; primary *= 2; }
    return primary;
}

// At 1920×1080 the reference's selected preview is 510px tall inside a
// 591px card. Its width follows the real window: 16:9 yields 927px, while
// a 795:510 window yields 815px. Footer controls overlay the live preview.
export function cardGeometry(monitorWidth, monitorHeight, aspect = 16 / 9, selected = true) {
    const scale = Math.max(0.35, Math.min(1.5, monitorWidth / 1920, monitorHeight / 1080));
    const height = (selected ? 591 : 343) * scale;
    const inset = (selected ? 10 : 6) * scale, header = (selected ? 71 : 37) * scale;
    const previewHeight = height - header - inset;
    const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
    const width = Math.min(monitorWidth - 64 * scale, previewHeight * safeAspect + 2 * inset);
    return {width, height, inset, header, scale, left: (monitorWidth - width) / 2, top: (monitorHeight - height) / 2};
}
