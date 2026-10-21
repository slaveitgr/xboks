import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {validateDxvkLock,dxvkComponents} from './build-runtime-dxvk.mjs';
const lock=JSON.parse(fs.readFileSync(new URL('./runtime-dxvk.lock.json',import.meta.url)));
const base=JSON.parse(fs.readFileSync(new URL('./runtime-base.lock.json',import.meta.url)));
test('DXVK uses the existing base revision, all pinned nested headers and verified upstream backport',()=>{
  assert.doesNotThrow(()=>validateDxvkLock(lock,base));
  assert.equal(lock.sources.dxvk.commit,'6227b633e8d528952873c4c146773663964fcb31');
  assert.equal(lock.sources.compiler.commit,'c5c1a5b9b61773d59592f628faa39be9add26282');
  assert.equal(lock.sources.compilerSpirv.commit,'c8ad050fcb29e42a2f57d9f59e97488f465c436d');
  assert.equal(lock.patch.upstream,'8dae2d8573af08378c6059aca3d5987da99d20b5');
  assert.equal(createHash('sha256').update(fs.readFileSync(new URL('../'+lock.patch.file,import.meta.url))).digest('hex'),lock.patch.sha256);
  const recipe=JSON.parse(fs.readFileSync(new URL('./runtime-patches.lock.json',import.meta.url)));
  assert.equal(recipe.dxvkSourceLockSha256,createHash('sha256').update(fs.readFileSync(new URL('./runtime-dxvk.lock.json',import.meta.url))).digest('hex'));
  assert.deepEqual(dxvkComponents,['d3d8.dll','d3d9.dll','d3d10core.dll','d3d11.dll','dxgi.dll']);
});
test('DXVK source validation rejects changing the base, unpinned inputs and unsafe paths',()=>{
  for(const mutate of [m=>{m.baseProtonCommit='b'.repeat(40);},m=>{m.sources.compiler.commit='master';},
    m=>{m.sources.compiler.path='../elsewhere';},m=>{m.sources.dxvk.url='file:///tmp/source';},
    m=>{delete m.sources.compilerSpirv;},m=>{m.sources.extra=m.sources.dxvk;},m=>{m.patch.sha256='';}]){
    const bad=structuredClone(lock);mutate(bad);assert.throws(()=>validateDxvkLock(bad,base));
  }
});
test('relaunch patch is pinned and exercised through actual DLL child-process contracts',()=>{
  const recipe=JSON.parse(fs.readFileSync(new URL('./runtime-patches.lock.json',import.meta.url)));
  const patch=recipe.patches.find(p=>p.file==='assets/xgameruntime-game-relaunch.patch');
  assert.ok(patch);
  assert.equal(createHash('sha256').update(fs.readFileSync(new URL('../'+patch.file,import.meta.url))).digest('hex'),patch.sha256);
  const probe=fs.readFileSync(new URL('./runtime-tests/game-relaunch-probe.c',import.meta.url),'utf8');
  assert.match(probe,/IXGameImpl2_XLaunchNewGame/);assert.match(probe,/caller-never-returns/);
  const runner=fs.readFileSync(new URL('./runtime-tests/run-contract-probes.mjs',import.meta.url),'utf8');
  assert.match(runner,/'game-relaunch'/);
});
