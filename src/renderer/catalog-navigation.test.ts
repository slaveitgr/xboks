import { expect, it } from 'vitest';
import { demoSnapshot } from '../shared/demo-data';
import { installedCatalogGame, queuedCatalogProduct } from './catalog-navigation';
import { resolveInterfaceLanguage } from './ReferenceLocale';

it('matches installed products by exact Store identity, including a separate install product', () => {
  const games = demoSnapshot().games;
  games[0].storeId = '9ABC'; games[1].storeId = '9DEF';
  expect(installedCatalogGame({ productId: '9abc' }, games)?.id).toBe(games[0].id);
  expect(installedCatalogGame({ productId: 'BUNDLE', installProductId: '9def' }, games)?.id).toBe(games[1].id);
  expect(installedCatalogGame({ productId: games[0].title }, games)).toBeUndefined();
});
it('queue details retain the Product ID even when titles collide', () => {
  const a = queuedCatalogProduct({ productId: '9ABC', title: 'Same title' });
  const b = queuedCatalogProduct({ productId: '9DEF', title: 'Same title' });
  expect(a?.productId).toBe('9ABC'); expect(b?.productId).toBe('9DEF');
  expect(a?.installability).toBe('unknown');
  expect(queuedCatalogProduct({ productId: '', title: 'Unknown game' })).toBeUndefined();
});
it('keeps interface language independent of game market and locale', () => {
  expect(resolveInterfaceLanguage('system', 'el-GR')).toBe('el');
  expect(resolveInterfaceLanguage('en', 'el-GR')).toBe('en');
  expect(resolveInterfaceLanguage('el', 'en-US')).toBe('el');
  expect(resolveInterfaceLanguage('system', undefined)).toBe('en');
});
