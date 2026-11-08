// SPDX-License-Identifier: MIT

/** Supported gaming homes. Desktop IDs are exact, not executable-name guesses. */
export const HOME_APPS = Object.freeze([
    Object.freeze({id: 'none', name: 'None', description: 'Use the ordinary desktop.', desktopIds: Object.freeze([])}),
    Object.freeze({id: 'steam', name: 'Steam Big Picture', description: 'Open the Steam controller interface.',
        desktopIds: Object.freeze(['steam.desktop', 'com.valvesoftware.Steam.desktop'])}),
    Object.freeze({id: 'xboks', name: 'XBOKS Fullscreen', description: 'Open XBOKS in its integrated fullscreen experience.',
        desktopIds: Object.freeze(['xboks.desktop', 'gr.slave.xboks.desktop'])}),
    Object.freeze({id: 'original-xbox', name: 'Original Xbox (Xbox mode)',
        description: 'Use the original Xbox client with a prepared experimental Wine-UWP runtime.',
        desktopIds: Object.freeze(['original-xbox-ce-wineuwp.desktop'])}),
]);

export function normalizeHomeApp(value) {
    return HOME_APPS.some(app => app.id === value) ? value : 'none';
}

/** Return only a fixed adapter request for a supported, installed desktop app. */
export function homeLaunchSpec(value, installedDesktopIds) {
    const id = normalizeHomeApp(value);
    const app = HOME_APPS.find(candidate => candidate.id === id);
    if (id === 'none') return null;
    const installed = new Set(Array.isArray(installedDesktopIds) || installedDesktopIds instanceof Set ? installedDesktopIds : []);
    const desktopId = app.desktopIds.find(candidate => installed.has(candidate));
    if (!desktopId) return null;
    if (id === 'steam') return {id, desktopId, uris: ['steam://open/bigpicture']};
    return {id, desktopId, args: id === 'xboks' ? ['--fullscreen-experience'] : []};
}
