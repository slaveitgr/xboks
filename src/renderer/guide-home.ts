import type { AppSnapshot, Game } from '../shared/types';
import { collectionKey } from './LibraryChrome';

/** Private history belongs to the current authenticated credential identity,
 * never to a stale display name or a different local account fallback. */
export function guideHistoryKey(auth: AppSnapshot['auth']): string | undefined {
  return auth.stored === true && !auth.running && typeof auth.username === 'string' &&
    auth.username.trim() && auth.username.length <= 320 && !/[\x00-\x1f\x7f]/.test(auth.username)
    ? collectionKey(auth) : undefined;
}

export function recentGuideGames(games: readonly Game[], history: Readonly<Record<string, unknown>>, now = Date.now()): Game[] {
  return games.flatMap(game => {
    const played = history[game.id];
    return typeof played === 'number' && Number.isFinite(played) && played > 0 && played <= now
      ? [{ game, played }] : [];
  }).sort((a, b) => b.played - a.played).slice(0, 4).map(item => item.game);
}
