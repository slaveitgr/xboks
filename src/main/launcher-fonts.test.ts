import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { adoptLauncherFonts, configureLauncherFonts, externalFontEnvironment } from './launcher-fonts.js';
import { spawnTracked } from './process.js';

const fonts = path.resolve('assets/fonts');
let root: string | undefined;
let installation: ReturnType<typeof configureLauncherFonts> | undefined;
afterEach(() => {
  installation?.dispose(); installation = undefined;
  if (root) rmSync(root, { recursive: true, force: true }); root = undefined;
});
function setup(environment: NodeJS.ProcessEnv = {}) {
  root = mkdtempSync(path.join(os.tmpdir(), 'nexus-font-test-'));
  installation = configureLauncherFonts(fonts, path.join(root, 'cache'), environment, root);
  return { environment, file: environment.FONTCONFIG_FILE! };
}

describe('launcher-only fallback fonts', () => {
  it('ships the pinned official font and complete license outside ASAR', () => {
    const metadata = JSON.parse(readFileSync(path.join(fonts, 'source.json'), 'utf8'));
    expect(createHash('sha256').update(readFileSync(path.join(fonts, metadata.file))).digest('hex')).toBe(metadata.sha256);
    expect(readFileSync(path.join(fonts, metadata.license), 'utf8')).toContain('Permission is hereby granted');
    const build = JSON.parse(readFileSync('package.json', 'utf8')).build;
    expect(build.extraResources).toContainEqual({ from: 'assets/fonts', to: 'fonts' });
    expect(build.files).toContain('!assets/fonts/**/*');
    expect(build.afterPack).toBe('scripts/launcher-fonts-after-pack.cjs');
  });
  it('adds a fallback without replacing host fonts and puts private cache first', () => {
    const { file } = setup();
    const config = readFileSync(file, 'utf8');
    expect(config).toContain('<include ignore_missing="yes">/etc/fonts/fonts.conf</include>');
    expect(config).toContain(`<dir>${fonts}</dir>`);
    expect(config.indexOf('<cachedir>')).toBeLessThan(config.indexOf('<include'));
    expect(config).not.toMatch(/<reset-dirs|<rejectfont|<alias/);
  });
  it('escapes XML paths and preserves an explicitly chosen configuration', () => {
    const original = '/custom/a&b<fonts>".conf';
    const { environment, file } = setup({ FONTCONFIG_FILE: original, FONTCONFIG_PATH: '/custom' });
    expect(readFileSync(file, 'utf8')).toContain('/custom/a&amp;b&lt;fonts&gt;&quot;.conf');
    expect(externalFontEnvironment(environment)).toEqual({ FONTCONFIG_FILE: original, FONTCONFIG_PATH: '/custom' });
    expect(environment.FONTCONFIG_FILE).toBe(file);
  });
  it('resolves relative custom configs using the original font search path', () => {
    root = mkdtempSync(path.join(os.tmpdir(), 'nexus-font-test-'));
    writeFileSync(path.join(root, 'custom.conf'), '<fontconfig/>');
    const environment = { FONTCONFIG_FILE: 'custom.conf', FONTCONFIG_PATH: root };
    installation = configureLauncherFonts(fonts, path.join(root, 'cache'), environment, root);
    expect(readFileSync(environment.FONTCONFIG_FILE, 'utf8')).toContain(`<include ignore_missing="yes">${root}/custom.conf</include>`);
    expect(externalFontEnvironment(environment).FONTCONFIG_FILE).toBe('custom.conf');
  });
  it('removes only the launcher override, preserving deliberate child overrides', () => {
    const { environment, file } = setup({ DISPLAY: ':1' });
    expect(externalFontEnvironment(environment)).toEqual({ DISPLAY: ':1' });
    expect(externalFontEnvironment({ ...environment, FONTCONFIG_FILE: '/game/fonts.conf' }).FONTCONFIG_FILE).toBe('/game/fonts.conf');
    expect(environment.FONTCONFIG_FILE).toBe(file);
  });
  it('does not pass the mounted launcher configuration to external processes', async () => {
    const { environment } = setup({ ...process.env, FONTCONFIG_FILE: '/original/fonts.conf' });
    const result = await spawnTracked(process.execPath, ['-e', 'process.stdout.write(process.env.FONTCONFIG_FILE)'], { env: environment }).result;
    expect(result.code).toBe(0);
    expect(result.output).toBe('/original/fonts.conf');
  });
  it('restores original environment and removes only its own temporary config', () => {
    const { environment, file } = setup();
    installation!.dispose(); installation = undefined;
    expect(environment).not.toHaveProperty('FONTCONFIG_FILE');
    expect(existsSync(file)).toBe(false);
    expect(existsSync(path.join(root!, 'cache'))).toBe(true);
  });
  it('leaves unsupported sysroot environments unchanged', () => {
    const environment = { FONTCONFIG_SYSROOT: '/custom', FONTCONFIG_FILE: '/custom/fonts.conf' };
    expect(() => configureLauncherFonts(fonts, '/unused', environment)).toThrow('FONTCONFIG_SYSROOT');
    expect(environment.FONTCONFIG_FILE).toBe('/custom/fonts.conf');
  });
  it('fails before touching the environment if the font is absent', () => {
    const environment = { FONTCONFIG_FILE: '/original/fonts.conf' };
    expect(() => configureLauncherFonts('/missing-font-directory', '/unused', environment)).toThrow('missing');
    expect(environment.FONTCONFIG_FILE).toBe('/original/fonts.conf');
  });
  it('adopts bootstrap environment and restores the original for children', () => {
    const { environment, file } = setup();
    environment.XODUS_NEXUS_FONTCONFIG = file;
    environment.XODUS_NEXUS_FONTCONFIG_ORIGINAL_SET = 'x';
    environment.XODUS_NEXUS_FONTCONFIG_ORIGINAL = '/host/fonts.conf';
    installation = adoptLauncherFonts(environment);
    expect(externalFontEnvironment(environment)).toEqual({ FONTCONFIG_FILE: '/host/fonts.conf' });
    installation!.dispose(); installation = undefined;
    expect(environment.FONTCONFIG_FILE).toBe('/host/fonts.conf');
    expect(existsSync(file)).toBe(false);
  });
  it('never recursively removes files beside an adopted configuration', () => {
    const { environment, file } = setup();
    const unrelated = path.join(path.dirname(file), 'unrelated');
    writeFileSync(unrelated, 'keep');
    installation = adoptLauncherFonts({ ...environment, XODUS_NEXUS_FONTCONFIG: file });
    installation!.dispose(); installation = undefined;
    expect(readFileSync(unrelated, 'utf8')).toBe('keep');
  });
  it('rejects unrelated and symlinked bootstrap locations', () => {
    expect(() => adoptLauncherFonts({ FONTCONFIG_FILE: '/tmp/fonts.conf', XODUS_NEXUS_FONTCONFIG: '/tmp/fonts.conf' })).toThrow('Invalid');
    root = mkdtempSync(path.join(os.tmpdir(), 'nexus-font-test-'));
    const directory = path.join(root, 'nexus-fonts-unsafe');
    mkdirSync(directory, { mode: 0o755 });
    const file = path.join(directory, 'fonts.conf');
    writeFileSync(file, '<fontconfig/>');
    expect(() => adoptLauncherFonts({ FONTCONFIG_FILE: file, XODUS_NEXUS_FONTCONFIG: file })).toThrow('Unsafe');
  });
});
