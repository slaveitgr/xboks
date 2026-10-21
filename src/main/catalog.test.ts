import { describe, expect, it } from 'vitest';
import { CatalogService, parseCatalogProducts, parseHandheldCompatibility, primaryGameProductId, type StoreCollection } from './catalog.js';

describe('verified public Store edition relationships', () => {
  const edition = '9NKX70BBCDRN', base = '9NNX1VVR3KNQ', addon = '9AAAAAAAAAAA';
  const game = (id: string, references: {BigId:string;IsPrimary?:boolean}[] = [], ProductType = 'Game') => ({ProductId:id,ProductType,DisplaySkuAvailabilities:[{Sku:{Properties:{BundledSkus:references}}}]});
  it('resolves the actual Forza Standard Edition primary game without inferring access', () => {
    const details = new Map([[edition,game(edition,[{BigId:base,IsPrimary:true},{BigId:base,IsPrimary:true}])],[base,game(base)]]);
    expect(primaryGameProductId(edition,details)).toBe(base);
    expect(primaryGameProductId(base,details)).toBeUndefined();
    const parsed = parseCatalogProducts({productsList:[{productId:edition,title:'Forza edition',isGame:true}]},{Products:[...details.values()]});
    expect(parsed[0].primaryProductId).toBe(base); expect(parsed[0]).not.toHaveProperty('hasEntitlement');
  });
  it('rejects missing, ambiguous, cyclic and non-game targets', () => {
    const details = new Map([[edition,game(edition,[{BigId:base},{BigId:addon}])],[base,game(base)],[addon,game(addon)]]);
    expect(primaryGameProductId(edition,details)).toBeUndefined();
    details.set(edition,game(edition,[{BigId:base,IsPrimary:true},{BigId:addon,IsPrimary:true}]));
    expect(primaryGameProductId(edition,details)).toBeUndefined();
    details.set(edition,game(edition,[{BigId:base,IsPrimary:true}])); details.set(base,game(base,[{BigId:edition}]));
    expect(primaryGameProductId(edition,details)).toBeUndefined();
    details.set(base,game(base,[],'Durable')); expect(primaryGameProductId(edition,details)).toBeUndefined();
    details.delete(base); expect(primaryGameProductId(edition,details)).toBeUndefined();
  });
});

const search = {
  productsList: [{
    productId: '9game123',
    title: 'Purchased Game',
    description: 'A real Store description.',
    publisherName: 'Studio',
    isGame: true,
    posterArtUrl: 'https://store-images.s-microsoft.com/image/poster',
    redirectUrl: 'https://www.xbox.com/games/store/game/9game123',
    priceInfo: { displayPrice: '$29.99' },
    plaintextPassName: undefined,
    categories: ['Action'],
  }, {
    productId: '9bundle1',
    title: 'Bundle Game',
    description: 'Bundle',
    isGame: true,
    plaintextPassName: 'Xbox Game Pass',
  }],
  cursor: 'next_page',
  hasMorePages: true,
};

const catalog = {
  Products: [{
    ProductId: '9GAME123',
    DisplaySkuAvailabilities: [{ Sku: { Properties: { Packages: [{
      PackageFormat: 'MSIXVC',
      PlatformDependencies: [{ PlatformName: 'Windows.Desktop' }],
    }] } } }],
  }, {
    ProductId: '9BUNDLE1',
    DisplaySkuAvailabilities: [{ Sku: { Properties: { Packages: [] } } }],
  }],
};

describe('anonymous Store collections', () => {
  const rows = { productsList: [{ productId: '9AAAAAAAAAAA', title: 'Returned PC game', isGame: true, categories: ['Action'], priceInfo: { displayPrice: '$14.99' } }], hasMorePages: false };
  function provider(pages: unknown[] = [rows]) {
    const requests: { url: URL; init?: RequestInit }[] = [];
    const fetcher = (async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(String(input)); requests.push({ url, init });
      const payload = url.hostname === 'displaycatalog.mp.microsoft.com' ? { Products: [] } : pages.shift();
      return new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    return { service: new CatalogService(fetcher), requests };
  }
  it.each(['all-pc', 'addons'] as const)('uses the real %s wildcard department without changing ordinary search rules', async kind => {
    const p = provider([{ ...rows, productsList: rows.productsList.map(row => ({ ...row, categories: [kind === 'addons' ? 'Add-on' : 'Action'] })) }]);
    const result = await p.service.collection(kind, 'el-GR');
    const { url, init } = p.requests[0];
    expect(url.origin + url.pathname).toBe('https://apps.microsoft.com/api/products/search');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ query: '*', mediaType: kind === 'addons' ? 'addons' : 'games', gl: 'GR', category: 'all' });
    expect(init).toMatchObject({ credentials: 'omit', redirect: 'error', headers: { Accept: 'application/json' } });
    expect(result.products[0]).toMatchObject({ title: 'Returned PC game', purchasePrice: '$14.99', installability: 'unknown' });
    expect(result.products[0].includedWith).toBeUndefined(); await expect(p.service.search('*', 'US')).rejects.toThrow('at least two');
  });
  it('uses actual server ranking for Top paid and its returned page number', async () => {
    const p = provider([{ ...rows, hasMorePages: true, nextPageNumber: 2 }, rows]);
    const first = await p.service.collection('toppaid', 'US'); expect(first.hasMore).toBe(true); expect(first.cursor).toBeTruthy();
    expect(Object.fromEntries(p.requests[0].url.searchParams)).toMatchObject({ listName: 'TopPaid', pgNo: '1', noItems: '24', mediaType: 'Games' });
    const last = await p.service.collection('toppaid', 'US', first.cursor);
    expect(p.requests.filter(request => request.url.hostname === 'apps.microsoft.com')[1].url.searchParams.get('pgNo')).toBe('2');
    expect(last.hasMore).toBe(false); expect(last.cursor).toBeUndefined();
  });
  it.each(['all-pc', 'addons'] as const)('passes only the original opaque %s cursor to the official endpoint', async kind => {
    const row = { ...rows.productsList[0], categories: ['Add-on'] };
    const p = provider([{ productsList: [row], cursor: 'original+/=cursor', hasMorePages: true }, { productsList: [], hasMorePages: false }]);
    const first = await p.service.collection(kind, 'US'); await p.service.collection(kind, 'US', first.cursor);
    const urls = p.requests.filter(request => request.url.hostname === 'apps.microsoft.com').map(request => request.url);
    expect(urls[1].searchParams.get('cursor')).toBe('original+/=cursor'); expect(first.cursor!.length).toBeLessThan(4096);
  });
  it('binds pagination to the exact collection and market before any network request', async () => {
    const p = provider([{ ...rows, hasMorePages: true, cursor: 'source_cursor' }]); const first = await p.service.collection('all-pc', 'US'); const count = p.requests.length;
    await expect(p.service.collection('addons', 'US', first.cursor)).rejects.toThrow('cursor is invalid');
    await expect(p.service.collection('all-pc', 'GR', first.cursor)).rejects.toThrow('cursor is invalid'); expect(p.requests).toHaveLength(count);
  });
  it.each(['not-a-token', 'A'.repeat(4097), Buffer.from(JSON.stringify({ version: 1, collection: 'toppaid', market: 'US', page: 101 })).toString('base64url')])('rejects malformed or excessive cursor %s', async cursor => {
    const p = provider(); await expect(p.service.collection('toppaid', 'US', cursor)).rejects.toThrow('cursor is invalid'); expect(p.requests).toHaveLength(0);
  });
  it('rejects unknown collections instead of mapping them to a normal search', async () => {
    const p = provider(); await expect(p.service.collection('personalized' as StoreCollection, 'US')).rejects.toThrow('Unknown Store collection'); expect(p.requests).toHaveLength(0);
  });
  it('does not turn a base-game fallback into an add-on collection', async () => {
    const p = provider(); await expect(p.service.collection('addons', 'US')).rejects.toThrow('verified add-on'); expect(p.requests).toHaveLength(1);
  });
  it.each([{}, { productsList: null }, { productsList: Array.from({ length: 61 }, () => rows.productsList[0]) }])('rejects malformed or excessive collection data', async response => {
    const p = provider([response]); await expect(p.service.collection('all-pc', 'US')).rejects.toThrow('Invalid Microsoft Store collection');
  });
  it.each([{ ...rows, hasMorePages: true }, { ...rows, hasMorePages: true, nextPageNumber: 1 }, { ...rows, hasMorePages: true, nextPageNumber: 101 }])('rejects nonadvancing Top paid pagination', async response => {
    const p = provider([response]); await expect(p.service.collection('toppaid', 'US')).rejects.toThrow('pagination did not advance');
  });
  it('rejects repeated wildcard cursors on subsequent pages', async () => {
    const response = { ...rows, hasMorePages: true, cursor: 'same' }, p = provider([response, response]);
    const first = await p.service.collection('all-pc', 'US'); await expect(p.service.collection('all-pc', 'US', first.cursor)).rejects.toThrow('pagination did not advance');
  });
  it('caches immutable page copies independently by kind and market', async () => {
    const p = provider([rows, rows, rows]); const first = await p.service.collection('all-pc', 'US'); first.products[0].title = 'Mutated caller';
    expect((await p.service.collection('all-pc', 'US')).products[0].title).toBe('Returned PC game'); expect(p.requests.filter(request => request.url.hostname === 'apps.microsoft.com')).toHaveLength(1);
    await p.service.collection('toppaid', 'US'); await p.service.collection('all-pc', 'GR'); expect(p.requests.filter(request => request.url.hostname === 'apps.microsoft.com')).toHaveLength(3);
  });
  it('bounds declared and streamed response bytes and does not enrich a failed response', async () => {
    let details = 0;
    for (const declared of [true, false]) {
      const service = new CatalogService((async input => { if (String(input).includes('displaycatalog')) details++; return new Response(' '.repeat(2 * 1024 * 1024 + 1), { headers: declared ? { 'content-length': String(2 * 1024 * 1024 + 1) } : {} }); }) as typeof fetch);
      await expect(service.collection('all-pc', 'US')).rejects.toThrow('response limit');
    }
    expect(details).toBe(0);
  });
  it('propagates HTTP failures without silently using trending or stale cached data', async () => {
    const service = new CatalogService((async () => new Response('unavailable', { status: 503 })) as typeof fetch);
    await expect(service.collection('toppaid', 'US')).rejects.toThrow('HTTP 503');
  });
});

describe('Microsoft Store catalog parsing', () => {
  it('separates purchase price, subscription availability, and Xodus package support', () => {
    const products = parseCatalogProducts(search, catalog);
    expect(products[0]).toMatchObject({
      productId: '9GAME123',
      purchasePrice: '$29.99',
      includedWith: undefined,
      installability: 'supported',
      packageFormat: 'MSIXVC',
    });
    expect(products[1]).toMatchObject({
      includedWith: 'Xbox Game Pass',
      installability: 'unsupported',
    });
  });

  it('rejects image URLs outside Microsoft Store hosts', () => {
    const products = parseCatalogProducts({ productsList: [{ ...search.productsList[0], posterArtUrl: 'https://example.com/tracker.png' }] }, catalog);
    expect(products[0].posterUrl).toBeUndefined();
  });

  it('prefers branded box art over textless poster art', () => {
    const products = parseCatalogProducts({ productsList: [{ ...search.productsList[0], boxArtUrl: 'https://store-images.s-microsoft.com/image/boxart' }] }, catalog);
    expect(products[0].posterUrl).toBe('https://store-images.s-microsoft.com/image/boxart');
  });

  it('keeps a multi-product Store edition intact for backend package selection', () => {
    const products = parseCatalogProducts({ productsList: [{ productId: '9edition', title: 'Game Standard Edition', isGame: true }] }, {
      Products: [{
        ProductId: '9EDITION',
        DisplaySkuAvailabilities: [{ Sku: { Properties: { Packages: [], BundledSkus: [
          { BigId: '9package', IsPrimary: true },
          { BigId: '9bonus', IsPrimary: false },
        ] } } }],
      }, {
        ProductId: '9PACKAGE',
        DisplaySkuAvailabilities: [{ Sku: { Properties: { Packages: [{
          PackageFormat: 'MSIXVC', PlatformDependencies: [{ PlatformName: 'Windows.Desktop' }],
        }] } } }],
      }, {
        ProductId: '9BONUS',
        DisplaySkuAvailabilities: [{ Sku: { Properties: { Packages: [] } } }],
      }],
    });
    expect(products[0]).toMatchObject({
      productId: '9EDITION',
      installability: 'supported',
      packageFormat: 'MSIXVC',
    });
    expect(products[0].installProductId).toBeUndefined();
  });

  it('does not treat an unsupported direct EAppx package as a resolvable bundle', () => {
    const products = parseCatalogProducts({ productsList: [{ productId: '9eappx', title: 'Legacy PC Game', isGame: true }] }, {
      Products: [{
        ProductId: '9EAPPX',
        DisplaySkuAvailabilities: [{ Sku: { Properties: { Packages: [{
          PackageFormat: 'EAppx', PlatformDependencies: [{ PlatformName: 'Windows.Desktop' }],
        }], BundledSkus: [{ BigId: '9package', IsPrimary: true }] } } }],
      }],
    });
    expect(products[0]).toMatchObject({ installability: 'unsupported', packageFormat: 'EAPPX' });
    expect(products[0].installProductId).toBeUndefined();
  });
});

describe('CatalogService', () => {
  it('only lists licensed base games with supported PC packages, not add-ons or console products', async () => {
    const id='9AAAAAAAAAAA';
    const data={Products:[{ ...catalog.Products[0],ProductId:id,ProductType:'Game',LocalizedProperties:[{ProductTitle:'Licensed PC Game',PublisherName:'Studio'}]},
      { ...catalog.Products[0],ProductId:'9BBBBBBBBBBB',ProductType:'Durable',LocalizedProperties:[{ProductTitle:'DLC'}]},
      {ProductId:'9CCCCCCCCCCC',ProductType:'Game',LocalizedProperties:[{ProductTitle:'Console game'}],DisplaySkuAvailabilities:[]} ]};
    const fetcher=(async()=>new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}})) as typeof fetch;
    const result=await new CatalogService(fetcher).licensedProducts([id,'9BBBBBBBBBBB','9CCCCCCCCCCC'],'US');
    expect(result.map(p=>p.title)).toEqual(['Licensed PC Game']);
    expect(result[0].installability).toBe('supported');
  });
  it('queries games and enriches them with display catalog package metadata', async () => {
    const urls: string[] = [];
    const fetcher = (async (input: URL | RequestInfo) => {
      const url = String(input); urls.push(url);
      return new Response(JSON.stringify(url.includes('displaycatalog') ? catalog : search), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;
    const result = await new CatalogService(fetcher).search('gears', 'neutral');
    expect(result.market).toBe('US');
    expect(result.hasMore).toBe(true);
    expect(result.products[0].installability).toBe('supported');
    expect(urls[0]).toContain('mediaType=games');
    expect(urls[1]).toContain('bigIds=9GAME123%2C9BUNDLE1');
  });

  it('loads the live computed games collection and enriches its products', async () => {
    const urls: string[] = [];
    const fetcher = (async (input: URL | RequestInfo) => {
      const url = String(input); urls.push(url);
      return new Response(JSON.stringify(url.includes('displaycatalog') ? catalog : { ...search, title: 'Trending games' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;
    const result = await new CatalogService(fetcher).featured('CZ');
    expect(result.query).toBe('Trending games');
    expect(result.market).toBe('CZ');
    expect(result.hasMore).toBe(false);
    expect(urls[0]).toContain('GetComputedProductsList');
    expect(urls[0]).toContain('mediaType=Games');
  });

  it('looks up Store cover artwork by Product ID, preferring square box art, and rejects foreign hosts', async () => {
    const fetcher = (async (input: URL | RequestInfo) => {
      const url = String(input);
      return new Response(JSON.stringify(url.includes('displaycatalog') ? {
        Products: [{
          ProductId: '9GAME123',
          LocalizedProperties: [{ Images: [
            { ImagePurpose: 'Logo', Uri: '//store-images.s-microsoft.com/image/logo' },
            { ImagePurpose: 'FeaturePromotionalSquareArt', Uri: '//store-images.s-microsoft.com/image/promo' },
            { ImagePurpose: 'BoxArt', Uri: '//store-images.s-microsoft.com/image/boxart' },
          ] }],
        }, {
          ProductId: '9FOREIGN',
          LocalizedProperties: [{ Images: [
            { ImagePurpose: 'BoxArt', Uri: '//tracker.example.com/image/boxart' },
          ] }],
        }],
      } : search), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    const posters = await new CatalogService(fetcher).posters(['9game123', '9foreign', 'bad id'], 'US');
    expect(posters.get('9GAME123')).toBe('https://store-images.s-microsoft.com/image/boxart');
    expect(posters.has('9FOREIGN')).toBe(false);
  });

  it('selects separate branded tile and wide artwork, skipping unsafe images and unrelated products', async () => {
    const fetcher = (async () => new Response(JSON.stringify({ Products: [
      { ProductId: '9GAME123', LocalizedProperties: [{ Images: [
        { ImagePurpose: 'Logo', Uri: '//store-images.s-microsoft.com/logo' },
        { ImagePurpose: 'BoxArt', Uri: '//foreign.example/box' },
        { ImagePurpose: 'BoxArt', Uri: '//store-images.s-microsoft.com/box' },
        { ImagePurpose: 'SuperHeroArt', Uri: '//store-images.s-microsoft.com/hero' },
        { ImagePurpose: 'TitledHeroArt', Uri: '//store-images.s-microsoft.com/titled-hero' },
      ] }] },
      { ProductId: '9OTHER', LocalizedProperties: [{ Images: [{ ImagePurpose: 'BoxArt', Uri: '//store-images.s-microsoft.com/other' }] }] },
    ] }), { headers: { 'Content-Type': 'application/json' } })) as typeof fetch;
    const artwork = await new CatalogService(fetcher).artwork(['9game123'], 'US');
    expect(artwork.get('9GAME123')).toEqual({ coverUrl: 'https://store-images.s-microsoft.com/box', heroUrl: 'https://store-images.s-microsoft.com/titled-hero' });
    expect(artwork.has('9OTHER')).toBe(false);
  });

  it('keeps artwork optional when the catalog is offline or has only a package logo', async () => {
    const offline = (async () => { throw Error('Offline'); }) as typeof fetch;
    expect((await new CatalogService(offline).artwork(['9GAME123'], 'US')).size).toBe(0);
    const logo = (async () => new Response(JSON.stringify({ Products: [{ ProductId: '9GAME123', LocalizedProperties: [{ Images: [
      { ImagePurpose: 'Logo', Uri: '//store-images.s-microsoft.com/logo' },
    ] }] }] }))) as typeof fetch;
    expect((await new CatalogService(logo).artwork(['9GAME123'], 'US')).size).toBe(0);
  });
});

const handheldId = '9PPT8K6GQHRZ';
// Minimal public response observed without authentication on 2026-10-21:
// https://emerald.xboxservices.com/xboxcomfd/products/9PPT8K6GQHRZ?locale=en-US
// Microsoft's current Xbox web client supplies API version 1.0 and MS-CV.
const handheldSummary = (deviceEvaluation: unknown) => ({
  productId: handheldId, productKind: 'Game', hhVerified: { deviceEvaluation },
});
const handheldPayload = (deviceEvaluation: unknown) => ({ productSummaries: [handheldSummary(deviceEvaluation)] });
const descriptionPayload = { Products: [{ ProductId: handheldId, ProductType: 'Game',
  LocalizedProperties: [{ ProductTitle: 'Clair Obscur: Expedition 33', ProductDescription: 'Catalog description.', Images: [
    { ImagePurpose: 'Screenshot', Uri: '//store-images.s-microsoft.com/screenshot' },
  ] }], Properties: { Categories: ['Role playing'] } }] };

describe('Microsoft Windows handheld classification', () => {
  // F21084 in the original app binds these numeric values; the public Xbox
  // PDP independently confirms hhVerified.deviceEvaluation=1 for this title.
  it.each([[0, 'unknown'], [1, 'optimized'], [2, 'unsupported'], [3, 'playable']] as const)(
    'maps explicit TestResult %s to %s with its Windows origin', (rawRating, rating) => {
      expect(parseHandheldCompatibility(handheldId, handheldPayload(rawRating))).toEqual({
        rating, rawRating, source: 'microsoft-catalog', platform: 'windows-pc',
      });
    },
  );

  it.each([undefined, null, true, false, '1', 'Verified', 'HandheldOptimized', 4, -1, 1.5, Infinity, {}, []])(
    'does not coerce an absent, malformed or future TestResult (%s)', value => {
      expect(parseHandheldCompatibility(handheldId, handheldPayload(value))).toBeUndefined();
    },
  );

  it('does not borrow ratings from another offer, a bundle child, duplicates or non-game records', () => {
    const other = { ...handheldSummary(1), productId: '9AAAAAAAAAAA' };
    expect(parseHandheldCompatibility(handheldId, { productSummaries: [other] })).toBeUndefined();
    expect(parseHandheldCompatibility(handheldId, { productSummaries: [
      { productId: handheldId, productKind: 'Game', bundledProductIds: [other.productId] }, other,
    ] })).toBeUndefined();
    expect(parseHandheldCompatibility(handheldId, { productSummaries: [handheldSummary(1), handheldSummary(2)] })).toBeUndefined();
    expect(parseHandheldCompatibility(handheldId, { productSummaries: [{ ...handheldSummary(1), productKind: 'Durable' }] })).toBeUndefined();
    expect(parseHandheldCompatibility('../invalid', handheldPayload(1))).toBeUndefined();
  });

  it('requires the explicit FD field and never converts controller, package or Game Pass metadata into a rating', () => {
    const product = { ...search.productsList[0], productId: handheldId, plaintextPassName: 'Xbox Game Pass',
      fullControllerSupport: true, availableOn: ['PC', 'Handheld'], hhVerified: { deviceEvaluation: 1 } };
    const metadata = { ...catalog.Products[0], ProductId: handheldId, Properties: {
      HandheldCompatibility: 'HandheldOptimized', FullControllerSupport: true,
    } };
    const parsed = parseCatalogProducts({ productsList: [product] }, { Products: [metadata] });
    expect(parsed[0].installability).toBe('supported');
    expect(parsed[0].includedWith).toBe('Xbox Game Pass');
    expect(parsed[0].handheldCompatibility).toBeUndefined();
    expect(parseHandheldCompatibility(handheldId, { productSummaries: [{
      productId: handheldId, productKind: 'Game', availableOn: ['PC', 'Handheld'], capabilities: ['FullControllerSupport'],
    }] })).toBeUndefined();
  });

  it('retains only explicitly published criterion results in their original order', () => {
    const payload = { productSummaries: [{ ...handheldSummary(1), hhVerified: { deviceEvaluation: 1, deviceResults: [
      { deviceTest: 4, testResult: 1, testTimestamp: '2026-01-01T00:00:00Z' },
      { deviceTest: 0, testResult: 1 }, { deviceTest: 1, testResult: 3 },
      { deviceTest: 2, testResult: 2 }, { deviceTest: 3, testResult: 0 },
    ] } }] };
    expect(parseHandheldCompatibility(handheldId, payload)).toMatchObject({ rating: 'optimized', criteria: [
      { id: 'supported-display', rating: 'optimized' }, { id: 'defaults-work', rating: 'optimized' },
      { id: 'iconography', rating: 'playable' }, { id: 'text-input', rating: 'unsupported' },
      { id: 'ui-legibility', rating: 'unknown' },
    ] });
    expect(parseHandheldCompatibility(handheldId, handheldPayload(1))?.criteria).toBeUndefined();
  });

  it.each([undefined, null, true, 'Verified', {}, [], Array(101).fill({ deviceTest: 0, testResult: 1 })])(
    'preserves the overall rating without inventing criteria for an absent, malformed or excessive results array', deviceResults => {
      const payload = { productSummaries: [{ ...handheldSummary(3), hhVerified: { deviceEvaluation: 3, deviceResults } }] };
      const result = parseHandheldCompatibility(handheldId, payload);
      expect(result?.rating).toBe('playable');
      expect(result?.criteria).toBeUndefined();
    },
  );

  it('ignores unknown fields, unknown tests and malformed per-test values without converting them to successful checks', () => {
    const payload = { productSummaries: [{ ...handheldSummary(1), hhVerified: { deviceEvaluation: 1, deviceResults: [
      null, true, [], { deviceTest: '0', testResult: 1 }, { deviceTest: false, testResult: 1 },
      { deviceTest: -1, testResult: 1 }, { deviceTest: 10, testResult: 1 }, { deviceTest: 5, testResult: 1 },
      { deviceTest: 0, result: 1 }, { deviceTest: 1, testResult: '1' }, { deviceTest: 2, testResult: true },
      { deviceTest: 3, testResult: 4 }, { deviceTest: 4, testResult: 3 },
    ] } }] };
    expect(parseHandheldCompatibility(handheldId, payload)?.criteria).toEqual([{ id: 'supported-display', rating: 'playable' }]);
  });

  it('marks duplicate criterion IDs unknown, including equal results and malformed duplicates', () => {
    const payload = { productSummaries: [{ ...handheldSummary(1), hhVerified: { deviceEvaluation: 1, deviceResults: [
      { deviceTest: 0, testResult: 1 }, { deviceTest: 0, testResult: 1 },
      { deviceTest: 1, testResult: 1 }, { deviceTest: 1, testResult: '1' },
      { deviceTest: 2, testResult: null }, { deviceTest: 2, testResult: 1 },
      { deviceTest: 3, testResult: 0 }, { deviceTest: 4, testResult: 1 },
    ] } }] };
    expect(parseHandheldCompatibility(handheldId, payload)?.criteria).toEqual([
      { id: 'defaults-work', rating: 'unknown' }, { id: 'iconography', rating: 'unknown' },
      { id: 'text-input', rating: 'unknown' }, { id: 'ui-legibility', rating: 'unknown' },
      { id: 'supported-display', rating: 'optimized' },
    ]);
  });

  it('reads public FD metadata only for opened game details, with anonymous bounded requests and cloned cache entries', async () => {
    const calls: { url: URL; options?: RequestInit }[] = [];
    const fetcher = (async (input: URL | RequestInfo, options?: RequestInit) => {
      const url = new URL(String(input)); calls.push({ url, options });
      return Response.json(url.hostname === 'emerald.xboxservices.com' ? { productSummaries: [{
        ...handheldSummary(1), hhVerified: { deviceEvaluation: 1, deviceResults: [{ deviceTest: 0, testResult: 1 }] },
      }] } : descriptionPayload);
    }) as typeof fetch;
    const service = new CatalogService(fetcher);
    const first = await service.gameDetails(handheldId, 'US');
    expect(first?.handheldCompatibility?.rating).toBe('optimized');
    expect(first?.screenshots).toEqual(['https://store-images.s-microsoft.com/screenshot']);
    first!.handheldCompatibility!.rating = 'unsupported';
    first!.handheldCompatibility!.criteria![0].rating = 'unsupported';
    expect((await service.gameDetails(handheldId, 'US'))?.handheldCompatibility?.rating).toBe('optimized');
    expect((await service.gameDetails(handheldId, 'US'))?.handheldCompatibility?.criteria).toEqual([{ id: 'defaults-work', rating: 'optimized' }]);
    expect(calls).toHaveLength(2);
    const request = calls[1];
    expect(request.url.toString()).toBe(`https://emerald.xboxservices.com/xboxcomfd/products/${handheldId}?locale=en-US`);
    expect(request.options).toMatchObject({ credentials: 'omit', redirect: 'error' });
    const headers = new Headers(request.options?.headers);
    expect(headers.get('X-MS-API-Version')).toBe('1.0');
    expect(headers.get('MS-CV')).toMatch(/^[A-Za-z0-9+/]{22}\.0$/);
    expect(headers.has('Authorization')).toBe(false);
    expect(headers.has('Cookie')).toBe(false);
    expect(request.options?.body).toBeUndefined();
    expect(request.options?.signal).toBeInstanceOf(AbortSignal);
    await service.gameDetails(handheldId, 'GB');
    expect(calls).toHaveLength(4);
    expect(calls[3].url.searchParams.get('locale')).toBe('en-GB');
    expect(new Headers(calls[3].options?.headers).get('MS-CV')).not.toBe(headers.get('MS-CV'));
  });

  it.each(['offline', 'unauthorized', 'invalid-json', 'unrelated-product', 'redirect'])(
    'preserves descriptions and screenshots when optional handheld metadata is %s', async mode => {
      const fetcher = (async (input: URL | RequestInfo) => {
        if (new URL(String(input)).hostname !== 'emerald.xboxservices.com') return Response.json(descriptionPayload);
        if (mode === 'offline' || mode === 'redirect') throw Error('Optional public catalog unavailable.');
        if (mode === 'unauthorized') return new Response('Unavailable', { status: 401 });
        if (mode === 'invalid-json') return new Response('<html>Not catalog JSON</html>');
        return Response.json({ productSummaries: [{ ...handheldSummary(1), productId: '9AAAAAAAAAAA' }] });
      }) as typeof fetch;
      const details = await new CatalogService(fetcher).gameDetails(handheldId, 'US');
      expect(details).toMatchObject({ title: 'Clair Obscur: Expedition 33', description: 'Catalog description.',
        screenshots: ['https://store-images.s-microsoft.com/screenshot'] });
      expect(details?.handheldCompatibility).toBeUndefined();
    },
  );

  it('bounds the actual metadata body even when its declared content length is tiny', async () => {
    const fetcher = (async (input: URL | RequestInfo) => new URL(String(input)).hostname !== 'emerald.xboxservices.com'
      ? Response.json(descriptionPayload)
      : new Response(' '.repeat(2 * 1024 * 1024) + JSON.stringify(handheldPayload(1)), { headers: { 'content-length': '1' } })) as typeof fetch;
    const details = await new CatalogService(fetcher).gameDetails(handheldId, 'US');
    expect(details?.title).toBe('Clair Obscur: Expedition 33');
    expect(details?.handheldCompatibility).toBeUndefined();
  });

  it('does not fetch optional metadata for non-game or missing descriptive records', async () => {
    const urls: string[] = [];
    const fetcher = (async (input: URL | RequestInfo) => {
      urls.push(String(input)); return Response.json({ Products: [{ ProductId: handheldId, ProductType: 'Durable' }] });
    }) as typeof fetch;
    expect(await new CatalogService(fetcher).gameDetails(handheldId, 'US')).toBeUndefined();
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('displaycatalog.mp.microsoft.com');
  });
});
