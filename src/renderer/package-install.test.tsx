import { afterEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { InstallPlan, InstallRequest } from '../shared/types';
import { initialInstallContent, PackageDialog } from './PackageInstall';
const base = { productId: '9BBBBBBBBBBB', contentId: '11111111-1111-4111-8111-111111111111', title: 'PC base game', platform: 'Windows.Desktop', packageFormat: 'MSIXVC', kind: 'Game', supported: true };
const request: InstallRequest = { productId: '9AAAAAAAAAAA', title: 'Store offer', destination: '/home/demo/Games/Xboks/sample' };
const plan = (ready = false): InstallPlan => ({ schema: 1, rootProductId: request.productId, market: 'US', status: ready ? 'ready' : 'choice', choices: ready ? [{ ...base }] : [
  { ...base }, { ...base, productId: '9CCCCCCCCCCC', contentId: '22222222-2222-4222-8222-222222222222', title: '<Console game>', platform: 'Xbox.One', packageFormat: 'XVC', supported: false },
] });
afterEach(() => vi.unstubAllGlobals());
it('keeps ambiguous package alternatives single-choice and excludes unsupported console content', () => {
  const html = renderToStaticMarkup(<PackageDialog plan={plan()} request={request} choose={() => {}} />);
  expect(html).toContain('data-install-stage="packages"'); expect(html).toContain('role="radiogroup"');
  expect(html).toContain('PC base game'); expect(html).toContain('&lt;Console game&gt;'); expect(html).toContain('Not available on this device');
  expect(html.match(/disabled=""/g)).toHaveLength(2); expect(html).not.toContain('checked=""');
  expect(html).not.toContain('type="checkbox"'); expect(html).not.toContain('checks your license'); expect(html.replace(/<[^>]*>/g, '')).not.toContain('11111111-1111');
});
it('opens a ready game in the required-content stage without inventing sizes or optional language packs', () => {
  const html = renderToStaticMarkup(<PackageDialog plan={plan(true)} request={request} choose={() => {}} />);
  expect(html).toContain('data-install-stage="contents"'); expect(html).toContain('Select the items to install');
  expect(html).toContain('Base game'); expect(html).toContain('Required'); expect(html).toMatch(/type="checkbox" checked="" disabled=""|type="checkbox" disabled=""[^>]*checked=""/);
  expect(html).toContain('Size unavailable'); expect(html).toContain('Disk space requirement unavailable'); expect(html).toContain('>Next</button>');
  expect(html).not.toContain('GB'); expect(html).not.toContain('BSL'); expect(html).not.toContain('ASL'); expect(html).not.toContain('>Install</button>');
});
it('does not auto-select an add-on or a choice plan even with one supported candidate', () => {
  expect(initialInstallContent(plan())).toBeUndefined();
  expect(initialInstallContent({ ...plan(true), status: 'choice', choices: [{ ...base, kind: 'GameAddOn' }] })).toBeUndefined();
  expect(initialInstallContent(plan(true))).toBe(base.contentId);
});
it('uses catalog artwork only when its product identity matches the selected content', () => {
  const props = { plan: plan(true), request, choose: () => {} };
  expect(renderToStaticMarkup(<PackageDialog {...props} presentation={{ productId: base.productId, posterUrl: 'https://example.test/actual.jpg' }} />)).toContain('src="https://example.test/actual.jpg"');
  expect(renderToStaticMarkup(<PackageDialog {...props} presentation={{ productId: '9ZZZZZZZZZZZ', posterUrl: 'https://example.test/foreign.jpg' }} />)).not.toContain('foreign.jpg');
});
it('uses the supplied Greek content title, required label and Next action', () => {
  vi.stubGlobal('localStorage', { getItem: () => 'el' });
  const html = renderToStaticMarkup(<PackageDialog plan={plan(true)} request={request} choose={() => {}} />);
  for (const value of ['Επιλέξτε τα στοιχεία που θα εγκατασταθούν', 'Κυρίως παιχνίδι', 'Απαιτείται', 'Επόμενο', 'Μη διαθέσιμο μέγεθος', 'Ακύρωση εγκατάστασης']) expect(html).toContain(value);
});
