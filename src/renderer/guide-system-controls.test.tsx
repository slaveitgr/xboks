import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GuideSystemContents, GuideSystemControls, guidePowerConfirmationToken, guideSystemActionAvailable } from './GuideSystemControls';
import type { GuideSystemAction, GuideSystemState, GuideSystemSettingsSection } from '../shared/guide-system';
import { GuideOverlay } from './GuideOverlay';
import { demoSnapshot } from '../shared/demo-data';

const yes = { available: true }, no = { available: false, reason: 'Unavailable in fixture' };
function fixture(): GuideSystemState {
  return { platform: 'linux', sampledAt: '2026-10-21T09:00:00Z',
    network: { available: true, state: 'connected', connectivity: 'full', wifi: { enabled: true, hardwareEnabled: true, toggle: yes }, devices: [{ interface: 'wlan0', type: 'wifi', state: 'connected', connection: 'Fixture Wi-Fi' }], settings: yes },
    bluetooth: { available: true, controller: { address: '00:11:22:33:44:55', name: 'Fixture controller', powered: true }, toggle: yes, devices: [{ address: 'AA:BB:CC:DD:EE:FF', name: 'Fixture headphones', paired: true, connected: true, connect: yes, disconnect: yes }], settings: yes },
    power: { available: true, actions: { lock: yes, logout: yes, suspend: no, reboot: yes, poweroff: yes }, settings: yes },
  };
}
const t = (en: string) => en;
function render(state?: GuideSystemState, section?: GuideSystemSettingsSection, busy = false, greek = false) {
  const callbacks = { select: vi.fn(), action: vi.fn(), settings: vi.fn(), back: vi.fn(), refresh: vi.fn() };
  const html = renderToStaticMarkup(<GuideSystemContents state={state} section={section} busy={busy} {...callbacks} t={greek ? (_en, el) => el : t} />);
  for (const callback of Object.values(callbacks)) expect(callback).not.toHaveBeenCalled();
  return html;
}
afterEach(() => vi.unstubAllGlobals());

describe('Guide system capability boundaries', () => {
  it.each<GuideSystemAction>([{ type: 'wifi', enabled: false }, { type: 'bluetooth', enabled: false }, { type: 'bluetooth-device', address: 'AA:BB:CC:DD:EE:FF', connected: false }, { type: 'power', action: 'lock' }, { type: 'open-settings', section: 'network' }])('rejects action without a real state: %j', action => {
    expect(guideSystemActionAvailable(undefined, action)).toBe(false);
  });
  it('rejects Wi-Fi changes when blocked by hardware or service capability', () => {
    const state = fixture(); expect(guideSystemActionAvailable(state, { type: 'wifi', enabled: false })).toBe(true);
    state.network.wifi!.hardwareEnabled = false; expect(guideSystemActionAvailable(state, { type: 'wifi', enabled: true })).toBe(false);
    state.network.wifi!.hardwareEnabled = true; state.network.wifi!.toggle = no; expect(guideSystemActionAvailable(state, { type: 'wifi', enabled: false })).toBe(false);
    state.network.wifi!.toggle = yes; state.network.available = false; expect(guideSystemActionAvailable(state, { type: 'wifi', enabled: false })).toBe(false);
  });
  it('requires an actual Bluetooth controller before radio changes', () => {
    const state = fixture(); expect(guideSystemActionAvailable(state, { type: 'bluetooth', enabled: false })).toBe(true);
    state.bluetooth.controller = undefined; expect(guideSystemActionAvailable(state, { type: 'bluetooth', enabled: true })).toBe(false);
  });
  it('uses the exact paired-device address and independent connect/disconnect capabilities', () => {
    const state = fixture(); state.bluetooth.devices[0].disconnect = no;
    expect(guideSystemActionAvailable(state, { type: 'bluetooth-device', address: 'AA:BB:CC:DD:EE:FF', connected: false })).toBe(false);
    expect(guideSystemActionAvailable(state, { type: 'bluetooth-device', address: 'AA:BB:CC:DD:EE:FF', connected: true })).toBe(true);
    expect(guideSystemActionAvailable(state, { type: 'bluetooth-device', address: 'NOT-PAIRED', connected: true })).toBe(false);
    state.bluetooth.controller!.powered = false;
    expect(guideSystemActionAvailable(state, { type: 'bluetooth-device', address: 'AA:BB:CC:DD:EE:FF', connected: true })).toBe(false);
  });
  it('keeps desktop settings capability separate from unavailable radio service', () => {
    const state = fixture(); state.network.available = false;
    expect(guideSystemActionAvailable(state, { type: 'open-settings', section: 'network' })).toBe(true);
    state.network.settings = no; expect(guideSystemActionAvailable(state, { type: 'open-settings', section: 'network' })).toBe(false);
  });
  it('does not enable unsupported power actions', () => {
    const state = fixture(); expect(guideSystemActionAvailable(state, { type: 'power', action: 'lock' })).toBe(true);
    expect(guideSystemActionAvailable(state, { type: 'power', action: 'suspend' })).toBe(false);
    state.power.available = false; expect(guideSystemActionAvailable(state, { type: 'power', action: 'lock' })).toBe(false);
  });
});

describe('Guide explicit power confirmation', () => {
  const now = Date.parse('2026-10-21T09:00:00Z');
  const prepared = { action: 'reboot' as const, token: 'sender-bound-test-token', expiresAt: '2026-10-21T09:01:00Z' };
  it('does not yield a token until a matching explicit confirmation exists', () => {
    expect(guidePowerConfirmationToken(undefined, 'reboot', now)).toBeUndefined();
    expect(guidePowerConfirmationToken(prepared, 'poweroff', now)).toBeUndefined();
    expect(guidePowerConfirmationToken(prepared, 'reboot', now)).toBe('sender-bound-test-token');
  });
  it.each(['2026-10-21T09:00:00Z', '2026-10-21T08:59:59Z', 'invalid'])('rejects expired or invalid confirmation at %s', expiresAt => {
    expect(guidePowerConfirmationToken({ ...prepared, expiresAt }, 'reboot', now)).toBeUndefined();
  });
  it('rejects an empty nonce even before expiry', () => {
    expect(guidePowerConfirmationToken({ ...prepared, token: '' }, 'reboot', now)).toBeUndefined();
  });
});

describe('Guide system rendered controls', () => {
  it('renders observed network/device summaries without inventing online status', () => {
    const html = render(fixture()); expect(html).toContain('Fixture Wi-Fi'); expect(html).toContain('Fixture headphones');
    expect(html).toContain('data-guide-system-open="power"'); expect(html).not.toContain('Online');
  });
  it('does not present an unavailable service as connected or powered on', () => {
    const state = fixture(); state.network.available = false; state.network.reason = 'No NetworkManager'; state.bluetooth.available = false; state.bluetooth.reason = 'No BlueZ';
    const html = render(state); expect(html).toContain('No NetworkManager'); expect(html).toContain('No BlueZ');
    expect(html).not.toContain('Fixture Wi-Fi'); expect(html).not.toContain('Fixture headphones');
  });
  it('renders Wi-Fi hardware block and keeps its switch disabled', () => {
    const state = fixture(); state.network.wifi!.hardwareEnabled = false;
    const html = render(state, 'network'); expect(html).toContain('disabled by the hardware switch'); expect(html).toMatch(/role="switch" disabled=""/);
    expect(html).toContain('wlan0'); expect(html).toContain('enter passwords in your desktop network settings');
  });
  it('renders paired-device connection action and capability reason', () => {
    const state = fixture(); state.bluetooth.devices[0].disconnect = no;
    const html = render(state, 'bluetooth'); expect(html).toContain('Paired devices'); expect(html).toContain('Connected'); expect(html).toContain('Unavailable in fixture'); expect(html).toMatch(/<button disabled="">Disconnect/);
    expect(html).toContain('Pair new devices in your desktop Bluetooth settings');
  });
  it('renders all five power actions and disables unsupported ones', () => {
    const html = render(fixture(), 'power'); for (const label of ['Lock','Sign out','Sleep','Shut down','Restart']) expect(html).toContain(label);
    expect(html).toMatch(/<button class="guide-row" disabled="">[\s\S]*?Sleep/);
  });
  it('disables rendered mutation and settings buttons while an action is busy', () => {
    const html = render(fixture(), 'power', true);
    expect(html.match(/<button[^>]*disabled=""/g)).toHaveLength(8);
  });
  it('provides Greek status, device and power labels', () => {
    const html = render(fixture(), 'power', false, true); for (const label of ['Κλείδωμα','Αποσύνδεση','Αναστολή λειτουργίας','Επανεκκίνηση','Άνοιγμα ρυθμίσεων επιφάνειας εργασίας']) expect(html).toContain(label);
    expect(render(fixture(), 'bluetooth', false, true)).toContain('Συζευγμένες συσκευές');
  });
  it('renders an absent adapter safely without calling any launcher API', () => {
    const html = renderToStaticMarkup(<GuideSystemControls />); expect(html).toContain('Checking system controls'); expect(html).toContain('Status unavailable'); expect(html).not.toContain('Connected');
  });
  it('integrates the real controls component in Guide settings instead of the old placeholder', () => {
    const html = renderToStaticMarkup(<GuideOverlay data={demoSnapshot()} tab="settings" setTab={() => {}} close={() => {}} go={() => {}} openGame={() => {}} />);
    expect(html).toContain('guide-system-controls'); expect(html).not.toContain('Network, Bluetooth and power controls are not connected yet');
  });
});
