import { expect, it } from 'vitest';
import { accountIdentityViews, readStoreIdentity } from './account-identities';
const now=Date.parse('2026-10-20T12:00:00Z');
const record = { schema:1, account:'xbox@example.test', username:'store@example.test', source:'backend-store-account', checkedAt:new Date(now).toISOString() };
it('does not fabricate a Store identity from an Xbox profile or a stored Microsoft credential', () => {
 const views=accountIdentityViews({running:false,stored:true,username:'xbox@example.test',gamertag:'Player',note:''},now);
 expect(views.xbox.name).toBe('Player'); expect(views.store.name).toBeUndefined();
 expect(views.xbox.status).toBe('Xbox profile available'); expect(views.store.status).toBe('Store identity unavailable');
});
it('accepts only fresh, account-bound explicitly sourced Store identities', () => {
 expect(readStoreIdentity(record,record.account,now)?.username).toBe('store@example.test');
 for(const patch of [{account:'other@example.test'},{schema:2},{source:'xbox-profile'},{checkedAt:'bad'},{checkedAt:new Date(now-600001).toISOString()},{checkedAt:new Date(now+60001).toISOString()},{username:'name\ninvalid'}]) expect(readStoreIdentity({...record,...patch},record.account,now)).toBeUndefined();
});
it('clears visible account identities on sign-out and rejects stale Store records', () => {
 const auth={running:false,stored:true,username:record.account,gamertag:'Player',note:'',storeAccount:readStoreIdentity(record,record.account,now)};
 expect(accountIdentityViews(auth,now).store.name).toBe('store@example.test');
 expect(accountIdentityViews({...auth,stored:false},now).store.name).toBeUndefined();
 expect(accountIdentityViews({...auth,stored:false},now).xbox.name).toBeUndefined();
 expect(accountIdentityViews(auth,now+600001).store.name).toBeUndefined();
 expect(accountIdentityViews({...auth,username:'other@example.test'},now).store.name).toBeUndefined();
});
