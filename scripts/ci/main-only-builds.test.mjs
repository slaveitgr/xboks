import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
const yaml=createRequire(import.meta.url)('js-yaml');
const read=async name=>yaml.load(await fs.readFile(`.github/workflows/${name}.yml`,'utf8'));
test('full backend/runtime workflows only build main, including manual dispatch',async()=>{
  for(const [name,job] of [['backend','build'],['runtime','changes']]){
    const workflow=await read(name);
    assert.deepEqual(workflow.on.push.branches,['main']);
    assert.equal(workflow.on.pull_request,undefined);
    assert.equal(workflow.jobs[job].if,"github.ref == 'refs/heads/main'");
  }
});
test('develop/PR checks cannot package or upload launcher candidates',async()=>{
  const steps=(await read('ci')).jobs.checks.steps;
  const checks=steps.find(step=>step.name==='Check source without compiling a distribution candidate');
  assert.equal(checks.if,"github.ref != 'refs/heads/main'");
  assert.equal(checks.run,'npm run typecheck && npm run test');
  for(const step of steps.filter(step=>step.run?.includes('npm run build')||step.run?.includes('electron-builder')||step.run?.includes('artifact-manifest.mjs')||step.uses?.startsWith('actions/upload-artifact'))){
    assert.equal(step.if,"github.ref == 'refs/heads/main'");
  }
});
test('the published backend uses the dedicated UI without WebKit build prerequisites',async()=>{
  const recipe=await fs.readFile('scripts/build-backend.mjs','utf8');
  assert.match(recipe,/const features = \['--no-default-features'\]/);
  assert.match(recipe,/External sign-in capability missing/);
  const native=(await read('backend')).jobs.build.steps.find(step=>step.name==='Install native build libraries').run;
  assert.doesNotMatch(native,/webkit|libgtk|libsoup/i);
});
test('runtime CI exposes the installed Ubuntu Wine tools before compilation',async()=>{
  const steps=(await read('runtime')).jobs.build.steps;
  const install=steps.findIndex(step=>step.name==='Install build and test prerequisites');
  const build=steps.findIndex(step=>step.name==='Build all shared components from pinned clean checkouts');
  assert.ok(install>=0&&build>install);
  assert.match(steps[install].run,/wine64-tools/);
  assert.match(steps[install].run,/test -x \/usr\/lib\/wine\/widl/);
  assert.match(steps[install].run,/echo \/usr\/lib\/wine >> "\$GITHUB_PATH"/);
});
