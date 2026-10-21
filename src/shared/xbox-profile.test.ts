import { expect, it } from 'vitest';
import { parseXboxSelfProfileDetails, profileCheckedAt } from './xbox-profile';

it('exposes only bounded provider profile details, including an actual zero gamerscore', () => {
  expect(parseXboxSelfProfileDetails({ gamerscore: '0', tenureLevel: 12, bio: ' First line\nSecond line ', location: ' Example place ',
    realName: 'Example Name', modernGamertag: 'Example', uniqueModernGamertag: 'Example#1234', modernGamertagSuffix: '1234',
    gameDisplayName: 'Game name', appDisplayName: 'App name', accountTier: 'Gold', followers: 999, email: 'private@example.test', token: 'secret' }))
    .toEqual({ gamerscore: 0, tenureLevel: 12, bio: 'First line\nSecond line', location: 'Example place', realName: 'Example Name',
      modernGamertag: 'Example', uniqueModernGamertag: 'Example#1234', modernGamertagSuffix: '1234', gameDisplayName: 'Game name', appDisplayName: 'App name', accountTier: 'Gold' });
});

it('omits absent, malformed, oversized or unknown fields without inventing profile or membership data', () => {
  for (const value of [undefined, null, [], {}, { gamerscore: -1, tenureLevel: 0x1_0000_0000, bio: 'bad\0text', location: 'bad\nplace',
    realName: 'x'.repeat(257), modernGamertagSuffix: 'not-a-suffix', accountTier: 'x'.repeat(65) }, { gamerscore: '1e3', tenureLevel: 1.5, bio: 'x'.repeat(4097) }]) {
    expect(parseXboxSelfProfileDetails(value)).toEqual({});
  }
  expect(parseXboxSelfProfileDetails({ gamerscore: '4294967295', accountTier: 'Gold' })).toEqual({ gamerscore: 4294967295, accountTier: 'Gold' });
  expect(parseXboxSelfProfileDetails({ accountTier: 'Gold' })).not.toHaveProperty('subscription');
});

it('retains genuine cache timestamps without refreshing their age or accepting future/malformed dates', () => {
  const now = Date.parse('2026-10-21T12:00:00Z');
  expect(profileCheckedAt('2026-10-20T12:00:00+00:00', now)).toBe('2026-10-20T12:00:00.000Z');
  for (const value of [undefined, 'bad', '4', '2026-10-22T12:00:00Z']) expect(profileCheckedAt(value, now)).toBeUndefined();
});
