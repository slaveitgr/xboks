import type { AccountLibraryPage, AppSnapshot, LauncherApi } from '../shared/types';

export type GamePassLibraryState = {
  status: 'loading' | 'ready' | 'error';
  result?: AccountLibraryPage;
  loadingMore?: boolean;
  failedMore?: boolean;
};
export interface GamePassLibrarySnapshot {
  state: GamePassLibraryState;
  consumedCursors: string[];
}

/** A signed-in boolean does not identify the account that owns a response. */
export function gamePassLibraryScope(data: AppSnapshot): string | null {
  return data.auth.stored === true && !data.auth.running && Boolean(data.auth.username || data.auth.gamertag)
    ? JSON.stringify([data.auth.username ?? null, data.auth.gamertag ?? null, data.settings.market,
      data.backend.binaryPath ?? null, data.backend.commit ?? null]) : null;
}

export function createGamePassLibraryLoader(
  bridge: Pick<LauncherApi, 'getAccountLibrary'>,
  changed: (state: GamePassLibraryState) => void,
  seed?: GamePassLibrarySnapshot,
) {
  let disposed = false;
  let state: GamePassLibraryState = seed?.state ?? { status: 'loading' };
  let settled = seed?.state;
  let pending: Promise<void> | undefined;
  const consumed = new Set(seed?.consumedCursors);
  const publish = (next: GamePassLibraryState) => {
    if (disposed) return;
    state = next;
    if (next.status !== 'loading' && !next.loadingMore) settled = next;
    changed(next);
  };
  function load(more = false, refresh = false): Promise<void> {
    if (disposed) return Promise.resolve();
    if (pending) return pending;
    const previous = more ? state.result : undefined, cursor = previous?.cursor;
    if (more && !cursor) return Promise.resolve();
    publish(previous ? { status: 'ready', result: previous, loadingMore: true } : { status: 'loading' });
    pending = Promise.resolve().then(() => disposed ? undefined : bridge.getAccountLibrary('gamepass', cursor, refresh)).then(page => {
      if (disposed) return;
      if (!page || page.kind !== 'gamepass' || !Array.isArray(page.products) ||
        !page.accessByProductId || typeof page.accessByProductId !== 'object' || Array.isArray(page.accessByProductId) ||
        page.cursor !== undefined && (typeof page.cursor !== 'string' || !page.cursor || page.cursor.length > 512 || /[\x00-\x20\x7f]/.test(page.cursor))) {
        throw Error('Invalid Game Pass library response.');
      }
      if (more && page.cursor && (page.cursor === cursor || consumed.has(page.cursor))) throw Error('Game Pass pagination did not advance.');
      const byId = new Map([...(previous?.products ?? []), ...page.products].map(product => [product.productId.toUpperCase(), product]));
      const products = [...byId.values()].filter(product => product.access === 'gamepass' && page.accessByProductId[product.productId] === 'gamepass');
      if (cursor) consumed.add(cursor); else consumed.clear();
      publish({ status: 'ready', result: { ...page, products } });
    }).catch(() => { publish(previous ? { status: 'error', result: previous, failedMore: true } : { status: 'error' }); })
      .finally(() => { pending = undefined; });
    return pending;
  }
  return {
    load: () => load(),
    refresh: () => load(false, true),
    more: () => load(true),
    retry: () => load(Boolean(state.failedMore)),
    snapshot: (): GamePassLibrarySnapshot | undefined => settled ? {state: settled, consumedCursors: [...consumed]} : undefined,
    dispose() { disposed = true; },
  };
}
