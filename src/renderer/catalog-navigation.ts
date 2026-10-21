import type { CatalogProduct, DownloadTask, Game } from '../shared/types';

export function installedCatalogGame(product: Pick<CatalogProduct, 'productId' | 'installProductId'>, games: Game[]): Game | undefined {
  const ids = new Set([product.productId, product.installProductId].filter(Boolean).map(id => id!.toUpperCase()));
  return games.find(game => game.storeId && ids.has(game.storeId.toUpperCase()));
}

/** A queue's Product ID is authoritative; the title is presentation only. */
export function queuedCatalogProduct(task: Pick<DownloadTask, 'productId' | 'title' | 'coverUrl'>): CatalogProduct | undefined {
  if (!task.productId.trim()) return undefined;
  return { productId: task.productId, title: task.title, posterUrl: task.coverUrl,
    description: '', categories: [], installability: 'unknown',
    supportNote: 'Package compatibility must be checked before installation.' };
}
