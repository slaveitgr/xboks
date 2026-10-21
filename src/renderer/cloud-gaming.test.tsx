import {afterEach, expect, it, vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {CloudGamingHost, CloudGamingPage, CloudGamingSurface, cloudGamingStatusLabel, observeCloudGaming} from './CloudGaming';
import type {CloudGamingState} from '../shared/cloud-gaming';
const ready: CloudGamingState = {open: true, phase: 'ready', canGoBack: false, origin: 'https://www.xbox.com'};
afterEach(() => vi.unstubAllGlobals());
it('renders an explicit official-site entry with separate sign-in and compatibility limits without performing account/network actions', () => {
  const open = vi.fn(async () => {}), html = renderToStaticMarkup(<CloudGamingPage open={open}/>);
  expect(html).toContain('Open Xbox Cloud Gaming'); expect(html).toContain('official Xbox Cloud Gaming website');
  expect(html).toContain('separate from the launcher account'); expect(html).toContain('Edge, Chrome and Safari'); expect(html).toContain('compatibility can vary');
  expect(html).not.toMatch(/<iframe|<webview|type="password"|Connected|streaming now/i); expect(open).not.toHaveBeenCalled();
});
it('does not create remote content from rendering the host and tolerates a missing bridge', () => {
  const bridge = {getCloudGamingState: vi.fn(), onCloudGamingState: vi.fn(), controlCloudGaming: vi.fn()};
  expect(renderToStaticMarkup(<CloudGamingHost bridge={bridge}/>)).toBe('');
  for (const method of Object.values(bridge)) expect(method).not.toHaveBeenCalled();
  expect(renderToStaticMarkup(<CloudGamingPage/>)).toContain('requires the desktop xboks application');
});
it('keeps Back/reload/close and origin in trusted controls without claiming a stream is active', () => {
  const command = vi.fn(), html = renderToStaticMarkup(<CloudGamingSurface state={ready} command={command}/>);
  for (const label of ['Return to xboks', 'Cloud gaming home', 'Reload Cloud gaming', 'Close Cloud gaming', 'https://www.xbox.com', 'Ctrl + F6']) expect(html).toContain(label);
  expect(command).not.toHaveBeenCalled(); expect(html).not.toMatch(/Connected|streaming now/i);
  expect(cloudGamingStatusLabel({...ready, origin: 'https://login.live.com'}, 'en')).toContain('Microsoft sign-in');
  expect(cloudGamingStatusLabel({...ready, blockedNavigation: true}, 'en')).toContain('outside Xbox');
});
it('shows loading/error recovery and localizes the route and controls in Greek', () => {
  const command = vi.fn();
  expect(renderToStaticMarkup(<CloudGamingSurface state={{...ready, phase: 'loading'}} command={command}/>)).toContain('Your launcher sign-in is separate');
  const error = renderToStaticMarkup(<CloudGamingSurface state={{...ready, phase: 'error', error: 'crashed'}} command={command}/>);
  expect(error).toContain('Try again'); expect(error).toContain('The Xbox page stopped'); expect(error).toContain('role="alert"');
  vi.stubGlobal('localStorage', {getItem: () => 'el'});
  expect(renderToStaticMarkup(<CloudGamingPage open={async () => {}}/>)).toContain('Άνοιγμα Xbox Cloud Gaming');
  expect(renderToStaticMarkup(<CloudGamingSurface state={ready} command={command}/>)).toContain('Κλείσιμο Cloud gaming');
});
it('subscribes before reading and prevents a stale initial read from replacing newer events', async () => {
  let notify!: (state: CloudGamingState) => void, resolve!: (state: CloudGamingState) => void;
  const changed = vi.fn(), unsubscribe = vi.fn(), stop = observeCloudGaming({onCloudGamingState: callback => {notify = callback; return unsubscribe;}, getCloudGamingState: () => new Promise(done => {resolve = done;})}, changed);
  notify(ready); resolve({open: false, phase: 'closed', canGoBack: false}); await Promise.resolve();
  expect(changed.mock.calls).toEqual([[ready]]); stop(); expect(unsubscribe).toHaveBeenCalledOnce(); notify({...ready, phase: 'error'}); expect(changed).toHaveBeenCalledOnce();
});
it('ignores initial reads after disposal and safely handles unavailable/failed bridge reads', async () => {
  let resolve!: (state: CloudGamingState) => void; const changed = vi.fn();
  const stop = observeCloudGaming({getCloudGamingState: () => new Promise(done => {resolve = done;})}, changed); stop(); resolve(ready); await Promise.resolve(); expect(changed).not.toHaveBeenCalled();
  expect(() => observeCloudGaming(undefined, changed)()).not.toThrow();
  const failed = observeCloudGaming({getCloudGamingState: async () => {throw Error('unavailable');}}, changed); await Promise.resolve(); failed(); expect(changed).not.toHaveBeenCalled();
});
