import { afterEach, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { batteryPowerStatus } from './battery-status.js';
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
async function fixture(rows: Record<string, Record<string, string>>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xboks-power-')); roots.push(root);
  for (const [name, values] of Object.entries(rows)) {
    await fs.mkdir(path.join(root, name));
    for (const [key, value] of Object.entries(values)) await fs.writeFile(path.join(root, name, key), value);
  }
  return root;
}
it('reports actual charging and AC state independently from capacity', async () => {
  const root = await fixture({ BAT0: { type: 'Battery', capacity: '63', status: 'Charging' }, AC: { type: 'Mains', online: '1' } });
  expect(await batteryPowerStatus(root)).toEqual({ percentage: 63, charging: true, externalPower: true });
  await fs.writeFile(path.join(root, 'BAT0/status'), 'Discharging'); await fs.writeFile(path.join(root, 'AC/online'), '0');
  expect(await batteryPowerStatus(root)).toEqual({ percentage: 63, charging: false, externalPower: false });
});
it('does not invent a battery or charging state on a desktop with mains only', async () => {
  expect(await batteryPowerStatus(await fixture({ AC: { type: 'Mains', online: '1' } }))).toEqual({ percentage: null, charging: null, externalPower: true });
});
it('preserves unknown readings, ignores absent batteries and bounds percentages', async () => {
  const root = await fixture({ BAT0: { type: 'Battery', capacity: 'invalid', status: 'Unknown' }, BAT1: { type: 'Battery', capacity: '80', status: 'Charging', present: '0' }, BAT2: { type: 'Battery', capacity: '101', status: '' }, AC: { type: 'USB_PD', online: '?' } });
  expect(await batteryPowerStatus(root)).toEqual({ percentage: null, charging: null, externalPower: null });
  expect(await batteryPowerStatus(path.join(root, 'missing'))).toEqual({ percentage: null, charging: null, externalPower: null });
});
