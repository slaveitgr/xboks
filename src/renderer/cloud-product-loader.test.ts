import {describe, expect, it, vi} from 'vitest';
import {CloudProductLoader, sharedCloudProductLoader} from './cloud-product-loader';
const product = (productId: string) => ({productId, title: productId, description: '', categories: []});
const flush = async () => {for (let n = 0; n < 8; n++) await Promise.resolve();};
describe('cloud metadata request pool', () => {
  it('shares one pool across remounts of the same launcher bridge', () => {
    const owner = {}, read = vi.fn();
    expect(sharedCloudProductLoader(owner, read)).toBe(sharedCloudProductLoader(owner, read));
    expect(sharedCloudProductLoader({}, read)).not.toBe(sharedCloudProductLoader(owner, read));
  });
  it('limits all current and superseded page work to three reads', async () => {
    const finish: (() => void)[] = [], reads: string[][] = [];
    const loader = new CloudProductLoader(ids => {reads.push(ids); return new Promise(resolve => finish.push(() => resolve(ids.map(product))));});
    const signal = new AbortController().signal;
    const results = Array.from({length: 5}, (_, n) => loader.describe([String(n)], signal));
    await flush(); expect(reads).toHaveLength(3);
    finish[0](); await flush(); expect(reads).toHaveLength(4);
    finish[1](); await flush(); expect(reads).toHaveLength(5);
    finish.slice(2).forEach(done => done()); await Promise.all(results);
  });
  it('coalesces the same running batch across a canceled route and its replacement', async () => {
    let complete!: () => void;
    const read = vi.fn((ids: string[]) => new Promise<ReturnType<typeof product>[]>(resolve => {complete = () => resolve(ids.map(product));}));
    const loader = new CloudProductLoader(read), first = new AbortController(), second = new AbortController();
    const old = loader.describe(['same'], first.signal).catch(error => error.message); await flush(); first.abort();
    const current = loader.describe(['same'], second.signal); complete();
    expect(await old).toContain('cancelled'); expect(await current).toEqual([product('same')]); expect(read).toHaveBeenCalledTimes(1);
  });
  it('cancels queued route work before it reaches the bridge', async () => {
    let complete!: () => void;
    const read = vi.fn((ids: string[]) => new Promise<ReturnType<typeof product>[]>(resolve => {complete = () => resolve(ids.map(product));}));
    const loader = new CloudProductLoader(read, 1), kept = new AbortController(), abandoned = new AbortController();
    const active = loader.describe(['active'], kept.signal), queued = loader.describe(['cancelled'], abandoned.signal).catch(error => error.message);
    await flush(); abandoned.abort(); complete(); await active; await flush();
    expect(await queued).toContain('cancelled'); expect(read).toHaveBeenCalledTimes(1);
  });
  it('normalizes adapter errors and permits a clean retry', async () => {
    const read = vi.fn().mockRejectedValueOnce(Error('PRIVATE_ACCOUNT_DIAGNOSTIC')).mockResolvedValueOnce([product('retry')]);
    const loader = new CloudProductLoader(read), signal = new AbortController().signal;
    await expect(loader.describe(['retry'], signal)).rejects.toThrow('Cloud metadata is unavailable.'); await flush();
    expect(await loader.describe(['retry'], signal)).toEqual([product('retry')]);
  });
});
