import type { GamePassSubscription } from './types.js';

/** Optional fields are supplied by the profile provider, never inferred from
 * email, installed games, social presence or a subscription product. */
export interface XboxSelfProfileDetails {
  gamerscore?: number;
  bio?: string;
  location?: string;
  realName?: string;
  modernGamertag?: string;
  uniqueModernGamertag?: string;
  modernGamertagSuffix?: string;
  gameDisplayName?: string;
  appDisplayName?: string;
  tenureLevel?: number;
  /** Legacy Xbox account tier; this is not a Game Pass membership. */
  accountTier?: string;
}

export interface XboxSelfProfile extends XboxSelfProfileDetails {
  gamertag: string;
  avatarDataUrl?: string;
  subscription?: GamePassSubscription;
  /** Time this launcher successfully received the profile, absent in old caches. */
  checkedAt?: string;
}

function text(value: unknown, limit: number, multiline = false): string | undefined {
  if (typeof value !== 'string' || value.length > limit
    || (multiline ? /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/ : /[\x00-\x1f\x7f]/).test(value)) return;
  return value.trim() || undefined;
}
function uint32(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value
    : typeof value === 'string' && /^\d{1,10}$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(number) && number >= 0 && number <= 0xffff_ffff ? number : undefined;
}

/** Discard malformed/unknown optional data without losing a valid identity. */
export function parseXboxSelfProfileDetails(value: unknown): XboxSelfProfileDetails {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const data = value as Record<string, unknown>;
  const result: XboxSelfProfileDetails = {};
  for (const field of ['gamerscore', 'tenureLevel'] as const) {
    const parsed = uint32(data[field]);
    if (parsed !== undefined) result[field] = parsed;
  }
  for (const field of ['realName', 'modernGamertag', 'uniqueModernGamertag', 'gameDisplayName', 'appDisplayName'] as const) {
    const parsed = text(data[field], 256);
    if (parsed !== undefined) result[field] = parsed;
  }
  for (const [field, limit, multiline] of [['bio', 4096, true], ['location', 256, false], ['accountTier', 64, false]] as const) {
    const parsed = text(data[field], limit, multiline);
    if (parsed !== undefined) result[field] = parsed;
  }
  if (typeof data.modernGamertagSuffix === 'string' && /^\d{1,16}$/.test(data.modernGamertagSuffix)) result.modernGamertagSuffix = data.modernGamertagSuffix;
  return result;
}

export function profileCheckedAt(value: unknown, now = Date.now()): string | undefined {
  if (typeof value !== 'string' || value.length > 40 || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return;
  const timestamp = Date.parse(value);
  if (Number.isFinite(timestamp) && timestamp >= 0 && timestamp <= now + 300_000) return new Date(timestamp).toISOString();
}
