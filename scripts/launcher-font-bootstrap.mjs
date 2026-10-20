import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { configureLauncherFonts } from './launcher-fonts.mjs';

// Electron's Node-only mode does not initialize Chromium/GTK or open a window.
const resources = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cache = process.env.XDG_CACHE_HOME && path.isAbsolute(process.env.XDG_CACHE_HOME)
  ? process.env.XDG_CACHE_HOME : path.join(os.homedir(), '.cache');
try {
  configureLauncherFonts(path.join(resources, 'fonts'), path.join(cache, 'xodus-nexus', 'fontconfig'));
  process.stdout.write(process.env.FONTCONFIG_FILE);
} catch (error) { console.error('Launcher fallback font unavailable:', error.message); }
