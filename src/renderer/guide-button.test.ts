import { describe, expect, it } from 'vitest';
import { GuideButtonFallback } from './guide-button';

describe('browser Guide button fallback ownership', () => {
  it('opens exactly once for each neutral-to-pressed edge', () => {
    const input = new GuideButtonFallback();
    expect(input.poll(false, true, true, undefined)).toBe(false);
    expect(input.poll(true, true, true, undefined)).toBe(true);
    expect(input.poll(true, true, true, undefined)).toBe(false);
    expect(input.poll(false, true, true, undefined)).toBe(false);
    expect(input.poll(true, true, true, undefined)).toBe(true);
  });

  it('never toggles beside an admitted native listener', () => {
    const input = new GuideButtonFallback(), native = { status: 'listening', devices: 1 } as const;
    input.poll(false, true, true, undefined);
    for (const pressed of [true, false, true, true]) expect(input.poll(pressed, true, true, native)).toBe(false);
    // Losing native ownership while the button is held must not replay it.
    expect(input.poll(true, true, true, { status: 'unavailable', devices: 0 })).toBe(false);
    input.poll(false, true, true, undefined);
    expect(input.poll(true, true, true, undefined)).toBe(true);
  });

  it.each(['unavailable', 'error', 'stopped', 'listening'] as const)('retains focused fallback without admitted devices (%s)', status => {
    const input = new GuideButtonFallback(), state = { status, devices: 0 };
    input.poll(false, true, true, state);
    expect(input.poll(true, true, true, state)).toBe(true);
  });

  it.each([{ status: 'starting', devices: 0 }, { status: 'unavailable', devices: 0, reason: 'session-blocked' }] as const)('never bypasses native startup or session blocking (%j)', state => {
    const input = new GuideButtonFallback();
    input.poll(false, true, true, undefined);
    expect(input.poll(true, true, true, state)).toBe(false);
    expect(input.poll(true, true, true, undefined)).toBe(false);
  });

  it.each([[false, true], [true, false], [false, false]])('does not react in a background or hidden document (focus=%s visible=%s)', (focused, visible) => {
    const input = new GuideButtonFallback();
    input.poll(false, true, true, undefined);
    expect(input.poll(true, focused, visible, undefined)).toBe(false);
    expect(input.poll(true, true, true, undefined)).toBe(false);
    input.poll(false, true, true, undefined);
    expect(input.poll(true, true, true, undefined)).toBe(true);
  });

  it('does not replay a button already held when the renderer mounts', () => {
    const input = new GuideButtonFallback();
    expect(input.poll(true, true, true, undefined)).toBe(false);
    expect(input.poll(true, true, true, undefined)).toBe(false);
    input.poll(false, true, true, undefined);
    expect(input.poll(true, true, true, undefined)).toBe(true);
  });
});
