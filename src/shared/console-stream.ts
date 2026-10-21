import type {CloudIceCandidate} from './cloud-stream.js';

/** Console and session IDs are local capabilities, not provider device identifiers. */
export interface ConsoleStreamDevice {
  id: string;
  name: string;
  consoleType?: string;
  powerState: 'on' | 'standby' | 'off' | 'unknown';
  outOfHomeWarning?: boolean;
  /** An available Play action is an attempt, not a successful connection claim. */
  canStream: boolean;
  canWake: boolean;
}
export interface ConsoleStreamList {
  status: 'ready' | 'signed-out' | 'unsupported' | 'error';
  consoles: ConsoleStreamDevice[];
  checkedAt: string;
  reason?: 'account-unavailable' | 'service-unavailable';
}
export interface ConsoleStreamState {
  phase: 'closed' | 'starting' | 'provisioning' | 'ready' | 'error';
  id?: string;
  consoleId?: string;
  error?: 'signed-out' | 'unsupported' | 'account-changed' | 'service' | 'timeout' | 'busy' | 'transfer-token-required';
}
export type ConsoleStreamIceCandidate = CloudIceCandidate;
export interface ConsoleWakeResult { ok: false; reason: 'unsupported'; }
export interface ConsoleStreamApi {
  getConsoleStreamDevices(refresh?: boolean): Promise<ConsoleStreamList>;
  startConsoleStream(consoleId: string): Promise<ConsoleStreamState>;
  getConsoleStreamState(id?: string): Promise<ConsoleStreamState>;
  exchangeConsoleStreamSdp(id: string, offer: string): Promise<string>;
  exchangeConsoleStreamIce(id: string, candidates: ConsoleStreamIceCandidate[]): Promise<ConsoleStreamIceCandidate[]>;
  stopConsoleStream(id?: string): Promise<void>;
  wakeConsole?(consoleId: string): Promise<ConsoleWakeResult>;
  onConsoleStreamState(callback: (state: ConsoleStreamState) => void): () => void;
}
