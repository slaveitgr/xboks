import {test} from 'node:test';
import assert from 'node:assert/strict';
import {shellFixture} from './fixtures/experience-shell.mjs';

function handlers(f) {
  const calls=[];
  const native=f.display.connect('overlay-key',()=>calls.push('native'));
  f.GObject.signal_handler_block(f.display,native);
  const tahoe=f.display.connect('overlay-key',()=>calls.push('tahoe'));
  return {calls,native,tahoe};
}

test('Super leases the currently active Tahoe handler while preserving the already blocked native handler',async()=>{
  const f=await shellFixture(),h=handlers(f);try{
    f.display.emit('overlay-key');assert.deepEqual(h.calls,['tahoe']);h.calls.length=0;
    await f.invoke('Enter');
    assert.equal(f.display.signals.get(h.native).blocked,1);
    assert.equal(f.display.signals.get(h.tahoe).blocked,1);
    f.display.emit('overlay-key');
    assert.equal(f.extension._switcher.visible,true);assert.deepEqual(h.calls,[]);
    f.display.emit('overlay-key');assert.equal(f.extension._switcher.visible,false);
    await f.invoke('Leave');
    assert.equal(f.display.signals.get(h.native).blocked,1);
    assert.equal(f.display.signals.get(h.tahoe).blocked,0);
    f.display.emit('overlay-key');assert.deepEqual(h.calls,['tahoe']);
  }finally{f.extension.disable();}
});

test('the mode handler stops later overlay-key handlers without touching their registration or unrelated signals',async()=>{
  const f=await shellFixture(),h=handlers(f);try{
    await f.invoke('Enter');
    const late=f.display.connect('overlay-key',()=>h.calls.push('late'));
    const other=f.display.connect('unrelated',()=>h.calls.push('unrelated'));
    f.display.emit('overlay-key');f.display.emit('unrelated');
    assert.deepEqual(h.calls,['unrelated']);
    assert.equal(f.display.signals.get(late).blocked,0);
    await f.invoke('Leave');
    assert.equal(f.display.signals.has(late),true);assert.equal(f.display.signals.has(other),true);
    f.display.emit('overlay-key');assert.deepEqual(h.calls,['unrelated','tahoe','late']);
  }finally{f.extension.disable();}
});

test('sticky keys retain their existing bare-Super behavior and the setting is read live without a write',async()=>{
  const f=await shellFixture(),h=handlers(f);try{
    f.native.stickyKeys=true;await f.invoke('Enter');f.display.emit('overlay-key');
    assert.equal(f.extension._switcher.visible,false);assert.deepEqual(h.calls,[]);
    f.native.stickyKeys=false;f.display.emit('overlay-key');assert.equal(f.extension._switcher.visible,true);
    f.native.stickyKeys=true;f.display.emit('overlay-key');assert.equal(f.extension._switcher.visible,true);
    await f.invoke('Leave');assert.equal(f.native.stickyKeys,true);
  }finally{f.extension.disable();}
});

test('external blocks and disconnections are preserved, and own handler cleanup is idempotent',async()=>{
  const f=await shellFixture(),h=handlers(f);try{
    const disconnected=f.display.connect('overlay-key',()=>h.calls.push('disconnected'));
    await f.invoke('Enter');
    const own=[...f.display.signals].find(([,entry])=>entry.signal==='overlay-key'&&!entry.blocked)[0];
    f.GObject.signal_handler_block(f.display,h.tahoe);
    f.display.disconnect(disconnected);f.display.disconnect(own);
    await f.invoke('Leave');f.extension.disable();
    assert.equal(f.display.signals.has(own),false);assert.equal(f.display.signals.has(disconnected),false);
    assert.equal(f.display.signals.get(h.native).blocked,1);
    assert.equal(f.display.signals.get(h.tahoe).blocked,1,'release only our own one-deep block');
  }finally{f.extension.disable();}
});

test('a later mode apply failure restores signal ownership and all desktop state',async()=>{
  const f=await shellFixture({failApply:true}),h=handlers(f);try{
    const result=await f.invoke('Enter');assert.equal(result.error,'shell-error');
    assert.equal(f.panel.visible,true);assert.equal(f.dock.visible,true);
    assert.equal(f.display.signals.get(h.native).blocked,1);
    assert.equal(f.display.signals.get(h.tahoe).blocked,0);
    assert.equal([...f.display.signals.values()].filter(entry=>entry.signal==='overlay-key').length,2);
    f.display.emit('overlay-key');assert.deepEqual(h.calls,['tahoe']);
    assert.deepEqual((await f.invoke('GetState')).value,[false,false]);
  }finally{f.extension.disable();}
});

test('an invalid overlay signal or a bounded scan failure releases only the acquired blocks',async()=>{
  for(const cause of ['missing','overflow','block-error']){
    const f=await shellFixture(),h=handlers(f);try{
      if(cause==='missing')f.GObject.signal_lookup=()=>0;
      if(cause==='overflow')for(let i=0;i<64;i++)f.display.connect('overlay-key',()=>{});
      if(cause==='block-error'){
        f.display.connect('overlay-key',()=>{});
        const block=f.GObject.signal_handler_block;let count=0;
        f.GObject.signal_handler_block=(...args)=>{if(++count===2)throw Error('Synthetic block failure');return block(...args);};
      }
      const before=new Map([...f.display.signals].map(([id,entry])=>[id,entry.blocked]));
      const result=await f.invoke('Enter');assert.equal(result.error,'shell-error',cause);
      assert.deepEqual(new Map([...f.display.signals].map(([id,entry])=>[id,entry.blocked])),before,cause);
      assert.equal(f.panel.visible,true);assert.deepEqual((await f.invoke('GetState')).value,[false,false]);
    }finally{f.extension.disable();}
  }
});

test('exactly 64 active handlers are leased and restored while handlers already blocked remain untouched',async()=>{
  const f=await shellFixture();try{
    const active=Array.from({length:64},()=>f.display.connect('overlay-key',()=>{}));
    const preblocked=f.display.connect('overlay-key',()=>{});
    f.GObject.signal_handler_block(f.display,preblocked);f.GObject.signal_handler_block(f.display,preblocked);
    assert.deepEqual((await f.invoke('Enter')).value,[]);
    for(const id of active)assert.equal(f.display.signals.get(id).blocked,1);
    assert.equal(f.display.signals.get(preblocked).blocked,2);
    await f.invoke('Leave');
    for(const id of active)assert.equal(f.display.signals.get(id).blocked,0);
    assert.equal(f.display.signals.get(preblocked).blocked,2);
  }finally{f.extension.disable();}
});

test('emergency exit, lock, disable and helper disappearance restore the original signal lease',async()=>{
  for(const cause of ['emergency','lock','disable','owner']){
    const f=await shellFixture(),h=handlers(f);try{
      await f.invoke('Enter');f.display.emit('overlay-key');assert.equal(f.extension._switcher.visible,true);
      if(cause==='emergency')f.display.emit('accelerator-activated',42);
      if(cause==='lock'){f.Main.sessionMode.isLocked=true;f.Main.sessionMode.emit('updated');}
      if(cause==='disable')f.extension.disable();
      if(cause==='owner')f.ownerLost(':1.1');
      assert.equal(f.panel.visible,true,cause);assert.equal(f.display.signals.get(h.native).blocked,1,cause);
      assert.equal(f.display.signals.get(h.tahoe).blocked,0,cause);
      assert.equal([...f.display.signals.values()].filter(entry=>entry.signal==='overlay-key').length,2,cause);
    }finally{f.extension.disable();}
  }
});
