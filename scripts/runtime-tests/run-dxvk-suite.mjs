// SPDX-License-Identifier: MIT
// Software Vulkan only, a new prefix and synthetic compute shader/readback.
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync,spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const [runtimeArg,parentArg]=process.argv.slice(2);
if(!runtimeArg||!parentArg||process.argv.length!==4)throw Error('Usage: run-dxvk-suite.mjs RUNTIME WORK_PARENT');
for(const name of ['wine','wine64','wineserver','wineserver64','xodus-cli','xodus-service']){
  try{execFileSync('pgrep',['-x',name],{stdio:'ignore'});throw Error(`${name} active; wait before synthetic graphics tests`);}
  catch(e){if(e.status!==1)throw e;}
}
const runtime=await fs.realpath(runtimeArg),parent=await fs.realpath(parentArg);
const root=await fs.mkdtemp(path.join(parent,'runtime-dxvk-'));await fs.chmod(root,0o700);
const icdRoot='/usr/share/vulkan/icd.d';
const icd=(await fs.readdir(icdRoot)).filter(x=>/^lvp_icd(?:\.x86_64)?\.json$/.test(x)).sort().at(0);
if(!icd)throw Error('Mesa software Vulkan (lavapipe) is required for the DXVK regression');
const files=path.join(runtime,'files'),wine=path.join(files,'bin/wine'),server=path.join(files,'bin/wineserver');
const env={...process.env,WINEPREFIX:path.join(root,'pfx'),WINEARCH:'win64',WINEDEBUG:'-all,err+all',
  WINEDLLPATH:path.join(files,'lib/vkd3d')+':'+path.join(files,'lib/wine'),
  LD_LIBRARY_PATH:'/usr/lib:'+path.join(files,'lib/x86_64-linux-gnu'),
  WINEDLLOVERRIDES:'winemenubuilder.exe=d;mshtml=;mscoree=;d3d11=n;dxgi=n',
  VK_DRIVER_FILES:path.join(icdRoot,icd),VK_ICD_FILENAMES:path.join(icdRoot,icd),
  DXVK_LOG_LEVEL:'info',DXVK_LOG_PATH:root};
for(const key of Object.keys(env))if(/^(XODUS_|XUSER_|STEAM_COMPAT_|SteamAppId$|SteamGameId$|LD_PRELOAD$)/.test(key))delete env[key];
const source=fileURLToPath(new URL('./dxvk-compute-probe.c',import.meta.url)),exe=path.join(root,'dxvk-compute.exe');
execFileSync('x86_64-w64-mingw32-gcc',['-O2','-Wall',source,'-o',exe,'-ld3d11','-ld3dcompiler'],{stdio:'inherit'});
async function run(args){return await new Promise((resolve,reject)=>{
  const p=spawn(wine,args,{cwd:root,env,stdio:['ignore','pipe','pipe']});let output='',timeout=false;
  for(const pipe of [p.stdout,p.stderr])pipe.on('data',b=>{if(output.length<512000)output+=b;});
  const timer=setTimeout(()=>{timeout=true;try{execFileSync(server,['-k'],{env,timeout:5000,stdio:'ignore'});}catch{p.kill('SIGKILL');}},45000);
  p.once('error',e=>{clearTimeout(timer);reject(e);});p.once('close',code=>{clearTimeout(timer);resolve({code,timeout,output});});
});}
try{
  const boot=await run(['wineboot','--init']);await fs.writeFile(path.join(root,'boot.log'),boot.output);
  if(boot.code||boot.timeout)throw Error('Synthetic graphics prefix failed to initialize');
  for(const name of ['d3d8.dll','d3d9.dll','d3d10core.dll','d3d11.dll','dxgi.dll','libvkd3d-shader-1.dll']){
    const library=name==='libvkd3d-shader-1.dll'?'vkd3d':'wine/dxvk';
    const target=path.join(env.WINEPREFIX,'drive_c/windows/system32',name);
    await fs.copyFile(path.join(files,'lib',library,'x86_64-windows',name),target+'.probe',fs.constants.COPYFILE_EXCL);
    await fs.rename(target+'.probe',target);
  }
  const result=await run([exe]);await fs.writeFile(path.join(root,'compute.log'),result.output);
  const summary=result.output.split('\n').filter(x=>/^(FAIL |DXVK COMPUTE CHECKS )/.test(x));
  await fs.writeFile(path.join(root,'result.json'),JSON.stringify({root,icd,code:result.code,timeout:result.timeout,summary},null,2));
  console.log(JSON.stringify({root,code:result.code,timeout:result.timeout,summary}));
  if(result.code||result.timeout||!/DXVK COMPUTE CHECKS [1-9][0-9]* FAILURES 0/.test(result.output))throw Error('Synthetic DXVK compute regression failed');
}finally{try{execFileSync(server,['-k'],{env,timeout:5000,stdio:'ignore'});}catch{}}
