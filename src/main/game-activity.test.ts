import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { GameActivities, installedTitleId, parseGameActivity } from './game-activity';

const payload = (patch = {}) => JSON.stringify({ schema: 1, account: 'example@test', titleId: '42', minutesPlayed: 2052, lastPlayed: '2026-01-01T12:00:00Z', partial: false, ...patch });
it('distinguishes genuine Xbox zero, missing and independently available fields', () => {
  expect(parseGameActivity(payload(), 'example@test', '42')).toMatchObject({ status: 'available', minutesPlayed: 2052 });
  expect(parseGameActivity(payload({ minutesPlayed: 0 }), 'example@test', '42').minutesPlayed).toBe(0);
  expect(parseGameActivity(payload({ minutesPlayed: null, lastPlayed: null }), 'example@test', '42')).toEqual({ status: 'unavailable', partial: false });
  expect(parseGameActivity(payload({ minutesPlayed: null }), 'example@test', '42')).toMatchObject({ status: 'available', lastPlayed: '2026-01-01T12:00:00.000Z' });
});
it.each([{ account: 'other@test' }, { titleId: '43' }, { schema: 2 }, { minutesPlayed: -1 }, { minutesPlayed: '42' }, { minutesPlayed: Infinity }, { minutesPlayed: 1e12 }, { lastPlayed: 'tomorrow' }, { lastPlayed: '9999-01-01T00:00:00Z' }, { partial: 'yes' }])('rejects malformed or mismatched activity %j', patch => {
  // Infinity is represented as JSON null, so exercise the finite parser separately.
  const raw = patch.minutesPlayed === Infinity ? payload().replace('2052','1e999') : payload(patch);
  expect(() => parseGameActivity(raw, 'example@test', '42')).toThrow();
});
it('coalesces reads and caches only the active account/backend, with explicit refresh', async () => {
  const reader = vi.fn(async () => payload()); const activities = new GameActivities(reader);
  activities.select('example@test', '/example/cli');
  const [a,b] = await Promise.all([activities.get('42'), activities.get('42')]);
  expect(a).toEqual(b); expect(reader).toHaveBeenCalledTimes(1);
  a.minutesPlayed = 0; expect((await activities.get('42')).minutesPlayed).toBe(2052);
  await activities.get('42', true); expect(reader).toHaveBeenCalledTimes(2);
  activities.select(); expect(await activities.get('42')).toEqual({ status: 'unsupported' });
  activities.select('other@test', '/example/cli'); expect(await activities.get('42')).toEqual({ status: 'error' });
});
it('aborts and rejects a stale in-flight account result', async () => {
  let resolve!: (value: string) => void; let signal!: AbortSignal;
  const activities = new GameActivities(async (_binary,_id,s) => { signal=s; return new Promise(r => { resolve=r; }); });
  activities.select('example@test','/example/cli'); const pending = activities.get('42');
  activities.select('other@test','/example/cli'); expect(signal.aborted).toBe(true); resolve(payload());
  expect(await pending).toEqual({ status: 'error' });
});
it('rejects invalid title arguments before a backend process is started', async () => {
  const reader=vi.fn(async()=>payload()); const activities=new GameActivities(reader); activities.select('example@test','/example/cli');
  for(const id of ['0','-1','0x2a','42;id','4294967296','../42']) await expect(activities.get(id)).rejects.toThrow();
  expect(reader).not.toHaveBeenCalled();
});
it('reads a case-insensitive bounded game config, converting hex TitleId to decimal without guessing', async () => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'activity-config-'));
  try {
    await fs.writeFile(path.join(dir,'MicrosoftGame.Config'),'<Game><!-- <TitleId>DEAD</TitleId> --><TitleId>0000002A</TitleId></Game>');
    expect(await installedTitleId(dir)).toBe('42');
    await fs.writeFile(path.join(dir,'MicrosoftGame.Config'),'<Game><TitleId>FFFFFFFFF</TitleId></Game>'); expect(await installedTitleId(dir)).toBeUndefined();
    await fs.writeFile(path.join(dir,'MicrosoftGame.Config'),'x'.repeat(1_000_001)); expect(await installedTitleId(dir)).toBeUndefined();
  } finally { await fs.rm(dir,{recursive:true,force:true}); }
});
