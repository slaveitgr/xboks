import { expect, it } from 'vitest';
import { collectionKey, loadCollections, saveCollections } from './LibraryChrome';
const auth = (username: string) => ({ username, stored: true, running: false, note: '' });
it('isolates Play later and recorded history by account, and restores them after reopening', () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const first = collectionKey(auth('first@example.test')), second = collectionKey(auth('second@example.test'));
  expect(first).not.toBe(second);
  expect(saveCollections(first, { later: ['game-1'], history: { 'game-2': 1234 } }, storage)).toBe(true);
  expect(loadCollections(first, storage)).toEqual({ later: ['game-1'], history: { 'game-2': 1234 } });
  expect(loadCollections(second, storage)).toEqual({ later: [], history: {} });
});
it('recovers from damaged storage and rejects invalid IDs and history timestamps', () => {
  const storage = { getItem: () => '{broken', setItem: () => { throw Error('full'); } };
  expect(loadCollections('key', storage)).toEqual({ later: [], history: {} });
  expect(saveCollections('key', { later: [], history: {} }, storage)).toBe(false);
  expect(loadCollections('key', { ...storage, getItem: () => JSON.stringify({ later: ['valid', 1, 'valid', 'x'.repeat(201)], history: { valid: 1234, negative: -1, text: '1234', null: null } }) })).toEqual({ later: ['valid'], history: { valid: 1234 } });
});
