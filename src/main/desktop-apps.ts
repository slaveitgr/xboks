import {execFile} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';
import type {DesktopAppEntry, DesktopAppsResult} from '../shared/types.js';
import {externalLauncherEnvironment} from './launcher-environment.js';

export const DESKTOP_APPS_MAX_BYTES = 2 * 1024 * 1024;
export function validDesktopAppId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 255 && /^[A-Za-z0-9_][A-Za-z0-9_.@+-]*\.desktop$/.test(value);
}
const record = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const validText = (value: unknown, limit: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= limit && !/[\u0000-\u001f\u007f]/.test(value);

export function parseDesktopApps(value: unknown): DesktopAppsResult {
  const data = record(value);
  if (!data || data.available !== true || !Array.isArray(data.apps) || data.apps.length > 512) throw Error('Invalid desktop applications response.');
  const seen = new Set<string>(), apps: DesktopAppEntry[] = [];
  for (const raw of data.apps) {
    const entry = record(raw);
    if (!entry || !validDesktopAppId(entry.id) || !validText(entry.name, 256) || seen.has(entry.id)) throw Error('Invalid desktop application metadata.');
    seen.add(entry.id);
    const app: DesktopAppEntry = {id: entry.id, name: entry.name};
    if (entry.description !== undefined) {
      if (!validText(entry.description, 512)) throw Error('Invalid desktop application description.');
      app.description = entry.description;
    }
    if (entry.iconDataUrl !== undefined) {
      if (typeof entry.iconDataUrl !== 'string' || entry.iconDataUrl.length > 24_000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(entry.iconDataUrl)) throw Error('Invalid desktop application icon.');
      const bytes = Buffer.from(entry.iconDataUrl.slice('data:image/png;base64,'.length), 'base64');
      if (bytes.length < 24 || bytes.length > 16_384 || !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ||
        !bytes.readUInt32BE(16) || !bytes.readUInt32BE(20) || bytes.readUInt32BE(16) > 256 || bytes.readUInt32BE(20) > 256) throw Error('Invalid desktop application icon.');
      app.iconDataUrl = entry.iconDataUrl;
    }
    apps.push(app);
  }
  return {available: true, apps};
}

type Runner = (command: 'list' | 'launch', id?: string) => Promise<string>;
export class DesktopApps {
  constructor(private readonly options: {helper: string; platform?: NodeJS.Platform; environment?: NodeJS.ProcessEnv; run?: Runner}) {}
  private async run(command: 'list' | 'launch', id?: string): Promise<unknown> {
    if ((this.options.platform ?? process.platform) !== 'linux') throw Error('Desktop applications require Linux.');
    if (!path.isAbsolute(this.options.helper) || !this.options.run && !existsSync(this.options.helper)) throw Error('Desktop applications helper is unavailable.');
    const stdout = this.options.run ? await this.options.run(command, id) : await new Promise<string>((resolve, reject) => {
      execFile('gjs', ['-m', this.options.helper, command, ...(id ? [id] : [])], {
        env: externalLauncherEnvironment(this.options.environment ?? process.env), encoding: 'utf8', timeout: 8000,
        maxBuffer: DESKTOP_APPS_MAX_BYTES, windowsHide: true,
      }, (error, output) => error ? reject(Error('Desktop applications helper could not complete.')) : resolve(output));
    });
    if (Buffer.byteLength(stdout, 'utf8') > DESKTOP_APPS_MAX_BYTES) throw Error('Desktop applications response is too large.');
    return JSON.parse(stdout);
  }
  async list(): Promise<DesktopAppsResult> {
    try { return parseDesktopApps(await this.run('list')); }
    catch { return {available: false, apps: [], reason: 'Installed Linux applications could not be read. Check that GJS and the desktop session are available.'}; }
  }
  async launch(id: unknown, authorize: () => boolean = () => true): Promise<void> {
    if (!validDesktopAppId(id)) throw Error('Invalid desktop application ID.');
    if (!authorize()) throw Error('Open this application from the focused XBOKS window.');
    let result: Record<string, unknown> | undefined;
    try { result = record(await this.run('launch', id)); }
    catch { throw Error('The desktop application could not be started. Check the desktop session and GJS installation.'); }
    if (result?.ok !== true) throw Error(result?.error === 'not-available' ? 'This desktop application is no longer available.' : 'The desktop application could not be started.');
  }
}
