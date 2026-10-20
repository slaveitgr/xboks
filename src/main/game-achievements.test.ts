import { expect, it, vi } from 'vitest';
import { GameAchievementsReader, parseGameAchievements } from './game-achievements';
import { parseBackendHelp } from '../shared/utils';
import { readFileSync } from 'node:fs';
const item = (patch = {}) => ({ id: 'service:1', name: 'First step', description: 'Finish a level', state: 'unlocked', secret: false, revoked: false, gamerscore: 10, unlockedAt: '2026-01-01T12:00:00Z', iconUrl: 'https://images-eds-ssl.xboxlive.com/image', progress: null, ...patch });
const payload = (patch = {}) => JSON.stringify({ schema: 1, account: 'example@test', titleId: '42', partial: false, items: [item()], ...patch });
it('discovers achievements as an optional backend capability', () => {
  expect(parseBackendHelp('Commands:\n  account      Read account\n  achievements      Read title achievements\n').achievements).toBe(true);
  expect(parseBackendHelp('Commands:\n  account      Read account\n').achievements).toBe(false);
});
it('allows only the specific Xbox artwork hosts in the packaged image policy', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const policy = /img-src ([^;]+)/.exec(html)?.[1];
  expect(policy).toContain('https://images-eds-ssl.xboxlive.com');
  expect(policy).toContain('https://images-eds.xboxlive.com');
  expect(policy).not.toMatch(/\*|http:|file:/);
});
it('keeps real zero separate from unavailable fields and preserves valid partial lists', () => {
  expect(parseGameAchievements(payload({ items: [item({ gamerscore: 0, iconUrl: null })] }), 'example@test', '42').items?.[0].gamerscore).toBe(0);
  const missing = parseGameAchievements(payload({ items: [item({ gamerscore: null, iconUrl: null, unlockedAt: null })], partial: true }), 'example@test', '42');
  expect(missing.partial).toBe(true); expect(missing.items?.[0]).not.toHaveProperty('gamerscore');
  expect(parseGameAchievements(payload({ items: [] }), 'example@test', '42').status).toBe('unavailable');
  expect(parseGameAchievements(payload({ items: [], partial: true }), 'example@test', '42').status).toBe('available');
});
it.each([{ account: 'other' }, { titleId: '43' }, { schema: 2 }, { partial: 'true' }, { items: [null] }, { items: [item(), item()] }, { items: Array.from({ length: 501 }, (_, i) => item({ id: String(i) })) }])('rejects mismatched or invalid envelopes %j', patch => {
  expect(() => parseGameAchievements(payload(patch), 'example@test', '42')).toThrow();
});
it.each([{ state: 'guess' }, { secret: 'false' }, { name: '' }, { gamerscore: -1 }, { gamerscore: 1.5 }, { gamerscore: '10' }, { progress: 101 }, { unlockedAt: 'tomorrow' }, { unlockedAt: '9999-01-01T00:00:00Z' }, { revoked: true }, { state: 'locked' }])('rejects invalid achievement values %j', patch => {
  expect(() => parseGameAchievements(payload({ items: [item(patch)] }), 'example@test', '42')).toThrow();
});
it.each(['file:///etc/passwd', 'https://evil.test/icon', 'https://user:secret@images-eds-ssl.xboxlive.com/icon', 'http://images-eds-ssl.xboxlive.com/icon'])('does not expose unsafe image URLs %s', iconUrl => {
  expect(parseGameAchievements(payload({ items: [item({ iconUrl })] }), 'example@test', '42').items?.[0]).not.toHaveProperty('iconUrl');
});
it('coalesces reads with independent clones, caches per identity and explicitly refreshes', async () => {
  const reader = vi.fn(async () => payload()), data = new GameAchievementsReader(reader);data.select('example@test', '/example/cli');
  const [a,b] = await Promise.all([data.get('42'),data.get('42')]);expect(reader).toHaveBeenCalledTimes(1);
  a.items![0].name='changed';expect(b.items![0].name).toBe('First step');expect((await data.get('42')).items![0].name).toBe('First step');
  await data.get('42',true);expect(reader).toHaveBeenCalledTimes(2);
  data.select('other','/example/cli');expect((await data.get('42')).status).toBe('error');
  data.select();expect((await data.get('42')).status).toBe('unsupported');
});
it('aborts stale account reads, bounds concurrent requests and rejects unsafe title IDs', async () => {
  const pending: {signal:AbortSignal;resolve:(raw:string)=>void}[]=[];
  const reader=vi.fn((_b,_id,signal:AbortSignal)=>new Promise<string>(resolve=>pending.push({signal,resolve})));
  const data=new GameAchievementsReader(reader);data.select('example@test','/example/cli');
  const a=data.get('42'),b=data.get('43');await Promise.resolve();expect((await data.get('44')).status).toBe('error');
  for(const id of ['0','42;id','../42','4294967296'])await expect(data.get(id)).rejects.toThrow();
  data.select('other','/example/cli');expect(pending.every(p=>p.signal.aborted)).toBe(true);pending.forEach(p=>p.resolve(payload()));
  expect((await a).status).toBe('error');expect((await b).status).toBe('error');
});
it('does not retain failed synchronous readers as pending jobs', async () => {
  const reader=vi.fn(()=>{throw Error('synthetic failure');});const data=new GameAchievementsReader(reader);data.select('example@test','/example/cli');
  for(let i=0;i<4;i++)expect((await data.get('42')).status).toBe('error');expect(reader).toHaveBeenCalledTimes(4);
});
