import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installSelection, parseInstallPlan, readInstallPlan } from './install-plan.js';

const root = '9AAAAAAAAAAA';
const contentId = '11111111-1111-4111-8111-111111111111';
const choice = { productId: root, contentId, title: 'Test game', platform: 'Windows.Desktop', packageFormat: 'MSIXVC', kind: 'Game', supported: true };
const plan = () => ({ schema: 1, rootProductId: root, market: 'US', status: 'ready', choices: [{ ...choice }] });
const parse = (value: unknown) => parseInstallPlan(JSON.stringify(value), root, 'US');
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true }); });
async function executable(code: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-package-plan-')); dirs.push(dir);
  const file = path.join(dir, 'cli'); await fs.writeFile(file, `#!${process.execPath}\n${code}`, { mode: 0o700 }); return file;
}
describe('package preflight protocol', () => {
  it('accepts one verified PC game and rejects a foreign Content ID', () => {
    expect(installSelection(parse(plan()))).toBe(contentId);
    expect(() => installSelection(parse(plan()), '22222222-2222-4222-8222-222222222222')).toThrow();
  });
  it('requires explicit choice for multiple games and for an add-on', () => {
    const multi = { ...plan(), status: 'choice', choices: [choice, { ...choice, contentId: '22222222-2222-4222-8222-222222222222' }] };
    expect(() => installSelection(parse(multi))).toThrow();
    expect(installSelection(parse(multi), contentId)).toBe(contentId);
    expect(() => installSelection(parse({ ...plan(), status: 'choice', choices: [{ ...choice, kind: 'GameAddOn' }] }))).toThrow();
  });
  it.each([
    { ...plan(), rootProductId: '9BBBBBBBBBBB' }, { ...plan(), market: 'CZ' }, { ...plan(), schema: 2 },
    { ...plan(), status: 'choice' }, { ...plan(), choices: [choice, choice] },
    { ...plan(), choices: [{ ...choice, platform: 'Xbox.One' }] },
    { ...plan(), choices: [{ ...choice, title: 'Bad\nlabel' }] },
    { ...plan(), choices: [{ ...choice, packageFormat: 'APPX' }] },
  ])('rejects mismatched or dishonest metadata %#', value => { expect(() => parse(value)).toThrow(); });
  it('cannot select an unsupported console package', () => {
    const value = parse({ ...plan(), status: 'unavailable', choices: [{ ...choice, supported: false, platform: 'Xbox.One' }] });
    expect(() => installSelection(value, contentId)).toThrow();
  });
  it('runs only the public command, closes stdin and preserves UTF-8', async () => {
    const value = { ...plan(), choices: [{ ...choice, title: 'Příliš žluťoučký' }] };
    const cli = await executable(`if(JSON.stringify(process.argv.slice(2))!==JSON.stringify(['resolve-package','${root}','--json','--market','US']))process.exit(2); process.stdin.on('end',()=>{const b=Buffer.from(${JSON.stringify(JSON.stringify(value))});process.stdout.write(b.subarray(0,110));process.stdout.write(b.subarray(110));});process.stdin.resume();`);
    expect(await readInstallPlan(cli, root, 'US')).toEqual(value);
  });
  it('bounds output, checks process failure and validates inputs before execution', async () => {
    const huge = await executable('process.stdout.write("x".repeat(300000));');
    await expect(readInstallPlan(huge, root, 'US')).rejects.toThrow('too large');
    const failed = await executable('console.error("Store unavailable");process.exit(1);');
    await expect(readInstallPlan(failed, root, 'US')).rejects.toThrow('Store unavailable');
    await expect(readInstallPlan('/must-not-run', '--help', 'US')).rejects.toThrow('Product ID');
  });
});
