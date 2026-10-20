import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ContentList, LibraryPage } from './App';
import { demoSnapshot } from '../shared/demo-data';
import type { GameContentPlan } from '../shared/types';
const plan: GameContentPlan = { gameId: 'sample', checkedAt: '', items: [
  { productId: 'OWN', title: 'Owned campaign content', access: 'owned', status: 'available', note: 'Checked again at install.', downloadBytes: 10 * 1024 ** 2 },
  { productId: 'GP', title: 'Subscription content', access: 'gamepass', status: 'installed', note: 'Runtime checks the license.' },
  { productId: 'PAID', title: 'Unlicensed expansion', status: 'unlicensed', note: 'No active license.' },
] };
it('offers generic content management on installed game details', () => {
  const data = demoSnapshot();
  expect(renderToStaticMarkup(<LibraryPage data={data} selection={{ id: data.games[0].id }} toast={() => {}} />)).toContain('Manage content');
});
it('distinguishes subscription, ownership, installation and missing licenses without hiding full titles', () => {
  const html = renderToStaticMarkup(<ContentList plan={plan} disabled={false} install={() => {}} />);
  expect(html).toContain('Owned campaign content'); expect(html).toContain('Owned'); expect(html).toContain('Game Pass'); expect(html).toContain('10.0 MiB');
  expect(html).toMatch(/Unlicensed expansion[\s\S]*?<button[^>]*disabled=""/);
  expect(html).toContain('Repair'); expect(html).toContain('License not verified');
});
it('blocks downloads while busy or after a license expires, even if files remain installed', () => {
  const html = renderToStaticMarkup(<ContentList plan={plan} disabled install={() => {}} />);
  expect(html.match(/disabled=""/g)).toHaveLength(3);
  const stale = { ...plan, items: [{ ...plan.items[1], access: undefined }] };
  expect(renderToStaticMarkup(<ContentList plan={stale} disabled={false} install={() => {}} />)).toContain('disabled=""');
});
