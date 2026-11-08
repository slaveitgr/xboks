import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {canonicalAbsolutePath, processStartTime, sameProcessUser, secureMetadata, validateEnrollment,
  commandLineNamesPe, nativeWindowForProcess, NativeRevision, NATIVE_PE_SHA256, NATIVE_DESKTOP_ID, NATIVE_OBJECT} from '../../desktop/gnome/xboks-experience@slaveitgr.github.io/native-state.js';
import {shellFixture} from './fixtures/experience-shell.mjs';

const pePath='/home/player/original/XboxPcAppCE.exe', executable='/home/player/runtime/wine-preloader';
const record={schema:1,pid:400,startTime:'987654321012345678',executable,pePath,peSHA256:NATIVE_PE_SHA256,desktopId:NATIVE_DESKTOP_ID};
const process={pid:400,uid:1000,startTime:record.startTime,executable,commandLine:[pePath]};

test('enrollment binds exact PID/start identity, pinned original CE bytes, desktop identity and selected PE argument',()=>{
  assert.equal(validateEnrollment(record,process),true);
  for(const patch of [{schema:2},{pid:401},{startTime:'987654321012345679'},{startTime:987654321},{executable:'/usr/bin/wine'},
    {pePath:'/home/player/original/../XboxPcAppCE.exe'},{peSHA256:'0'.repeat(64)},{desktopId:'xboks.desktop'},
    {extra:'unrecognized'},{pePath:'/home/player/original/XboxPcApp.exe'}])
    assert.equal(Boolean(validateEnrollment({...record,...patch},process)),false,JSON.stringify(patch));
  assert.equal(Boolean(validateEnrollment(record,{...process,commandLine:['/home/player/other.exe','--data',pePath]})),false);
  assert.equal(Boolean(validateEnrollment(record,{...process,executable:'/other/preloader'})),false);
  assert.equal(Boolean(validateEnrollment(record,{...process,startTime:'123'})),false);
});

test('Wine Z paths support repeated backslashes and filename case while rejecting traversal, foreign drive and arbitrary later arguments',()=>{
  for(const args of [[pePath],['Z:\\home\\player\\original\\XboxPcAppCE.exe'],['Z:\\\\home\\\\player\\\\original\\\\xboxpcappce.exe'],
    [executable,pePath],['wine',pePath]]) assert.equal(commandLineNamesPe(args,pePath,executable),true,JSON.stringify(args));
  for(const args of [['C:\\home\\player\\original\\XboxPcAppCE.exe'],['/home/Player/original/XboxPcAppCE.exe'],
    ['Z:\\home\\player\\original\\..\\original\\XboxPcAppCE.exe'],['other.exe',pePath],[executable,'--arg',pePath]])
    assert.equal(commandLineNamesPe(args,pePath,executable),false,JSON.stringify(args));
  for(const value of ['relative','/home//player/file','/home/./file','/home/../file','/home/file\0']) assert.equal(canonicalAbsolutePath(value),false);
});

test('Linux process identity parses stat field22 without losing ticks or splitting a comm containing parentheses',()=>{
  const fields=['S',...Array(18).fill('0'),record.startTime,'0'];
  assert.equal(processStartTime(`400 (odd ) process) ${fields.join(' ')}`),record.startTime);
  assert.equal(processStartTime('400 malformed'),null);
  assert.equal(processStartTime('400 (name) S 0'),null);
  assert.equal(sameProcessUser('Uid:\t1000\t1000\t1000\t1000\n',1000),true);
  assert.equal(sameProcessUser('Uid:\t1000\t1000\t0\t1000\n',1000),false);
  assert.equal(sameProcessUser('Uid:\t0\t0\t0\t0\n',0),false);
});

test('private enrollment rejects symlink/nonregular type, wrong owner and broader mode',()=>{
  assert.equal(secureMetadata({kind:'regular',uid:1000,mode:0o100600},1000,'regular',true),true);
  assert.equal(secureMetadata({kind:'directory',uid:1000,mode:0o40700},1000,'directory',true),true);
  for(const patch of [{kind:'symlink'},{uid:1001},{mode:0o100644},{mode:0o100660},{mode:0o104600}])
    assert.equal(secureMetadata({kind:'regular',uid:1000,mode:0o100600,...patch},1000,'regular',true),false);
  assert.equal(secureMetadata({kind:'regular',uid:1000,mode:0o100755},1000,'regular'),true);
  assert.equal(secureMetadata({kind:'regular',uid:1000,mode:0o100775},1000,'regular'),false);
});

test('native epoch rejects stale or unsafe inputs; focus follows bounded transient ownership without title/class trust',()=>{
  const revision=new NativeRevision(100);
  revision.assert(100n);revision.bump();assert.throws(()=>revision.assert(100),/stale/);
  for(const value of [-1,NaN,1.5,Number.MAX_SAFE_INTEGER+1,'101']) assert.throws(()=>revision.assert(value),/stale/);
  const home={get_pid:()=>400},child={get_pid:()=>500,get_transient_for:()=>home};
  assert.equal(nativeWindowForProcess(child,400),true);
  assert.equal(nativeWindowForProcess({get_pid:()=>999,get_title:()=> 'XBOX',get_wm_class:()=> 'xboxpcappce.exe'},400),false);
  const cycle={get_pid:()=>999};cycle.get_transient_for=()=>cycle;assert.equal(nativeWindowForProcess(cycle,400),false);
});

async function nativeFixture(options) {
  const f=await shellFixture(options);
  f.native.records.set(400,record);f.native.credentials.set(':1.40',{pid:400,uid:1000});
  f.home={get_pid:()=>400,get_wm_class:()=> 'xboxpcappce.exe',get_title:()=> 'XBOX',appId:NATIVE_DESKTOP_ID,get_transient_for:()=>null};
  f.windows.push(f.home);return f;
}
const nativeState=async f=>(await f.invokeNative('GetState')).value;

test('Native1 GetState reports global support before enrollment/focus while permission stays side-effect free and enrollment bound',async()=>{
  const f=await nativeFixture();try{
    const state=await nativeState(f);assert.deepEqual([state[0],...state.slice(2)],[1,true,false,false,false]);
    assert.equal(f.panel.visible,true);assert.equal(f.watches.size,0);assert.equal(f.native.monitors.size,0);
    f.display.focus_window=f.home;
    assert.deepEqual((await nativeState(f)).slice(2),[true,false,true,false]);
    f.native.records.delete(400);assert.deepEqual((await nativeState(f)).slice(2),[true,false,false,false]);
    const denied=await f.invokeNative('SetMode',':1.40',[true,state[1]]);
    assert.equal(denied.error,'not-authorized');
    assert.equal(denied.errorName,'org.slaveitgr.Xboks.Experience.Native1.Error.AccessDenied');
    assert.equal(f.panel.visible,true);
  }finally{f.extension.disable();}
});

test('Native1 owns one lease, emits monotonic epoch/state and restores existing Shell state on explicit exit',async()=>{
  const f=await nativeFixture();try{
    f.display.focus_window={get_pid:()=>500,get_transient_for:()=>f.home};
    const initial=await nativeState(f);
    const entered=await f.invokeNative('SetMode',':1.40',[true,initial[1]]);
    assert.deepEqual(entered.value.slice(1),[true,true]);assert.ok(entered.value[0]>initial[1]);
    assert.equal(f.panel.visible,false);assert.equal(f.watches.size,1);assert.equal(f.native.monitors.size,1);
    const signals=f.output.filter(item=>item.object===NATIVE_OBJECT&&item.name==='StateChanged');
    assert.deepEqual(signals.at(-1).state,[entered.value[0],true]);
    f.display.focus_window={get_pid:()=>999}; // Leaving is allowed after the owner loses focus.
    assert.equal((await nativeState(f))[4],true);
    assert.deepEqual((await f.invokeNative('SetMode',':1.40',[false,entered.value[0]])).value.slice(1),[false,false]);
    assert.equal(f.panel.visible,true);assert.equal(f.watches.size,0);assert.equal(f.native.monitors.size,0);
    assert.deepEqual((await f.invoke('GetState')).value,[false,false]);
  }finally{f.extension.disable();}
});

test('Native1 cannot take an existing XBOKS lease, and stale/concurrent setters cannot reenter mode',async()=>{
  const f=await nativeFixture();try{
    await f.invoke('Enter');f.display.focus_window=f.home;const occupied=await nativeState(f);
    assert.deepEqual(occupied.slice(2),[true,true,false,false]);
    assert.equal((await f.invokeNative('SetMode',':1.40',[true,occupied[1]])).error,'busy');
    assert.equal((await f.invokeNative('SetMode',':1.40',[false,occupied[1]])).error,'not-authorized');
    await f.invoke('Leave');const initial=await nativeState(f);
    assert.equal((await f.invokeNative('SetMode',':1.40',[true,occupied[1]])).error,'stale-epoch');
    const results=await Promise.all([f.invokeNative('SetMode',':1.40',[true,initial[1]]),f.invokeNative('SetMode',':1.40',[true,initial[1]])]);
    assert.equal(results.filter(result=>result.value).length,1);assert.equal(results.filter(result=>result.error==='stale-epoch').length,1);
    assert.equal(f.watches.size,1);
  }finally{f.extension.disable();}
});

test('Native1 owner loss, enrollment revocation, lock and disable restore once without automatic reentry',async()=>{
  for(const cause of ['owner','enrollment','lock','disable']){
    const f=await nativeFixture();f.display.focus_window=f.home;const state=await nativeState(f);
    await f.invokeNative('SetMode',':1.40',[true,state[1]]);
    if(cause==='owner')f.ownerLost(':1.40');
    if(cause==='enrollment')f.native.monitors.get(400)();
    if(cause==='lock'){f.Main.sessionMode.isLocked=true;f.Main.sessionMode.emit('updated');}
    if(cause==='disable')f.extension.disable();
    assert.equal(f.panel.visible,true,cause);assert.equal(f.watches.size,0,cause);assert.equal(f.native.monitors.size,0,cause);
    if(cause!=='disable'){assert.equal(f.extension._lease.active,false);assert.equal((await f.invokeNative('SetMode',':1.40',[true,state[1]])).error,'stale-epoch');}
    f.extension.disable();
  }
});

test('Native1 checks kernel user, current enrollment and extension epoch after asynchronous verification',async()=>{
  const f=await nativeFixture();try{
    f.display.focus_window=f.home;f.native.credentials.set(':1.40',{pid:400,uid:1001});
    assert.equal((await nativeState(f))[2],false);f.native.credentials.set(':1.40',{pid:400,uid:1000});
    f.native.current=false;assert.deepEqual((await nativeState(f)).slice(2),[true,false,false,false]);f.native.current=true;
    const state=await nativeState(f);let resume,started;
    const waiting=new Promise(resolve=>{started=resolve;});
    f.native.beforeVerify=()=>new Promise(resolve=>{resume=resolve;started();});
    const pending=f.invokeNative('SetMode',':1.40',[true,state[1]]);await waiting;f.extension.disable();resume();
    assert.equal((await pending).error,'unavailable');assert.equal(f.panel.visible,true);assert.equal(f.watches.size,0);
  }finally{f.extension.disable();}
});

test('Native1 monitor/apply failure does not retain native ownership or change old entry authorization',async()=>{
  for(const options of [{failApply:true},{emergencyAvailable:false},{}]){
    const f=await nativeFixture(options);f.display.focus_window=f.home;
    if(!options.failApply&&options.emergencyAvailable!==false)f.native.failWatch=true;
    const state=await nativeState(f),result=await f.invokeNative('SetMode',':1.40',[true,state[1]]);
    assert.ok(result.error);assert.equal(f.panel.visible,true);assert.equal(f.extension._nativeOwner,null);
    assert.equal(f.native.monitors.size,0);assert.equal(f.watches.size,0);
    assert.equal((await f.invoke('Enter')).error,'not-authorized');f.extension.disable();
  }
});

test('Native1 switcher Home returns to the enrolled CE owner and loss of its process identity exits mode',async()=>{
  const f=await nativeFixture();try{
    f.display.focus_window=f.home;const initial=await nativeState(f);await f.invokeNative('SetMode',':1.40',[true,initial[1]]);
    f.display.focus_window={get_pid:()=>999};f.extension._focusXbox();await new Promise(resolve=>setImmediate(resolve));
    assert.equal(f.display.focus_window,f.home);
    f.native.records.delete(400);f.extension._focusXbox();await new Promise(resolve=>setImmediate(resolve));
    assert.equal(f.panel.visible,true);assert.equal(f.extension._lease.active,false);
  }finally{f.extension.disable();}
});

test('Native1 cleanup continues after a monitor-disconnect error and service-name loss revokes a native lease',async()=>{
  for(const cause of ['monitor-error','name-loss']){
    const f=await nativeFixture();f.display.focus_window=f.home;const state=await nativeState(f);
    await f.invokeNative('SetMode',':1.40',[true,state[1]]);
    if(cause==='monitor-error'){f.native.failStop=true;f.ownerLost(':1.40');}
    else f.nameLost();
    assert.equal(f.panel.visible,true);assert.equal(f.native.monitors.size,0);assert.equal(f.watches.size,0);
    assert.equal(f.extension._nativeOwner,null);f.extension.disable();
  }
});

test('read-only global mode remains truthful without enrollment; overview and credential changes deny mutation',async()=>{
  const f=await nativeFixture();try{
    await f.invoke('Enter');f.native.records.delete(400);
    assert.deepEqual((await nativeState(f)).slice(2),[true,true,false,false]);
    assert.equal(f.extension._lease.owner,':1.1');assert.equal(f.watches.size,1);
    await f.invoke('Leave');f.native.records.set(400,record);f.display.focus_window=f.home;
    f.Main.overview.visible=true;let state=await nativeState(f);
    assert.equal(state[4],false);
    const denied=await f.invokeNative('SetMode',':1.40',[true,state[1]]);
    assert.equal(denied.errorName,'org.slaveitgr.Xboks.Experience.Native1.Error.OverviewOpen');
    f.Main.overview.visible=false;state=await nativeState(f);let resume,started;
    const waiting=new Promise(resolve=>{started=resolve;});
    f.native.beforeVerify=()=>new Promise(resolve=>{resume=resolve;started();});
    const pending=f.invokeNative('SetMode',':1.40',[true,state[1]]);await waiting;
    f.native.credentials.set(':1.40',{pid:400,uid:1001});resume();
    assert.equal((await pending).errorName,'org.slaveitgr.Xboks.Experience.Native1.Error.AccessDenied');
    assert.equal(f.panel.visible,true);assert.equal(f.watches.size,0);
  }finally{f.extension.disable();}
});

test('actual GJS/Gio file reader verifies opened-file metadata, strict private modes, symlink refusal and bounded chunked hashing',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'xboks-native-auth-'));
  try{
    const file=path.join(root,'record.json'),hashFile=path.join(root,'payload'),bulkFile=path.join(root,'large-payload'),link=path.join(root,'link.json');
    await fs.writeFile(file,'{"schema":1}',{mode:0o600});await fs.chmod(file,0o600);
    await fs.writeFile(hashFile,'abc',{mode:0o600});await fs.symlink(file,link);
    const bulk=Buffer.alloc(300000,42);await fs.writeFile(bulkFile,bulk,{mode:0o600});
    const bulkDigest=createHash('sha256').update(bulk).digest('hex');
    const module=path.resolve('desktop/gnome/xboks-experience@slaveitgr.github.io/native-state.js');
    const source=(await fs.readFile('desktop/gnome/xboks-experience@slaveitgr.github.io/native-auth.js','utf8')).replace(/^import .*;\r?\n/gm,'');
    const fixture=path.join(root,'reader-probe.js');
    await fs.writeFile(fixture,`import Gio from 'gi://Gio';\nimport GLib from 'gi://GLib';\nimport {canonicalAbsolutePath, processStartTime, sameProcessUser, secureMetadata, validateEnrollment, commandLineNamesPe, NATIVE_PE_SHA256} from ${JSON.stringify(pathToFileURL(module).href)};\n${source}\n
const uid=Number(readProc('/proc/self/status').match(/^Uid:\\s+(\\d+)/m)[1]);
let checks=0;
function check(value){checks++;if(!value)throw Error('Reader assertion '+checks);}
async function rejected(action){try{await action();return false;}catch{return true;}}
const contents=await checkedRead(${JSON.stringify(file)},uid,true,16384);check(contents.text==='{"schema":1}');
const digest=await checkedRead(${JSON.stringify(hashFile)},uid,false,16384,true);check(digest.sha256==='ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
const bulk=await checkedRead(${JSON.stringify(bulkFile)},uid,false,524288,true);check(bulk.sha256===${JSON.stringify(bulkDigest)});
check(await rejected(()=>checkedRead(${JSON.stringify(link)},uid,true,16384)));
check(await rejected(()=>checkedRead(${JSON.stringify(file)},uid+1,true,16384)));
check(await rejected(()=>checkedRead(${JSON.stringify(file)},uid,true,3)));
GLib.chmod(${JSON.stringify(file)},0o644);check(await rejected(()=>checkedRead(${JSON.stringify(file)},uid,true,16384)));
print(JSON.stringify({checks,failed:0}));\n`,{mode:0o600});
    const result=execFileSync('gjs',['-m',fixture],{encoding:'utf8',env:{...process.env,DISPLAY:'',WAYLAND_DISPLAY:''},timeout:15000});
    assert.deepEqual(JSON.parse(result.trim()),{checks:7,failed:0});
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
