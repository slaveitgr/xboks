import { existsSync, lstatSync, mkdirSync, mkdtempSync, rmdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let active: { file: string; original: string | undefined } | undefined;
const xml = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!);

/** Restore the caller's font configuration for non-Electron subprocesses. */
export function externalFontEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const environment = { ...source };
  if (active && environment.FONTCONFIG_FILE === active.file) {
    if (active.original === undefined) delete environment.FONTCONFIG_FILE;
    else environment.FONTCONFIG_FILE = active.original;
  }
  return environment;
}

/** Run in the Node-only bootstrap, before Chromium's native font initialization. */
export function configureLauncherFonts(fontDirectory: string, cacheDirectory: string,
  environment: NodeJS.ProcessEnv = process.env, temporaryRoot = os.tmpdir()): { dispose(): void } {
  if (environment.FONTCONFIG_SYSROOT) throw Error('A custom FONTCONFIG_SYSROOT is active; leaving its font configuration unchanged.');
  if (!existsSync(path.join(fontDirectory, 'DejaVuSans.ttf'))) throw Error('The bundled fallback font is missing.');
  const original = environment.FONTCONFIG_FILE;
  const requested = original || '/etc/fonts/fonts.conf';
  const host = path.isAbsolute(requested) ? requested :
    (environment.FONTCONFIG_PATH || '/etc/fonts').split(path.delimiter)
      .map(directory => path.resolve(directory, requested)).find(file => existsSync(file)) ?? requested;
  mkdirSync(cacheDirectory, { recursive: true, mode: 0o700 });
  const directory = mkdtempSync(path.join(temporaryRoot, 'nexus-fonts-'));
  const file = path.join(directory, 'fonts.conf');
  try {
    // Keep the host's fonts, aliases and preferences. The private cache comes
    // first; no system/user font installation or cache reset is needed.
    writeFileSync(file, `<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">\n<fontconfig>\n  <cachedir>${xml(cacheDirectory)}</cachedir>\n  <include ignore_missing="yes">${xml(host)}</include>\n  <dir>${xml(fontDirectory)}</dir>\n</fontconfig>\n`, { flag: 'wx', mode: 0o600 });
    active = { file, original };
    environment.FONTCONFIG_FILE = file;
  } catch (error) { rmSync(directory, { recursive: true, force: true }); throw error; }
  return { dispose() {
    if (environment.FONTCONFIG_FILE === file) {
      if (original === undefined) delete environment.FONTCONFIG_FILE;
      else environment.FONTCONFIG_FILE = original;
    }
    if (active?.file === file) active = undefined;
    rmSync(directory, { recursive: true, force: true });
  } };
}

/** Adopt only the private configuration generated before Electron started. */
export function adoptLauncherFonts(environment: NodeJS.ProcessEnv = process.env): { dispose(): void } | undefined {
  const file = environment.XODUS_NEXUS_FONTCONFIG;
  if (!file) return undefined;
  const original = environment.XODUS_NEXUS_FONTCONFIG_ORIGINAL_SET === 'x' ? environment.XODUS_NEXUS_FONTCONFIG_ORIGINAL : undefined;
  delete environment.XODUS_NEXUS_FONTCONFIG;
  delete environment.XODUS_NEXUS_FONTCONFIG_ORIGINAL;
  delete environment.XODUS_NEXUS_FONTCONFIG_ORIGINAL_SET;
  if (!path.isAbsolute(file) || file !== environment.FONTCONFIG_FILE || path.basename(file) !== 'fonts.conf'
    || !path.basename(path.dirname(file)).startsWith('nexus-fonts-')) throw Error('Invalid launcher font bootstrap.');
  const directory = path.dirname(file);
  const parent = lstatSync(directory), config = lstatSync(file);
  if (!parent.isDirectory() || !config.isFile() || parent.uid !== process.getuid?.() || config.uid !== parent.uid
    || (parent.mode & 0o077) || (config.mode & 0o077)) throw Error('Unsafe launcher font bootstrap.');
  active = { file, original };
  return { dispose() {
    if (environment.FONTCONFIG_FILE === file) {
      if (original === undefined) delete environment.FONTCONFIG_FILE;
      else environment.FONTCONFIG_FILE = original;
    }
    if (active?.file === file) active = undefined;
    // Never recursively delete a directory supplied through the environment.
    try { unlinkSync(file); rmdirSync(directory); } catch { /* May already be gone, or contain unrelated files. */ }
  } };
}
