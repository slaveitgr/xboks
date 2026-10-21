import {expect, it} from 'vitest';
import {cloudTransferProof} from './cloud-transfer';
const now = Date.parse('2026-10-22T00:00:00Z'), account = 'example@example.invalid';
const proof = () => ({schema: 1, account, kind: 'loginprooftoken', token: 'private-proof-fixture', issuedAt: new Date(now).toISOString()});
it('accepts only a fresh exact-purpose proof for the selected account without inferring provider expiry', () => {
  expect(cloudTransferProof(JSON.stringify(proof()), account, now)).toBe('private-proof-fixture');
});
it.each([{kind: 'compact'}, {account: 'different@example.invalid'}, {schema: 2}, {token: ''}, {token: 'private\nproof'}, {issuedAt: 'bad'},
  {issuedAt: new Date(now - 30_001).toISOString()}, {issuedAt: new Date(now + 5_001).toISOString()}, {token: 'x'.repeat(100_001)}])('rejects invalid or stale one-use proof fields', override => {
  expect(() => cloudTransferProof(JSON.stringify({...proof(), ...override}), account, now)).toThrow('Invalid cloud transfer proof.');
});
it('rejects malformed/oversized JSON without reproducing credentials in errors', () => {
  for (const raw of ['private-token', '"private-token"', JSON.stringify({...proof(), extra: 'x'.repeat(128 * 1024)})]) expect(() => cloudTransferProof(raw, account, now)).toThrow('Invalid cloud transfer proof.');
});
