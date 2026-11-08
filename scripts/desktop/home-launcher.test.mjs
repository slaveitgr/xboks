import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {HOME_APPS, normalizeHomeApp, homeLaunchSpec} from '../../desktop/gnome/xboks-experience@slaveitgr.github.io/home-apps.js';
import {ExperienceLease} from '../../desktop/gnome/xboks-experience@slaveitgr.github.io/state.js';
import {shellFixture} from './fixtures/experience-shell.mjs';
import {NATIVE_DESKTOP_ID, NATIVE_PE_SHA256} from '../../desktop/gnome/xboks-experience@slaveitgr.github.io/native-state.js';

async function fixture({selected='steam', installed=['steam.desktop'], startingUp=false, failLaunch=false}={}) {
  class Signals {
    constructor(){this.signals=new Map();this.next=1;}
    connect(name,cb){const id=this.next++;this.signals.set(id,{name,cb});return id;}
    disconnect(id){this.signals.delete(id);}
    emit(name,...args){for(const entry of [...this.signals.values()])if(entry.name===name)entry.cb(this,...args);}
  }
  class Actor { constructor(props){Object.assign(this,props);this.children=[];}add_child(child){this.children.push(child);}connect(){return 1;}destroy(){this.destroyed=true;} }
  let windows=[],active=false,nextTimer=1;const timers=new Map(),covers=[],launches=[],events=[],notices=[];
  const settings=Object.assign(new Signals(),{values:{'home-app':selected,'enter-on-login':true,'use-feral-gamemode':false},
    get_string(key){return this.values[key];},get_boolean(key){return this.values[key];}});
  class FeralGameMode{constructor(){this.state={state:'disabled'};}setEnabled(value){this.enabled=value;}setProcesses(value){this.pids=value;}stop(){this.stopped=true;this.state={state:'disabled'};}destroy(){this.destroyed=true;}}
  const tracker=Object.assign(new Signals(),{get_window_app:window=>({get_id:()=>window.desktopId})});
  const app={get_windows:()=>windows};
  const desktop=id=>installed.includes(id)?{get_filename:()=>'/apps/'+id,
    launch_uris(uris){launches.push({id,uris});if(failLaunch)throw Error('launch-error');return true;},
    launch(){launches.push({id});if(failLaunch)throw Error('launch-error');return true;}}:null;
  const GioUnix={DesktopAppInfo:{new:desktop,new_from_keyfile:key=>({launch(){launches.push({command:key.command});return true;}})}};
  const GLib={get_language_names:()=>['en'],PRIORITY_DEFAULT:0,SOURCE_CONTINUE:true,SOURCE_REMOVE:false,KeyFileFlags:{NONE:0},
    KeyFile:class{load_from_file(file){this.file=file;}get_string(){return 'xboks %U';}set_string(_group,_key,value){this.command=value;}},
    timeout_add(_priority,delay,callback){const id=nextTimer++;timers.set(id,{delay,callback});return id;},Source:{remove:id=>timers.delete(id)}};
  const Main={overview:{visible:false,animationInProgress:false,hide(){this.visible=false;}},layoutManager:Object.assign(new Signals(),{_startingUp:startingUp,addTopChrome:cover=>covers.push(cover)}),
    activateWindow:window=>events.push(['focus',window]),notify:message=>notices.push(message)};
  const nativeGlobal={stage:{width:1920,height:1080},display:new Signals(),window_manager:new Signals(),get_current_time:()=>1,
    create_app_launch_context:()=>({}),get_window_actors:()=>windows.map(meta_window=>({meta_window}))};
  const source=(await fs.readFile('desktop/gnome/xboks-experience@slaveitgr.github.io/home-launcher.js','utf8')).replace(/^import .*;\r?\n/gm,'').replaceAll('export ','');
  const Class=new Function('Clutter','Gio','GioUnix','GLib','Meta','Shell','St','Main','HOME_APPS','normalizeHomeApp','homeLaunchSpec','FeralGameMode','global',source+'\nreturn GamingHome;')(
    {BinLayout:class{},ActorAlign:{CENTER:0}}, {},GioUnix,GLib,{WindowType:{NORMAL:0}},
    {AppSystem:{get_default:()=>({lookup_app:()=>app})},WindowTracker:{get_default:()=>tracker}},
    {Widget:Actor,BoxLayout:Actor,Label:Actor,Button:Actor},Main,HOME_APPS,normalizeHomeApp,homeLaunchSpec,FeralGameMode,nativeGlobal);
  const home=new Class({settings,guardCover:()=>{events.push(['guard']);return()=>events.push(['unguard']);},enter:()=>{events.push(['enter']);active=true;},leave:()=>{events.push(['leave']);active=false;home.stop();},active:()=>active,notify:m=>notices.push(m)});
  const window=(desktopId=installed[0])=>({desktopId,mapped:true,skip_taskbar:false,get_window_type:()=>0,get_transient_for:()=>null,
    get_title:()=> selected==='steam'?'Steam Big Picture Mode':'Home',get_pid:()=>123,unminimize(){events.push(['unminimize']);},make_fullscreen(){events.push(['fullscreen']);}});
  return{home,settings,Main,events,notices,covers,launches,timers,window,setWindows:value=>{windows=value;},
    tick(delay){for(const[id,timer]of[...timers])if(timer.delay===delay){if(!timer.callback())timers.delete(id);}},get active(){return active;}};
}

test('fixed home adapters reject arbitrary selections and require exact installed desktop identity',()=>{
  for(const value of ['unknown','steam;touch /tmp/file',null,{},'Steam'])assert.equal(homeLaunchSpec(value,['steam.desktop']),null);
  assert.equal(homeLaunchSpec('steam',['fake-steam.desktop']),null);
  assert.deepEqual(homeLaunchSpec('steam',['com.valvesoftware.Steam.desktop']),{id:'steam',desktopId:'com.valvesoftware.Steam.desktop',uris:['steam://open/bigpicture']});
  assert.deepEqual(homeLaunchSpec('original-xbox',[NATIVE_DESKTOP_ID]),{id:'original-xbox',desktopId:NATIVE_DESKTOP_ID,args:[]});
});

test('login with None or disabled startup leaves ordinary desktop untouched; startup executes once',async()=>{
  for(const patch of[{selected:'none'},{selected:'steam',disabled:true}]){
    const f=await fixture(patch);if(patch.disabled)f.settings.values['enter-on-login']=false;
    f.home.scheduleStartup();f.home.scheduleStartup();assert.equal(f.launches.length,0);assert.equal(f.events.length,0);assert.equal(f.covers.length,0);f.home.destroy();
  }
  const f=await fixture({startingUp:true});f.home.scheduleStartup();assert.equal(f.covers.length,1);assert.equal(f.launches.length,0);
  f.Main.layoutManager.emit('startup-complete');f.home.scheduleStartup();assert.equal(f.launches.length,1);assert.equal(f.active,true);f.home.destroy();
});

test('selected Steam launches Big Picture, covers loading, reveals only mapped home and keeps app alive on desktop exit',async()=>{
  const f=await fixture();f.home.launch();assert.deepEqual(f.launches,[{id:'steam.desktop',uris:['steam://open/bigpicture']}]);
  assert.equal(f.active,true);assert.equal(f.home.state.loading,true);assert.equal(f.covers[0].destroyed,undefined);
  f.setWindows([f.window('other.desktop')]);f.tick(250);assert.equal(f.home.state.loading,true);
  const home=f.window();f.setWindows([home]);f.tick(250);assert.equal(f.home.session.ready,true);assert.equal(f.covers[0].destroyed,true);
  assert.deepEqual(f.events.slice(-3).map(e=>e[0]),['unminimize','fullscreen','focus']);
  f.home.focus();assert.equal(f.events.at(-1)[1],home);f.home.stop();assert.equal(f.timers.size,0);assert.equal(home.killed,undefined);f.home.destroy();
});

test('startup cover has an escape guard, cancels pending login launch and waits behind Overview animations',async()=>{
  const cancelled=await fixture({startingUp:true});cancelled.home.scheduleStartup();
  assert.equal(cancelled.events[0][0],'guard');cancelled.home.cancelStartup();cancelled.Main.layoutManager.emit('startup-complete');
  assert.equal(cancelled.launches.length,0);assert.equal(cancelled.covers[0].destroyed,true);assert.equal(cancelled.events.at(-1)[0],'unguard');cancelled.home.destroy();
  const f=await fixture();f.Main.overview.visible=true;f.Main.overview.animationInProgress=true;
  f.home.scheduleStartup();assert.equal(f.launches.length,0);assert.equal(f.covers.length,1);
  f.tick(100);assert.equal(f.launches.length,0);f.Main.overview.animationInProgress=false;f.tick(100);
  assert.equal(f.launches.length,1);assert.deepEqual(f.events.slice(0,3).map(e=>e[0]),['guard','unguard','enter']);f.home.destroy();
});

test('missing/failed/timed-out home cannot leave an indefinite startup cover or retain timers',async()=>{
  const missing=await fixture({installed:[]});assert.throws(()=>missing.home.launch(),/not-installed/);assert.equal(missing.active,false);missing.home.destroy();
  const failed=await fixture({failLaunch:true});assert.throws(()=>failed.home.launch(),/launch-error/);assert.equal(failed.active,false);assert.equal(failed.covers[0].destroyed,true);failed.home.destroy();
  const timeout=await fixture();timeout.home.launch();timeout.tick(300000);assert.equal(timeout.active,false);assert.equal(timeout.home.session,null);assert.equal(timeout.timers.size,0);assert.equal(timeout.notices.length,1);timeout.home.destroy();
});

test('XBOKS receives the fixed fullscreen flag; closing the home restores rather than relaunching automatically',async()=>{
  const f=await fixture({selected:'xboks',installed:['xboks.desktop']});f.home.launch();assert.deepEqual(f.launches,[{command:'xboks %U --fullscreen-experience'}]);
  f.setWindows([f.window()]);f.tick(250);f.setWindows([]);f.tick(250);assert.equal(f.active,false);assert.equal(f.launches.length,1);f.home.destroy();
});

test('lease adoption changes only acknowledged owner without dropping gaming state or repeating desktop modifications',()=>{
  let applied=0,restored=0;const states=[];const lease=new ExperienceLease(()=>applied++,()=>restored++,state=>states.push(state));
  lease.enter(':1.99',true);assert.throws(()=>lease.transfer(':1.2',':1.1',true),/authorized/);assert.throws(()=>lease.transfer(':1.99','invalid',true),/authorized/);
  lease.transfer(':1.99',':1.1',true);assert.deepEqual(lease.state(':1.1'),{active:true,owned:true});assert.equal(applied,1);assert.equal(restored,0);
  lease.ownerVanished(':1.99');assert.equal(lease.active,true);lease.leave(':1.1');assert.equal(restored,1);assert.deepEqual(states,[true,true,false]);
});

test('Home1 requires same-user unlocked credentials and explicit shell-owned launch before client adoption',async()=>{
  const f=await shellFixture();try{
    let result=await f.extension._homeRequest('launch',[],{get_sender:()=>':1.1',return_value(){},return_dbus_error(_n,e){throw Error(e);}});
    assert.equal(result,undefined);assert.deepEqual((await f.invoke('GetState')).value,[true,false]);
    f.extension._home.session={id:'xboks',ready:true};f.display.focus_window.homeMatch=true;
    assert.deepEqual((await f.invoke('Enter')).value,[]);assert.deepEqual((await f.invoke('GetState')).value,[true,true]);
    f.ownerLost(':1.1');assert.equal(f.panel.visible,true);
    let denied;f.native.credentials.set(':1.4',{pid:500,uid:2000});
    await f.extension._homeRequest('launch',[],{get_sender:()=>':1.4',return_value(){},return_dbus_error(_n,e){denied=e;}});
    assert.equal(denied,'not-authorized');assert.equal(f.extension._lease.active,false);
  }finally{f.extension.disable();}
});

test('original client reads genuine pre-existing global mode and may adopt or exit only its selected focused home',async()=>{
  for(const action of[true,false]){
    const f=await shellFixture();try{
      const record={schema:1,pid:400,startTime:'9000',executable:'/runtime/wine-preloader',pePath:'/game/XboxPcAppCE.exe',peSHA256:NATIVE_PE_SHA256,desktopId:NATIVE_DESKTOP_ID};
      f.native.records.set(400,record);f.native.credentials.set(':1.40',{pid:400,uid:1000});
      f.extension._home.session={id:'original-xbox',ready:true};f.extension._home.options.enter();
      const window={homeMatch:true,get_pid:()=>400,get_transient_for:()=>null};f.display.focus_window=window;
      const state=(await f.invokeNative('GetState')).value;assert.deepEqual(state.slice(2),[true,true,true,false]);
      assert.equal((await f.invokeNative('SetMode',':1.40',[action,state[1]])).error,undefined);
      assert.equal(f.extension._lease.active,action);
      if(action){assert.equal(f.extension._nativeOwner.pid,400);f.ownerLost(':1.40');assert.equal(f.panel.visible,true);}
    }finally{f.extension.disable();}
  }
});
