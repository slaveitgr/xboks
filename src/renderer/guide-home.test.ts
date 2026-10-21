import { describe, expect, it } from 'vitest';
import { demoSnapshot } from '../shared/demo-data';
import { guideHistoryKey, recentGuideGames } from './guide-home';

describe('Game Bar account-scoped recent games', () => {
  const games = Array.from({ length: 6 }, (_, index) => ({ ...demoSnapshot().games[0], id: `game-${index}`, addedAt: new Date(10000 + index).toISOString() }));
  it('does not present the installed library or addedAt order as play history', () => {
    expect(recentGuideGames(games, {})).toEqual([]);
  });
  it('uses only actual matching IDs, ordered by the newest valid play timestamps, capped at four', () => {
    const history = { 'game-0': 100, 'game-1': 600, 'game-2': 500, 'game-3': 200, 'game-4': 400, 'game-5': 300, 'removed-game': 1000 };
    expect(recentGuideGames(games, history, 1000).map(game => game.id)).toEqual(['game-1', 'game-2', 'game-4', 'game-5']);
    expect(games.map(game => game.id)).toEqual(['game-0', 'game-1', 'game-2', 'game-3', 'game-4', 'game-5']);
  });
  it('ignores corrupt, missing, non-date and future timestamps', () => {
    expect(recentGuideGames(games, { 'game-0': NaN, 'game-1': Infinity, 'game-2': 0, 'game-3': -1, 'game-4': '500', 'game-5': 1001 }, 1000)).toEqual([]);
  });
  it('keeps separate exact credential identities and ignores display-name changes', () => {
    const auth = { ...demoSnapshot().auth, stored: true, running: false, username: 'one@example.test' };
    expect(guideHistoryKey(auth)).toBe(guideHistoryKey({ ...auth, gamertag: 'NewDisplayName' }));
    expect(guideHistoryKey(auth)).not.toBe(guideHistoryKey({ ...auth, username: 'two@example.test' }));
  });
  it('does not read private MRU for signed-out, unknown or changing accounts or a gamertag-only identity', () => {
    const auth = demoSnapshot().auth;
    for (const patch of [{ stored: false }, { stored: null }, { running: true }, { username: undefined, gamertag: 'OldDisplayName' }])
      expect(guideHistoryKey({ ...auth, ...patch })).toBeUndefined();
  });
});
