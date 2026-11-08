import { expect, it, vi } from 'vitest';
import type { AccountLibraryPage, CatalogProduct } from '../shared/types';
import { demoSnapshot } from '../shared/demo-data';
import { createGamePassLibraryLoader, gamePassLibraryScope, type GamePassLibraryState } from './gamepass-library';

const product = (id: string): CatalogProduct & {access: 'gamepass'} => ({productId: id, title: id, description: '', categories: [], installability: 'unknown', supportNote: '', access: 'gamepass'});
const page = (ids: string[], cursor?: string, all = ids): AccountLibraryPage => ({kind: 'gamepass', products: ids.map(product), accessByProductId: Object.fromEntries(all.map(id => [id, 'gamepass'])), checkedAt: '', cursor});
const deferred = <T,>() => { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return {promise, resolve, reject}; };

it('binds Game Pass reads to account, market and backend rather than the signed-in boolean', () => {
  const data = demoSnapshot(); data.auth = {stored: true, running: false, note: '', username: 'first@example.test'};
  const first = gamePassLibraryScope(data); expect(first).not.toBeNull();
  for (const update of [
    {...data, auth: {...data.auth, username: 'second@example.test'}},
    {...data, settings: {...data.settings, market: 'GR'}},
    {...data, backend: {...data.backend, binaryPath: '/new/engine'}},
  ]) expect(gamePassLibraryScope(update)).not.toBe(first);
  for (const auth of [{...data.auth, running: true}, {...data.auth, stored: false}, {...data.auth, stored: null}]) expect(gamePassLibraryScope({...data, auth})).toBeNull();
  expect(gamePassLibraryScope({...data, auth: {stored: true, running: false, note: ''}})).toBeNull();
});

it('serializes page requests and uses the actual next cursor without repeating products', async () => {
  const next = deferred<AccountLibraryPage>(), read = vi.fn().mockResolvedValueOnce(page(['FIRST'], 'next')).mockReturnValueOnce(next.promise);
  let state!: GamePassLibraryState; const loader = createGamePassLibraryLoader({getAccountLibrary: read}, value => state = value);
  await loader.load(); const one = loader.more(), two = loader.more();
  await Promise.resolve(); expect(read).toHaveBeenCalledTimes(2); expect(one).toBe(two); expect(state.loadingMore).toBe(true);
  next.resolve(page(['FIRST', 'SECOND'], undefined, ['FIRST', 'SECOND'])); await one;
  expect(read.mock.calls).toEqual([['gamepass', undefined, false], ['gamepass', 'next', false]]);
  expect(state.result?.products.map(product => product.productId)).toEqual(['FIRST', 'SECOND']); expect(state.result?.cursor).toBeUndefined();
  await loader.more(); expect(read).toHaveBeenCalledTimes(2);
});

it('retains the current page on continuation failure and retries exactly that page', async () => {
  const read = vi.fn().mockResolvedValueOnce(page(['FIRST'], 'next')).mockRejectedValueOnce(Error('private provider detail')).mockResolvedValueOnce(page(['SECOND'], undefined, ['FIRST', 'SECOND']));
  let state!: GamePassLibraryState; const loader = createGamePassLibraryLoader({getAccountLibrary: read}, value => state = value);
  await loader.load(); await loader.more(); expect(state).toMatchObject({status: 'error', failedMore: true}); expect(state.result?.products[0].title).toBe('FIRST');
  expect(JSON.stringify(state)).not.toContain('private provider detail'); await loader.retry();
  expect(read.mock.calls[2]).toEqual(['gamepass', 'next', false]); expect(state.status).toBe('ready'); expect(state.result?.products).toHaveLength(2);
});

it('rejects repeated or cyclic cursors while preserving the last accepted products', async () => {
  const read = vi.fn().mockResolvedValueOnce(page(['FIRST'], 'next')).mockResolvedValueOnce(page(['SECOND'], 'next', ['FIRST', 'SECOND']));
  let state!: GamePassLibraryState; const loader = createGamePassLibraryLoader({getAccountLibrary: read}, value => state = value);
  await loader.load(); await loader.more(); expect(state.status).toBe('error'); expect(state.result?.products.map(product => product.productId)).toEqual(['FIRST']);
  read.mockResolvedValueOnce(page(['SECOND'], 'third', ['FIRST', 'SECOND'])); await loader.retry();
  read.mockResolvedValueOnce(page(['THIRD'], 'next', ['FIRST', 'SECOND', 'THIRD'])); await loader.more();
  expect(state.status).toBe('error'); expect(state.result?.products.map(product => product.productId)).toEqual(['FIRST', 'SECOND']);
});

it('does not keep revoked licenses or owned-only entries in the Game Pass list', async () => {
  const owned = {...product('OWNED'), access: 'owned'};
  const read = vi.fn().mockResolvedValueOnce(page(['REVOKED', 'KEPT'], 'next')).mockResolvedValueOnce({...page(['NEW'], undefined, ['KEPT', 'NEW']), products: [product('NEW'), owned], accessByProductId: {KEPT: 'gamepass', NEW: 'gamepass', OWNED: 'owned'}});
  let state!: GamePassLibraryState; const loader = createGamePassLibraryLoader({getAccountLibrary: read}, value => state = value);
  await loader.load(); await loader.more(); expect(state.result?.products.map(product => product.productId)).toEqual(['KEPT', 'NEW']);
});

it('refreshes licenses explicitly and starts again from the first page', async () => {
  const read = vi.fn().mockResolvedValueOnce(page(['OLD'], 'next')).mockResolvedValueOnce(page(['FRESH']));
  let state!: GamePassLibraryState; const loader = createGamePassLibraryLoader({getAccountLibrary: read}, value => state = value);
  await loader.load(); await loader.refresh(); expect(read.mock.calls[1]).toEqual(['gamepass', undefined, true]);
  expect(state.result?.products.map(product => product.productId)).toEqual(['FRESH']);
});

it('discards a late previous-owner response and starts no queued read after disposal', async () => {
  const old = deferred<AccountLibraryPage>(), read = vi.fn(() => old.promise), changed = vi.fn();
  const loader = createGamePassLibraryLoader({getAccountLibrary: read}, changed), result = loader.load(); await Promise.resolve();
  loader.dispose(); old.resolve(page(['OLD'])); await result;
  expect(changed.mock.calls).toEqual([[{status: 'loading'}]]);
  const never = createGamePassLibraryLoader({getAccountLibrary: read}, changed), queued = never.load(); never.dispose(); await queued;
  expect(read).toHaveBeenCalledOnce();
});

it.each(['owned', 'all'])('rejects a response belonging to %s rather than Game Pass', async kind => {
  const read = vi.fn(async () => ({...page(['WRONG']), kind} as AccountLibraryPage));
  let state!: GamePassLibraryState; const loader = createGamePassLibraryLoader({getAccountLibrary: read}, value => state = value);
  await loader.load(); expect(state).toEqual({status: 'error'});
});

it('resumes only accepted rows and preserves consumed cursor protection across a paused read', async () => {
  const abandoned = deferred<AccountLibraryPage>();
  const read = vi.fn().mockResolvedValueOnce(page(['FIRST'], 'next')).mockResolvedValueOnce(page(['SECOND'], 'third', ['FIRST', 'SECOND'])).mockReturnValueOnce(abandoned.promise);
  let state!: GamePassLibraryState; const loader = createGamePassLibraryLoader({getAccountLibrary: read}, value => state = value);
  await loader.load(); await loader.more(); const pending = loader.more(); await Promise.resolve();
  const snapshot = loader.snapshot(); expect(snapshot?.state.loadingMore).toBeUndefined(); expect(snapshot?.consumedCursors).toEqual(['next']); loader.dispose();
  abandoned.resolve(page(['ABANDONED'], undefined, ['FIRST', 'SECOND', 'ABANDONED'])); await pending;
  const resumedRead = vi.fn(async () => page(['CYCLE'], 'next', ['FIRST', 'SECOND', 'CYCLE']));
  const resumed = createGamePassLibraryLoader({getAccountLibrary: resumedRead}, value => state = value, snapshot); await resumed.more();
  expect(resumedRead.mock.calls[0]).toEqual(['gamepass', 'third', false]); expect(state.status).toBe('error');
  expect(state.result?.products.map(product => product.productId)).toEqual(['FIRST', 'SECOND']);
});

it('starts a new cursor history only after accepting a refreshed first page following pagination and resume', async () => {
  const originalRead = vi.fn().mockResolvedValueOnce(page(['FIRST'], 'next')).mockResolvedValueOnce(page(['SECOND'], 'third', ['FIRST', 'SECOND']));
  const original = createGamePassLibraryLoader({getAccountLibrary: originalRead}, () => {});
  await original.load(); await original.more(); const snapshot = original.snapshot(); original.dispose();
  expect(snapshot?.consumedCursors).toEqual(['next']);
  const read = vi.fn().mockResolvedValueOnce({...page(['WRONG'], 'next'), kind: 'owned'})
    .mockResolvedValueOnce(page(['FRESH'], 'next'))
    .mockResolvedValueOnce(page(['NEWSECOND'], 'third', ['FRESH', 'NEWSECOND']))
    .mockResolvedValueOnce(page(['CYCLE'], 'next', ['FRESH', 'NEWSECOND', 'CYCLE']));
  let state!: GamePassLibraryState; const resumed = createGamePassLibraryLoader({getAccountLibrary: read}, value => state = value, snapshot);
  await resumed.refresh(); expect(state.status).toBe('error'); expect(resumed.snapshot()?.consumedCursors).toEqual(['next']);
  await resumed.refresh(); expect(state.status).toBe('ready'); expect(state.result?.products.map(product => product.productId)).toEqual(['FRESH']);
  expect(read.mock.calls.slice(0, 2)).toEqual([['gamepass', undefined, true], ['gamepass', undefined, true]]);
  expect(resumed.snapshot()?.consumedCursors).toEqual([]);
  await resumed.more(); expect(state.status).toBe('ready'); expect(state.result?.products.map(product => product.productId)).toEqual(['FRESH', 'NEWSECOND']);
  await resumed.more(); expect(state.status).toBe('error'); expect(state.failedMore).toBe(true);
  expect(state.result?.products.map(product => product.productId)).toEqual(['FRESH', 'NEWSECOND']);
});
