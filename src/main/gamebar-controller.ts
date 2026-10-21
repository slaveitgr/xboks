import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { externalLauncherEnvironment } from './launcher-environment.js';

export interface GameBarControllerState {
  status: 'starting' | 'listening' | 'unavailable' | 'error' | 'stopped';
  devices: number;
  reason?: string;
}
export type GameBarControllerSurface = 'none' | 'guide' | 'switcher';
export type GameBarControllerAction = 'up' | 'down' | 'left' | 'right' | 'accept' | 'back' | 'previous' | 'next' | 'close-window';
const inputActions: GameBarControllerAction[] = ['up', 'down', 'left', 'right', 'accept', 'back', 'previous', 'next', 'close-window'];

type ReadCommand = (command: string, args: readonly string[]) => Promise<string>;
const sessionId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(value);
const record = (value: unknown): Record<string, unknown> | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

/** No session guessing from screensaver=false alone: require an active, local,
 * same-user graphical logind session, plus GNOME's independent lock guard. */
export async function controllerSessionActive(options: { environment?: NodeJS.ProcessEnv; uid?: number;
  platform?: NodeJS.Platform; run?: ReadCommand } = {}): Promise<boolean> {
  if ((options.platform ?? process.platform) !== 'linux') return false;
  const environment = options.environment ?? process.env, uid = options.uid ?? process.getuid?.();
  if (!Number.isSafeInteger(uid) || (uid as number) < 1) return false;
  const run: ReadCommand = options.run ?? ((command, args) => new Promise((resolve, reject) => {
    execFile(command, [...args], { shell: false, encoding: 'utf8', timeout: 1500, maxBuffer: 16_384,
      env: externalLauncherEnvironment(environment) }, (error, stdout) => error ? reject(error) : resolve(stdout));
  }));
  try {
    const explicit = environment.XDG_SESSION_ID;
    let candidates: string[];
    if (explicit !== undefined) {
      if (!sessionId(explicit)) return false;
      candidates = [explicit];
    } else {
      const raw = await run('loginctl', ['list-sessions', '--json=short', '--no-pager']);
      if (Buffer.byteLength(raw) > 16_384) return false;
      const sessions: unknown = JSON.parse(raw);
      if (!Array.isArray(sessions) || sessions.length > 64) return false;
      candidates = sessions.flatMap(value => {
        const item = record(value);
        return item && item.uid === uid && item.class === 'user' && typeof item.seat === 'string' &&
          /^seat[\w.-]{0,60}$/.test(item.seat) && sessionId(item.session) ? [item.session] : [];
      });
      if (candidates.length === 0 || candidates.length > 4 || new Set(candidates).size !== candidates.length) return false;
    }
    let active = 0;
    for (const id of candidates) {
      const raw = await run('loginctl', ['show-session', id, '--no-pager', '--property=Active', '--property=LockedHint',
        '--property=Remote', '--property=Class', '--property=Type', '--property=User', '--property=Seat']);
      if (Buffer.byteLength(raw) > 4096) return false;
      const fields = new Map<string, string>();
      for (const line of raw.trim().split('\n')) {
        const index = line.indexOf('=');
        if (index <= 0 || fields.has(line.slice(0, index))) return false;
        fields.set(line.slice(0, index), line.slice(index + 1));
      }
      if (fields.get('Active') === 'yes' && fields.get('LockedHint') === 'no' && fields.get('Remote') === 'no' &&
          fields.get('Class') === 'user' && ['wayland', 'x11'].includes(fields.get('Type') ?? '') &&
          fields.get('User') === String(uid) && /^seat[\w.-]{0,60}$/.test(fields.get('Seat') ?? '')) active++;
    }
    if (active !== 1) return false;
    if (environment.XDG_CURRENT_DESKTOP?.split(':').some(value => value.toLowerCase() === 'gnome')) {
      const raw = await run('gdbus', ['call', '--session', '--dest', 'org.gnome.ScreenSaver', '--object-path',
        '/org/gnome/ScreenSaver', '--method', 'org.gnome.ScreenSaver.GetActive']);
      if (raw.trim() !== '(false,)') return false;
    }
    return true;
  } catch { return false; }
}

/** Global BTN_MODE plus explicitly scoped normalized UI navigation. No raw
 * renderer input, keyboard hooks, grabs, identities or permission/udev changes. */
export class GameBarController {
  private child?: ChildProcessWithoutNullStreams;
  private value: GameBarControllerState = { status: 'stopped', devices: 0 };
  private partial = '';
  private generation = 0;
  private blocked = false;
  private pending = false;
  private inputPending = false;
  private surface: GameBarControllerSurface = 'none';
  private surfaceEpoch = 0;
  private lastPress = -Infinity;
  private readyTimer?: ReturnType<typeof setTimeout>;
  constructor(private options: { helper: string; onGuide: () => void | Promise<void>; canActivate: () => boolean | Promise<boolean>;
    onInput?: (action: GameBarControllerAction, surface: Exclude<GameBarControllerSurface, 'none'>) => void | Promise<void>;
    changed?: (state: GameBarControllerState) => void; environment?: NodeJS.ProcessEnv; platform?: NodeJS.Platform;
    start?: () => ChildProcessWithoutNullStreams; now?: () => number; startupTimeoutMs?: number }) {}
  get current(): GameBarControllerState { return { ...this.value }; }
  private publish(value: GameBarControllerState): void { this.value = value; this.options.changed?.(this.current); }
  start(): void {
    if (this.child) return;
    if ((this.options.platform ?? process.platform) !== 'linux') { this.publish({ status: 'unavailable', devices: 0, reason: 'unsupported-platform' }); return; }
    if (!path.isAbsolute(this.options.helper) || !existsSync(this.options.helper)) { this.publish({ status: 'unavailable', devices: 0, reason: 'helper-missing' }); return; }
    this.generation++; this.partial = ''; this.lastPress = -Infinity;
    this.publish({ status: 'starting', devices: 0 });
    let child: ChildProcessWithoutNullStreams;
    try {
      child = this.options.start?.() ?? spawn('python3', [this.options.helper], {
        env: externalLauncherEnvironment(this.options.environment ?? process.env), stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch { this.publish({ status: 'error', devices: 0, reason: 'helper-failed' }); return; }
    this.child = child;
    const readyTimer = this.readyTimer = setTimeout(() => {
      if (this.child === child && this.value.status === 'starting') this.stop('error', 'helper-timeout');
    }, this.options.startupTimeoutMs ?? 5000);
    readyTimer.unref();
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (this.child !== child) return;
      this.partial += chunk;
      if (Buffer.byteLength(this.partial) > 8192) { this.stop('error', 'invalid-helper-message'); return; }
      let newline;
      while ((newline = this.partial.indexOf('\n')) >= 0) {
        const line = this.partial.slice(0, newline); this.partial = this.partial.slice(newline + 1);
        if (line && !this.receive(line)) { this.stop('error', 'invalid-helper-message'); return; }
      }
    });
    child.stderr.resume(); // Never log raw device data, identities or errors.
    child.stdin.on('error', () => { if (this.child === child) this.stop('error', 'helper-closed'); });
    child.once('error', () => { if (this.child === child) this.stop('error', 'helper-failed'); });
    child.once('close', () => { if (this.child === child) this.stop('error', 'helper-closed'); });
    this.command(this.blocked ? 'pause' : 'resume');
    if (this.surface !== 'none') this.writeSurface();
  }
  private receive(line: string): boolean {
    let message: Record<string, unknown> | undefined;
    try { message = record(JSON.parse(line)); } catch { return false; }
    if (!message || message.schema !== 1) return false;
    if (message.event === 'guide' && Object.keys(message).every(key => ['schema', 'event'].includes(key))) {
      void this.activate(); return true;
    }
    if (message.event === 'input') {
      if (Object.keys(message).some(key => !['schema', 'event', 'action', 'surface', 'epoch'].includes(key)) ||
          !inputActions.includes(message.action as GameBarControllerAction) || !['guide', 'switcher'].includes(String(message.surface)) ||
          !Number.isSafeInteger(message.epoch) || (message.epoch as number) < 0 ||
          message.action === 'close-window' && message.surface !== 'switcher') return false;
      if (message.surface === this.surface && message.epoch === this.surfaceEpoch) void this.activateInput(
        message.action as GameBarControllerAction, message.surface as Exclude<GameBarControllerSurface, 'none'>, message.epoch as number);
      return true;
    }
    if (message.event !== 'status' || Object.keys(message).some(key => !['schema', 'event', 'status', 'devices', 'reason'].includes(key)) ||
        !['listening', 'unavailable', 'error'].includes(String(message.status)) || !Number.isInteger(message.devices) ||
        (message.devices as number) < 0 || (message.devices as number) > 16 ||
        (message.status === 'listening') !== ((message.devices as number) > 0)) return false;
    const reasons = ['no-controller', 'permission-denied', 'session-blocked', 'unsupported-architecture', 'device-error', 'scan-unavailable'];
    if (message.reason !== undefined && !reasons.includes(String(message.reason))) return false;
    clearTimeout(this.readyTimer); this.readyTimer = undefined;
    if (!this.blocked) this.publish({ status: message.status as GameBarControllerState['status'], devices: message.devices as number,
      ...(typeof message.reason === 'string' ? { reason: message.reason } : {}) });
    return true;
  }
  private async activate(): Promise<void> {
    const now = (this.options.now ?? Date.now)();
    if (!this.child || this.blocked || this.pending || this.value.status !== 'listening' || this.value.devices < 1 || now - this.lastPress < 350) return;
    this.lastPress = now; this.pending = true;
    const generation = this.generation;
    try {
      if (await this.options.canActivate() && this.child && generation === this.generation && !this.blocked &&
          this.value.status === 'listening' && this.value.devices > 0) await this.options.onGuide();
    } catch { /* Uncertain session state never opens UI. No raw bus error logs. */ }
    finally { this.pending = false; }
  }
  private async activateInput(action: GameBarControllerAction, surface: Exclude<GameBarControllerSurface, 'none'>, epoch: number): Promise<void> {
    if (!this.options.onInput || !this.child || this.blocked || this.inputPending || this.value.status !== 'listening' ||
        this.value.devices < 1 || this.surface !== surface || this.surfaceEpoch !== epoch) return;
    this.inputPending = true;
    const generation = this.generation;
    try {
      if (await this.options.canActivate() && this.child && generation === this.generation && !this.blocked &&
          this.value.status === 'listening' && this.value.devices > 0 && this.surface === surface && this.surfaceEpoch === epoch)
        await this.options.onInput(action, surface);
    } catch { /* No input delivery without current session/surface ownership. */ }
    finally { this.inputPending = false; }
  }
  /** Main process only: set from acknowledged owned visibility, never a raw
   * renderer request. Epoch tags reject queued input from a previous surface. */
  setSurface(surface: GameBarControllerSurface): void {
    if (!['none', 'guide', 'switcher'].includes(surface) || this.blocked && surface !== 'none' || surface === this.surface) return;
    this.surface = surface; this.surfaceEpoch++; this.generation++;
    this.writeSurface();
  }
  private writeSurface(): void {
    try { this.child?.stdin.write(JSON.stringify({ command: 'surface', surface: this.surface, epoch: this.surfaceEpoch }) + '\n'); }
    catch { this.stop('error', 'helper-closed'); }
  }
  setSessionBlocked(blocked: boolean): void {
    this.blocked = blocked; this.generation++;
    if (blocked) this.setSurface('none');
    if (blocked) this.publish({ status: 'unavailable', devices: 0, reason: 'session-blocked' });
    else if (this.child) this.publish({ status: 'starting', devices: 0 });
    this.command(blocked ? 'pause' : 'resume');
  }
  private command(command: 'pause' | 'resume'): void {
    try { this.child?.stdin.write(JSON.stringify({ command }) + '\n'); }
    catch { this.stop('error', 'helper-closed'); }
  }
  private stop(status: 'error' | 'stopped', reason?: string): void {
    const child = this.child; this.child = undefined; this.generation++; this.partial = '';
    this.surface = 'none'; this.surfaceEpoch++;
    clearTimeout(this.readyTimer); this.readyTimer = undefined;
    this.publish({ status, devices: 0, ...(reason ? { reason } : {}) });
    if (!child) return;
    child.stdin.end(); child.kill('SIGTERM');
    const timer = setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 1500);
    timer.unref(); child.once('close', () => clearTimeout(timer));
  }
  dispose(): void { this.stop('stopped'); }
}
