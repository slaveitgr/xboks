import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { demoSnapshot } from '../shared/demo-data';
import type { CatalogProduct } from '../shared/types';
import { openXboxModeHomeItem, XboxModeHome, xboxModeHomeItems } from './XboxModeHome';

const product: CatalogProduct = {
  productId: '9N431PX143P8', title: 'Public catalog game', description: '', categories: [],
  heroUrl: 'https://store-images.s-microsoft.com/actual-hero.jpg',
  posterUrl: 'https://store-images.s-microsoft.com/actual-cover.jpg',
  installability: 'unknown', supportNote: 'Public metadata only',
};

describe('Xbox mode Home data and navigation boundaries', () => {
  it('uses matching catalog artwork without converting catalog metadata to installation or entitlement', () => {
    const data = demoSnapshot();
    const game = data.games.find(game => game.storeId === product.productId)!;
    const before = structuredClone(game);
    const [item] = xboxModeHomeItems([game], [product]);
    expect(item.hero).toBe(product.heroUrl);
    expect(item.cover).toBe(product.posterUrl);
    expect(item.title).toBe(game.title);
    expect(item.game).toBe(game);
    expect(item.product).toBeUndefined();
    expect(game).toEqual(before);
  });

  it('does not substitute unrelated artwork and keeps an imported game in its real state', () => {
    const game = { ...demoSnapshot().games[0], id: 'local-import', storeId: undefined,
      heroUrl: 'data:image/png;base64,aGVybw==', coverDataUrl: 'data:image/png;base64,Y292ZXI=', installState: 'imported' as const };
    const [item] = xboxModeHomeItems([game], [product]);
    expect(item.hero).toBe(game.heroUrl);
    expect(item.cover).toBe(game.coverDataUrl);
    expect(item.game?.installState).toBe('imported');
  });

  it('deduplicates entries, caps the horizontal row, and uses catalog items only for an empty library', () => {
    const base = demoSnapshot().games[0];
    const games = Array.from({ length: 20 }, (_, index) => ({ ...base, id: `game-${index}` }));
    expect(xboxModeHomeItems([games[0], ...games], [product])).toHaveLength(12);
    expect(xboxModeHomeItems([], [product, { ...product, productId: product.productId.toLowerCase() }])).toHaveLength(1);
    expect(xboxModeHomeItems(games, [product]).every(item => item.game && !item.product)).toBe(true);
  });

  it('opens existing game details on A; no execution or install callback is available', () => {
    const go = vi.fn(), openGame = vi.fn(), openProduct = vi.fn();
    const item = xboxModeHomeItems(demoSnapshot().games, [product])[0];
    openXboxModeHomeItem(item, { go, openGame, openProduct });
    expect(openGame).toHaveBeenCalledTimes(1); expect(openGame).toHaveBeenCalledWith(item.game!.id);
    expect(openProduct).not.toHaveBeenCalled(); expect(go).not.toHaveBeenCalled();
    openXboxModeHomeItem(item, { go });
    expect(go).toHaveBeenCalledTimes(1); expect(go).toHaveBeenCalledWith('library');
  });

  it('sends public fallback items to the Store details route without enabling installation', () => {
    const go = vi.fn(), openProduct = vi.fn(), item = xboxModeHomeItems([], [product])[0];
    openXboxModeHomeItem(item, { go, openProduct });
    expect(openProduct).toHaveBeenCalledTimes(1); expect(openProduct).toHaveBeenCalledWith(product);
    expect(go).not.toHaveBeenCalled();
    openXboxModeHomeItem(item, { go });
    expect(go).toHaveBeenCalledTimes(1); expect(go).toHaveBeenCalledWith('store');
  });
});

describe('Xbox mode Home rendering', () => {
  it('keeps row focus selection separate from activation and exposes every tile to spatial navigation', () => {
    const data = demoSnapshot();
    const html = renderToStaticMarkup(<XboxModeHome data={data} go={() => {}} onSearch={() => {}} catalog={[]} />);
    expect((html.match(/data-console-home-item=/g) ?? []).length).toBe(data.games.length);
    expect((html.match(/data-gamepad-action-row=""/g) ?? []).length).toBe(3);
    expect(html).toContain('data-gamepad-initial=""');
    expect(html).not.toContain('data-gamepad-auto-select');
    expect(html).not.toContain('data-gamepad-grid');
    expect(html).toContain('View game details:');
    expect(html).not.toContain('Launch ');
    expect(html).not.toContain('friends are playing');
  });

  it('displays provider profile facts, including zero gamerscore, and shares shell status instead of duplicating it', () => {
    const data = demoSnapshot();
    data.auth.profile = { gamertag: 'Test user', gamerscore: 0 };
    const html = renderToStaticMarkup(<XboxModeHome data={data} go={() => {}} onSearch={() => {}} catalog={[]} status={<time>real shell clock</time>} />);
    expect(html).toContain('Gamerscore 0');
    expect(html).toContain('PC GAME PASS');
    expect(html).toContain('real shell clock');
    expect((html.match(/<time/g) ?? []).length).toBe(1);
  });

  it('hides stale account profile/subscription data after sign-out and omits absent or invalid gamerscore', () => {
    const data = demoSnapshot();
    data.auth.profile = { gamertag: 'Private previous user', gamerscore: 9000, avatarDataUrl: 'data:image/png;base64,cHJpdmF0ZQ==' };
    data.auth.stored = false;
    let html = renderToStaticMarkup(<XboxModeHome data={data} go={() => {}} onSearch={() => {}} catalog={[]} />);
    expect(html).not.toContain('Private previous user'); expect(html).not.toContain('Gamerscore'); expect(html).not.toContain('PC GAME PASS');
    expect(html).not.toContain('data:image/png;base64,cHJpdmF0ZQ==');
    data.auth.stored = true;
    for (const gamerscore of [undefined, -1, NaN, Infinity, 1.5]) {
      data.auth.profile.gamerscore = gamerscore;
      html = renderToStaticMarkup(<XboxModeHome data={data} go={() => {}} onSearch={() => {}} catalog={[]} />);
      expect(html).not.toContain('Gamerscore');
    }
  });

  it('hides the previous account while a sign-in or sign-out operation is running', () => {
    const data = demoSnapshot();
    data.auth = { ...data.auth, stored: true, running: true, gamertag: 'Previous private gamertag',
      avatarDataUrl: 'data:image/png;base64,cHJldmlvdXM=',
      profile: { gamertag: 'Previous private profile', gamerscore: 9017, avatarDataUrl: 'data:image/png;base64,cHJvZmlsZQ==' } };
    const html = renderToStaticMarkup(<XboxModeHome data={data} go={() => {}} onSearch={() => {}} catalog={[]} />);
    for (const privateValue of ['Previous private gamertag', 'Previous private profile', 'cHJldmlvdXM=', 'cHJvZmlsZQ==', 'Gamerscore', 'PC GAME PASS']) expect(html).not.toContain(privateValue);
    expect(html).toContain('Sign in');
  });

  it('keeps the empty library useful without fabricated catalog artwork, friends, scores, battery or time', () => {
    const data = demoSnapshot(); data.games = []; data.auth.stored = false;
    const html = renderToStaticMarkup(<XboxModeHome data={data} go={() => {}} onSearch={() => {}} catalog={[]} />);
    expect(html).toContain('Your next game starts here');
    expect(html).toContain('Cloud gaming');
    expect(html).not.toContain('console-home-game selected');
    expect(html).not.toContain('<time'); expect(html).not.toContain('Battery');
    expect(html).not.toContain('Appearance');
  });

  it('offers appearance only when it has a real callback and renders actual featured metadata', () => {
    const html = renderToStaticMarkup(<XboxModeHome data={demoSnapshot()} go={() => {}} onSearch={() => {}}
      onCustomize={() => {}} catalog={[product]} />);
    expect(html).toContain('Appearance');
    expect(html).toContain(`data-product-id="${product.productId}"`);
    expect(html).toContain(product.title);
    expect(html).not.toContain('Play like a Pro');
    expect(html).not.toContain('Choose your audio');
  });
});
