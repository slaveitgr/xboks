import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { demoSnapshot } from '../shared/demo-data';
import { XboxModeNavigation } from './XboxModeNavigation';

describe('shared Xbox mode navigation', () => {
  it('keeps the same accessible navigation on Library, Store and Game Pass without a desktop rail', () => {
    for (const page of ['home', 'library', 'store', 'gamepass', 'cloud', 'downloads', 'profile', 'settings'] as const) {
      const html = renderToStaticMarkup(<XboxModeNavigation page={page} data={demoSnapshot()} go={() => {}} onSearch={() => {}} onPanel={() => {}} />);
      expect(html).toContain('data-console-navigation=""');
      for (const label of ['My Library', 'Store', 'Game Pass', 'Search', 'Settings', 'More']) expect(html).toContain(`aria-label="${label}"`);
      expect(html).not.toContain('class="sidebar');
      const primary = ['home', 'library', 'store', 'gamepass', 'settings'].includes(page);
      expect((html.match(/aria-current="page"/g) ?? []).length).toBe(primary ? 1 : 0);
    }
  });
  it('clears private account facts for both sign-out and in-progress account transitions', () => {
    for (const auth of [{ stored: false, running: false }, { stored: true, running: true }]) {
      const data = demoSnapshot();
      data.auth = { ...data.auth, ...auth, gamertag: 'Previous private user', avatarDataUrl: 'data:image/png;base64,cHJpdmF0ZQ==', profile: { gamertag: 'Previous private profile', gamerscore: 8888 } };
      const html = renderToStaticMarkup(<XboxModeNavigation data={data} go={() => {}} onSearch={() => {}} />);
      expect(html).toContain('aria-label="Sign in"');
      for (const value of ['Previous private', 'cHJpdmF0ZQ==', 'Gamerscore', 'PC GAME PASS']) expect(html).not.toContain(value);
    }
  });
  it('renders the actual shell status once and offers Back only when supplied by the route', () => {
    const data = demoSnapshot();
    const html = renderToStaticMarkup(<XboxModeNavigation data={data} page="library" go={() => {}} onSearch={() => {}} back={() => {}} status={<time>actual clock slot</time>} />);
    expect((html.match(/<time/g) ?? []).length).toBe(1);
    expect(html).toContain('aria-label="Back"');
    expect(html).toContain('actual clock slot');
    const home = renderToStaticMarkup(<XboxModeNavigation data={data} go={() => {}} onSearch={() => {}} />);
    expect(home).not.toContain('aria-label="Back"');
  });
});
