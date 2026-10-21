export interface FullscreenExperienceStatus {
  available: boolean;
  active: boolean;
  source: 'gnome-extension' | 'session' | 'none';
  reason?: string;
}

export interface XboxModeRestartStatus { available: boolean; reason?: string }

export interface BatteryPowerStatus {
  percentage: number | null;
  charging: boolean | null;
  externalPower: boolean | null;
}
