import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import * as jsxRuntime from 'react/jsx-runtime';
import * as icons from 'lucide-react';
import ts from 'typescript';
import type { AccountLibraryPage, AppSnapshot, CatalogProduct, CatalogSearchResult } from '../shared/types';
import { demoSnapshot } from '../shared/demo-data';
import { NewExperienceHomeContent, newHomeAccountKey, newHomeRecentGames, newHomeUniqueProducts, openNewHomeProduct } from './NewExperienceHome';

const product = (id: string, title = id): CatalogProduct => ({ productId: id, title, description: '', categories: ['Racing', 'Simulation'], installability: 'unknown', supportNote: '' });
const catalog = (products: CatalogProduct[] = []): CatalogSearchResult => ({ products, market: 'US', query: 'Trending games', hasMore: false, source: 'Microsoft Store', fetchedAt: '' });
const account = (products: AccountLibraryPage['products'] = []): AccountLibraryPage => ({ products, kind: 'gamepass', accessByProductId: {}, checkedAt: '' });
const deferred = <T,>() => { let resolve!: (value: T) => void, reject!: (reason?: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

/** Exercise the actual container effects and account-bound render guard without
 * using a host window, private account or another DOM dependency. */
function homeHarness(initialAuth: AppSnapshot['auth'], featured = vi.fn(async () => catalog()), library = vi.fn(async () => account())) {
  let data = demoSnapshot(), cursor = 0, dirty = false, mounted = true, tree: any;
  data.auth = initialAuth;
  const slots: any[] = [], effects: (() => void)[] = [];
  const same = (left?: unknown[], right?: unknown[]) => Boolean(left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index])));
  const hooks = {
    useState(initial: any) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, (next: any) => { const value = typeof next === 'function' ? next(slots[index].value) : next; if (!Object.is(value, slots[index].value)) { slots[index].value = value; dirty = true; } }];
    },
    useMemo(callback: () => unknown, deps: unknown[]) { const index = cursor++; if (!same(slots[index]?.deps, deps)) slots[index] = { deps, value: callback() }; return slots[index].value; },
    useEffect(callback: () => void | (() => void), deps: unknown[]) {
      const index = cursor++; if (same(slots[index]?.deps, deps)) return;
      const previous = slots[index]; slots[index] = { deps };
      effects.push(() => { previous?.cleanup?.(); slots[index].cleanup = callback(); });
    },
    useRef: (value: unknown) => ({ current: value }),
  };
  const imports: Record<string, unknown> = {
    react: hooks, 'react/jsx-runtime': jsxRuntime, 'lucide-react': icons, './XboxIcons': icons,
    './LibraryChrome': { useLibraryCollections: () => ({ collections: { later: [], history: {} } }) },
    './ReferenceLocale': { useReferenceLocale: () => ({ text: (en: string) => en }) }, './new-experience-home.css': {},
  };
  const exports: Record<string, any> = {};
  const code = ts.transpileModule(readFileSync(new URL('./NewExperienceHome.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  runInNewContext(code, { exports, require: (id: string) => { if (!(id in imports)) throw Error(`Unexpected import ${id}`); return imports[id]; } });
  const bridge = { getFeaturedCatalog: featured, getAccountLibrary: library };
  const render = () => {
    if (!mounted) return;
    let attempts = 0;
    do { dirty = false; cursor = 0; tree = exports.NewExperienceHome({ data, bridge, go: () => {}, action: () => {} }); effects.splice(0).forEach(effect => effect()); if (++attempts > 20) throw Error('Home effects did not settle.'); } while (dirty);
  };
  render();
  return { featured, library, props: () => tree.props,
    async flush() { for (let i = 0; i < 5; i++) { await Promise.resolve(); render(); } },
    update(auth: AppSnapshot['auth'], market = data.settings.market) { data = { ...data, auth, settings: { ...data.settings, market } }; render(); },
    unmount() { mounted = false; slots.forEach(slot => slot?.cleanup?.()); },
  };
}

it('records MRU from actual play history, never installation order or addedAt', () => {
  const games = demoSnapshot().games;
  expect(newHomeRecentGames(games, {})).toEqual([]);
  const history = { [games[0].id]: 100, [games[2].id]: 400, [games[3].id]: Number.NaN, [games[4].id]: -1, absent: 500 };
  expect(newHomeRecentGames([...games, games[2]], history).map(game => game.id)).toEqual([games[2].id, games[0].id]);
  expect(games.map(game => game.id)).toEqual(demoSnapshot().games.map(game => game.id));
});

it('deduplicates catalog identity without replacing the original product returned to its details route', () => {
  const first = product('ABC', 'Actual returned title');
  expect(newHomeUniqueProducts([first, product('abc', 'Duplicate'), product('DEF')])).toEqual([first, product('DEF')]);
  const openProduct = vi.fn(), go = vi.fn(); openNewHomeProduct(first, { openProduct, go });
  expect(openProduct).toHaveBeenCalledOnce(); expect(openProduct).toHaveBeenCalledWith(first); expect(go).not.toHaveBeenCalled();
  openNewHomeProduct(first, { go }); expect(go).toHaveBeenCalledOnce(); expect(go).toHaveBeenCalledWith('store');
});

it('renders Featured first when there is no MRU, with actual metadata and no invented campaign, access or recent-added row', () => {
  const products = Array.from({ length: 6 }, (_, index) => ({ ...product(`P${index}`, `Returned ${index}`), heroUrl: `https://images.example.test/${index}.png`, purchasePrice: index === 0 ? '€9.99' : undefined }));
  const html = renderToStaticMarkup(<NewExperienceHomeContent recentGames={[]} products={products} catalogStatus="ready" retryCatalog={() => {}} go={() => {}} />);
  expect(html).not.toContain('Jump back in'); expect(html).not.toContain('Your next game'); expect(html).not.toContain('Recently added');
  expect(html.indexOf('>Featured<')).toBeLessThan(html.indexOf("What everyone&#x27;s playing"));
  expect(html).toContain('€9.99'); expect(html).toContain('Racing · Simulation'); expect(html).toContain('Returned 0');
  expect(html.match(/aria-label="Show featured page /g)).toHaveLength(3);
  expect(html).not.toContain('Play now'); expect(html).not.toContain('Launch'); expect(html).not.toContain('friends playing');
});

it('uses distinct pending, failed and empty catalog states while retaining recorded local games', () => {
  const recentGames = demoSnapshot().games.slice(0, 1);
  const render = (catalogStatus: 'loading' | 'error' | 'ready') => renderToStaticMarkup(<NewExperienceHomeContent recentGames={recentGames} products={[]} catalogStatus={catalogStatus} retryCatalog={() => {}} go={() => {}} />);
  expect(render('loading')).toContain('Loading featured games…'); expect(render('loading')).toContain(recentGames[0].title);
  expect(render('error')).toContain('Featured games could not be loaded.'); expect(render('error')).toContain('Try again'); expect(render('error')).toContain('Open library');
  expect(render('ready')).toContain('There are no featured games available right now.');
});

it('labels account-returned products by their real provenance instead of claiming they were recently added', () => {
  const html = renderToStaticMarkup(<NewExperienceHomeContent recentGames={[]} products={[]} catalogStatus="ready" retryCatalog={() => {}} gamePassProducts={[product('GP', 'Account Game')]}
    gamePassStatus="ready" retryGamePass={() => {}} go={() => {}} />);
  expect(html).toContain('Your Game Pass library'); expect(html).toContain('Account Game'); expect(html).not.toContain('Recently added'); expect(html).not.toContain('Owned');
});

it('never fetches an account library on sign-out or in-progress account transitions', async () => {
  for (const auth of [{ stored: false, running: false, note: '' }, { stored: true, running: true, note: '', username: 'previous@example.test' }]) {
    expect(newHomeAccountKey(auth)).toBeNull(); const app = homeHarness(auth); await app.flush();
    expect(app.featured).toHaveBeenCalledOnce(); expect(app.library).not.toHaveBeenCalled(); expect(app.props().gamePassProducts).toEqual([]); app.unmount();
  }
});

it('drops late previous-account responses and exposes only current Game Pass products rather than owned-only products', async () => {
  const old = deferred<AccountLibraryPage>(), current = deferred<AccountLibraryPage>();
  const library = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  const auth = { stored: true, running: false, note: '', username: 'first@example.test' };
  const app = homeHarness(auth, vi.fn(async () => catalog()), library);
  app.update({ ...auth, username: 'second@example.test' });
  old.resolve(account([{ ...product('OLD', 'Previous private game'), access: 'gamepass' }])); await app.flush();
  expect(app.props().gamePassProducts).toEqual([]);
  current.resolve(account([{ ...product('NEW', 'Current account game'), access: 'gamepass' }, { ...product('OWNED'), access: 'owned' }])); await app.flush();
  expect(app.props().gamePassProducts.map((value: CatalogProduct) => value.productId)).toEqual(['NEW']);
  app.update({ stored: false, running: false, note: '' }); expect(app.props().gamePassProducts).toEqual([]); expect(app.props().gamePassStatus).toBe('idle'); app.unmount();
});

it('does not display an old-market catalog result or apply a completion after unmount', async () => {
  const old = deferred<CatalogSearchResult>(), next = deferred<CatalogSearchResult>();
  const read = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
  const auth = { stored: false, running: false, note: '' }, app = homeHarness(auth, read);
  app.update(auth, 'GR'); old.resolve(catalog([product('OLD')])); await app.flush(); expect(app.props().products).toEqual([]);
  next.resolve({ ...catalog([product('NEW')]), market: 'GR' }); await app.flush(); expect(app.props().products.map((value: CatalogProduct) => value.productId)).toEqual(['NEW']);
  app.unmount(); expect(read).toHaveBeenCalledTimes(2);
});
