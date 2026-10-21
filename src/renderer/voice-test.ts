export interface VoiceDevice { id: string; label: string }
export interface VoiceTestState {
  phase: 'idle' | 'starting' | 'running'; inputs: VoiceDevice[]; outputs: VoiceDevice[];
  inputId: string; outputId: string; level: number; muted: boolean; listening: boolean;
  pushToTalk: boolean; talking: boolean; volume: number; noiseSuppression: boolean;
  noiseSupported: boolean; noiseApplied?: boolean; outputSupported: boolean; permissionPending: boolean; error?: string;
}
export interface VoiceTestEnvironment {
  request(): Promise<void>; release(): Promise<void>;
  capture(constraints: MediaStreamConstraints): Promise<MediaStream>;
  devices(): Promise<MediaDeviceInfo[]>; constraints(): MediaTrackSupportedConstraints;
  context(): AudioContext; audio(): HTMLAudioElement;
  frame(callback: FrameRequestCallback): number; cancelFrame(id: number): void;
  timeout(callback: () => void, milliseconds: number): () => void;
}
export const initialVoiceTestState = (): VoiceTestState => ({ phase:'idle',inputs:[],outputs:[],inputId:'',outputId:'',level:0,muted:false,listening:false,pushToTalk:false,talking:false,volume:20,noiseSuppression:true,noiseSupported:false,outputSupported:false,permissionPending:false });
export function voiceGateOpen(state: Pick<VoiceTestState,'muted'|'pushToTalk'|'talking'>) { return !state.muted && (!state.pushToTalk || state.talking); }
export function voiceLevel(samples: Float32Array): number {
  if (!samples.length) return 0;
  const square = samples.reduce((sum, value) => sum + value * value, 0) / samples.length;
  return Number.isFinite(square) ? Math.min(100, Math.round(Math.sqrt(square) * 300)) : 0;
}
export function voiceError(value: unknown): string {
  const name = value && typeof value === 'object' && 'name' in value ? value.name : '';
  return name === 'NotAllowedError' || name === 'SecurityError' ? 'Microphone permission was denied.'
    : name === 'NotFoundError' ? 'No microphone is available.'
    : name === 'NotReadableError' ? 'The microphone could not be opened. It may be busy.'
    : name === 'OverconstrainedError' ? 'The selected microphone or setting is unavailable.'
    : value instanceof Error ? value.message : 'The local microphone test could not start.';
}
/** Local-only media graph. No recorder, peer connection, network or system-wide
 * routing. Every acquired stream is owned until every track has been stopped. */
export class LocalVoiceTestEngine {
  state = initialVoiceTestState();
  private listeners = new Set<(state: VoiceTestState) => void>();
  private generation = 0;
  private stream?: MediaStream; private processed?: MediaStream;
  private context?: AudioContext; private source?: MediaStreamAudioSourceNode; private analyser?: AnalyserNode; private gain?: GainNode;
  private output?: HTMLAudioElement; private frame = 0; private cancelTimeout?: () => void;
  private ended?: () => void; private captureInputId?: string;
  private grantPending = false; private grantHeld = false; private pendingReleased = false;
  constructor(private environment: VoiceTestEnvironment) {}
  subscribe(listener: (state: VoiceTestState) => void) { this.listeners.add(listener); listener(this.state); return () => { this.listeners.delete(listener); }; }
  private publish(patch: Partial<VoiceTestState>) { this.state = { ...this.state, ...patch }; for (const listener of this.listeners) listener(this.state); }
  async refreshDevices() {
    const generation = this.generation;
    try {
      const devices = await this.environment.devices(); if (generation !== this.generation) return;
      const inputs = devices.filter(device => device.kind === 'audioinput').map((device, index) => ({ id: device.deviceId, label: device.label || `Microphone ${index + 1}` }));
      const outputs = devices.filter(device => device.kind === 'audiooutput').map((device, index) => ({ id: device.deviceId, label: device.label || `Output ${index + 1}` }));
      if (this.state.phase === 'running' && ((this.captureInputId && !inputs.some(device => device.id === this.captureInputId)) || (this.state.outputId && !outputs.some(device => device.id === this.state.outputId)))) { await this.stop('The selected audio device was disconnected.'); return; }
      this.publish({ inputs, outputs, noiseSupported: this.environment.constraints().noiseSuppression === true });
    } catch (error) { if (generation === this.generation) this.publish({ error: voiceError(error) }); }
  }
  setInput(id: string) { if (this.state.phase === 'idle') this.publish({ inputId: id, error: undefined }); }
  setMuted(muted: boolean) { this.publish({ muted }); this.applyGate(); }
  setPushToTalk(pushToTalk: boolean) { this.publish({ pushToTalk, talking: false }); this.applyGate(); }
  setTalking(talking: boolean) { this.publish({ talking: this.state.phase === 'running' && talking }); this.applyGate(); }
  setVolume(volume: number) { if (!Number.isFinite(volume)) return; const next = Math.min(100,Math.max(0,volume)); if (this.output) this.output.volume = next / 100; this.publish({ volume: next }); }
  private applyGate() { if (this.gain) this.gain.gain.value = voiceGateOpen(this.state) ? 1 : 0; }
  async setNoiseSuppression(enabled: boolean) {
    const generation = this.generation;
    if (!this.state.noiseSupported) return;
    if (!this.stream) { this.publish({ noiseSuppression: enabled }); return; }
    try { const track = this.stream.getAudioTracks()[0]; await track.applyConstraints({ noiseSuppression: enabled }); if (generation === this.generation) this.publish({ noiseSuppression: enabled, noiseApplied: track.getSettings().noiseSuppression, error: undefined }); }
    catch (error) { if (generation === this.generation) this.publish({ error: voiceError(error) }); }
  }
  async setOutput(id: string) {
    if (!this.output) { this.publish({ outputId: id }); return; }
    const generation = this.generation;
    try { if (typeof this.output.setSinkId !== 'function') { if (id) throw Error('Output selection is unavailable. The default output is used.'); } else await this.output.setSinkId(id); if (generation === this.generation) this.publish({ outputId: id, error: undefined }); }
    catch (error) { if (generation === this.generation) this.publish({ error: voiceError(error) }); }
  }
  async setListening(listening: boolean) {
    if (!this.output || this.state.phase !== 'running') return;
    if (!listening) { this.output.pause(); this.output.muted = true; this.publish({ listening: false }); return; }
    const generation = this.generation;
    try { this.output.muted = false; await this.output.play(); if (generation === this.generation) this.publish({ listening: true, error: undefined }); }
    catch { if (generation === this.generation) { this.output.muted = true; this.publish({ listening: false, error: 'Test playback could not start. Choose an available output and try again.' }); } }
  }
  async start() {
    if (this.state.phase !== 'idle' || this.grantPending) return;
    const generation = ++this.generation;
    this.grantPending = true; this.pendingReleased = false;
    this.publish({ phase: 'starting', permissionPending: true, error: undefined, listening: false, talking: false, level: 0 });
    try {
      try { await this.environment.request(); this.grantHeld = !this.pendingReleased; }
      finally { this.grantPending = false; this.publish({ permissionPending: false }); }
      if (generation !== this.generation) return;
      const constraints = this.environment.constraints();
      const audio: MediaTrackConstraints = { ...(this.state.inputId ? { deviceId: { exact: this.state.inputId } } : {}), ...(constraints.noiseSuppression ? { noiseSuppression: this.state.noiseSuppression } : {}), ...(constraints.echoCancellation ? { echoCancellation: true } : {}) };
      const stream = await this.environment.capture({ audio, video: false });
      if (generation !== this.generation) { stream.getTracks().forEach(track => track.stop()); return; }
      this.stream = stream; const track = stream.getAudioTracks()[0]; if (!track) throw Error('The selected device did not provide microphone audio.');
      this.captureInputId = track.getSettings().deviceId;
      this.context = this.environment.context(); this.source = this.context.createMediaStreamSource(stream); this.analyser = this.context.createAnalyser(); this.analyser.fftSize = 512;
      this.gain = this.context.createGain(); const destination = this.context.createMediaStreamDestination(); this.processed = destination.stream;
      this.source.connect(this.analyser); this.source.connect(this.gain); this.gain.connect(destination);
      this.output = this.environment.audio(); this.output.srcObject = destination.stream; this.output.muted = true; this.output.volume = this.state.volume / 100;
      if (this.state.outputId) { if (typeof this.output.setSinkId !== 'function') throw Error('Output selection is unavailable. The default output is used.'); await this.output.setSinkId(this.state.outputId); }
      if (generation !== this.generation) return;
      await this.context.resume(); if (generation !== this.generation) return;
      if (track.readyState === 'ended') throw Error('The microphone stopped or was disconnected.');
      this.ended = () => { void this.stop('The microphone stopped or was disconnected.'); }; stream.getTracks().forEach(track => track.addEventListener('ended', this.ended!));
      this.publish({ phase: 'running', outputSupported: typeof this.output.setSinkId === 'function', noiseSupported: constraints.noiseSuppression === true, noiseApplied: track.getSettings().noiseSuppression }); this.applyGate();
      this.cancelTimeout = this.environment.timeout(() => { void this.stop('The local test stopped after 60 seconds.'); }, 60000);
      const samples = new Float32Array(this.analyser.fftSize);
      const meter = () => { if (generation !== this.generation || !this.analyser) return; this.analyser.getFloatTimeDomainData(samples); this.publish({ level: voiceLevel(samples) }); this.frame = this.environment.frame(meter); };
      this.frame = this.environment.frame(meter); await this.refreshDevices();
    } catch (error) { if (generation === this.generation) await this.stop(voiceError(error)); }
  }
  async stop(error?: string) {
    this.generation++; this.cancelTimeout?.(); this.cancelTimeout = undefined; this.environment.cancelFrame(this.frame);
    if (this.output) { this.output.pause(); this.output.muted = true; this.output.srcObject = null; }
    if (this.stream && this.ended) this.stream.getTracks().forEach(track => track.removeEventListener('ended', this.ended!));
    for (const stream of [this.stream, this.processed]) stream?.getTracks().forEach(track => track.stop());
    this.source?.disconnect(); this.analyser?.disconnect(); this.gain?.disconnect();
    const context = this.context; this.stream = undefined; this.processed = undefined; this.context = undefined; this.source = undefined; this.analyser = undefined; this.gain = undefined; this.output = undefined; this.ended = undefined; this.captureInputId = undefined;
    const release = this.grantHeld || (this.grantPending && !this.pendingReleased); this.grantHeld = false; if (this.grantPending) this.pendingReleased = true;
    // Revoke before publishing idle, so a fresh Start cannot be overtaken by
    // this older Stop while AudioContext.close() is still pending.
    const released = release ? this.environment.release().catch(() => {}) : Promise.resolve();
    this.publish({ phase:'idle',level:0,listening:false,talking:false,noiseApplied:undefined,error });
    try { await context?.close(); } catch { /* Tracks are already stopped. */ }
    await released;
  }
}

export function browserVoiceEnvironment(): VoiceTestEnvironment {
  return {
    request: () => window.launcher.requestVoiceCapture(), release: () => window.launcher.releaseVoiceCapture(),
    capture: constraints => { if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) return Promise.reject(Error('Microphone capture is unavailable in this app session.')); return navigator.mediaDevices.getUserMedia(constraints); },
    devices: () => navigator.mediaDevices?.enumerateDevices?.() ?? Promise.resolve([]), constraints: () => navigator.mediaDevices?.getSupportedConstraints?.() ?? {},
    context: () => new AudioContext(), audio: () => document.createElement('audio'),
    frame: callback => requestAnimationFrame(callback), cancelFrame: id => cancelAnimationFrame(id),
    timeout: (callback, milliseconds) => { const timer = window.setTimeout(callback, milliseconds); return () => window.clearTimeout(timer); },
  };
}
const browserEngines = new WeakMap<Window, LocalVoiceTestEngine>();
/** Main Settings and an inline Guide share one capture in the same window. */
export function browserVoiceEngine(): LocalVoiceTestEngine {
  let engine = browserEngines.get(window);
  if (!engine) { engine = new LocalVoiceTestEngine(browserVoiceEnvironment()); browserEngines.set(window, engine); }
  return engine;
}
