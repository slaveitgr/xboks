import {describe, expect, it} from 'vitest';
import {CatalogService, STORE_CATEGORY_CHANNELS} from './catalog.js';
import type {StoreCategoryKey} from '../shared/types.js';

const channelId = 'DynamicChannel.PCCCGameDeals';
const ids = Array.from({length: 30}, (_, i) => `9${String(i).padStart(11, '0')}`);
const metadata = (id: string) => ({ProductId: id, ProductType: 'Game', LocalizedProperties: [{ProductTitle: `Returned ${id}`,
  ProductDescription: 'Public description', PublisherName: 'Returned studio', Images: [{ImagePurpose: 'BoxArt', Uri: 'https://store-images.s-microsoft.com/image/test'}]}],
  Properties: {Categories: ['Simulation']}, DisplaySkuAvailabilities: [{Sku: {Properties: {Packages: [{PackageFormat: 'MSIXVC', PlatformDependencies: [{PlatformName: 'Windows.Desktop'}]}]}}}]});
function provider(pages: unknown[], products = ids.map(metadata), status = 200) {
  const calls: {url: URL; init?: RequestInit}[] = [];
  const service = new CatalogService((async (input, init) => {
    const url = new URL(String(input)); calls.push({url, init});
    return new Response(JSON.stringify(url.hostname === 'reef.xboxservices.com' ? pages.shift() : {Products: products}), {status: url.hostname === 'reef.xboxservices.com' ? status : 200});
  }) as typeof fetch);
  return {service, calls};
}
const page = (productIds = ids.slice(0, 24), totalItems = 30) => ({channelId, title: 'Game deals', totalItems, productIds});

describe('original collection service Deals adapter', () => {
  it('reads actual anonymous channel membership and hydrates only returned IDs in service order', async () => {
    const p = provider([page()]), result = await p.service.collection('deals', 'el-GR');
    expect(p.calls[0].url.origin + p.calls[0].url.pathname).toBe(`https://reef.xboxservices.com/channels/${channelId}/browse`);
    expect(Object.fromEntries(p.calls[0].url.searchParams)).toEqual({market: 'GR', language: 'en-US', pageSize: '24', skipItems: '0'});
    expect(p.calls[0].init).toMatchObject({credentials: 'omit', redirect: 'error', headers: {Accept: 'application/json'}});
    expect((p.calls[0].init!.headers as Record<string,string>)['MS-CV']).toMatch(/^[A-Za-z0-9+/]{22}\.0$/);
    expect(JSON.stringify(p.calls[0].init)).not.toMatch(/authorization|signature|cookie/i);
    expect(p.calls[1].url.searchParams.get('bigIds')).toBe(ids.slice(0,24).join(','));
    expect(result.products.map(product => product.productId)).toEqual(ids.slice(0,24));
    expect(result.products[0]).toMatchObject({title: `Returned ${ids[0]}`, categories: ['Simulation'], installability: 'supported'});
    expect(result.products[0]).not.toHaveProperty('purchasePrice'); expect(result.products[0]).not.toHaveProperty('hasEntitlement');
    expect(result.hasMore).toBe(true);
  });
  it('advances by consumed source IDs and ends on the actual service total', async () => {
    const p = provider([page(), page(ids.slice(24))]);
    const first = await p.service.collection('deals', 'US'), last = await p.service.collection('deals', 'US', first.cursor);
    const calls = p.calls.filter(call => call.url.hostname === 'reef.xboxservices.com');
    expect(calls[1].url.searchParams.get('skipItems')).toBe('24');
    expect(last.products.map(product => product.productId)).toEqual(ids.slice(24)); expect(last.hasMore).toBe(false); expect(last.cursor).toBeUndefined();
  });
  it('rejects cross-market/cross-collection and malformed cursors before any request', async () => {
    const p = provider([page()]), first = await p.service.collection('deals', 'US'), count = p.calls.length;
    await expect(p.service.collection('deals', 'GR', first.cursor)).rejects.toThrow('cursor is invalid');
    await expect(p.service.collection('all-pc', 'US', first.cursor)).rejects.toThrow('cursor is invalid');
    for (const cursor of ['bad', 'x'.repeat(4097), Buffer.from(JSON.stringify({version:1,collection:'deals',market:'US',skip:2401,previous:[ids[0]]})).toString('base64url')]) {
      await expect(p.service.collection('deals','US',cursor)).rejects.toThrow('cursor is invalid');
    }
    expect(p.calls).toHaveLength(count);
  });
  it.each([{...page(), channelId:'Trending'}, {...page(), title:'Failed to Get Channel'}, page([],30), page(['invalid']), page([ids[0],ids[0]]), page(ids.slice(0,25)), {...page(),totalItems:-1}])('rejects wrong, failed or malformed channel data without catalog enrichment', async data => {
    const p = provider([data]); await expect(p.service.collection('deals','US')).rejects.toThrow('verified deals channel'); expect(p.calls).toHaveLength(1);
  });
  it('rejects a repeated page instead of issuing a fresh cursor over the same products', async () => {
    const p = provider([page(),page()]); const first = await p.service.collection('deals','US');
    await expect(p.service.collection('deals','US',first.cursor)).rejects.toThrow('pagination did not advance');
  });
  it('accepts a genuinely empty channel without fabricating offers or requesting metadata', async () => {
    const p = provider([page([],0)]), result = await p.service.collection('deals','US');
    expect(result.products).toEqual([]); expect(result.hasMore).toBe(false); expect(p.calls).toHaveLength(1);
  });
  it('does not fall back to Trending on HTTP failure or missing product metadata', async () => {
    await expect(provider([{}],[],503).service.collection('deals','US')).rejects.toThrow('HTTP 503');
    await expect(provider([page()],[]).service.collection('deals','US')).rejects.toThrow('metadata could not be loaded');
  });
  it('bounds streamed and declared channel body size', async () => {
    const service = new CatalogService((async () => new Response(' '.repeat(2*1024*1024+1))) as typeof fetch);
    await expect(service.collection('deals','US')).rejects.toThrow('response limit');
  });
  it('returns immutable cached page snapshots per market', async () => {
    const p = provider([page(),page()]), first = await p.service.collection('deals','US'); first.products[0].title='Caller mutation';
    expect((await p.service.collection('deals','US')).products[0].title).toBe(`Returned ${ids[0]}`);
    await p.service.collection('deals','GR'); expect(p.calls.filter(call=>call.url.hostname==='reef.xboxservices.com')).toHaveLength(2);
  });
  it.each(Object.entries(STORE_CATEGORY_CHANNELS) as [StoreCategoryKey,string][])('loads actual %s channel membership rather than filtering catalog genres', async (category, expected) => {
    const p = provider([{...page(),channelId:expected}]), result = await p.service.category(category,'US');
    expect(p.calls[0].url.pathname).toBe(`/channels/${expected}/browse`);
    expect(result.products.map(product=>product.productId)).toEqual(ids.slice(0,24));
    expect(result.products[0].categories).toEqual(['Simulation']);
  });
  it('keeps category continuation isolated from other categories and Deals', async () => {
    const p = provider([{...page(),channelId:STORE_CATEGORY_CHANNELS.cozy}]), first = await p.service.category('cozy','US'), count = p.calls.length;
    await expect(p.service.category('horror','US',first.cursor)).rejects.toThrow('cursor is invalid');
    await expect(p.service.collection('deals','US',first.cursor)).rejects.toThrow('cursor is invalid'); expect(p.calls).toHaveLength(count);
  });
  it.each(['__proto__','constructor','https://example.test/','unknown'])('rejects unlisted category %s without requesting an arbitrary source', async category => {
    const p = provider([]); await expect(p.service.category(category as StoreCategoryKey,'US')).rejects.toThrow('Unknown Store category'); expect(p.calls).toEqual([]);
  });
});
