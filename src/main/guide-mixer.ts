import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { GuideMixerCommand, GuideMixerNode, GuideMixerState } from '../shared/guide-mixer.js';
import { externalLauncherEnvironment } from './launcher-environment.js';
const exec = promisify(execFile), MAX_NODES = 64, MAX_BYTES = 8 * 1024 * 1024;
type Runner = (file: 'pw-dump' | 'wpctl', args: string[]) => Promise<{ stdout: string }>;
const object = (value: unknown): Record<string, unknown> | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const text = (value: unknown, max = 512): string | undefined => typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : undefined;
const nodeId = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0 && value < 0xffffffff;
function serial(value: unknown): string | undefined {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? String(value) : undefined;
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]{0,19})$/.test(value)) return;
  return BigInt(value) <= 18446744073709551615n ? value : undefined;
}
function blank(status: GuideMixerState['status'], reason: string): GuideMixerState {
  return { status, source: 'pipewire', outputs: [], inputs: [], applications: [], reason };
}
export function parseMixerVolume(stdout: string): { volumePercent: number; muted: boolean } | undefined {
  const match = /^Volume:\s+([0-9]+(?:\.[0-9]+)?)(\s+\[MUTED\])?\s*$/.exec(stdout.trim());
  if (!match) return;
  const volume = Number(match[1]);
  return Number.isFinite(volume) && volume >= 0 && volume <= 10 ? { volumePercent: Math.round(volume * 100), muted: !!match[2] } : undefined;
}
function defaultNames(rows: unknown[]): { output?: string; input?: string; writable: boolean } {
  const defaults = rows.map(object).filter(row => row?.type === 'PipeWire:Interface:Metadata' && object(row.props)?.['metadata.name'] === 'default');
  if (defaults.length !== 1) return { writable: false };
  const metadata = Array.isArray(defaults[0]?.metadata) ? defaults[0].metadata : [];
  const get = (key: string) => {
    const matches = metadata.map(object).filter(row => row?.subject === 0 && row.key === key);
    if (matches.length !== 1) return;
    let value = matches[0]?.value;
    if (typeof value === 'string' && value.length <= 4096) { try { value = JSON.parse(value); } catch { return; } }
    return text(object(value)?.name);
  };
  return { output: get('default.audio.sink'), input: get('default.audio.source'),
    writable: Array.isArray(defaults[0]?.permissions) && defaults[0].permissions.includes('w') };
}
/** pw-dump structured topology only. Volume uses wpctl's user-facing scale,
 * rather than mistaking raw channel amplitude for its cubic volume control. */
export function parseGuideMixerTopology(value: unknown): GuideMixerState {
  if (!Array.isArray(value) || value.length > 20_000) throw Error('Invalid PipeWire topology.');
  const defaults = defaultNames(value), candidates: GuideMixerNode[] = [];
  for (const entry of value) {
    const row = object(entry), info = object(row?.info), props = object(info?.props);
    if (row?.type !== 'PipeWire:Interface:Node' || !nodeId(row.id) || !props) continue;
    const mediaClass = props['media.class'];
    const kind = mediaClass === 'Audio/Sink' ? 'output' : mediaClass === 'Audio/Source' ? 'input' : mediaClass === 'Stream/Output/Audio' ? 'application' : undefined;
    const identity = serial(props['object.serial']), name = text(props['node.name']);
    if (!kind || identity === undefined || !name) continue;
    const application = text(props['application.name']), description = text(props['node.description']) ?? application ?? text(props['media.name']) ?? name;
    const writable = Array.isArray(row.permissions) && row.permissions.includes('w');
    candidates.push({ id: row.id, serial: identity, kind, name, description, ...(application ? { application } : {}),
      canSetVolume: writable, canSetMute: writable, canSetDefault: kind !== 'application' && defaults.writable,
      isDefault: kind !== 'application' && (kind === 'output' ? defaults.output : defaults.input) === name });
  }
  const idCounts = new Map<number, number>(), serialCounts = new Map<string, number>(), nameCounts = new Map<string, number>();
  for (const node of candidates) {
    idCounts.set(node.id, (idCounts.get(node.id) ?? 0) + 1);
    serialCounts.set(node.serial, (serialCounts.get(node.serial) ?? 0) + 1);
    const key = `${node.kind}\u0000${node.name}`; nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }
  const unique = candidates.filter(node => idCounts.get(node.id) === 1 && serialCounts.get(node.serial) === 1);
  const nodes = unique.slice(0, MAX_NODES);
  // A duplicate device name cannot establish a unique default target.
  for (const node of nodes) if (node.isDefault && nameCounts.get(`${node.kind}\u0000${node.name}`) !== 1) node.isDefault = false;
  return { status: 'available', source: 'pipewire', outputs: nodes.filter(node => node.kind === 'output'), inputs: nodes.filter(node => node.kind === 'input'),
    applications: nodes.filter(node => node.kind === 'application'), ...(unique.length > MAX_NODES ? { partial: true } : {}) };
}
export function validateGuideMixerCommand(value: unknown): GuideMixerCommand {
  const data = object(value);
  if (!data || !nodeId(data.id) || typeof data.serial !== 'string' || serial(data.serial) !== data.serial ||
      typeof data.action !== 'string' || !['volume', 'mute', 'default'].includes(data.action) ||
      Object.keys(data).some(key => !['action', 'id', 'serial', ...(data.action === 'volume' ? ['volumePercent'] : data.action === 'mute' ? ['muted'] : [])].includes(key)) ||
      data.action === 'volume' && (typeof data.volumePercent !== 'number' || !Number.isInteger(data.volumePercent) || data.volumePercent < 0 || data.volumePercent > 100) ||
      data.action === 'mute' && typeof data.muted !== 'boolean') throw Error('Invalid audio mixer operation.');
  return data as unknown as GuideMixerCommand;
}
export class GuideMixerManager {
  private readonly run: Runner;
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;
  constructor(private options: { run?: Runner; platform?: NodeJS.Platform; environment?: NodeJS.ProcessEnv } = {}) {
    this.run = options.run ?? (async (file, args) => {
      const { stdout } = await exec(file, args, { timeout: 4000, maxBuffer: file === 'pw-dump' ? MAX_BYTES : 16_384,
        env: { ...externalLauncherEnvironment(options.environment ?? process.env), LC_ALL: 'C' } }); return { stdout };
    });
  }
  private async topology(): Promise<GuideMixerState> {
    const { stdout } = await this.run('pw-dump', ['-N']);
    if (Buffer.byteLength(stdout, 'utf8') > MAX_BYTES) throw Error('PipeWire topology exceeds the limit.');
    return parseGuideMixerTopology(JSON.parse(stdout));
  }
  async state(): Promise<GuideMixerState> {
    if ((this.options.platform ?? process.platform) !== 'linux') return blank('unsupported', 'The audio mixer requires Linux PipeWire and WirePlumber.');
    try {
      const state = await this.topology(), nodes = [...state.outputs, ...state.inputs, ...state.applications];
      let offset = 0;
      await Promise.all(Array.from({ length: Math.min(4, nodes.length) }, async () => {
        for (;;) {
          const node = nodes[offset++]; if (!node) return;
          try {
            const { stdout } = await this.run('wpctl', ['get-volume', String(node.id)]), volume = parseMixerVolume(stdout);
            if (!volume) throw Error(); Object.assign(node, volume);
          } catch { node.canSetVolume = false; node.canSetMute = false; }
        }
      }));
      return state;
    } catch { return blank('error', 'The audio mixer needs a running PipeWire/WirePlumber session and the pw-dump/wpctl utilities.'); }
  }
  async control(value: GuideMixerCommand): Promise<GuideMixerState> {
    const command = validateGuideMixerCommand(value);
    if ((this.options.platform ?? process.platform) !== 'linux') throw Error('The audio mixer requires a Linux PipeWire session.');
    if (this.pending >= 8) throw Error('Too many audio mixer requests are pending.');
    this.pending++;
    const task = this.tail.then(async () => {
      const state = await this.state(), original = [...state.outputs, ...state.inputs, ...state.applications]
        .find(node => node.id === command.id && node.serial === command.serial);
      if (!original) throw Error('The audio device or stream changed. Refresh the mixer before trying again.');
      if (command.action === 'volume' && !original.canSetVolume || command.action === 'mute' && !original.canSetMute ||
          command.action === 'default' && !original.canSetDefault) throw Error('That audio control is unavailable for this device or stream.');
      // Re-read immediately before the command: IDs can be recycled between UI
      // snapshots. The CLI cannot make this identity check atomic with mutation.
      const fresh = await this.topology(), target = [...fresh.outputs, ...fresh.inputs, ...fresh.applications].find(node => node.id === command.id);
      if (!target || target.serial !== original.serial || target.kind !== original.kind || target.name !== original.name ||
          command.action === 'default' && (!target.canSetDefault || target.kind === 'application') ||
          command.action === 'volume' && !target.canSetVolume || command.action === 'mute' && !target.canSetMute)
        throw Error('The audio device or stream changed. Refresh the mixer before trying again.');
      const args = command.action === 'volume' ? ['set-volume', String(target.id), `${command.volumePercent}%`] :
        command.action === 'mute' ? ['set-mute', String(target.id), command.muted ? '1' : '0'] : ['set-default', String(target.id)];
      try { await this.run('wpctl', args); }
      catch { throw Error('WirePlumber did not confirm the audio change. Refresh the mixer before trying again.'); }
      return this.state();
    });
    this.tail = task.then(() => undefined, () => undefined);
    try { return await task; } finally { this.pending--; }
  }
}
