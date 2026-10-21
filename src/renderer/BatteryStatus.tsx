import { useEffect, useState } from 'react';
import { loadAppearance } from './appearance';
import { Battery0, Battery1, Battery2, Battery3, Battery4, BatteryCharging, Cable } from './XboxIcons';
import { useReferenceLocale } from './ReferenceLocale';

export interface BatteryReading { percentage: number | null; charging: boolean | null; externalPower: boolean | null }
export interface BatteryBridge {
  getBatteryStatus?(): Promise<BatteryReading>;
  getBatteryPercentage?(): Promise<number | null>;
}
const unknown: BatteryReading = { percentage: null, charging: null, externalPower: null };
export function normalizeBatteryReading(value: BatteryReading): BatteryReading {
  return {
    percentage: typeof value.percentage === 'number' && Number.isFinite(value.percentage) && value.percentage >= 0 && value.percentage <= 100 ? Math.round(value.percentage) : null,
    charging: typeof value.charging === 'boolean' ? value.charging : null,
    externalPower: typeof value.externalPower === 'boolean' ? value.externalPower : null,
  };
}
export async function readBatteryStatus(bridge: BatteryBridge | undefined): Promise<BatteryReading> {
  if (bridge?.getBatteryStatus) return normalizeBatteryReading(await bridge.getBatteryStatus());
  if (bridge?.getBatteryPercentage) return normalizeBatteryReading({ ...unknown, percentage: await bridge.getBatteryPercentage() });
  return unknown;
}
export function useBatteryPercentage() {
  const [percentage, setPercentage] = useState<number | null>(null);
  useEffect(() => {
    let active = true;
    const read = () => { if (window.launcher.getBatteryPercentage) void window.launcher.getBatteryPercentage().then(value => { if (active) setPercentage(value); }).catch(() => { if (active) setPercentage(null); }); };
    read(); const timer = window.setInterval(read, 60000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  return percentage;
}
export function batteryPowerIcon(status: BatteryReading): 'charging' | 'battery' | 'plug' | null {
  if (status.charging === true) return 'charging';
  if (status.percentage !== null) return 'battery';
  return status.externalPower === true ? 'plug' : null;
}
export function BatteryIndicator({ status, showPercentage }: { status: BatteryReading; showPercentage: boolean }) {
  const { text } = useReferenceLocale();
  const kind = batteryPowerIcon(status);
  if (!kind) return null;
  const percentage = status.percentage === null ? '' : ` ${status.percentage}%`;
  const label = kind === 'plug' ? text('Connected to power', 'Συνδεδεμένο στο ρεύμα') : kind === 'charging' ? text(`Battery charging${percentage}`, `Η μπαταρία φορτίζει${percentage}`) : text(`Battery${percentage}`, `Μπαταρία${percentage}`);
  const Icon = kind === 'plug' ? Cable : kind === 'charging' ? BatteryCharging : [Battery0, Battery1, Battery2, Battery3, Battery4][Math.floor((status.percentage ?? 0) / 25)];
  return <span className="shell-battery" data-power-icon={kind} role="img" aria-label={label} title={label}><Icon />{showPercentage && status.percentage !== null ? <span>{status.percentage}%</span> : null}</span>;
}
/** Mounted only for the fullscreen header. Hidden desktop tools do not poll. */
export function BatteryStatus() {
  const [status, setStatus] = useState<BatteryReading>(unknown);
  const [enabled, setEnabled] = useState(() => loadAppearance().showBattery);
  useEffect(() => {
    let active = true, pending = false;
    const read = async () => {
      if (pending || document.visibilityState === 'hidden') return;
      pending = true;
      try { const value = await readBatteryStatus(window.launcher); if (active) setStatus(value); }
      catch { if (active) setStatus(unknown); }
      finally { pending = false; }
    };
    void read(); const timer = window.setInterval(() => void read(), 30000);
    const visible = () => { if (document.visibilityState !== 'hidden') void read(); };
    document.addEventListener('visibilitychange', visible);
    return () => { active = false; clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, []);
  useEffect(() => {
    const update = (event: Event) => {
      const value = (event as CustomEvent<{ showBattery?: boolean }>).detail?.showBattery;
      setEnabled(typeof value === 'boolean' ? value : loadAppearance().showBattery);
    };
    window.addEventListener('xboks-appearance', update);
    return () => window.removeEventListener('xboks-appearance', update);
  }, []);
  return <BatteryIndicator status={status} showPercentage={enabled} />;
}
