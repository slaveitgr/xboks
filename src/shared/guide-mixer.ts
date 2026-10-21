export interface GuideMixerNode {
  id: number;
  /** PipeWire object.serial prevents acting on a recycled numeric node ID. */
  serial: string;
  kind: 'output' | 'input' | 'application';
  name: string;
  description: string;
  application?: string;
  /** Observed percentage can exceed 100 when another application amplified it. */
  volumePercent?: number;
  muted?: boolean;
  canSetVolume: boolean;
  canSetMute: boolean;
  canSetDefault: boolean;
  isDefault: boolean;
}
export interface GuideMixerState {
  status: 'available' | 'unsupported' | 'error';
  source: 'pipewire';
  outputs: GuideMixerNode[];
  inputs: GuideMixerNode[];
  applications: GuideMixerNode[];
  partial?: boolean;
  reason?: string;
}
export type GuideMixerCommand = { action: 'volume'; id: number; serial: string; volumePercent: number }
  | { action: 'mute'; id: number; serial: string; muted: boolean }
  | { action: 'default'; id: number; serial: string };
