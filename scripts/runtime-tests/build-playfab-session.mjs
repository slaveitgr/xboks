// SPDX-License-Identifier: MIT
// Test-only GUI choices and SDK/user fixtures are never staged in a runtime.
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
export async function buildPlayFabSessionProbe(output, includeFlags) {
  await fs.mkdir(output,{recursive:true});
  const tests=path.dirname(fileURLToPath(import.meta.url));
  const compat=path.resolve(tests,'../runtime-compat');
  const fixture=path.join(tests,'playfab-session-probe.c');
  const definition=await fs.readFile(path.join(compat,'playfab-save-folder.def'),'utf8');
  const own=new Set(['PFGameSaveFilesInitialize','PFGameSaveFilesSetUiCallbacks',
    'PFGameSaveFilesAddUserWithUiAsync','PFGameSaveFilesIsConnectedToCloud',
    'PFGameSaveFilesUploadWithUiAsync','PFGameSaveFilesUploadWithUiResult',
    'PFGameSaveFilesUninitializeAsync','PFGameSaveFilesUninitializeResult']);
  const sdkDef=definition.replace(/^(PF\w+)(?:=\S+)? @(\d+)$/gm,(_,name,ordinal)=>
    `${name}${own.has(name)?'':name.startsWith('PFGameSaveFilesSetUi')?'=FixtureResponse':'=FixtureStub'} @${ordinal}`);
  const file=path.join(output,'sdk-fixture.def');
  await fs.writeFile(file,sdkDef);
  const env={...process.env,LD_LIBRARY_PATH:'',LD_PRELOAD:''};
  const run=args=>execFileSync('x86_64-w64-mingw32-gcc',args,{env,stdio:'inherit'});
  const base=['-O2','-Wall','-Wextra','-Werror','-Wl,--no-insert-timestamp'];
  run([...base,'-shared','-DPROBE_CORE',fixture,'-o',path.join(output,'PlayFabCore.dll')]);
  run([...base,'-shared','-DPROBE_SDK',fixture,file,'-o',path.join(output,'nexus_pgs_native.dll')]);
  run([...base,'-shared','-DPROBE_PROXY','-DNEXUS_PGS_TEST',fixture,
    path.join(compat,'playfab-save-folder.c'),path.join(compat,'playfab-session.c'),
    path.join(compat,'playfab-save-folder.def'),'-o',path.join(output,'PlayFabGameSave.dll')]);
  run([...base,'-D__WINESRC__',...includeFlags,fixture,'-o',path.join(output,'playfab-session-probe.exe')]);
}
