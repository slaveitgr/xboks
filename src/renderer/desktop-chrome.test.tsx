import { expect, it, onTestFinished, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { demoSnapshot } from '../shared/demo-data';
import { DesktopHeader, DesktopSidebar, desktopMoreActions } from './DesktopChrome';
import { selectReferenceMenuItem } from './ReferenceMenu';

const noop = () => {};
const text = (en: string) => en;

it('keeps the four main destinations in reference order and exposes one current page', () => {
  const html = renderToStaticMarkup(<DesktopSidebar page="library" go={noop} onPanel={noop} collapsed={false} social={<p>Friends content</p>} queue={<button>Queue content</button>} />);
  const routes = [...html.matchAll(/data-desktop-page="([^"]+)"/g)].map(match => match[1]);
  expect(routes).toEqual(['home', 'library', 'gamepass', 'store']);
  expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  expect(html).toMatch(/data-desktop-page="library"[^>]*aria-current="page"/);
  expect(html).toContain('aria-label="Main navigation"');
  expect(html.match(/data-gamepad-auto-select=""/g)).toHaveLength(4);
  expect(html).toContain('Friends content');
  expect(html).toContain('Queue content');
});

it('keeps cloud, remote play and settings reachable through distinct nonautomatic actions', () => {
  const go = vi.fn(), panel = vi.fn(), dismiss = vi.fn();
  const items = desktopMoreActions(go, panel, text);
  expect(items.map(item => item.id)).toEqual(['cloud', 'remote-play', 'settings']);
  for (const item of items) expect(selectReferenceMenuItem(item, dismiss)).toBe(true);
  expect(go.mock.calls).toEqual([['cloud'], ['settings']]);
  expect(panel.mock.calls).toEqual([['remote-play']]);
  expect(dismiss).toHaveBeenCalledTimes(3);
  const html = renderToStaticMarkup(<DesktopSidebar page="cloud" go={noop} onPanel={noop} collapsed={false} social={null} queue={null} />);
  expect(html).toContain('aria-label="More destinations"');
  expect(html).toContain('aria-haspopup="menu" aria-expanded="false"');
  expect(html).not.toMatch(/class="desktop-more[^>]*data-gamepad-auto-select/);
});

it('does not mount private roster content in the collapsed sidebar', () => {
  const html = renderToStaticMarkup(<DesktopSidebar page="home" go={noop} onPanel={noop} collapsed social={<p>Private friend roster</p>} queue={<button>Queue</button>} />);
  expect(html).not.toContain('Private friend roster');
  expect(html).toContain('data-collapsed="true"');
  expect(html).toContain('aria-label="Friends"');
  expect(html).toContain('Queue');
});

it('places actual account identity in the header without inferring subscription from sign-in', () => {
  vi.useFakeTimers({ now: new Date('2026-11-06T12:00:00Z') });
  onTestFinished(() => { vi.useRealTimers(); });
  const data = demoSnapshot();
  data.auth = { stored: true, running: false, note: '', username: 'sample@example.test', gamertag: 'ActualPlayer', avatarDataUrl: 'data:image/png;base64,AA==' };
  const render = () => renderToStaticMarkup(<DesktopHeader data={data} collapsed={false} onCollapsed={noop} onPanel={noop} search={<input aria-label="Search" />} controls={<button>Xbox mode</button>} back={noop} />);
  expect(render()).toContain('Account menu: ActualPlayer');
  expect(render()).toContain('src="data:image/png;base64,AA=="');
  expect(render()).not.toContain('Game Pass ULTIMATE');
  data.auth.subscription = { status: 'active', productIds: ['CFQ7TTC0KHS0'], checkedAt: '2026-11-05T12:00:00Z' };
  expect(render()).not.toContain('Game Pass ULTIMATE');
  data.auth.subscription.checkedAt = '2026-11-06T12:00:00Z';
  expect(render()).toContain('Game Pass ULTIMATE');
  data.auth.stored = false;
  expect(render()).not.toContain('ActualPlayer');
  expect(render()).not.toContain('sample@example.test');
  expect(render()).not.toContain('data:image/png;base64,AA==');
  expect(render()).not.toContain('Game Pass ULTIMATE');
  expect(render()).toContain('Account menu: Sign in');
});

it('suppresses stale account identity while the session is changing and names sidebar expansion', () => {
  const data = demoSnapshot();
  data.auth = { stored: true, running: true, note: '', gamertag: 'PreviousAccount', avatarDataUrl: 'data:image/png;base64,AA==' };
  const html = renderToStaticMarkup(<DesktopHeader data={data} collapsed onCollapsed={noop} onPanel={noop} search={<input aria-label="Search" />} />);
  expect(html).toContain('Account menu: Connecting…');
  expect(html).not.toContain('PreviousAccount');
  expect(html).not.toContain('data:image/png;base64,AA==');
  expect(html).toContain('aria-label="Expand sidebar"');
  expect(html).toContain('aria-expanded="false" aria-controls="desktop-sidebar"');
  expect(html).toContain('aria-label="Notifications"');
});
