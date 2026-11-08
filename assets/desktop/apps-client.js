// SPDX-License-Identifier: MIT
// One-shot desktop app discovery/activation. Gio owns desktop-entry parsing.
import Gio from 'gi://Gio';
import GioUnix from 'gi://GioUnix';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';

const MAX_APPS = 512, MAX_JSON = 2 * 1024 * 1024, MAX_ICON = 16 * 1024, ICON_BUDGET = 512 * 1024;
const encoder = new TextEncoder();
const validId = id => typeof id === 'string' && id.length <= 255 && /^[A-Za-z0-9_][A-Za-z0-9_.@+-]*\.desktop$/.test(id);
const text = (value, length) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, length) : '';
function visible(info) {
    // Older GJS may wrap GDesktopAppInfo through Gio instead of GioUnix.
    // Both wrappers share the native GType, but not the JS constructor.
    return info instanceof GObject.Object && GObject.type_is_a(info.constructor.$gtype, GioUnix.DesktopAppInfo.$gtype) &&
        validId(info.get_id()) && info.should_show() &&
        !info.get_boolean('Hidden') && !info.get_boolean('NoDisplay');
}

async function graphics() {
    try {
        const {default: Gtk} = await import('gi://Gtk?version=4.0');
        const {default: Gdk} = await import('gi://Gdk?version=4.0');
        if (!Gtk.init_check()) return null;
        const display = Gdk.Display.get_default();
        return display ? {theme: Gtk.IconTheme.get_for_display(display), context: display.get_app_launch_context()} : null;
    } catch { return null; }
}

function iconData(info, theme) {
    if (!theme) return undefined;
    let stream;
    try {
        const icon = info.get_icon();
        if (!icon) return undefined;
        const paintable = theme.lookup_by_gicon(icon, 48, 1, 0, 0), file = paintable?.get_file();
        if (!file || !file.get_path()?.toLowerCase().endsWith('.png')) return undefined;
        const path = file.get_path(), canonical = GLib.canonicalize_filename(path, null);
        const roots = ['/usr/share/icons', '/usr/local/share/icons', '/usr/share/pixmaps', '/var/lib/flatpak/exports/share/icons',
            GLib.get_user_data_dir() + '/icons', GLib.get_home_dir() + '/.icons', GLib.get_home_dir() + '/.local/share/flatpak/exports/share/icons'];
        if (canonical !== path || !roots.some(root => path.startsWith(root + '/'))) return undefined;
        // A themed/FileIcon must remain in an icon directory, including its
        // ancestors. Never follow a desktop entry's icon into another file.
        const components = path.split('/').filter(Boolean); let directory = '';
        for (const component of components.slice(0, -1)) {
            directory += '/' + component;
            if (Gio.File.new_for_path(directory).query_info('standard::type', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null).get_file_type() !== Gio.FileType.DIRECTORY) return undefined;
        }
        const metadata = file.query_info('standard::type,standard::size', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
        if (metadata.get_file_type() !== Gio.FileType.REGULAR || metadata.get_size() > MAX_ICON) return undefined;
        stream = file.read(null);
        const bytes = stream.read_bytes(MAX_ICON + 1, null).get_data();
        if (bytes.length < 24 || bytes.length > MAX_ICON || [137,80,78,71,13,10,26,10].some((value, index) => bytes[index] !== value)) return undefined;
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), width = view.getUint32(16), height = view.getUint32(20);
        if (!width || !height || width > 256 || height > 256) return undefined;
        return 'data:image/png;base64,' + GLib.base64_encode(bytes);
    } catch { return undefined; }
    finally { try { stream?.close(null); } catch { /* Best-effort read-only icon cleanup. */ } }
}

async function list() {
    const display = await graphics(), seen = new Set(), candidates = [];
    for (const info of Gio.AppInfo.get_all()) {
        if (!visible(info) || seen.has(info.get_id())) continue;
        seen.add(info.get_id());
        const name = text(info.get_display_name() || info.get_name(), 256);
        if (!name) continue;
        candidates.push({info, id: info.get_id(), name, description: text(info.get_description(), 512) || undefined});
    }
    candidates.sort((a, b) => a.name.localeCompare(b.name));
    const apps = []; let size = 128, iconBudget = ICON_BUDGET;
    for (const {info, ...entry} of candidates.slice(0, MAX_APPS)) {
        const icon = iconBudget > 0 ? iconData(info, display?.theme) : undefined;
        if (icon && icon.length <= iconBudget) { entry.iconDataUrl = icon; iconBudget -= icon.length; }
        const length = encoder.encode(JSON.stringify(entry)).length + 1;
        if (size + length > MAX_JSON - 1024) break;
        size += length; apps.push(entry);
    }
    return {available: true, apps};
}

async function launch(id) {
    if (!validId(id)) throw Error('invalid-id');
    // Resolve afresh rather than trusting metadata from an earlier list reply.
    const info = GioUnix.DesktopAppInfo.new(id);
    if (!info || !visible(info)) throw Error('not-available');
    const display = await graphics();
    if (!info.launch([], display?.context ?? new Gio.AppLaunchContext())) throw Error('launch-failed');
    return {ok: true};
}

try {
    let result;
    if (ARGV.length === 1 && ARGV[0] === 'list') result = await list();
    else if (ARGV.length === 2 && ARGV[0] === 'launch') result = await launch(ARGV[1]);
    else throw Error('invalid-command');
    const output = JSON.stringify(result);
    if (encoder.encode(output).length > MAX_JSON) throw Error('response-too-large');
    print(output);
} catch (error) {
    const codes = new Set(['invalid-id', 'not-available', 'launch-failed', 'invalid-command', 'response-too-large']);
    print(JSON.stringify({ok: false, error: codes.has(error.message) ? error.message : 'desktop-unavailable'}));
}
