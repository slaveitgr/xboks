import {EventEmitter} from 'node:events';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type Player from 'xbox-xcloud-player';
import PlayerPacket from 'xbox-xcloud-player/dist/Channel/Input/Packet';
import {CloudInputDriver, CloudPlayerError, cloudGamepadFrame, connectCloudPlayer, type CloudPlayerFactory} from './cloud-player';

function pad(values: Record<number, number> = {}, axes = [0, 0, 0, 0], mapping = 'standard'): Gamepad {
  return {connected: true, index: 2, mapping, axes,
    buttons: Array.from({length: 17}, (_, index) => ({value: values[index] ?? 0, pressed: Boolean(values[index]), touched: false})),
  } as unknown as Gamepad;
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
}
let focused: boolean, hidden: boolean, pads: (Gamepad | null)[];
beforeEach(() => {
  focused = true; hidden = false; pads = [pad({0: 1})];
  vi.stubGlobal('document', {get hidden() {return hidden;}, hasFocus: () => focused, getElementById: () => null});
  vi.stubGlobal('navigator', {getGamepads: () => pads});
});
afterEach(() => {vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();});

describe('cloud controller transport', () => {
  it('bounds physical input and keeps the local Guide button out of the streamed frame', () => {
    const frame = cloudGamepadFrame(pad({0: 3, 1: -1, 2: Number.NaN, 6: 0.25, 16: 1}, [2, -2, Number.NaN, 0.5]));
    expect(frame).toMatchObject({GamepadIndex: 0, A: 1, B: 0, X: 0, LeftTrigger: 0.25, Nexus: 0,
      LeftThumbXAxis: 1, LeftThumbYAxis: -1, RightThumbXAxis: 0, RightThumbYAxis: 0.5});
    expect(Object.values(cloudGamepadFrame()).every(value => value === 0)).toBe(true);
  });
  it.each([[-1, 1], [1, -1]])('encodes browser Y=%s with the correct XInput direction through the pinned player', (browserY, wireSign) => {
    // Exercise the actual dependency encoder: it already reverses browser Y.
    const Packet = (PlayerPacket as unknown as {default?: typeof PlayerPacket}).default ?? PlayerPacket;
    const packet = new Packet(1), bytes = new DataView(new ArrayBuffer(32));
    packet._writeGamepadData(bytes, 0, [cloudGamepadFrame(pad({}, [0, browserY, 0, browserY])) as never]);
    expect(Math.sign(bytes.getInt16(6, true))).toBe(wireSign);
    expect(Math.sign(bytes.getInt16(10, true))).toBe(wireSign);
  });
  it('uses one connected standard controller and never maps unknown layouts', () => {
    const driver = new CloudInputDriver(); driver.setPaused(false); pads = [null, pad({0: 1}, [], ''), pad({1: 1})];
    expect(driver.requestStates()).toHaveLength(1); expect(driver.requestStates()[0]).toMatchObject({A: 0, B: 1});
    pads = [pad({0: 1}, [], '')]; expect(driver.requestStates()[0].A).toBe(0);
  });
  it.each(['pause', 'hidden', 'blur', 'stop'] as const)('sends a neutral frame on %s', gate => {
    const driver = new CloudInputDriver(); driver.setPaused(false); expect(driver.requestStates()[0].A).toBe(1);
    if (gate === 'pause') driver.setPaused(true);
    else if (gate === 'hidden') hidden = true;
    else if (gate === 'blur') focused = false;
    else driver.stop();
    expect(Object.values(driver.requestStates()[0]).every(value => value === 0)).toBe(true);
  });
  it('limits Guide pulses and removes the timeout when stopped without starting a polling loop', () => {
    vi.useFakeTimers(); const driver = new CloudInputDriver(); driver.setPaused(false); pads = [];
    driver.run(); expect(vi.getTimerCount()).toBe(0);
    driver.pressButton(0, 'Nexus'); expect(driver.requestStates()[0].Nexus).toBe(1);
    vi.advanceTimersByTime(91); expect(driver.requestStates()[0].Nexus).toBe(0);
    driver.pressButton(0, 'not-a-button'); expect(vi.getTimerCount()).toBe(0);
    driver.pressButton(0, 'Nexus'); driver.stop(); expect(vi.getTimerCount()).toBe(0);
    expect(driver.requestStates()[0].Nexus).toBe(0); driver.start(); driver.setPaused(false);
    driver.pressButton(0, 'Nexus'); expect(driver.requestStates()[0].Nexus).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });
});

class Peer extends EventTarget {
  iceGatheringState: RTCIceGatheringState = 'complete';
  createOffer = vi.fn(async (_options?: RTCOfferOptions) => ({type: 'offer' as const, sdp: 'local-offer'}));
  setLocalDescription = vi.fn(async (_description: RTCSessionDescriptionInit) => {});
  setRemoteDescription = vi.fn(async (_description: RTCSessionDescriptionInit) => {});
  addIceCandidate = vi.fn(async (_candidate: RTCIceCandidateInit) => {});
}
function fixture() {
  const events = new EventEmitter(), peer = new Peer(), controller = new AbortController();
  let driver!: CloudInputDriver;
  const sendTransaction = vi.fn();
  const player = {
    _webrtcClient: peer,
    getEventBus: () => events,
    getChannelProcessor: () => ({sendTransaction}),
    bind: vi.fn(() => driver.setApplication(player as unknown as Player)),
    close: vi.fn(() => driver.stop()),
    createOffer: vi.fn(() => {throw Error('The unawaited upstream offer helper must not be used.');}),
    getIceCandidates: vi.fn(() => [{candidate: 'local-candidate', sdpMid: '0', sdpMLineIndex: 0}]),
  };
  const factory: CloudPlayerFactory = vi.fn(async (_container, config) => {
    driver = config!.input_driver as CloudInputDriver; return player as unknown as Player;
  });
  const bridge = {
    exchangeCloudSdp: vi.fn(async (_id: string, _sdp: string) => 'remote-answer'),
    exchangeCloudIce: vi.fn(async (_id: string, _candidates: unknown) => [{candidate: 'a=end-of-candidates', sdpMid: '0', sdpMLineIndex: 0}]),
  };
  const changed = vi.fn(), message = vi.fn(), diagnostic = vi.fn();
  const options = {container: 'owned-player', id: 'local-capability', signal: controller.signal, bridge, changed, message, diagnostic, factory};
  return {events, peer, player, bridge, factory, controller, options, changed, message, diagnostic, sendTransaction, getDriver: () => driver};
}
function showMessage(f: ReturnType<typeof fixture>, id = 'dialog-1') {
  f.events.emit('message', {id, target: '/streaming/systemUi/messages/ShowMessageDialog', content: JSON.stringify({
    TitleText: 'Service message', ContentText: 'Choose an option', CommandLabel1: 'Continue', CommandLabel2: '', CommandLabel3: 'Cancel',
  })});
  return f.message.mock.calls.at(-1)![0] as {respond: (index: number) => void};
}

describe('cloud peer lifecycle and session isolation', () => {
  it('exchanges only SDP/ICE with the locally owned session and tears down once', async () => {
    const f = fixture(), handle = await connectCloudPlayer(f.options);
    expect(f.player.bind).toHaveBeenCalledOnce();
    expect(f.player.createOffer).not.toHaveBeenCalled(); expect(f.peer.setLocalDescription).toHaveBeenCalledWith({type: 'offer', sdp: 'local-offer'});
    expect(f.bridge.exchangeCloudSdp).toHaveBeenCalledWith('local-capability', 'local-offer');
    expect(f.peer.setRemoteDescription).toHaveBeenCalledWith({type: 'answer', sdp: 'remote-answer'});
    expect(f.bridge.exchangeCloudIce).toHaveBeenCalledWith('local-capability', [{candidate: 'local-candidate', sdpMid: '0', sdpMLineIndex: 0}]);
    expect(f.peer.addIceCandidate).toHaveBeenCalledWith({candidate: '', sdpMid: '0', sdpMLineIndex: 0});
    handle.close(); handle.close(); f.controller.abort(); expect(f.player.close).toHaveBeenCalledOnce();
    f.events.emit('connectionstate', {state: 'connected'}); expect(f.changed).not.toHaveBeenCalledWith('connected');
  });
  it('configures bounded controller input with keyboard conversion and automatic system UI disabled', async () => {
    const f = fixture(), handle = await connectCloudPlayer(f.options);
    const config = vi.mocked(f.factory).mock.calls[0][1];
    expect(config).toMatchObject({ui_systemui: [19], input_legacykeyboard: true, input_mousekeyboard: false, input_touch: false,
      input_mousekeyboard_config: {_keymapping: {}}});
    expect(config?.input_driver).toBeInstanceOf(CloudInputDriver); handle.close();
  });
  it('keeps game input paused through negotiation and early connection events until the host owns its controls', async () => {
    const f = fixture(), answer = deferred<string>(); f.bridge.exchangeCloudSdp.mockReturnValue(answer.promise);
    const pending = connectCloudPlayer(f.options);
    await vi.waitFor(() => expect(f.bridge.exchangeCloudSdp).toHaveBeenCalled());
    expect(f.getDriver().requestStates()[0].A).toBe(0);
    f.events.emit('connectionstate', {state: 'connected'}); expect(f.getDriver().requestStates()[0].A).toBe(0);
    answer.resolve('remote-answer'); const handle = await pending;
    expect(f.getDriver().requestStates()[0].A).toBe(0);
    handle.pause(false); expect(f.getDriver().requestStates()[0].A).toBe(1); handle.close();
  });
  it('does not construct a player or make a signaling request for an already aborted launch', async () => {
    const f = fixture(); f.controller.abort();
    await expect(connectCloudPlayer(f.options)).rejects.toThrow();
    expect(f.factory).not.toHaveBeenCalled(); expect(f.bridge.exchangeCloudSdp).not.toHaveBeenCalled();
  });
  it('closes a player constructed after cancellation without binding or signaling', async () => {
    const f = fixture(), created = deferred<Player>(); f.options.factory = vi.fn(() => created.promise);
    const pending = connectCloudPlayer(f.options); f.controller.abort(); created.resolve(f.player as unknown as Player);
    await expect(pending).rejects.toThrow(); expect(f.player.close).toHaveBeenCalledOnce(); expect(f.player.bind).not.toHaveBeenCalled();
    expect(f.bridge.exchangeCloudSdp).not.toHaveBeenCalled();
  });
  it('cancels a pending offer without sending SDP and clears all local deadlines', async () => {
    vi.useFakeTimers(); const f = fixture(), offer = deferred<RTCSessionDescriptionInit>();
    f.peer.createOffer.mockImplementation(() => offer.promise as Promise<{type: 'offer'; sdp: string}>);
    const pending = connectCloudPlayer(f.options); await vi.waitFor(() => expect(f.peer.createOffer).toHaveBeenCalled());
    f.controller.abort(); await expect(pending).rejects.toThrow();
    expect(f.bridge.exchangeCloudSdp).not.toHaveBeenCalled(); expect(f.player.close).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it('removes offer deadlines after success instead of retaining callbacks on the signal', async () => {
    vi.useFakeTimers(); const f = fixture(), added = vi.spyOn(f.controller.signal, 'addEventListener'), removed = vi.spyOn(f.controller.signal, 'removeEventListener');
    const handle = await connectCloudPlayer(f.options); handle.close();
    expect(vi.getTimerCount()).toBe(0);
    const active = added.mock.calls.filter(([name, listener]) => name === 'abort' && !removed.mock.calls.some(([event, removedListener]) => event === name && removedListener === listener));
    expect(active).toEqual([]);
  });
  it('cancels while gathering without sending candidates or keeping peer listeners', async () => {
    vi.useFakeTimers(); const f = fixture(); f.peer.iceGatheringState = 'gathering';
    const added = vi.spyOn(f.peer, 'addEventListener'), removed = vi.spyOn(f.peer, 'removeEventListener');
    const pending = connectCloudPlayer(f.options); await vi.waitFor(() => expect(added).toHaveBeenCalledWith('icegatheringstatechange', expect.any(Function)));
    f.controller.abort(); await expect(pending).rejects.toThrow();
    expect(f.bridge.exchangeCloudIce).not.toHaveBeenCalled(); expect(f.player.close).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
    expect(removed).toHaveBeenCalledWith('icegatheringstatechange', added.mock.calls.find(([name]) => name === 'icegatheringstatechange')![1]);
  });
  it('keeps input neutral when a service dialog closes while a local overlay remains open', async () => {
    const f = fixture(), handle = await connectCloudPlayer(f.options); handle.pause(true);
    showMessage(f).respond(0); expect(f.getDriver().requestStates()[0].A).toBe(0);
    showMessage(f); f.events.emit('message', {type: 'SenderCancel', id: 'dialog-1'});
    expect(f.getDriver().requestStates()[0].A).toBe(0); handle.pause(false); expect(f.getDriver().requestStates()[0].A).toBe(1); handle.close();
  });
  it('responds once and ignores stale or unrelated server dialog cancellation', async () => {
    const f = fixture(), handle = await connectCloudPlayer(f.options); handle.pause(false); const first = showMessage(f, 'first');
    const second = showMessage(f, 'second'); first.respond(0);
    expect(f.sendTransaction).not.toHaveBeenCalled();
    f.events.emit('message', {type: 'SenderCancel', id: 'first'}); expect(f.getDriver().requestStates()[0].A).toBe(0);
    second.respond(2); second.respond(2);
    expect(f.sendTransaction).toHaveBeenCalledOnce();
    expect(f.sendTransaction).toHaveBeenCalledWith('second', {Result: 2}); handle.close();
  });
  it('cancels pending signaling promptly and does not apply a late SDP answer', async () => {
    vi.useFakeTimers(); const f = fixture(), answer = deferred<string>(); f.bridge.exchangeCloudSdp.mockReturnValue(answer.promise);
    const pending = connectCloudPlayer(f.options); await vi.waitFor(() => expect(f.bridge.exchangeCloudSdp).toHaveBeenCalled());
    f.controller.abort(); await expect(pending).rejects.toThrow(); answer.resolve('late-answer'); await Promise.resolve();
    expect(f.peer.setRemoteDescription).not.toHaveBeenCalled(); expect(f.bridge.exchangeCloudIce).not.toHaveBeenCalled();
    expect(f.events.listenerCount('message')).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });
  it('stops pending negotiation after a server disconnect instead of submitting its late offer', async () => {
    vi.useFakeTimers(); const f = fixture(), offer = deferred<{type: 'offer'; sdp: string}>(); f.peer.createOffer.mockReturnValue(offer.promise);
    const pending = connectCloudPlayer(f.options); await vi.waitFor(() => expect(f.peer.createOffer).toHaveBeenCalled());
    f.events.emit('message', {target: '/streaming/sessionLifetimeManagement/serverInitiatedDisconnect'});
    await expect(pending).rejects.toThrow(); offer.resolve({type: 'offer', sdp: 'late-offer'}); await Promise.resolve();
    expect(f.bridge.exchangeCloudSdp).not.toHaveBeenCalled(); expect(f.changed).toHaveBeenLastCalledWith('disconnected');
    expect(f.player.close).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it('drops all subscriptions and input on a partial signaling failure', async () => {
    const f = fixture(); f.bridge.exchangeCloudSdp.mockRejectedValue(Error('private transport failure'));
    await expect(connectCloudPlayer(f.options)).rejects.toThrow('Cloud video could not connect (exchange-sdp: failed).');
    expect(f.changed).toHaveBeenLastCalledWith('error'); expect(f.player.close).toHaveBeenCalledOnce();
    expect(f.getDriver().requestStates()[0].A).toBe(0);
    expect(f.events.listenerCount('message')).toBe(0); expect(f.events.listenerCount('connectionstate')).toBe(0);
  });
  it('waits for local SDP to be applied before transmitting the offer and preserves the pinned stereo preference', async () => {
    const f = fixture(), applied = deferred<void>(); f.peer.setLocalDescription.mockReturnValue(applied.promise);
    f.peer.createOffer.mockResolvedValue({type: 'offer', sdp: 'v=0\r\na=fmtp:111 useinbandfec=1\r\n'});
    const pending = connectCloudPlayer(f.options); await vi.waitFor(() => expect(f.peer.setLocalDescription).toHaveBeenCalled());
    expect(f.bridge.exchangeCloudSdp).not.toHaveBeenCalled(); expect(f.peer.setRemoteDescription).not.toHaveBeenCalled();
    applied.resolve(); const handle = await pending;
    expect(f.bridge.exchangeCloudSdp).toHaveBeenCalledWith('local-capability', 'v=0\r\na=fmtp:111 useinbandfec=1; stereo=1\r\n'); handle.close();
  });
  it.each(['create-offer', 'local-description', 'exchange-sdp', 'apply-answer', 'exchange-ice', 'apply-ice'] as const)('reports a safe exact %s failure without exposing exception contents', async stage => {
    const f = fixture(), privateError = Error('credential=private-fixture SDP and network-address fixture');
    if (stage === 'create-offer') f.peer.createOffer.mockRejectedValue(privateError);
    else if (stage === 'local-description') f.peer.setLocalDescription.mockRejectedValue(privateError);
    else if (stage === 'exchange-sdp') f.bridge.exchangeCloudSdp.mockRejectedValue(privateError);
    else if (stage === 'apply-answer') f.peer.setRemoteDescription.mockRejectedValue(privateError);
    else if (stage === 'exchange-ice') f.bridge.exchangeCloudIce.mockRejectedValue(privateError);
    else f.peer.addIceCandidate.mockRejectedValue(privateError);
    const result = await connectCloudPlayer(f.options).catch(error => error);
    expect(result).toBeInstanceOf(CloudPlayerError); expect(result).toMatchObject({stage, code: 'failed'});
    expect(String(result)).not.toMatch(/private-fixture|credential=|network-address/); expect(f.diagnostic).toHaveBeenLastCalledWith(stage);
    expect(f.player.close).toHaveBeenCalledOnce(); expect(f.changed).toHaveBeenLastCalledWith('error');
    if (['create-offer', 'local-description'].includes(stage)) expect(f.bridge.exchangeCloudSdp).not.toHaveBeenCalled();
  });
  it('bounds an unresponsive local-description operation and retains its safe stage', async () => {
    vi.useFakeTimers(); const f = fixture(); f.peer.setLocalDescription.mockReturnValue(new Promise(() => {}));
    const result = connectCloudPlayer(f.options).catch(error => error);
    await vi.waitFor(() => expect(f.peer.setLocalDescription).toHaveBeenCalled()); await vi.advanceTimersByTimeAsync(15001);
    expect(await result).toMatchObject({stage: 'local-description', code: 'timeout'}); expect(f.bridge.exchangeCloudSdp).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it('accepts an implemented single-command server dialog without inventing absent button labels', async () => {
    const f = fixture(), handle = await connectCloudPlayer(f.options);
    f.events.emit('message', {id: 'one-button', target: '/streaming/systemUi/messages/ShowMessageDialog', content: JSON.stringify({TitleText: 'Continue', ContentText: 'A service prompt', CommandLabel1: 'OK'})});
    const dialog = f.message.mock.calls.at(-1)![0]; expect(dialog.buttons).toEqual(['OK', '', '']); dialog.respond(0);
    expect(f.sendTransaction).toHaveBeenCalledWith('one-button', {Result: 0}); handle.close();
  });
});

it('replays the pinned player channels, handshake, transaction and actual input encoder through the default package factory', async () => {
  vi.useFakeTimers(); vi.spyOn(console, 'log').mockImplementation(() => {}); vi.stubGlobal('window', new EventTarget());
  const peers: RuntimePeer[] = [];
  class Channel extends EventTarget {readyState = 'open'; send = vi.fn();}
  class RuntimePeer extends Peer {
    channels = new Map<string, {channel: Channel; config: RTCDataChannelInit}>();
    transceivers: {kind: string; options: RTCRtpTransceiverInit}[] = [];
    close = vi.fn();
    constructor(public config: RTCConfiguration) {super(); peers.push(this);}
    createDataChannel(name: string, config: RTCDataChannelInit) {const channel = new Channel(); this.channels.set(name, {channel, config}); return channel;}
    addTransceiver(kind: string, options: RTCRtpTransceiverInit) {this.transceivers.push({kind, options});}
  }
  vi.stubGlobal('RTCPeerConnection', RuntimePeer);
  const f = fixture(), {factory: _fixtureFactory, ...options} = f.options, handle = await connectCloudPlayer(options), peer = peers[0];
  expect([...peer.channels].map(([name, row]) => [name, row.config.protocol])).toEqual([
    ['input', '1.0'], ['chat', 'chatV1'], ['control', 'controlV1'], ['message', 'messageV1'],
  ]);
  expect(peer.transceivers).toEqual([{kind: 'audio', options: {direction: 'sendrecv'}}, {kind: 'video', options: {direction: 'recvonly'}}]);
  const messages = peer.channels.get('message')!.channel, input = peer.channels.get('input')!.channel;
  for (const {channel} of peer.channels.values()) channel.dispatchEvent(new Event('open'));
  messages.dispatchEvent(new MessageEvent('message', {data: JSON.stringify({type: 'HandshakeAck'})}));
  const decoded = () => messages.send.mock.calls.map(([bytes]) => JSON.parse(new TextDecoder().decode(bytes)));
  const configuration = decoded().find(row => row.target === '/streaming/systemUi/configuration');
  expect(JSON.parse(configuration.content).systemUis).toEqual([19]);
  messages.dispatchEvent(new MessageEvent('message', {data: JSON.stringify({id: 'real-dialog', type: 'Transaction',
    target: '/streaming/systemUi/messages/ShowMessageDialog', content: JSON.stringify({TitleText: 'Service', ContentText: 'Continue?', CommandLabel1: 'Yes'})})}));
  f.message.mock.calls.at(-1)![0].respond(0);
  const completed = decoded().find(row => row.type === 'TransactionComplete');
  expect(completed.id).toBe('real-dialog'); expect(JSON.parse(completed.content)).toEqual({Result: 0});
  const packetView = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  handle.pause(false); vi.advanceTimersByTime(17);
  const frame = packetView(input.send.mock.calls.at(-1)![0]); expect(frame.getUint16(0, true) & 2).toBe(2); expect(frame.getUint16(16, true) & 16).toBe(16);
  handle.pause(true); vi.advanceTimersByTime(17); const neutral = packetView(input.send.mock.calls.at(-1)![0]); expect(neutral.getUint16(16, true)).toBe(0);
  handle.close(); expect(peer.close).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
});
