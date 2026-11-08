import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';
import * as jsxRuntime from 'react/jsx-runtime';
import * as icons from './XboxIcons';
import ts from 'typescript';
import type { AccountLibraryPage, AppSnapshot } from '../shared/types';
import { demoSnapshot } from '../shared/demo-data';
import * as gamePassLibrary from './gamepass-library';
import { parseXboxSelfProfileDetails } from '../shared/xbox-profile';
import { profileAccountKey, profileRecentGames } from './ProfilePage';

const deferred = <T,>() => { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return {promise, resolve, reject}; };
const page = (title: string, cursor?: string): AccountLibraryPage => ({kind: 'gamepass', products: [{productId: title, title, description: '', categories: ['Racing'], installability: 'unknown', supportNote: '', access: 'gamepass'}], accessByProductId: {[title]: 'gamepass'}, cursor, checkedAt: ''});
const signedIn = (): AppSnapshot => { const data = demoSnapshot(); data.auth = {stored: true, running: false, username: 'first@example.test', note: ''}; data.backend.capabilities.library = true; return data; };
const content = (value: any): string => Array.isArray(value) ? value.map(content).join(' ') : value == null || typeof value === 'boolean' ? '' : typeof value === 'object' ? content(value.props?.children) : String(value);
function nodes(value: any): any[] { return Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === 'object' ? [value, ...nodes(value.props?.children)] : []; }

/** Run the real component's hooks, effects and handlers without a host window,
 * real account or DOM dependency. Native service boundaries stay mocked. */
function harness(file: string, choose: (exports: any, props: any) => any, initialProps: any, launcher: any, extra: Record<string, unknown> = {}, attach?: (tree: any) => void) {
  let props = initialProps, cursor = 0, dirty = false, mounted = true, tree: any, afterUnmount = 0;
  const slots: any[] = [], effects: (() => void)[] = [];
  const same = (left?: unknown[], right?: unknown[]) => Boolean(left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index])));
  const hooks = {
    useState(initial: any) {
      const index = cursor++; if (slots[index] === undefined) slots[index] = {value: typeof initial === 'function' ? initial() : initial};
      return [slots[index].value, (next: any) => { if (!mounted) afterUnmount++; const value = typeof next === 'function' ? next(slots[index].value) : next; if (!Object.is(value, slots[index].value)) { slots[index].value = value; dirty = true; } }];
    },
    useRef(initial: unknown) { const index = cursor++; if (slots[index] === undefined) slots[index] = {value: {current: initial}}; return slots[index].value; },
    useEffect(callback: () => void | (() => void), deps: unknown[]) {
      const index = cursor++; if (same(slots[index]?.deps, deps)) return;
      const previous = slots[index]; slots[index] = {deps}; effects.push(() => { previous?.cleanup?.(); slots[index].cleanup = callback(); });
    },
  };
  const imports: Record<string, unknown> = {
    react: hooks, 'react/jsx-runtime': jsxRuntime, './XboxIcons': icons,
    './ReferenceLocale': {useReferenceLocale: () => ({text: (en: string) => en, language: 'en'})},
    './ReferenceMenu': {ReferenceMenu: () => null}, './gamepass-library': gamePassLibrary,
    './GamepadNavigation': {useBackHandler: () => {}}, './XboxSocialPanel': {}, './ConsoleLibrary': {},
    './SubscriptionBadge': {SubscriptionBadge: () => null}, '../shared/xbox-profile': {parseXboxSelfProfileDetails}, './account-menu-v2.css': {},
    './GamePassPage': {}, ...extra,
  };
  const exports: Record<string, any> = {};
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX}}).outputText;
  const fakeDocument = {activeElement: {isConnected: true, focus: vi.fn()}, querySelector: () => undefined};
  runInNewContext(code, {exports, require: (id: string) => { if (!(id in imports)) throw Error(`Unexpected import ${id}`); return imports[id]; }, window: {launcher, addEventListener: vi.fn(), removeEventListener: vi.fn()}, document: fakeDocument, localStorage: {getItem: () => null}});
  const render = () => {
    if (!mounted) return;
    let attempts = 0;
    do { dirty = false; cursor = 0; tree = choose(exports, props); attach?.(tree); effects.splice(0).forEach(effect => effect()); if (++attempts > 25) throw Error('Menu effects did not settle.'); } while (dirty);
  };
  render();
  return {tree: () => tree, text: () => content(tree), find: (label: string) => nodes(tree).find(node => node.type === 'button' && content(node).replace(/\s+/g, ' ').trim() === label),
    update(next: any) {props = next; render();}, render,
    async flush() {for (let i = 0; i < 10; i++) {await Promise.resolve(); render();}},
    unmount() { mounted = false; slots.forEach(slot => slot?.cleanup?.()); }, afterUnmount: () => afterUnmount,
  };
}

it('hides previous Game Pass cards immediately during account, market and authentication transitions', async () => {
  const first = deferred<AccountLibraryPage>(), second = deferred<AccountLibraryPage>(), third = deferred<AccountLibraryPage>();
  const read = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise);
  let data = signedIn(); const app = harness('./GamePassPage.tsx', (exports, props) => exports.GamePassPage(props), {data, go: vi.fn(), select: vi.fn()}, {getAccountLibrary: read});
  await Promise.resolve(); first.resolve(page('First private title')); await app.flush(); expect(app.text()).toContain('First private title');
  data = {...data, auth: {...data.auth, username: 'second@example.test'}}; app.update({data, go: vi.fn(), select: vi.fn()}); expect(app.text()).not.toContain('First private title');
  second.resolve(page('Second private title')); await app.flush(); expect(app.text()).toContain('Second private title');
  data = {...data, settings: {...data.settings, market: 'GR'}}; app.update({data, go: vi.fn(), select: vi.fn()}); expect(app.text()).not.toContain('Second private title');
  data = {...data, auth: {...data.auth, running: true}}; app.update({data, go: vi.fn(), select: vi.fn()}); third.resolve(page('Late old market title')); await app.flush();
  expect(app.text()).toContain('Checking your account'); expect(app.text()).not.toContain('Late old market title');
  app.unmount(); expect(app.afterUnmount()).toBe(0);
});

it('has explicit retry, genre filtering, details navigation and cursor continuation without launching a game', async () => {
  const read = vi.fn().mockRejectedValueOnce(Error('private service response')).mockResolvedValueOnce(page('First', 'next')).mockResolvedValueOnce({...page('Second'), accessByProductId: {First: 'gamepass', Second: 'gamepass'}});
  const select = vi.fn(), data = signedIn();
  const app = harness('./GamePassPage.tsx', (exports, props) => exports.GamePassPage(props), {data, go: vi.fn(), select}, {getAccountLibrary: read});
  await app.flush(); expect(app.text()).toContain('library could not be loaded'); expect(app.text()).not.toContain('private service response');
  app.find('Try again').props.onClick(); await app.flush();
  nodes(app.tree()).find(node => node.props?.className === 'home-product').props.onClick(); expect(select).toHaveBeenCalledWith(expect.objectContaining({productId: 'First'}));
  app.find('Load more').props.onClick(); await app.flush(); expect(app.text()).toContain('Second'); expect(read.mock.calls[2]).toEqual(['gamepass', 'next', false]);
  app.find('Pin a genre').props.onClick({currentTarget: {}}); app.render();
  const menu = nodes(app.tree()).find(node => node.props?.id === 'game-pass-genres'); menu.props.items[0].onSelect(); app.render(); expect(app.find('Racing')).toBeDefined();
  app.unmount();
});

it.each([false, null])('never requests private Game Pass data while auth.stored is %s', async stored => {
  const data = signedIn(); data.auth = {...data.auth, stored}; const read = vi.fn();
  const app = harness('./GamePassPage.tsx', (exports, props) => exports.GamePassPage(props), {data, go: vi.fn(), select: vi.fn()}, {getAccountLibrary: read}); await app.flush();
  expect(read).not.toHaveBeenCalled(); expect(app.text()).toContain(stored === null ? 'Checking your account' : 'Sign in'); app.unmount();
});

it('retains loaded Game Pass pages and genre on details Back without hidden reads or activation', async () => {
  const data = signedIn(), select = vi.fn(), go = vi.fn();
  const read = vi.fn().mockResolvedValueOnce(page('FIRST', 'next')).mockResolvedValueOnce({...page('SECOND'), accessByProductId: {FIRST: 'gamepass', SECOND: 'gamepass'}});
  const props = {data, select, go, active: true};
  const app = harness('./GamePassPage.tsx', (exports, value) => exports.GamePassPage(value), props, {getAccountLibrary: read}); await app.flush();
  app.find('Load more').props.onClick(); await app.flush(); app.find('Pin a genre').props.onClick({currentTarget: {}}); app.render();
  nodes(app.tree()).find(node => node.props?.id === 'game-pass-genres').props.items[0].onSelect(); app.render();
  const second = nodes(app.tree()).find(node => node.props?.className === 'home-product' && node.props['data-product-id'] === 'SECOND');
  app.update({...props, active: false}); second.props.onClick(); app.find('Refresh games').props.onClick(); await app.flush();
  expect(select).not.toHaveBeenCalled(); expect(read).toHaveBeenCalledTimes(2); expect(nodes(app.tree()).some(node => node.props?.id === 'game-pass-genres')).toBe(false);
  app.update(props); await app.flush(); expect(app.text()).toContain('SECOND'); expect(app.find('Racing')).toBeDefined(); expect(read).toHaveBeenCalledTimes(2);
  nodes(app.tree()).find(node => node.props?.className === 'home-product' && node.props['data-product-id'] === 'SECOND').props.onClick();
  expect(select).toHaveBeenCalledWith(expect.objectContaining({productId: 'SECOND'})); app.unmount();
});

it('discards a hidden pending initial response, restarts it on resume and invalidates cached accounts', async () => {
  const data = signedIn(), old = deferred<AccountLibraryPage>(), next = deferred<AccountLibraryPage>();
  const read = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce(page('CURRENT')).mockReturnValueOnce(next.promise);
  const props = {data, select: vi.fn(), go: vi.fn(), active: true};
  const app = harness('./GamePassPage.tsx', (exports, value) => exports.GamePassPage(value), props, {getAccountLibrary: read}); await Promise.resolve();
  app.update({...props, active: false}); old.resolve(page('ABANDONED')); await app.flush(); expect(app.text()).not.toContain('ABANDONED'); expect(read).toHaveBeenCalledOnce();
  app.update(props); await app.flush(); expect(app.text()).toContain('CURRENT'); expect(read).toHaveBeenCalledTimes(2);
  app.update({...props, active: false, data: {...data, auth: {...data.auth, username: 'second@example.test'}}}); await app.flush(); expect(app.text()).not.toContain('CURRENT'); expect(read).toHaveBeenCalledTimes(2);
  app.update(props); expect(app.text()).not.toContain('CURRENT'); await Promise.resolve(); expect(read).toHaveBeenCalledTimes(3);
  next.resolve(page('FRESH')); await app.flush(); expect(app.text()).toContain('FRESH'); app.unmount();
});

function accountHarness(launcher: any) {
  const close = vi.fn(), go = vi.fn(), settings = vi.fn(), remotePlay = vi.fn(); let back = () => false;
  const focus = {first: {focus: vi.fn()}, support: {focus: vi.fn()}, feedback: {focus: vi.fn()}};
  const root = {querySelector: (selector: string) => selector.includes('data-shell-action="support"') ? focus.support : selector.includes('data-shell-action="feedback"') ? focus.feedback : focus.first};
  const data = signedIn();
  const props = {panel: 'account', data, close, go, settings, remotePlay};
  const app = harness('./XboxShell.tsx', (exports, value) => {const element = exports.ShellFlyout(value); return element.type(element.props);}, props, launcher,
    {'./GamepadNavigation': {useBackHandler: (callback: () => boolean) => {back = callback;}}}, tree => {nodes(tree).find(node => node.props?.role === 'dialog').ref.current = root;});
  return {...app, close, go, settings, data, props, focus, back: () => {back(); app.render();}};
}

it.each(['support', 'feedback'] as const)('account %s Back restores the exact invoking action instead of the first menu row', kind => {
  const app = accountHarness({logout: vi.fn()}); const label = kind === 'support' ? 'Get help' : 'Give feedback';
  app.find(label).props.onClick(); app.render(); expect(app.text()).toContain(kind === 'support' ? 'How can we help' : 'Share feedback');
  app.back(); expect(app.find(label)).toBeDefined(); expect(app.focus[kind].focus).toHaveBeenCalledOnce(); expect(app.close).not.toHaveBeenCalled();
  app.back(); expect(app.close).toHaveBeenCalledOnce(); app.unmount();
});

it('serializes sign-out immediately, blocks navigation while pending, and closes only its own live surface', async () => {
  const result = deferred<void>(), logout = vi.fn(() => result.promise), app = accountHarness({logout});
  const button = app.find('Sign out'); button.props.onClick(); button.props.onClick(); app.find('Settings').props.onClick(); app.back();
  expect(logout).toHaveBeenCalledOnce(); expect(app.settings).not.toHaveBeenCalled(); expect(app.close).not.toHaveBeenCalled();
  app.update({...app.props, data: {...app.data, auth: {...app.data.auth, running: true}}}); app.find('Settings').props.onClick(); app.back();
  expect(app.settings).not.toHaveBeenCalled(); expect(app.close).not.toHaveBeenCalled();
  expect(app.text()).toContain('Signing out'); result.resolve(); await app.flush(); expect(app.close).toHaveBeenCalledOnce(); app.unmount();
});

it('drops a previous-account sign-out completion and never updates an unmounted menu', async () => {
  const result = deferred<void>(), logout = vi.fn(() => result.promise), app = accountHarness({logout});
  app.find('Sign out').props.onClick(); const next = {...app.data, auth: {...app.data.auth, username: 'second@example.test'}};
  app.update({...app.props, data: next}); result.reject(Error('private backend details')); await app.flush();
  expect(app.close).not.toHaveBeenCalled(); expect(app.text()).not.toContain('private backend details'); expect(app.text()).not.toContain('Sign out failed');
  const pending = deferred<void>(), later = accountHarness({logout: vi.fn(() => pending.promise)}); later.find('Sign out').props.onClick(); later.unmount(); pending.resolve(); await later.flush();
  expect(later.close).not.toHaveBeenCalled(); expect(later.afterUnmount()).toBe(0); app.unmount();
});

it('shows a bounded sign-out failure and permits an explicit retry', async () => {
  const logout = vi.fn().mockRejectedValueOnce(Error('sensitive provider payload')).mockResolvedValueOnce(undefined), app = accountHarness({logout});
  app.find('Sign out').props.onClick(); await app.flush(); expect(app.text()).toContain('Sign out failed. Try again.'); expect(app.text()).not.toContain('sensitive provider payload');
  app.find('Sign out').props.onClick(); await app.flush(); expect(logout).toHaveBeenCalledTimes(2); expect(app.close).toHaveBeenCalledOnce(); app.unmount();
});

it('keeps profile ownership when username is absent and rejects unknown/nonpositive recent-play records', () => {
  const auth = {stored: true, running: false, note: '', gamertag: 'ReturnedTag'};
  expect(profileAccountKey(auth)).toBeDefined(); expect(profileAccountKey({...auth, gamertag: 'AnotherTag'})).not.toBe(profileAccountKey(auth)); expect(profileAccountKey({...auth, running: true})).toBeUndefined();
  expect(profileAccountKey({stored: true, running: false, note: ''})).toBeUndefined();
  const games = demoSnapshot().games; const history = {[games[0].id]: 10, [games[1].id]: 20, [games[2].id]: 0, [games[3].id]: -1};
  expect(profileRecentGames([...games, games[0]], history).map(game => game.id)).toEqual([games[1].id, games[0].id]);
});
