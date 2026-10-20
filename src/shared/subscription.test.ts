import { expect, it } from 'vitest';
import { parseSubscription, subscriptionBadge } from './subscription';

const active = (productIds: string[]) => ({ status: 'active', productIds, checkedAt: new Date().toISOString() });
it('labels actual supported tiers, preferring Ultimate and PC access', () => {
  expect(subscriptionBadge(active(['CFQ7TTC0KGQ8']))).toBe('PC GAME PASS');
  expect(subscriptionBadge(active(['CFQ7TTC0K5DJ', 'CFQ7TTC0KGQ8', 'CFQ7TTC0KHS0']))).toBe('ULTIMATE');
  expect(subscriptionBadge(active(['CFQ7TTC0P85B']))).toBe('PREMIUM');
  expect(subscriptionBadge(active(['CFQ7TTC0K5DJ']))).toBe('ESSENTIAL');
});
it('never treats unknown, absent, stale, malformed or future records as active', () => {
  const pc = active(['CFQ7TTC0KGQ8']);
  for (const v of [undefined, {}, active(['invalid']), { ...pc, status: 'unknown' },
    { ...pc, checkedAt: 'bad' }, { ...pc, checkedAt: new Date(Date.now() - 86_400_001).toISOString() },
    { ...pc, checkedAt: new Date(Date.now() + 600_000).toISOString() }]) expect(subscriptionBadge(v)).toBeUndefined();
  expect(parseSubscription({ status: 'none', productIds: [], checkedAt: pc.checkedAt })?.status).toBe('none');
});
