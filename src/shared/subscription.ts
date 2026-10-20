import type { GamePassSubscription } from './types.js';

const labels: Record<string, string> = {
  CFQ7TTC0KHS0: 'ULTIMATE', CFQ7TTC0KGQ8: 'PC GAME PASS',
  CFQ7TTC0P85B: 'PREMIUM', CFQ7TTC0K5DJ: 'ESSENTIAL', CFQ7TTC0K6L8: 'GAME PASS CONSOLE',
};

export function parseSubscription(value: unknown, now = Date.now()): GamePassSubscription | undefined {
  if (!value || typeof value !== 'object') return;
  const data = value as Partial<GamePassSubscription>;
  if (!['active', 'none', 'unknown'].includes(data.status ?? '') || typeof data.checkedAt !== 'string'
    || !Array.isArray(data.productIds) || data.productIds.length > 5
    || !data.productIds.every(id => typeof id === 'string' && Object.hasOwn(labels, id))) return;
  const age = now - Date.parse(data.checkedAt);
  if (!Number.isFinite(age) || age < -300_000 || age >= 86_400_000) return;
  if ((data.status === 'active') !== (data.productIds.length > 0)) return;
  return { status: data.status as GamePassSubscription['status'], productIds: [...new Set(data.productIds)], checkedAt: data.checkedAt };
}

export function subscriptionBadge(value: unknown): string | undefined {
  const subscription = parseSubscription(value);
  if (subscription?.status !== 'active') return;
  return Object.keys(labels).filter(id => subscription.productIds.includes(id)).map(id => labels[id])[0];
}
