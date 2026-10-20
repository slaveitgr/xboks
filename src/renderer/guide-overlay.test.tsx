import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GuideOverlay, type GuideTab } from './GuideOverlay';
import { demoSnapshot } from '../shared/demo-data';
const render = (tab: GuideTab) => renderToStaticMarkup(<GuideOverlay data={demoSnapshot()} tab={tab} setTab={() => {}} close={() => {}} go={() => {}} openGame={() => {}} />);
it('exposes modal/controller close semantics and a selected tab', () => {
  const html = render('home');
  expect(html).toContain('aria-modal="true"');
  expect(html).toContain('data-gamepad-cancel');
  expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
  expect(html).toContain('Gears of War: E-Day');
});
it('shows capability limits rather than fictitious social data', () => {
  const html = render('social');
  expect(html).toContain('Friends, chat and party services are not connected yet');
  expect(html).not.toContain('Online (');
});
it('labels capture as the xboks window, not any running game', () => {
  const html = render('capture');
  expect(html).toContain('Captures the xboks window without this overlay');
  expect(html).toContain('Game video recording and capture outside xboks are not connected yet');
});
