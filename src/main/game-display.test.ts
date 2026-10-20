import { describe, expect, it, vi } from 'vitest';
import { GameDisplayBlocker } from './game-display.js';

describe('game display-sleep inhibition', () => {
  it('has no side effects until a game starts, including valid zero blocker IDs', () => {
    const start = vi.fn(() => 0), stop = vi.fn(() => true);
    const game = new GameDisplayBlocker({ start, stop });
    expect(start).not.toHaveBeenCalled();
    const release = game.acquire();
    expect(start).toHaveBeenCalledWith('prevent-display-sleep'); expect(stop).not.toHaveBeenCalled();
    release(); release(); game.stop(); expect(stop.mock.calls).toEqual([[0]]);
  });
  it('releases all outstanding games on shutdown without stopping another game twice', () => {
    let serial = 0;
    const start = vi.fn(() => ++serial), stop = vi.fn(() => true);
    const game = new GameDisplayBlocker({ start, stop });
    const first = game.acquire(), second = game.acquire(); first(); game.stop(); second(); game.stop();
    expect(stop.mock.calls).toEqual([[1], [2]]);
  });
  it('does not turn missing power-management support into a game launch failure', () => {
    const warn = vi.fn(), stop = vi.fn(() => true);
    const game = new GameDisplayBlocker({ start: () => { throw Error('unavailable'); }, stop }, warn);
    const release = game.acquire(); release(); game.stop();
    expect(warn).toHaveBeenCalledOnce(); expect(stop).not.toHaveBeenCalled();
  });
  it('cleans up its own lifecycle even if releasing the desktop inhibitor fails', () => {
    const warn = vi.fn(), stop = vi.fn(() => { throw Error('session ended'); });
    const game = new GameDisplayBlocker({ start: () => 3, stop }, warn);
    const release = game.acquire(); release(); game.stop();
    expect(stop).toHaveBeenCalledOnce(); expect(warn).toHaveBeenCalledOnce();
  });
});
