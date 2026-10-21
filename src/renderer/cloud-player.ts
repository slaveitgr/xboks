import type Player from 'xbox-xcloud-player';
import type {CloudStreamApi} from '../shared/cloud-library';

const buttons = ['A','B','X','Y','LeftShoulder','RightShoulder','LeftTrigger','RightTrigger','View','Menu','LeftThumb','RightThumb','DPadUp','DPadDown','DPadLeft','DPadRight'] as const;
export function cloudGamepadFrame(pad?: Gamepad | null) {
  const frame: Record<string, number> = {GamepadIndex: 0, Nexus: 0};
  buttons.forEach((name, index) => {const value = pad?.buttons[index]?.value ?? 0; frame[name] = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;});
  ['LeftThumbXAxis','LeftThumbYAxis','RightThumbXAxis','RightThumbYAxis'].forEach((name, index) => {
    // The player packet encoder converts browser Y axes to XInput already.
    const value = pad?.axes[index] ?? 0; frame[name] = Number.isFinite(value) ? Math.min(1, Math.max(-1, value)) : 0;
  });
  return frame;
}
/** InputChannel owns its polling interval. This driver never starts a recursive timer. */
export class CloudInputDriver {
  private client?: Player;
  private stopped = false;
  private paused = true;
  private pulse?: string;
  private pulseTimer?: ReturnType<typeof setTimeout>;
  setApplication(client: Player) {this.client = client;}
  start() { /* A disposed driver cannot be restarted by a late channel event. */ }
  run() { /* Legacy input mode polls requestStates; no extra input loop. */ }
  stop() {this.stopped = true; clearTimeout(this.pulseTimer); this.pulse = undefined; this.client = undefined;}
  setPaused(paused: boolean) {this.paused = paused;}
  requestStates() {
    const active = !this.stopped && !this.paused && !document.hidden && document.hasFocus();
    const pad = active ? [...(navigator.getGamepads?.() ?? [])].find(pad => pad?.connected && pad.mapping === 'standard') : undefined;
    const frame = cloudGamepadFrame(pad);
    if (active && this.pulse) frame[this.pulse] = 1;
    return [frame];
  }
  pressButton(_index: number, name: string) {
    if (!['Nexus', ...buttons].includes(name as typeof buttons[number]) || this.stopped) return;
    clearTimeout(this.pulseTimer); this.pulse = name; this.pulseTimer = setTimeout(() => {this.pulse = undefined;}, 90);
  }
}
export interface CloudPlayerHandle {close(): void; pause(paused: boolean): void; guide(): void; mute(muted: boolean): void}
export type CloudPlayerFactory = (container: string, config: ConstructorParameters<typeof Player>[1]) => Promise<Player>;
const factory: CloudPlayerFactory = async (container, config) => {const module = await import('xbox-xcloud-player'); return new module.default(container, config);};

/** Own every deadline and abort listener, including promises whose producer
 * cannot itself be interrupted. Late completion never reopens a closed player. */
function bounded<T>(job: PromiseLike<T>, signal: AbortSignal, milliseconds: number): Promise<T> {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (success: boolean, value: unknown) => {
      if (done) return; done = true; clearTimeout(timer); signal.removeEventListener('abort', aborted);
      if (success) resolve(value as T); else reject(value);
    };
    const aborted = () => finish(false, Error('Cloud player cancelled.'));
    const timer = setTimeout(() => finish(false, Error('Cloud operation timed out.')), milliseconds);
    signal.addEventListener('abort', aborted, {once: true});
    if (signal.aborted) aborted();
    Promise.resolve(job).then(value => finish(true, value), error => finish(false, error));
  });
}

/** Microsoft signaling stays in main; this adapter receives SDP/ICE, never account tokens. */
export async function connectCloudPlayer(options: {
  container: string; id: string; bridge: Pick<CloudStreamApi, 'exchangeCloudSdp' | 'exchangeCloudIce'>;
  signal: AbortSignal; changed: (state: 'connecting' | 'connected' | 'disconnected' | 'error') => void;
  message: (value: {title: string; text: string; buttons: string[]; respond: (index: number) => void} | undefined) => void;
  factory?: CloudPlayerFactory;
}): Promise<CloudPlayerHandle> {
  const driver = new CloudInputDriver(), lifecycle = new AbortController(), signal = lifecycle.signal;
  let player: Player | undefined, disposed = false, externalPaused = true, terminalReported = false;
  let dialog: {id: string; consumed: boolean} | undefined;
  const subscriptions: (() => void)[] = [];
  const inputGate = () => driver.setPaused(externalPaused || Boolean(dialog));
  const close = () => {
    if (disposed) return; disposed = true; dialog = undefined; driver.stop(); lifecycle.abort();
    subscriptions.splice(0).forEach(remove => remove());
    try {player?.close();} catch { /* Partial bind failure still releases our input. */ }
    options.message(undefined); options.signal.removeEventListener('abort', close);
  };
  options.signal.throwIfAborted(); options.signal.addEventListener('abort', close, {once: true});
  try {
    const created = (options.factory ?? factory)(options.container, {ui_systemui: [], input_driver: driver, input_legacykeyboard: true,
      input_mousekeyboard: false, input_touch: false, input_mousekeyboard_config: {_keymapping: {}} as never}).then(candidate => {
      if (disposed) {try {candidate.close();} catch {} throw Error('Cloud player cancelled.');}
      return candidate;
    });
    player = await bounded(created, signal, 15000);
    if (disposed) {try {player.close();} catch {} throw Error('Cloud player cancelled.');}
    const client = player;
    const events = client.getEventBus();
    const connectionState = (event: {state?: string}) => {
      if (disposed) return;
      if (event.state === 'connected') options.changed('connected');
      else if (['disconnected','failed','closed','closing'].includes(event.state ?? '')) {terminalReported = true; close(); options.changed('disconnected');}
    };
    const serviceMessage = (event: {id?: string; type?: string; target?: string; content?: string}) => {
      if (disposed) return;
      if (event.target === '/streaming/sessionLifetimeManagement/serverInitiatedDisconnect') {terminalReported = true; close(); options.changed('disconnected'); return;}
      if (event.type === 'SenderCancel') {
        if (dialog?.id === event.id) {dialog = undefined; inputGate(); options.message(undefined);} return;
      }
      if (event.target !== '/streaming/systemUi/messages/ShowMessageDialog' || typeof event.id !== 'string' || event.id.length > 256 || typeof event.content !== 'string' || event.content.length > 20000) return;
      try {const value = JSON.parse(event.content), labels = [value.CommandLabel1,value.CommandLabel2,value.CommandLabel3];
        if (typeof value.TitleText !== 'string' || typeof value.ContentText !== 'string' || labels.some(label => typeof label !== 'string')) return;
        const current = {id: event.id, consumed: false}; dialog = current; inputGate();
        options.message({title: value.TitleText.slice(0, 512), text: value.ContentText.slice(0, 10000), buttons: labels.map(label => label.slice(0, 512)),
          respond(index) {
            if (disposed || dialog !== current || current.consumed || !Number.isInteger(index) || index < 0 || index > 2 || !labels[index]) return;
            current.consumed = true; dialog = undefined;
            try {client.getChannelProcessor('message')?.sendTransaction(current.id, JSON.stringify({Result: index}));}
            catch {terminalReported = true; close(); options.changed('error'); return;}
            inputGate(); options.message(undefined);
          }});
      } catch { /* Invalid service UI messages cannot execute or render markup. */ }
    };
    events.on('connectionstate', connectionState); events.on('message', serviceMessage);
    subscriptions.push(() => events.removeListener('connectionstate', connectionState), () => events.removeListener('message', serviceMessage));
    client.bind(); options.changed('connecting');
    const offer = await bounded(client.createOffer(), signal, 15000) as RTCSessionDescriptionInit;
    signal.throwIfAborted(); if (!offer.sdp) throw Error('No cloud offer.');
    const answer = await bounded(options.bridge.exchangeCloudSdp(options.id, offer.sdp), signal, 35000); signal.throwIfAborted();
    await bounded(client._webrtcClient!.setRemoteDescription({type: 'answer', sdp: answer}), signal, 10000);
    // The upstream helper does not await gathering; send the full bounded candidate set.
    await new Promise<void>((resolve, reject) => {
      const peer = client._webrtcClient!;
      let done = false;
      const finish = (error?: Error) => {
        if (done) return; done = true; clearTimeout(timer); peer.removeEventListener('icegatheringstatechange', gathered); signal.removeEventListener('abort', aborted);
        if (error) reject(error); else resolve();
      };
      const gathered = () => {if (peer.iceGatheringState === 'complete') finish();};
      const aborted = () => finish(Error('Cloud player cancelled.'));
      const timer = setTimeout(() => finish(), 10000); peer.addEventListener('icegatheringstatechange', gathered); signal.addEventListener('abort', aborted, {once: true});
      if (signal.aborted) aborted(); else gathered();
    });
    signal.throwIfAborted();
    const candidates = client.getIceCandidates().map(candidate => ({candidate: candidate.candidate, sdpMid: candidate.sdpMid, sdpMLineIndex: candidate.sdpMLineIndex}));
    const remote = await bounded(options.bridge.exchangeCloudIce(options.id, candidates), signal, 35000); signal.throwIfAborted();
    for (const candidate of remote) {
      signal.throwIfAborted();
      await bounded(client._webrtcClient!.addIceCandidate({...candidate, candidate: candidate.candidate === 'a=end-of-candidates' ? '' : candidate.candidate}), signal, 10000);
    }
    if (disposed) throw Error('Cloud player closed.');
    return {close, pause: value => {externalPaused = value; inputGate();}, guide: () => driver.pressButton(0, 'Nexus'), mute: value => {
      document.getElementById(options.container)?.querySelectorAll<HTMLMediaElement>('audio,video').forEach(media => {media.muted = value;});
    }};
  } catch {close(); if (!options.signal.aborted && !terminalReported) options.changed('error'); throw Error('Cloud video could not connect.');}
}
