import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FirstRunWizard, SettingsPage } from './App';
import { demoSnapshot } from '../shared/demo-data';

it.each(['wizard', 'settings'])('offers explicit keyring checks and safe setup guidance in %s', location => {
  const data = demoSnapshot(); data.auth.stored = false;
  const html = renderToStaticMarkup(location === 'wizard' ? <FirstRunWizard data={data} toast={() => {}} /> : <SettingsPage data={data} toast={() => {}} />);
  expect(html).toContain('aria-label="System keyring"');
  expect(html).toContain('Check keyring');
  expect(html).toContain('keyring-compact');
  expect(html).toContain('Checking…');
  expect(html).not.toContain('XBOKS Engine can start an installed service.');
  expect(html).not.toContain('Keep your wallet password enabled');
  expect(html).not.toContain('keyring-help');
  expect(html).not.toContain('Start keyring service'); // Only offered after an actual activatable-provider result.
  if (location === 'wizard') expect(html.indexOf('aria-label="System keyring"')).toBeLessThan(html.indexOf('class="wizard-account"'));
});
it.each([false, true])('keeps limiter instructions short with bandwidth support=%s', supported => {
  const data = demoSnapshot(); data.backend.capabilities.streamingBandwidthLimit = supported;
  const html = renderToStaticMarkup(<SettingsPage data={data} initialSection="install" toast={() => {}} />);
  expect(html).toContain('0 = unlimited. Applies to active and future game downloads.');
  expect(html).not.toContain('Small network-buffering bursts');
  expect(html).not.toContain('Update XBOKS Engine to use a speed limit');
  expect(html).not.toContain('Keep your wallet password enabled');
});

it('keeps wallet diagnostics reachable from About while signed in without changing the observed Account menu', () => {
  const data = demoSnapshot(); data.auth.stored = true;
  const html = renderToStaticMarkup(<SettingsPage data={data} initialSection="about" toast={() => {}} />);
  expect(html).toContain('XBOKS Engine settings'); expect(html).toContain('aria-label="System keyring"');
  expect(html).toContain('aria-label="Check keyring"'); expect(html).not.toContain('Start keyring service');
});
