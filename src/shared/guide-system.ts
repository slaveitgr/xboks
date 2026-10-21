/** Linux system capabilities are sampled from real services, never inferred from UI preferences. */
export interface GuideSystemCapability {
  available: boolean;
  reason?: string;
  requiresAuthorization?: boolean;
}
export interface GuideNetworkDevice {
  interface: string;
  type: string;
  state: string;
  connection?: string;
}
export interface GuideNetworkState {
  available: boolean;
  reason?: string;
  state?: string;
  connectivity?: string;
  wifi?: { enabled: boolean; hardwareEnabled: boolean; toggle: GuideSystemCapability };
  devices: GuideNetworkDevice[];
  settings: GuideSystemCapability;
}
export interface GuideBluetoothDevice {
  address: string;
  name: string;
  paired: true;
  connected: boolean;
  connect: GuideSystemCapability;
  disconnect: GuideSystemCapability;
}
export interface GuideBluetoothState {
  available: boolean;
  reason?: string;
  controller?: { address: string; name: string; powered: boolean };
  toggle: GuideSystemCapability;
  devices: GuideBluetoothDevice[];
  settings: GuideSystemCapability;
}
export type GuidePowerAction = 'lock' | 'logout' | 'suspend' | 'reboot' | 'poweroff';
export type GuideSystemSettingsSection = 'network' | 'bluetooth' | 'power';
export interface GuidePowerState {
  available: boolean;
  reason?: string;
  actions: Record<GuidePowerAction, GuideSystemCapability>;
  settings: GuideSystemCapability;
}
export interface GuideSystemState {
  platform: string;
  sampledAt: string;
  network: GuideNetworkState;
  bluetooth: GuideBluetoothState;
  power: GuidePowerState;
}
export type GuideSystemAction =
  | { type: 'wifi'; enabled: boolean }
  | { type: 'bluetooth'; enabled: boolean }
  | { type: 'bluetooth-device'; address: string; connected: boolean }
  | { type: 'power'; action: GuidePowerAction }
  | { type: 'open-settings'; section: GuideSystemSettingsSection };
export interface GuideSystemActionResult {
  ok: boolean;
  state: GuideSystemState;
  error?: string;
}
/** Sender-bound, expiring and single-use; issued/checked by the main IPC owner. */
export interface GuidePowerConfirmation { token: string; expiresAt: string }
