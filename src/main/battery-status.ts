import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { BatteryPowerStatus } from '../shared/fullscreen-experience.js';

/** Read facts from Linux power_supply; unknown is never inferred as charging. */
export async function batteryPowerStatus(root = '/sys/class/power_supply'): Promise<BatteryPowerStatus> {
  const unknown: BatteryPowerStatus = { percentage: null, charging: null, externalPower: null };
  try {
    const batteries: { percentage: number | null; status: string }[] = [], power: boolean[] = [];
    for (const entry of await fs.readdir(root)) {
      const read = (name: string) => fs.readFile(path.join(root, entry, name), 'utf8').then(value => value.trim(), () => '');
      const type = await read('type');
      if (type === 'Battery') {
        if (await read('present') === '0') continue;
        const text = await read('capacity'), value = Number(text);
        batteries.push({ percentage: /^\d+(?:\.\d+)?$/.test(text) && value >= 0 && value <= 100 ? value : null, status: await read('status') });
      } else if (['Mains', 'USB', 'USB_C', 'USB_PD', 'USB_PD_DRP', 'Wireless'].includes(type)) {
        const online = await read('online');
        if (online === '0' || online === '1') power.push(online === '1');
      }
    }
    const levels = batteries.map(row => row.percentage).filter((value): value is number => value !== null);
    return {
      percentage: levels.length ? Math.round(levels.reduce((sum, value) => sum + value, 0) / levels.length) : null,
      charging: batteries.some(row => row.status === 'Charging') ? true
        : batteries.length && batteries.every(row => ['Discharging', 'Full', 'Not charging'].includes(row.status)) ? false : null,
      externalPower: power.length ? power.some(Boolean) : null,
    };
  } catch { return unknown; }
}
