import {test} from 'node:test';
import assert from 'node:assert/strict';
import {shellFixture} from './fixtures/experience-shell.mjs';
import {NATIVE_PE_SHA256, NATIVE_DESKTOP_ID} from '../../desktop/gnome/xboks-experience@slaveitgr.github.io/native-state.js';

const nativeSender=':1.40',serviceSender=':1.50';
const identity={schema:1,pid:400,startTime:'123456789',executable:'/private/wine-preloader',
  pePath:'/private/original/XboxPcAppCE.exe',peSHA256:NATIVE_PE_SHA256,desktopId:NATIVE_DESKTOP_ID};

async function fixture({installed=true}={}) {
  const f=await shellFixture();
  f.native.records.set(400,identity);
  f.native.credentials.set(nativeSender,{pid:400,uid:1000});
  f.native.credentials.set(serviceSender,{pid:150,uid:1000});
  f.native.parents.set(150,100);
  if(installed)f.native.installedParents.add(100);
  f.home={get_pid:()=>400,get_wm_class:()=> 'xboxpcappce.exe',get_title:()=> 'XBOX',
    appId:NATIVE_DESKTOP_ID,get_transient_for:()=>null};
  f.windows.push(f.home);f.display.focus_window=f.home;
  const state=(await f.invokeNative('GetState')).value;
  const entered=await f.invokeNative('SetMode',nativeSender,[true,state[1]]);
  assert.deepEqual(entered.value.slice(1),[true,true]);
  return f;
}
const control=async f=>(await f.invoke('GetSwitcherControl',serviceSender)).value;
const action=(f,value,token)=>f.invoke('ControlSwitcher',serviceSender,[value,token]);

test('installed controller service receives a separate capability without owning the Native lease',async()=>{
  const f=await fixture();try{
    const initial=await control(f),modeEpoch=f.extension._nativeRevision.epoch;
    assert.deepEqual(initial.slice(1),[true,false,false,true]);
    assert.equal(f.extension._lease.owner,nativeSender);
    assert.equal(f.watches.size,1);
    assert.deepEqual((await f.invoke('GetState',serviceSender)).value,[true,false]);
    assert.equal((await f.invoke('Switch',serviceSender,['open'])).error,'not-authorized');
    assert.equal((await f.invoke('Leave',serviceSender)).error,'not-authorized');
    assert.equal((await f.invoke('Enter',serviceSender)).error,'busy');
    assert.deepEqual((await action(f,'open',initial[0])).value,[true]);
    const opened=await control(f);
    assert.ok(opened[0]>initial[0]);
    assert.deepEqual(opened.slice(1),[true,false,true,true]);
    assert.equal(f.extension._nativeRevision.epoch,modeEpoch,'switcher state must not alter the native mode epoch');
    assert.equal((await action(f,'next',initial[0])).error,'stale-control');
    assert.deepEqual((await action(f,'next',opened[0])).value,[true]);
    assert.equal(f.extension._lease.owner,nativeSender);
  }finally{f.extension.disable();}
});

test('portable/unknown, wrong-user and writable installed executables cannot control a Native-owned switcher',async()=>{
  for(const cause of ['portable','wrong-user','wrong-parent','wrong-owner','writable']){
    const f=await fixture({installed:cause!=='portable'});try{
      if(cause==='wrong-user')f.native.processUsers.set(150,1001);
      if(cause==='wrong-parent')f.native.parents.set(150,999);
      if(cause==='wrong-owner')f.native.installedOwnerUid=1000;
      if(cause==='writable')f.native.installedMode=0o100775;
      const state=await control(f);
      assert.deepEqual(state.slice(1),[true,false,false,false],cause);
      assert.equal((await action(f,'open',state[0])).error,'not-authorized',cause);
      assert.equal(f.extension._switcher.visible,false);
      assert.equal(f.extension._lease.owner,nativeSender);
    }finally{f.extension.disable();}
  }
});

test('keyboard-open, cancel and reopen each invalidate queued controller actions without changing Native ownership',async()=>{
  const f=await fixture();try{
    const initial=await control(f),modeEpoch=f.extension._nativeRevision.epoch;
    f.Main.overview.toggle();
    const opened=await control(f);
    assert.ok(opened[0]>initial[0]);assert.equal(opened[3],true);
    assert.equal((await action(f,'accept',initial[0])).error,'stale-control');
    await action(f,'cancel',opened[0]);
    const closed=await control(f);
    assert.equal(closed[3],false);assert.ok(closed[0]>opened[0]);
    f.Main.overview.toggle();
    const reopened=await control(f);
    assert.equal((await action(f,'accept',opened[0])).error,'stale-control');
    assert.equal((await action(f,'next',closed[0])).error,'stale-control');
    assert.deepEqual((await action(f,'previous',reopened[0])).value,[true]);
    assert.equal(f.extension._nativeRevision.epoch,modeEpoch);
  }finally{f.extension.disable();}
});

test('delegated cancel supports Guide handoff; explicit Desktop releases the Native lease and revokes control',async()=>{
  const f=await fixture();try{
    let state=await control(f);await action(f,'open',state[0]);
    state=await control(f);await action(f,'cancel',state[0]);
    assert.equal(f.extension._switcher.visible,false);
    assert.equal(f.extension._lease.owner,nativeSender);
    const guide={get_pid:()=>100,get_wm_class:()=> 'xboks',get_title:()=> 'XBOKS Game Bar'};
    f.windows.push(guide);assert.deepEqual((await f.invoke('FocusGuide',serviceSender)).value,[]);
    assert.equal(f.display.focus_window,guide);
    state=await control(f);await action(f,'open',state[0]);
    state=await control(f);await action(f,'desktop',state[0]);
    const desktop=await control(f);
    assert.deepEqual(desktop.slice(1),[false,false,false,false]);
    assert.ok(desktop[0]>state[0]);assert.equal(f.panel.visible,true);
    assert.equal((await action(f,'open',state[0])).error,'not-authorized');
  }finally{f.extension.disable();}
});

test('controller-service disappearance never releases the Native owner; Native loss does revoke delegated permission',async()=>{
  const f=await fixture();try{
    let state=await control(f);await action(f,'open',state[0]);
    f.ownerLost(serviceSender);
    assert.equal(f.extension._lease.owner,nativeSender);
    assert.equal(f.panel.visible,false);
    f.ownerLost(nativeSender);
    state=await control(f);
    assert.deepEqual(state.slice(1),[false,false,false,false]);
    assert.equal(f.panel.visible,true);assert.equal(f.watches.size,0);
  }finally{f.extension.disable();}
});

test('enrollment revocation, lock and extension disable reject pending or subsequent delegated actions',async()=>{
  for(const cause of ['enrollment','lock','disable']){
    const f=await fixture();try{
      const state=await control(f);
      if(cause==='enrollment')f.native.current=false;
      if(cause==='lock'){f.Main.sessionMode.isLocked=true;f.Main.sessionMode.emit('updated');}
      if(cause==='disable')f.extension.disable();
      const denied=await action(f,'open',state[0]);
      assert.ok(['not-authorized','unavailable'].includes(denied.error),cause);
      if(cause!=='disable')assert.equal((await control(f))[4],false);
    }finally{f.extension.disable();}
  }
});

test('authentication completing after mode transition or helper-parent change cannot replay an old command',async()=>{
  for(const cause of ['mode','parent']){
    const f=await fixture();try{
      const state=await control(f);let release,started;
      const waiting=new Promise(resolve=>{started=resolve;});
      let held=false;
      f.native.beforeCredential=async(_method,sender)=>{
        if(sender===serviceSender&&!held){held=true;await new Promise(resolve=>{release=resolve;started();});}
      };
      const pending=action(f,'open',state[0]);await waiting;
      if(cause==='mode')f.extension._lease.forceLeave();else f.native.parents.set(150,999);
      release();const denied=await pending;
      assert.equal(denied.error,'not-authorized',cause);
      assert.equal(f.extension._switcher?.visible??false,false);
    }finally{f.extension.disable();}
  }
});

test('disable after helper authentication rejects control before a cleared bus connection is used',async()=>{
  const f=await fixture();try{
    const state=await control(f),original=f.extension._callerMain.bind(f.extension);
    f.extension._callerMain=async invocation=>{
      const parent=await original(invocation);f.extension.disable();return parent;
    };
    const denied=await action(f,'open',state[0]);
    assert.equal(denied.error,'unavailable');
    assert.equal(f.panel.visible,true);assert.equal(f.watches.size,0);
  }finally{f.extension.disable();}
});

test('invalid delegated actions and epochs fail closed; the ordinary owned switcher path is unchanged',async()=>{
  const f=await fixture();try{
    const state=await control(f);
    assert.equal((await action(f,'kill-process',state[0])).error,'invalid-action');
    for(const value of [state[0]-1,'100',-1,NaN,1.5,Number.MAX_SAFE_INTEGER+1])
      assert.equal((await action(f,'open',value)).error,'stale-control');
    f.extension._lease.forceLeave();
    f.display.focus_window=f.windows[0];
    await f.invoke('Enter');await f.invoke('Switch',':1.1',['open']);
    const own=(await f.invoke('GetSwitcherControl',':1.1')).value;
    assert.deepEqual(own.slice(1),[true,true,true,false]);
    assert.deepEqual((await f.invoke('Switch',':1.1',['next'])).value,[true]);
  }finally{f.extension.disable();}
});
