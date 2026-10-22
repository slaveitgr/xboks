import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inspectMsix, main} from './inspect.mjs';

function fixture(bundle = true) {
  const archive = kind => ({kind,entryCount:3,declaredUncompressedBytes:2000,signaturePresent:true,blockMapPresent:true,signatureValidated:false,blockMapValidated:false});
  const identity = {name:'Example.Game',publisher:'CN=Example',version:'1.0.0.0',architecture:'x64'};
  const manifest = {schema:1,identity,applications:[{id:'App',activation:'appcontainer-uwp',requiresRuntimeValidation:true}],runtimeValidation:'required',signatureValidation:'not-performed'};
  const input = {schemaVersion:1,inspectionOnly:true,requestedArchitecture:'x64',source:{sizeBytes:1000,sha256:'a'.repeat(64)},
    archive:archive(bundle?'bundle':'package'),bundle:bundle?{identity:{...identity},selectedMember:'app.msix',packages:[{fileName:'app.msix',archivePath:'app.msix',type:'application',architecture:'x64',version:'1.0.0.0'}]}:null,
    selectedPackage:{memberPath:bundle?'app.msix':null,sizeBytes:800,archive:archive('package'),manifest:{xml:'<untrusted-manifest/>'}},limitations:['Inspection only.']};
  const options = {scan:async()=>input,parseManifest:async()=>manifest};
  return {input,manifest,options};
}
test('joins archive and manifest identity without treating signed metadata as runnable', async()=>{
  const f=fixture(),result=await inspectMsix('/local/game.msixbundle','x64',f.options);
  assert.equal(result.gameCompatibilityProven,false);assert.equal(result.inspectionOnly,true);
  assert.equal(result.selectedPackage.manifest.applications[0].activation,'appcontainer-uwp');
  assert.equal(result.archive.signatureValidated,false);assert.equal(result.archive.blockMapValidated,false);
  assert.equal(JSON.stringify(result).includes('<untrusted-manifest/>'),false);
});
test('accepts standalone package inspection without inventing bundle relationships',async()=>{
  const f=fixture(false),result=await inspectMsix('/local/game.msix','x64',f.options);
  assert.equal(result.bundle,null);assert.equal(result.selectedPackage.memberPath,null);
});
test('joins the logical OPC name to the separately checked encoded archive path',async()=>{
  const f=fixture();f.input.bundle.selectedMember='Example Game.msix';
  f.input.bundle.packages[0].fileName='Example Game.msix';f.input.bundle.packages[0].archivePath='Example%20Game.msix';
  f.input.selectedPackage.memberPath='Example%20Game.msix';
  const result=await inspectMsix('/local/game.msixbundle','x64',f.options);
  assert.equal(result.selectedPackage.memberPath,'Example%20Game.msix');assert.equal(result.bundle.selectedMember,'Example Game.msix');
});
for(const [name,change] of [
  ['different publisher',f=>{f.manifest.identity.publisher='CN=Other';}],
  ['different version',f=>{f.input.bundle.packages[0].version='2.0.0.0';}],
  ['duplicate member',f=>{f.input.bundle.packages.push({...f.input.bundle.packages[0]});}],
  ['resource-only member',f=>{f.input.bundle.packages[0].type='resource';}],
  ['changed selected filename',f=>{f.input.selectedPackage.memberPath='other.msix';}],
])test('rejects bundle mismatch: '+name,async()=>{
  const f=fixture();change(f);await assert.rejects(inspectMsix('/local/game.msixbundle','x64',f.options),/identities|selection/);
});
test('rejects a wrong executable architecture even for a standalone package',async()=>{
  const f=fixture(false);f.manifest.identity.architecture='arm64';
  await assert.rejects(inspectMsix('/local/game.msix','x64',f.options),/architecture/);
});
test('preserves neutral architecture without presenting it as native execution evidence',async()=>{
  const f=fixture();f.manifest.identity.architecture='neutral';f.input.bundle.packages[0].architecture='neutral';
  const result=await inspectMsix('/local/game.msixbundle','x64',f.options);
  assert.equal(result.selectedPackage.manifest.identity.architecture,'neutral');assert.equal(result.gameCompatibilityProven,false);
});
test('refuses incorrect protocol and trust fields instead of publishing partial inspection',async()=>{
  for(const change of [f=>f.input.schemaVersion=2,f=>f.input.inspectionOnly=false,f=>f.input.archive.signatureValidated=true,f=>f.input.source.sha256='wrong']) {
    const f=fixture();change(f);await assert.rejects(inspectMsix('/local/game.msixbundle','x64',f.options),/Invalid archive/);
  }
});
test('rejects unsupported architecture before reading any file or invoking Python',async()=>{
  let calls=0;await assert.rejects(inspectMsix('/local/game.msix','arm',{scan:async()=>{calls++;}}),/architecture/);assert.equal(calls,0);
});
test('rejects missing package and unknown CLI options before any file access',async()=>{
  await assert.rejects(main([]),/Choose a local package/);
  await assert.rejects(main(['--install','game.msix']),/Usage/);
});
test('preserves source path components for the secure archive open',async()=>{
  const f=fixture();let received;
  await inspectMsix('/local/link/../game.msix','x64',{...f.options,scan:async file=>{received=file;return f.input;}});
  assert.equal(received,'/local/link/../game.msix');
});
