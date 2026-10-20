import { describe, expect, it } from 'vitest';
import { guideAudio, parseGuideVolume } from './guide-audio';
describe('Game Bar system audio', () => {
  it('reads real wpctl responses and preserves mute state', () => {
    expect(parseGuideVolume('Volume: 0.61\n')).toEqual({ available: true, volume: 61, muted: false });
    expect(parseGuideVolume('Volume: 0.87 [MUTED]\n')).toEqual({ available: true, volume: 87, muted: true });
    expect(parseGuideVolume('Volume: 1.50')).toEqual({ available: true, volume: 100, muted: false });
  });
  it('does not invent a volume for malformed service output', () => {
    expect(parseGuideVolume('connection failed').available).toBe(false);
    expect(parseGuideVolume('Volume: NaN').available).toBe(false);
    expect(parseGuideVolume('Volume: 0.5 unexpected').available).toBe(false);
  });
  it('rejects invalid control values before invoking a system command', async () => {
    for (const volume of [-1, 101, NaN, Infinity]) await expect(guideAudio({ volume })).rejects.toThrow('Volume must');
    await expect(guideAudio({ muted: 'yes' as unknown as boolean })).rejects.toThrow('Invalid mute');
  });
});
