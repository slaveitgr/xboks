import type { AuthStatus } from './types.js';
export interface StoreAccountIdentity {
  account: string;
  username: string;
  source: 'backend-store-account';
  checkedAt: string;
}
const identityName = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 320 && !/[\x00-\x1f\x7f]/.test(value);
/** Optional future backend response. Never infer Store identity from Xbox credentials.
 * A record is bound to the current keychain account and must be recently checked. */
export function readStoreIdentity(value: unknown, account: string, now = Date.now()): StoreAccountIdentity | undefined {
  if (!value || typeof value !== 'object') return;
  const data = value as Record<string, unknown>;
  if (data.schema !== 1 || data.account !== account || !identityName(data.username)
    || data.source !== 'backend-store-account' || typeof data.checkedAt !== 'string') return;
  const time = Date.parse(data.checkedAt);
  if (!Number.isFinite(time) || time > now + 60_000 || now-time > 10*60_000) return;
  return { account, username: data.username.trim(), source: 'backend-store-account', checkedAt: data.checkedAt };
}
export function accountIdentityViews(auth: AuthStatus, now = Date.now()) {
  const xbox = {
    role: 'Xbox gaming account',
    name: auth.stored === true ? auth.gamertag ?? auth.username : undefined,
    detail: auth.stored === true ? auth.username : undefined,
    status: auth.stored === false ? 'Not signed in' : auth.stored === true ? auth.gamertag ? 'Xbox profile available' : 'Microsoft credentials stored' : 'Account status unavailable',
  };
  const store = auth.stored === true && auth.username ? readStoreIdentity(auth.storeAccount && {schema:1,...auth.storeAccount},auth.username,now) : undefined;
  return { xbox, store: { role: 'Microsoft Store account', name: store?.username,
    status: store ? 'Store identity verified by backend' : 'Store identity unavailable',
    checkedAt: store?.checkedAt,
  }, namesDiffer: Boolean(store && auth.username && store.username.toLowerCase() !== auth.username.toLowerCase()) };
}
