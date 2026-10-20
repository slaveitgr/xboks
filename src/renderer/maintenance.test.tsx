import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { demoSnapshot } from '../shared/demo-data';
import { DiagnosticDialog, DownloadsPage, LibraryPage, SettingsPage, Sidebar, TopStatus } from './App';
it('has one sidebar queue entry below Settings', () => {
  const html = renderToStaticMarkup(<Sidebar data={demoSnapshot()} page="downloads" go={() => {}} />);
  expect(html.match(/class="queue-summary /g)).toHaveLength(1); expect(html.indexOf('Settings')).toBeLessThan(html.indexOf('Install Queue')); expect(html).toContain('aria-current="page"');
});
it('keeps backend health and launcher update notices distinct', () => {
  const data = demoSnapshot(); data.launcherUpdate!.latestVersion = '0.3.1';
  const html = renderToStaticMarkup(<TopStatus data={data} go={() => {}} />);
  expect(html).toContain('Update available'); expect(html).toContain('Xodus ready');
});
it('offers verified in-app install with independent backend version labels', () => {
  const data = demoSnapshot(); data.launcherUpdate = { currentVersion: '9.0.0', checking: false, latestVersion: '9.0.1', canInstall: true }; data.backend.version = '0.2.1';
  const html = renderToStaticMarkup(<SettingsPage data={data} toast={() => {}} />);
  expect(html).toContain('Install launcher update'); expect(html).toContain('Nexus backend 0.2.1'); expect(html).not.toContain('Backend updates are versioned independently');
});
it('shows game update badges and a separate version-check action', () => {
  const data = demoSnapshot(); data.gameUpdates = { [data.games[0].id]: { checking: false, available: true, latestVersion: '1.10.0.0' } };
  const html = renderToStaticMarkup(<LibraryPage data={data} selection={{ id: data.games[0].id }} toast={() => {}} />);
  expect(html).toContain('Update available'); expect(html).toContain('Update game'); expect(html).toContain('Check game updates');
});
it('renders diagnostic logs as escaped text rather than executable HTML', () => {
  const html = renderToStaticMarkup(<DiagnosticDialog log={{ name: 'game.log', content: '<script>bad()</script>', truncated: true }} close={() => {}} />);
  expect(html).not.toContain('<script>'); expect(html).toContain('&lt;script&gt;'); expect(html).toContain('512 KiB');
});
it('offers Resume and Cancel for paused downloads, without treating them as finished', () => {
  const data = demoSnapshot();
  data.downloads = [{ id:'paused', title:'Game', destination:'/tmp/demo', productId:'TEST', status:'paused',
    canPause:true, progress:25, phase:'Paused', log:[], startedAt:'today' }];
  const html = renderToStaticMarkup(<DownloadsPage data={data} toast={() => {}} />);
  expect(html).toContain('Resume download'); expect(html).toContain('Cancel download');
  expect(html).not.toContain('Clear finished'); expect(html).not.toContain('Remove from queue');
  expect(html).not.toContain('util-linux');
});
