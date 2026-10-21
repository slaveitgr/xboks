import {expect, it, vi} from 'vitest';
import {CloudCatalogService, CLOUD_SIGLS, parseCloudProducts, parseCloudSigl} from './cloud-catalog';
const id = '9N26X2PMTWBT', other = '9NBLGGH4R315';
const product = (value = id) => ({StoreId: value, ProductTitle: 'Cloud console title', PublisherName: 'Publisher', Description: 'Description',
  Categories: ['Action', 'Adventure'], Image_Tile: {URL: '//store-images.s-microsoft.com/image/apps.fixture'}});
const payload = () => ({Products: {[id]: product(), [other]: product(other)}});
it('keeps provider order, accepts exact IDs and never treats metadata or duplicate rows as products', () => {
  expect(parseCloudSigl([{siglId: 'collection', title: 'Header'}, {id}, {id: other}, {id}, {id: '../../file'}, null])).toEqual([id, other]);
  expect(() => parseCloudSigl({ids: [id]})).toThrow();
  expect(() => parseCloudSigl(Array(5001).fill({id}))).toThrow();
});
it('hydrates only exact requested products without title IDs, license, or PC support inference', () => {
  const products = parseCloudProducts(payload(), [id]);
  expect(products).toEqual([{productId: id, title: 'Cloud console title', publisher: 'Publisher', description: 'Description',
    posterUrl: 'https://store-images.s-microsoft.com/image/apps.fixture', heroUrl: 'https://store-images.s-microsoft.com/image/apps.fixture', categories: ['Action','Adventure']}]);
  expect(JSON.stringify(products)).not.toMatch(/titleId|owned|entitle|installab|token/i);
  expect(parseCloudProducts({Products: {[id]: {...product(), StoreId: other}}}, [id])).toEqual([]);
});
it('does not load image URLs with arbitrary hosts, credentials, ports, or unsafe protocols', () => {
  for (const URL of ['https://store-images.s-microsoft.com.evil.test/a','http://store-images.s-microsoft.com/a','https://x@store-images.s-microsoft.com/a','https://store-images.s-microsoft.com:444/a','file:///private']) {
    expect(parseCloudProducts({Products: {[id]: {...product(), Image_Tile: {URL}}}}, [id])[0].posterUrl).toBeUndefined();
  }
});
it('uses the original five public cloud collections anonymously and coalesces/caches the read', async () => {
  const fetcher = vi.fn(async () => Response.json([{siglId: 'header'}, {id}]));
  const catalog = new CloudCatalogService(fetcher as typeof fetch);
  const [first, second] = await Promise.all([catalog.catalog('US'), catalog.catalog('US')]);
  expect(fetcher).toHaveBeenCalledTimes(5); expect(first).toEqual(second);
  expect(Object.values(first.collections).every(ids => ids.join() === id)).toBe(true);
  expect(new Set(fetcher.mock.calls.map(call => new URL(String(call[0])).searchParams.get('id')))).toEqual(new Set(Object.values(CLOUD_SIGLS)));
  for (const call of fetcher.mock.calls as unknown as [URL, RequestInit][]) {expect(call[0].origin).toBe('https://catalog.gamepass.com'); expect(call[1]).toMatchObject({credentials: 'omit', redirect: 'error'}); expect(JSON.stringify(call[1].headers)).not.toMatch(/token|cookie|authorization/i);}
  first.collections.all.push(other); expect((await catalog.catalog('US')).collections.all).toEqual([id]); expect(fetcher).toHaveBeenCalledTimes(5);
});
it('reads only requested metadata IDs, reuses cached public metadata and returns safe clones', async () => {
  const fetcher = vi.fn(async () => Response.json(payload())); const catalog = new CloudCatalogService(fetcher as typeof fetch);
  const first = await catalog.describe([id,id], 'GR'); expect(first).toHaveLength(1);
  const [url, request] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
  expect(url.pathname).toBe('/v3/products'); expect(url.searchParams.get('market')).toBe('GR'); expect(JSON.parse(request.body as string)).toEqual({Products: [id]});
  expect(request).toMatchObject({credentials: 'omit', redirect: 'error'});
  first[0].title = 'Changed'; expect((await catalog.describe([id], 'GR'))[0].title).toBe('Cloud console title'); expect(fetcher).toHaveBeenCalledOnce();
});
it('rejects malformed/unbounded renderer IDs before making a network request', async () => {
  const fetcher = vi.fn(); const catalog = new CloudCatalogService(fetcher);
  for (const ids of [['invalid'], ['https://example.com'], Array(61).fill(id), null]) await expect(catalog.describe(ids as string[], 'US')).rejects.toThrow('Invalid');
  expect(fetcher).not.toHaveBeenCalled();
});
it('does not silently cache an HTTP failure as an empty successful collection', async () => {
  let failed = true; const fetcher = vi.fn(async () => failed ? new Response('{}', {status: 503}) : Response.json([{id}]));
  const catalog = new CloudCatalogService(fetcher as typeof fetch);
  await expect(catalog.catalog('US')).rejects.toThrow('unavailable'); failed = false;
  expect((await catalog.catalog('US')).collections.own).toEqual([id]);
});
it('bounds body size before parsing untrusted response data', async () => {
  const catalog = new CloudCatalogService(vi.fn(async () => new Response('{}', {headers: {'content-length': '9000000'}})) as typeof fetch);
  await expect(catalog.describe([id], 'US')).rejects.toThrow('unavailable');
});
