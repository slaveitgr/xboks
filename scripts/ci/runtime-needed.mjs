import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { runtimeInputsChanged, runtimeRecipeMetadataOnly } from './runtime-inputs.mjs';
const base = process.env.BASE_SHA ?? '', head = process.env.HEAD_SHA ?? '';
if (!/^[a-f0-9]{40}$/.test(head) || (base && !/^[a-f0-9]{40}$/.test(base))) throw Error('Invalid diff identity');
// A history reset may leave github.event.before outside the new checkout.
// Rebuild conservatively rather than failing the diff or skipping native CI.
const force = process.env.FORCE_RUNTIME === 'true' || !base || /^0+$/.test(base) ||
  spawnSync('git', ['cat-file', '-e', `${base}^{commit}`], { stdio: 'ignore' }).status !== 0;
const changed = force ? [] : execFileSync('git', ['diff', '--name-only', '-z', base, head], { encoding: 'utf8' }).split('\0').filter(Boolean);
let metadataOnly = false;
if (!force && changed.includes('scripts/runtime-patches.lock.json')) {
  try {
    const read = commit => JSON.parse(execFileSync('git', ['show', `${commit}:scripts/runtime-patches.lock.json`], { encoding: 'utf8' }));
    metadataOnly = runtimeRecipeMetadataOnly(read(base), read(head));
  } catch { /* Missing/invalid locks use the normal rebuild path. */ }
}
const needed = force || runtimeInputsChanged(changed, metadataOnly);
if (!process.env.GITHUB_OUTPUT) throw Error('GITHUB_OUTPUT missing');
fs.appendFileSync(process.env.GITHUB_OUTPUT, `needed=${needed}\n`);
console.log(`Runtime build needed: ${needed}`);
