import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FriendsDock, FriendsDockSession, friendsDockAccountKey, validFriendsDockQuery, visibleFriendsDock } from './FriendsDock';
import type { XboxSocialResult } from '../shared/xbox-social';
import { demoSnapshot } from '../shared/demo-data';

const result = (label = 'Returned player'): XboxSocialResult => ({ status: 'ready', checkedAt: '2026-11-06T12:00:00Z', selfXuid: '99',
  capabilities: { friends: true, presence: true, inbox: true, conversation: true, send: true, search: true, partyVoice: false },
  friends: [{ xuid: '42', gamertag: label, presence: 'unknown' }] });
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture() {
  const bridge = { getXboxFriends: vi.fn(async (_refresh?: boolean) => result()), searchXboxPeople: vi.fn(async (_query: string) => result('Search player')) }, changed = vi.fn();
  const session = new FriendsDockSession(bridge, changed);
  return { bridge, changed, session };
}
afterEach(() => vi.unstubAllGlobals());

describe('Friends dock account and read lifecycle', () => {
  it('does not fetch during construction and coalesces roster reads while preserving the explicit refresh flag', async () => {
    const f = fixture(), pending = deferred<XboxSocialResult>();
    expect(f.bridge.getXboxFriends).not.toHaveBeenCalled();
    f.bridge.getXboxFriends.mockReturnValueOnce(pending.promise);
    const first = f.session.read(true), second = f.session.read();
    expect(first).toBe(second); expect(f.bridge.getXboxFriends).toHaveBeenCalledOnce(); expect(f.bridge.getXboxFriends).toHaveBeenCalledWith(true);
    pending.resolve(result()); await first;
    expect(f.session.current).toMatchObject({ status: 'ready', loading: false, friends: [{ xuid: '42', presence: 'unknown' }] });
    await f.session.read(); expect(f.bridge.getXboxFriends).toHaveBeenLastCalledWith(false);
  });
  it('discards late roster results after an account session is closed and clears its private state immediately', async () => {
    const f = fixture(), pending = deferred<XboxSocialResult>(); f.bridge.getXboxFriends.mockReturnValueOnce(pending.promise);
    const reading = f.session.read(); f.session.close(); const calls = f.changed.mock.calls.length;
    pending.resolve(result('Private old account')); await reading;
    expect(f.changed).toHaveBeenCalledTimes(calls); expect(f.session.current.friends).toEqual([]);
    await f.session.read(); expect(f.bridge.getXboxFriends).toHaveBeenCalledOnce();
  });
  it('discards late failures from a closed account rather than changing its replacement', async () => {
    const old = fixture(), next = fixture(), pending = deferred<XboxSocialResult>(); old.bridge.getXboxFriends.mockReturnValueOnce(pending.promise);
    const reading = old.session.read(); old.session.close(); await next.session.read(); const calls = old.changed.mock.calls.length;
    pending.reject(Error('PRIVATE account exception')); await reading;
    expect(old.changed).toHaveBeenCalledTimes(calls); expect(next.session.current.friends?.[0].gamertag).toBe('Returned player');
  });
  it('never exposes arbitrary service reasons or thrown errors in dock state', async () => {
    const f = fixture(); f.bridge.getXboxFriends.mockRejectedValueOnce(Error('PRIVATE_ACCESS_TOKEN'));
    await f.session.read(); expect(f.session.current.status).toBe('error'); expect(JSON.stringify(f.changed.mock.calls)).not.toContain('PRIVATE_ACCESS_TOKEN');
    f.bridge.getXboxFriends.mockResolvedValueOnce({ ...result(), status: 'error', reason: 'PRIVATE_RESPONSE', friends: undefined });
    await f.session.read(); expect(JSON.stringify(f.session.current)).not.toContain('PRIVATE_RESPONSE'); expect(f.session.current.friends).toEqual([]);
  });
  it('keeps unsupported or absent adapters unavailable without inferring people or presence', async () => {
    const changed = vi.fn(), absent = new FriendsDockSession(undefined, changed); await absent.read(); expect(absent.current).toMatchObject({ status: 'unsupported', presence: false, canSearch: false, friends: [] });
    const f = fixture(); f.bridge.getXboxFriends.mockResolvedValueOnce({ ...result(), status: 'unsupported', reason: 'untrusted detail' }); await f.session.read();
    expect(f.session.current).toMatchObject({ status: 'unsupported', friends: [], canChat: false, canSearch: false });
  });
  it('keeps presence capability distinct from people data instead of inferring online from sign-in', async () => {
    const f = fixture(); f.bridge.getXboxFriends.mockResolvedValueOnce({ ...result(), capabilities: { ...result().capabilities, presence: false, conversation: false } });
    await f.session.read(); expect(f.session.current.presence).toBe(false); expect(f.session.current.canChat).toBe(false); expect(f.session.current.friends[0].presence).toBe('unknown');
  });
});

describe('Friends dock people search', () => {
  it('uses the existing real search adapter only after verified capability data and a valid explicit query', async () => {
    const f = fixture(); await f.session.search('Player'); expect(f.bridge.searchXboxPeople).not.toHaveBeenCalled();
    await f.session.read();
    for (const query of ['', '  ', 'a'.repeat(65), 'bad\0value', 'bad\nvalue']) await f.session.search(query);
    expect(f.bridge.searchXboxPeople).not.toHaveBeenCalled(); await f.session.search('  Player  ');
    expect(f.bridge.searchXboxPeople).toHaveBeenCalledOnce(); expect(f.bridge.searchXboxPeople).toHaveBeenCalledWith('Player'); expect(f.session.current.search).toMatchObject({ query: 'Player', status: 'ready', friends: [{ gamertag: 'Search player' }] });
    expect(f.bridge).not.toHaveProperty('sendXboxMessage'); expect(f.bridge).not.toHaveProperty('changeXboxRelationship');
  });
  it('counts Unicode query characters and rejects control characters', () => {
    expect(validFriendsDockQuery('🎮'.repeat(64))).toBe(true); expect(validFriendsDockQuery('🎮'.repeat(65))).toBe(false);
    expect(validFriendsDockQuery(' Gamer tag ')).toBe(true); expect(validFriendsDockQuery('a\tb')).toBe(false);
  });
  it('ignores superseded results and a cleared search that completes later', async () => {
    const f = fixture(), first = deferred<XboxSocialResult>(), second = deferred<XboxSocialResult>(); await f.session.read();
    f.bridge.searchXboxPeople.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const a = f.session.search('Older'), b = f.session.search('Current'); second.resolve(result('Current player')); await b;
    first.resolve(result('Private stale result')); await a; expect(f.session.current.search?.friends[0].gamertag).toBe('Current player');
    const pending = deferred<XboxSocialResult>(); f.bridge.searchXboxPeople.mockReturnValueOnce(pending.promise);
    const cleared = f.session.search('Cancelled'); f.session.clearSearch(); pending.resolve(result('Cancelled result')); await cleared; expect(f.session.current.search).toBeUndefined();
  });
  it('discards a late search when the account closes and never retains private search failures', async () => {
    const f = fixture(), pending = deferred<XboxSocialResult>(); await f.session.read(); f.bridge.searchXboxPeople.mockReturnValueOnce(pending.promise);
    const searching = f.session.search('Player'); f.session.close(); const calls = f.changed.mock.calls.length;
    pending.reject(Error('PRIVATE search payload')); await searching; expect(f.changed).toHaveBeenCalledTimes(calls); expect(f.session.current.search).toBeUndefined();
    const next = fixture(); await next.session.read(); next.bridge.searchXboxPeople.mockRejectedValueOnce(Error('PRIVATE secret')); await next.session.search('Player');
    expect(next.session.current.search).toMatchObject({ status: 'error', friends: [] }); expect(JSON.stringify(next.changed.mock.calls)).not.toContain('PRIVATE');
  });
});

describe('Friends dock rendering and visibility', () => {
  it('replaces the private component identity immediately for every sign-in/account transition', () => {
    const auth = { ...demoSnapshot().auth, stored: true, username: 'Account A', running: false }, actions = { openFriends: vi.fn(), openAccount: vi.fn() };
    const initial = FriendsDock({ auth, ...actions });
    for (const patch of [{ stored: false }, { username: 'Account B' }, { running: true }]) expect(FriendsDock({ auth: { ...auth, ...patch }, ...actions }).key).not.toBe(initial.key);
    expect(friendsDockAccountKey({ ...auth, gamertag: 'Refreshed display name', note: 'New note' })).toBe(initial.key);
  });
  it('renders working routes and the honest voice limitation without starting private reads or showing a stale signed-out profile', () => {
    const reads = vi.fn(); vi.stubGlobal('window', { launcher: { getXboxFriends: reads, searchXboxPeople: reads } });
    const html = renderToStaticMarkup(<FriendsDock auth={{ ...demoSnapshot().auth, stored: false, gamertag: 'Private stale name' }} openFriends={() => {}} openAccount={() => {}} />);
    expect(html).toContain('aria-label="Friends"'); expect(html).toContain('Search or add friends'); expect(html).toContain('Open chats'); expect(html).toContain('Sign in to see your friends.');
    expect(html).toContain('Xbox party voice is not available in this version.'); expect(html).not.toContain('Private stale name'); expect(html).not.toContain('role="dialog"'); expect(reads).not.toHaveBeenCalled();
  });
  it('polls only visible noncollapsed dock layouts in a visible document', () => {
    const element = { getClientRects: () => [{}] } as unknown as HTMLElement;
    const doc = { visibilityState: 'visible', defaultView: { getComputedStyle: () => ({ display: 'flex', visibility: 'visible' }) } } as unknown as Document;
    expect(visibleFriendsDock(element, doc)).toBe(true); expect(visibleFriendsDock(null, doc)).toBe(false);
    expect(visibleFriendsDock(element, { ...doc, visibilityState: 'hidden' } as Document)).toBe(false);
    expect(visibleFriendsDock({ getClientRects: () => [] } as unknown as HTMLElement, doc)).toBe(false);
    expect(visibleFriendsDock(element, { ...doc, defaultView: { getComputedStyle: () => ({ display: 'none', visibility: 'visible' }) } } as unknown as Document)).toBe(false);
    expect(visibleFriendsDock(element, { ...doc, defaultView: { getComputedStyle: () => ({ display: 'flex', visibility: 'hidden' }) } } as unknown as Document)).toBe(false);
  });
});
