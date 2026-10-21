import {EventEmitter} from 'node:events';
import {beforeEach,expect,it,vi} from 'vitest';
const fixture=vi.hoisted(()=>({views:[] as any[],fail:false,defer:false,pending:[] as {resolve:()=>void;reject:(error:Error)=>void}[],nextBlocker:0,stop:vi.fn()}));
vi.mock('electron',async()=>{
 const{EventEmitter}=await import('node:events');
 class Contents extends EventEmitter{
  destroyed=false;url='';history=false;session={setPermissionRequestHandler:vi.fn(),setPermissionCheckHandler:vi.fn()};popup:any;
  navigationHistory={canGoBack:()=>this.history,goBack:vi.fn()};focus=vi.fn();setWindowOpenHandler=vi.fn((handler:any)=>{this.popup=handler;});
  loadURL=vi.fn(async(url:string)=>{this.url=url;this.emit('did-start-navigation',{},url,false,true);if(fixture.defer)await new Promise<void>((resolve,reject)=>fixture.pending.push({resolve,reject}));else if(fixture.fail)throw Error('network');this.emit('did-finish-load');});
  isDestroyed(){return this.destroyed;}getURL(){return this.url;}close=vi.fn(()=>{this.destroyed=true;this.emit('destroyed');});
 }
 return{BrowserWindow:class{},WebContentsView:class{webContents=new Contents();setBackgroundColor=vi.fn();setVisible=vi.fn();setBounds=vi.fn();constructor(public options:any){fixture.views.push(this);}},powerSaveBlocker:{start:()=>++fixture.nextBlocker,isStarted:()=>true,stop:fixture.stop}};
});
import {RemotePlay,REMOTE_PLAY_URL,remotePlayBounds,remotePlayNavigation,remotePlayPermission} from './remote-play';
class Owner extends EventEmitter{destroyed=false;size=[1280,800];contentView={addChildView:vi.fn(),removeChildView:vi.fn()};webContents={focus:vi.fn()};getContentSize(){return this.size;}isDestroyed(){return this.destroyed;}isFocused(){return true;}show=vi.fn();focus=vi.fn();setFullScreen=vi.fn();isFullScreen=()=>false;}
const owner=()=>new Owner() as unknown as Electron.BrowserWindow;
const flush=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve();};
beforeEach(()=>{fixture.views=[];fixture.fail=false;fixture.defer=false;fixture.pending=[];fixture.nextBlocker=0;fixture.stop.mockClear();});
it('allows only TLS Xbox and explicit sign-in navigations without userinfo/ports',()=>{
 for(const url of[REMOTE_PLAY_URL,'https://login.live.com/oauth20_authorize.srf','https://sisu.xboxlive.com/connect/XboxLive/'])expect(remotePlayNavigation(url)).toBe(true);
 for(const url of['file:///tmp/index.html','javascript:alert(1)','https://xbox.com.evil.test/','http://xbox.com/','https://login.live.com.evil.test/','https://user@www.xbox.com/play','https://www.xbox.com:8888/play','garbage'])expect(remotePlayNavigation(url)).toBe(false);
});
it('grants LAN/fullscreen only to exact official player mainframe and denies media/loopback/login',()=>{
 for(const permission of['local-network','local-network-access','fullscreen'])expect(remotePlayPermission(permission,REMOTE_PLAY_URL,true)).toBe(true);
 expect(remotePlayPermission('local-network','https://www.xbox.com/el-GR/play/consoles',true)).toBe(true);
 for(const permission of['media','camera','notifications','loopback-network','fileSystem','pointerLock'])expect(remotePlayPermission(permission,REMOTE_PLAY_URL,true)).toBe(false);
 for(const url of['https://login.live.com/','https://www.xbox.com/store','https://evil.xbox.com/play','https://www.xbox.com.evil.test/play','https://user@www.xbox.com/play'])expect(remotePlayPermission('local-network',url,true)).toBe(false);
 expect(remotePlayPermission('local-network',REMOTE_PLAY_URL,false)).toBe(false);
});
it('keeps the trusted64px toolbar unobscured even at small dimensions',()=>{expect(remotePlayBounds(1280,800)).toEqual({x:0,y:64,width:1280,height:736});expect(remotePlayBounds(300,40)).toEqual({x:0,y:64,width:300,height:0});});
it('attaches one isolated child view inside the existing launcher and never creates another window',async()=>{
 const remote=new RemotePlay(),main=owner();await remote.open(main);await flush();await remote.open(main);
 expect(fixture.views).toHaveLength(1);const view=fixture.views[0];expect(main.contentView.addChildView).toHaveBeenCalledWith(view);
 expect(view.options.webPreferences).toMatchObject({sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,partition:'persist:xboks-remote-play'});expect(view.options.webPreferences.preload).toBeUndefined();expect(view.webContents.loadURL).toHaveBeenCalledWith(REMOTE_PLAY_URL);expect(remote.state).toEqual({open:true,phase:'ready',canGoBack:false,error:undefined});remote.destroy();expect(view.webContents.close).toHaveBeenCalledWith({waitForBeforeUnload:false});expect(main.contentView.removeChildView).toHaveBeenCalledWith(view);expect(fixture.stop).toHaveBeenCalledWith(1);
});
it('acknowledges host creation before navigation completes and retains a recoverable error surface',async()=>{
 fixture.defer=true;const remote=new RemotePlay(),main=owner();await remote.open(main);expect(remote.state.phase).toBe('loading');fixture.pending[0].reject(Error('offline'));await flush();expect(remote.state.phase).toBe('error');expect(remote.state.error).toContain('Check your internet');expect(fixture.views[0].webContents.isDestroyed()).toBe(false);expect(fixture.views[0].setVisible).toHaveBeenLastCalledWith(false);fixture.defer=false;await remote.control('retry');await flush();expect(remote.state.phase).toBe('ready');expect(fixture.views).toHaveLength(1);remote.destroy();
});
it('blocks untrusted navigation/popups and sends allowed Microsoft login into the same isolated view',async()=>{
 const remote=new RemotePlay();await remote.open(owner());await flush();const contents=fixture.views[0].webContents,event={preventDefault:vi.fn()};contents.emit('will-navigate',event,'file:///etc/passwd');expect(event.preventDefault).toHaveBeenCalledOnce();expect(contents.popup({url:'https://evil.test/'})).toEqual({action:'deny'});expect(contents.loadURL).toHaveBeenCalledTimes(1);expect(contents.popup({url:'https://login.live.com/'})).toEqual({action:'deny'});await flush();expect(contents.loadURL).toHaveBeenLastCalledWith('https://login.live.com/');remote.destroy();
});
it('binds permission callbacks to this child webcontents in addition to origin/frame checks',async()=>{
 const remote=new RemotePlay();await remote.open(owner());await flush();const contents=fixture.views[0].webContents,request=contents.session.setPermissionRequestHandler.mock.calls[0][0],check=contents.session.setPermissionCheckHandler.mock.calls[0][0],callback=vi.fn();request(contents,'local-network',callback,{requestingUrl:REMOTE_PLAY_URL,isMainFrame:true});expect(callback).toHaveBeenLastCalledWith(true);request({},'local-network',callback,{requestingUrl:REMOTE_PLAY_URL,isMainFrame:true});expect(callback).toHaveBeenLastCalledWith(false);expect(check(contents,'media','https://www.xbox.com',{requestingUrl:REMOTE_PLAY_URL,isMainFrame:true})).toBe(false);expect(check(contents,'local-network','https://www.xbox.com',{requestingUrl:REMOTE_PLAY_URL,isMainFrame:true})).toBe(true);remote.destroy();expect(check(contents,'local-network','https://www.xbox.com',{requestingUrl:REMOTE_PLAY_URL,isMainFrame:true})).toBe(false);
});
it('does not hide the player indefinitely on same-document console navigation',async()=>{
 const remote=new RemotePlay();await remote.open(owner());await flush();const view=fixture.views[0];view.webContents.history=true;view.webContents.emit('did-start-navigation',{},REMOTE_PLAY_URL+'/console-id',true,true);view.webContents.emit('did-navigate-in-page');expect(remote.state.phase).toBe('ready');expect(remote.state.canGoBack).toBe(true);expect(view.setVisible).toHaveBeenLastCalledWith(true);await remote.control('back');expect(view.webContents.navigationHistory.goBack).toHaveBeenCalledOnce();remote.destroy();
});
it('hides native remote content for Game Bar and restores it without changing navigation/session',async()=>{
 const remote=new RemotePlay(),main=owner();await remote.open(main);await flush();const view=fixture.views[0];remote.setObscured(true);expect(view.setVisible).toHaveBeenLastCalledWith(false);view.webContents.emit('did-finish-load');expect(view.setVisible).toHaveBeenLastCalledWith(false);remote.setObscured(false);expect(view.setVisible).toHaveBeenLastCalledWith(true);expect(view.webContents.loadURL).toHaveBeenCalledTimes(1);(main as any).size=[1920,1080];main.emit('resize');expect(view.setBounds).toHaveBeenLastCalledWith({x:0,y:64,width:1920,height:1016});remote.destroy();
});
it('keeps game Escape/B in the player and offers toolbar focus without closing the session',async()=>{
 const remote=new RemotePlay(),main=owner();await remote.open(main);await flush();const view=fixture.views[0],preventDefault=vi.fn();view.webContents.emit('before-input-event',{preventDefault},{type:'keyDown',key:'b'});expect(remote.state.open).toBe(true);view.webContents.emit('before-input-event',{preventDefault},{type:'keyDown',key:'F11'});expect(main.setFullScreen).toHaveBeenCalledWith(true);view.webContents.emit('before-input-event',{preventDefault},{type:'keyDown',key:'Escape'});expect(remote.state.open).toBe(true);view.webContents.emit('before-input-event',{preventDefault},{type:'keyDown',key:'F6',control:true});expect(main.webContents.focus).toHaveBeenCalled();expect(fixture.stop).not.toHaveBeenCalled();main.emit('closed');expect(view.webContents.close).toHaveBeenCalledOnce();expect(remote.state.open).toBe(false);
});
it('ignores a late failed navigation from a closed previous host',async()=>{
 fixture.defer=true;const remote=new RemotePlay(),main=owner();await remote.open(main);remote.destroy();fixture.defer=false;await remote.open(main);await flush();fixture.pending[0].reject(Error('late network error'));await flush();expect(remote.state.phase).toBe('ready');expect(remote.state.error).toBeUndefined();await expect(remote.control('unknown' as any)).rejects.toThrow('Invalid');remote.destroy();
});
