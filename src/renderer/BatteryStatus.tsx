import { useEffect, useState } from 'react';
import { loadAppearance } from './appearance';
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
export function BatteryStatus() {
  const percentage = useBatteryPercentage();
  const [enabled, setEnabled] = useState(() => loadAppearance().showBattery);
  useEffect(() => { const update = (event: Event) => setEnabled((event as CustomEvent<{ showBattery: boolean }>).detail.showBattery); window.addEventListener('xboks-appearance', update); return () => window.removeEventListener('xboks-appearance', update); }, []);
  return enabled && percentage !== null ? <span className="shell-battery" aria-label={`Battery ${percentage}%`}>{percentage}%</span> : null;
}
