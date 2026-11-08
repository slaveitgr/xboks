import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LibraryTabs, libraryTabItems } from './LibraryChrome';

it('uses the 2612 navigation order and suppresses unavailable Apps and duplicate dock Queue entry points', () => {
  expect(libraryTabItems({ showInstalled: true, showApps: true }).map(item => item.id)).toEqual(['installed', 'apps', 'history', 'later', 'games', 'queue']);
  expect(libraryTabItems({ showInstalled: true, highDensity: false }).map(item => item.id)).toEqual(['installed', 'history', 'later', 'queue', 'games']);
  expect(libraryTabItems({ queueInDock: true }).map(item => item.id)).not.toContain('queue');
  expect(libraryTabItems().map(item => item.id)).not.toContain('apps');
  expect(libraryTabItems({ surface: 'inline' }).map(item => item.id)).toEqual(['games', 'history', 'later', 'queue']);
  expect(libraryTabItems({ showInstalled: true, showApps: true, showLater: false, queueInDock: true }).map(item => item.id)).toEqual(['installed', 'apps', 'history', 'games']);
});

it('exposes one keyboard tab stop, selected section identity and real button semantics', () => {
  const html = renderToStaticMarkup(<LibraryTabs active="later" select={() => {}} showInstalled />);
  expect(html.match(/tabindex="0"/g)).toHaveLength(1);
  expect(html).toMatch(/tabindex="0" aria-selected="true" id="library-tab-later"/);
  expect(html).toContain('aria-label="Library sections"'); expect(html).toContain('type="button" role="tab"');
  expect(html).toContain('Recently played'); expect(html).not.toContain('Install Queue');
});
