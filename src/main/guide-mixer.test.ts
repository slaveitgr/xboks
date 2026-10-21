import { describe, expect, it, vi } from 'vitest';
import { GuideMixerManager, parseGuideMixerTopology, parseMixerVolume, validateGuideMixerCommand } from './guide-mixer.js';
const node = (id: number, serial: number | string, kind = 'Audio/Sink', name = `node-${id}`, permissions = ['r', 'w', 'x']) => ({
  id, type: 'PipeWire:Interface:Node', permissions, info: { props: { 'object.serial': serial, 'media.class': kind, 'node.name': name,
    'node.description': `Audio ${id}`, ...(kind === 'Stream/Output/Audio' ? { 'application.name': 'Synthetic game' } : {}) } },
});
const metadata = () => ({ id: 5, type: 'PipeWire:Interface:Metadata', permissions: ['r', 'w', 'x'], props: { 'metadata.name': 'default' }, metadata: [
  { subject: 0, key: 'default.audio.sink', type: 'Spa:String:JSON', value: { name: 'node-10' } },
  { subject: 0, key: 'default.audio.source', type: 'Spa:String:JSON', value: JSON.stringify({ name: 'node-11' }) },
] });
const topology = () => [metadata(), node(10, 110), node(11, '111', 'Audio/Source'), node(12, 112, 'Stream/Output/Audio')];
function fixture(options: { mutateTopology?: (rows: ReturnType<typeof topology>, count: number) => unknown; failVolume?: boolean; failMutation?: boolean } = {}) {
  const rows = topology(), calls: { file: string; args: string[] }[] = [], levels = new Map([[10, { volume: 153, muted: true }], [11, { volume: 16, muted: true }], [12, { volume: 100, muted: false }]]);
  let dumps = 0;
  const run = vi.fn(async (file: 'pw-dump' | 'wpctl', args: string[]) => {
    calls.push({ file, args: [...args] });
    if (file === 'pw-dump') return { stdout: JSON.stringify(options.mutateTopology?.(structuredClone(rows), ++dumps) ?? rows) };
    const id = Number(args[1]), level = levels.get(id)!;
    if (args[0] === 'get-volume') {
      if (options.failVolume) throw Error('private raw command error');
      return { stdout: `Volume: ${(level.volume / 100).toFixed(2)}${level.muted ? ' [MUTED]' : ''}\n` };
    }
    if (options.failMutation) throw Error('private mutation error');
    if (args[0] === 'set-volume') level.volume = Number(args[2].slice(0, -1));
    if (args[0] === 'set-mute') level.muted = args[2] === '1';
    if (args[0] === 'set-default') (rows[0] as ReturnType<typeof metadata>).metadata[0].value = { name: `node-${id}` };
    return { stdout: '' };
  });
  return { manager: new GuideMixerManager({ run }), run, calls, mutations: () => calls.filter(call => call.args[0].startsWith('set-')) };
}

describe('PipeWire topology and user-facing volume scale', () => {
  it('parses devices, playback applications and effective default names from structured pw-dump metadata', () => {
    const state = parseGuideMixerTopology(topology());
    expect(state.status).toBe('available');
    expect(state.outputs[0]).toMatchObject({ id: 10, serial: '110', kind: 'output', isDefault: true, canSetDefault: true });
    expect(state.inputs[0]).toMatchObject({ id: 11, serial: '111', kind: 'input', isDefault: true });
    expect(state.applications[0]).toMatchObject({ id: 12, application: 'Synthetic game', kind: 'application', canSetDefault: false });
    expect(state.outputs[0].volumePercent).toBeUndefined();
  });
  it('ignores non-audio, malformed, duplicate and unsafe identities rather than guessing a stream', () => {
    const invalid = [node(1, 101, 'Video/Source'), node(2, 102, 'Stream/Input/Audio'), node(3, '18446744073709551616'),
      node(4, 1.2), node(6, '001'), node(8, 108), node(8, 109), node(0xffffffff, 110), node(-1, 111), node(20, 120), node(21, 120),
      node(22, 122, '__proto__')];
    expect(parseGuideMixerTopology(invalid)).toMatchObject({ outputs: [], inputs: [], applications: [] });
  });
  it('does not infer defaults from priority or choose between conflicting metadata/device names', () => {
    const rows = topology(); (rows[0] as ReturnType<typeof metadata>).metadata.push({ subject: 0, key: 'default.audio.sink', type: 'Spa:String:JSON', value: { name: 'node-11' } });
    expect(parseGuideMixerTopology(rows).outputs[0].isDefault).toBe(false);
    expect(parseGuideMixerTopology([metadata(), node(10, 110), node(13, 113, 'Audio/Sink', 'node-10')]).outputs.every(n => !n.isDefault)).toBe(true);
    const duplicate = parseGuideMixerTopology([metadata(), metadata(), node(10, 110)]);
    expect(duplicate.outputs[0].isDefault).toBe(false); expect(duplicate.outputs[0].canSetDefault).toBe(false);
  });
  it('honors explicit write permissions and bounds displayed nodes', () => {
    const rows = [metadata(), ...Array.from({ length: 65 }, (_, i) => node(i + 10, i + 100, 'Audio/Sink', `node-${i}`, i === 0 ? ['r'] : ['r', 'w']))];
    const state = parseGuideMixerTopology(rows); expect(state.outputs).toHaveLength(64); expect(state.partial).toBe(true);
    expect(state.outputs[0].canSetVolume).toBe(false); expect(state.outputs[0].canSetMute).toBe(false);
  });
  it('uses actual wpctl percentages, preserving external amplification and explicit mute independently', () => {
    expect(parseMixerVolume('Volume: 1.53 [MUTED]\n')).toEqual({ volumePercent: 153, muted: true });
    expect(parseMixerVolume('Volume: 0.16')).toEqual({ volumePercent: 16, muted: false });
    expect(parseMixerVolume('Volume: 0.00')).toEqual({ volumePercent: 0, muted: false });
  });
  it.each(['Volume: NaN', 'Volume: -1.0', 'Volume: 1.0\nset-volume 59 1', 'Volume: 11.0', 'private output', 'Volume: 0.1 [false]'])(
    'rejects unsupported volume output %s', output => expect(parseMixerVolume(output)).toBeUndefined(),
  );
});

describe('numeric mixer command boundary', () => {
  it.each([null, { action: 'volume', id: '10', serial: '110', volumePercent: 10 }, { action: 'mute', id: 10, serial: 110, muted: true },
    { action: 'volume', id: 10, serial: '110', volumePercent: 101 }, { action: 'volume', id: 10, serial: '110', volumePercent: -1 },
    { action: 'volume', id: 10, serial: '110', volumePercent: 1.5 }, { action: 'mute', id: 10, serial: '110', muted: 'toggle' },
    { action: 'default', id: 10, serial: '110', command: 'launch' }, { action: ['default'], id: 10, serial: '110' },
    { action: 'default', id: 10, serial: '110;sh' }])('rejects invalid commands before any process is invoked', async value => {
    const run = vi.fn(); const manager = new GuideMixerManager({ run });
    expect(() => validateGuideMixerCommand(value)).toThrow('Invalid audio mixer operation');
    await expect(manager.control(value as any)).rejects.toThrow('Invalid audio mixer operation'); expect(run).not.toHaveBeenCalled();
  });
});

describe('real-command mixer orchestration with synthetic runner', () => {
  it('uses read-only discovery and actual volume reads, without any automatic device or playback mutations', async () => {
    const f = fixture(), state = await f.manager.state(); expect(state.outputs[0].volumePercent).toBe(153); expect(state.inputs[0].muted).toBe(true);
    expect(f.mutations()).toEqual([]); expect(f.calls[0]).toEqual({ file: 'pw-dump', args: ['-N'] });
    expect(f.calls.slice(1).every(call => call.file === 'wpctl' && call.args[0] === 'get-volume' && /^[0-9]+$/.test(call.args[1]))).toBe(true);
  });
  it('sets per-application volume and source mute with fixed numeric arguments and returns observed fresh state', async () => {
    const f = fixture(); let state = await f.manager.control({ action: 'volume', id: 12, serial: '112', volumePercent: 25 });
    expect(f.mutations()).toEqual([{ file: 'wpctl', args: ['set-volume', '12', '25%'] }]); expect(state.applications[0].volumePercent).toBe(25);
    state = await f.manager.control({ action: 'mute', id: 11, serial: '111', muted: false });
    expect(f.mutations()[1]).toEqual({ file: 'wpctl', args: ['set-mute', '11', '0'] }); expect(state.inputs[0].muted).toBe(false);
  });
  it('supports explicit device defaults but rejects using application streams as default devices', async () => {
    const f = fixture(); await f.manager.control({ action: 'default', id: 10, serial: '110' });
    expect(f.mutations()).toEqual([{ file: 'wpctl', args: ['set-default', '10'] }]);
    await expect(f.manager.control({ action: 'default', id: 12, serial: '112' })).rejects.toThrow('unavailable'); expect(f.mutations()).toHaveLength(1);
  });
  it('rejects stale UI identities without issuing a mutation', async () => {
    const f = fixture(); await expect(f.manager.control({ action: 'volume', id: 10, serial: '999', volumePercent: 20 })).rejects.toThrow('changed'); expect(f.mutations()).toEqual([]);
  });
  it.each(['serial', 'name', 'kind', 'permission'])(
    'revalidates %s immediately before mutating a recycled/changed device', async field => {
      const f = fixture({ mutateTopology: (rows, count) => {
        if (count === 2) { const device = rows[1] as ReturnType<typeof node>;
          if (field === 'serial') device.info.props['object.serial'] = 999;
          if (field === 'name') device.info.props['node.name'] = 'replacement';
          if (field === 'kind') device.info.props['media.class'] = 'Audio/Source';
          if (field === 'permission') device.permissions = ['r']; }
        return rows;
      } });
      await expect(f.manager.control({ action: 'volume', id: 10, serial: '110', volumePercent: 20 })).rejects.toThrow('changed'); expect(f.mutations()).toEqual([]);
    },
  );
  it('does not claim successful controls for failed reads or retry an unconfirmed mutation', async () => {
    const failedRead = fixture({ failVolume: true }), state = await failedRead.manager.state();
    expect(state.outputs[0]).toMatchObject({ canSetVolume: false, canSetMute: false }); expect(state.outputs[0].volumePercent).toBeUndefined();
    await expect(failedRead.manager.control({ action: 'volume', id: 10, serial: '110', volumePercent: 20 })).rejects.toThrow('unavailable'); expect(failedRead.mutations()).toEqual([]);
    const failedSet = fixture({ failMutation: true }); await expect(failedSet.manager.control({ action: 'mute', id: 10, serial: '110', muted: false })).rejects.toThrow('did not confirm'); expect(failedSet.mutations()).toHaveLength(1);
  });
  it('reports missing tools, invalid topology and non-Linux sessions without fabricating device entries', async () => {
    for (const stdout of ['not JSON', '{}', ' '.repeat(8 * 1024 * 1024 + 1)]) {
      const manager = new GuideMixerManager({ run: async () => ({ stdout }) }); expect(await manager.state()).toMatchObject({ status: 'error', outputs: [], inputs: [], applications: [] });
    }
    const run = vi.fn(), manager = new GuideMixerManager({ platform: 'win32', run }); expect((await manager.state()).status).toBe('unsupported'); expect(run).not.toHaveBeenCalled();
  });
  it('serializes changes so a later slider command cannot finish before an earlier pending mutation', async () => {
    const f = fixture(); let release!: () => void, started!: () => void; const wait = new Promise<void>(resolve => { release = resolve; }), began = new Promise<void>(resolve => { started = resolve; });
    const original = f.run.getMockImplementation()!; let first = true;
    f.run.mockImplementation(async (file, args) => { if (args[0] === 'set-volume' && first) { first = false; started(); await wait; } return original(file, args); });
    const one = f.manager.control({ action: 'volume', id: 12, serial: '112', volumePercent: 75 });
    const two = f.manager.control({ action: 'volume', id: 12, serial: '112', volumePercent: 50 });
    await began; expect(f.mutations()).toHaveLength(0); release(); await Promise.all([one, two]);
    expect(f.mutations().map(call => call.args[2])).toEqual(['75%', '50%']);
  });
});
