import { BrowserWindow, WebContentsView, powerSaveBlocker } from 'electron';
import { REMOTE_PLAY_TOOLBAR_HEIGHT, type RemotePlayCommand, type RemotePlayState } from '../shared/remote-play.js';
export const REMOTE_PLAY_URL='https://www.xbox.com/play/consoles';
/** Navigation only. Subresources retain Chromium's TLS/origin checks. */
export function remotePlayNavigation(value:string):boolean{
 try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&(url.hostname==='xbox.com'||url.hostname.endsWith('.xbox.com')||['login.live.com','account.live.com','login.microsoftonline.com','account.microsoft.com','sisu.xboxlive.com'].includes(url.hostname));}catch{return false;}
}
/** Local-network access is needed only by the explicitly opened official
 * console player. Sign-in pages, subframes, camera and microphone stay denied. */
export function remotePlayPermission(permission:string,requestingUrl:string,isMainFrame:boolean):boolean{
 if(!isMainFrame)return false;
 try{const url=new URL(requestingUrl);return url.origin==='https://www.xbox.com'&&!url.username&&!url.password&&/^\/(?:[a-z]{2}-[a-z]{2}\/)?play(?:\/|$)/i.test(url.pathname)&&['fullscreen','local-network','local-network-access'].includes(permission);}catch{return false;}
}
export function remotePlayBounds(width:number,height:number){return{x:0,y:REMOTE_PLAY_TOOLBAR_HEIGHT,width:Math.max(0,Math.floor(width)),height:Math.max(0,Math.floor(height)-REMOTE_PLAY_TOOLBAR_HEIGHT)};}
/** The official client owns sign-in, console discovery and WebRTC. The view
 * lives inside the launcher, in a distinct sandbox with no launcher preload. */
export class RemotePlay{
 private owner?:BrowserWindow;private view?:WebContentsView;private blocker?:number;private obscured=false;private generation=0;private navigation=0;
 private current:RemotePlayState={open:false,phase:'closed',canGoBack:false};
 private resize=()=>{if(this.owner&&!this.owner.isDestroyed()&&this.view){const[sizeX,sizeY]=this.owner.getContentSize();this.view.setBounds(remotePlayBounds(sizeX,sizeY));}};
 private ownerClosed=()=>this.destroy();
 constructor(private options:{changed?:(state:RemotePlayState)=>void;toggleFullscreen?:(owner:BrowserWindow)=>unknown}={}){}
 get state():RemotePlayState{return{...this.current};}
 private publish(patch:Partial<RemotePlayState>){this.current={...this.current,...patch};this.options.changed?.(this.state);}
 private updateHistory(){const contents=this.view?.webContents;if(contents&&!contents.isDestroyed())this.publish({canGoBack:contents.navigationHistory.canGoBack()});}
 private visible(){this.view?.setVisible(!this.obscured&&this.current.phase==='ready');}
 private ready(generation:number){if(generation!==this.generation||!this.view||this.view.webContents.isDestroyed())return;this.publish({phase:'ready',error:undefined,canGoBack:this.view.webContents.navigationHistory.canGoBack()});this.visible();if(!this.obscured&&this.owner?.isFocused())this.view.webContents.focus();}
 private failed(generation:number,message='Remote Play could not load. Check your internet connection and try again.'){
  if(generation!==this.generation||!this.view)return;this.publish({phase:'error',error:message});this.visible();this.owner?.webContents.focus();
 }
 async open(owner:BrowserWindow):Promise<void>{
  if(owner.isDestroyed())throw Error('The launcher window is unavailable.');
  if(this.view&&!this.view.webContents.isDestroyed()&&this.owner===owner){owner.show();owner.focus();this.visible();if(!this.obscured&&this.current.phase==='ready')this.view.webContents.focus();return;}
  this.destroy();this.owner=owner;const generation=++this.generation;
  const view=new WebContentsView({webPreferences:{partition:'persist:xboks-remote-play',sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,autoplayPolicy:'no-user-gesture-required'}});this.view=view;view.setBackgroundColor('#1a1b1e');view.setVisible(false);owner.contentView.addChildView(view);this.resize();owner.on('resize',this.resize);owner.once('closed',this.ownerClosed);
  this.blocker=powerSaveBlocker.start('prevent-display-sleep');
  const contents=view.webContents,session=contents.session;
  session.setPermissionRequestHandler((sender,permission,callback,details)=>callback(sender===this.view?.webContents&&remotePlayPermission(permission,details.requestingUrl,details.isMainFrame)));
  session.setPermissionCheckHandler((sender,permission,origin,details)=>sender===this.view?.webContents&&remotePlayPermission(permission,details.requestingUrl??origin,details.isMainFrame));
  const guard=(event:Electron.Event,url:string)=>{if(!remotePlayNavigation(url))event.preventDefault();};contents.on('will-navigate',guard);contents.on('will-redirect',guard);
  contents.setWindowOpenHandler(({url})=>{if(remotePlayNavigation(url))void this.navigate(url);return{action:'deny'};});
  contents.on('did-start-navigation',(_event,_url,inPlace,isMainFrame)=>{if(isMainFrame&&!inPlace&&generation===this.generation){this.publish({phase:'loading',error:undefined});this.visible();}});
  contents.on('did-navigate',()=>this.updateHistory());contents.on('did-navigate-in-page',()=>this.updateHistory());
  contents.on('did-finish-load',()=>this.ready(generation));
  contents.on('did-fail-load',(_event,code,_description,_url,isMainFrame)=>{if(isMainFrame&&code!==-3)this.failed(generation);});
  contents.on('render-process-gone',()=>this.failed(generation,'The Remote Play page stopped. Reload it to try again.'));
  contents.on('destroyed',()=>{if(this.view===view)this.destroy();});
  contents.on('before-input-event',(event,input)=>{if(input.type!=='keyDown')return;if(input.key==='F6'&&input.control){event.preventDefault();owner.webContents.focus();}else if(input.key==='F11'){event.preventDefault();if(!owner.isDestroyed()){if(this.options.toggleFullscreen){try{void Promise.resolve(this.options.toggleFullscreen(owner)).catch(()=>{});}catch{/* Coordinated fullscreen may be unavailable. */}}else owner.setFullScreen(!owner.isFullScreen());}}});
  this.publish({open:true,phase:'loading',canGoBack:false,error:undefined});void this.navigate(REMOTE_PLAY_URL);owner.show();owner.focus();
 }
 private async navigate(url:string):Promise<void>{
  const view=this.view;if(!view||view.webContents.isDestroyed()||!remotePlayNavigation(url))return;const generation=this.generation,navigation=++this.navigation;this.publish({phase:'loading',error:undefined});this.visible();
  try{await view.webContents.loadURL(url);if(navigation===this.navigation)this.ready(generation);}catch(error){if(navigation===this.navigation&&(error as {code?:string})?.code!=='ERR_ABORTED')this.failed(generation);}
 }
 async control(command:RemotePlayCommand):Promise<RemotePlayState>{
  if(!['back','home','retry','close'].includes(command))throw Error('Invalid Remote Play action.');
  if(command==='close'){this.destroy();return this.state;}
  const contents=this.view?.webContents;if(!contents||contents.isDestroyed())return this.state;
  if(command==='back'){if(contents.navigationHistory.canGoBack())contents.navigationHistory.goBack();else this.destroy();}
  else if(command==='home')void this.navigate(REMOTE_PLAY_URL);
  else {const currentUrl=contents.getURL();void this.navigate(remotePlayNavigation(currentUrl)?currentUrl:REMOTE_PLAY_URL);}
  return this.state;
 }
 /** Native child views are above React; root hides this view for Guide/modal UI. */
 setObscured(value:boolean):void{this.obscured=value;this.visible();if(this.owner&&!this.owner.isDestroyed()&&this.owner.isFocused()){if(value)this.owner.webContents.focus();else if(this.current.phase==='ready')this.view?.webContents.focus();}}
 destroy():void{
  const owner=this.owner,view=this.view;this.owner=undefined;this.view=undefined;this.generation++;this.navigation++;this.obscured=false;
  if(owner){owner.removeListener('resize',this.resize);owner.removeListener('closed',this.ownerClosed);if(!owner.isDestroyed()&&view){try{owner.contentView.removeChildView(view);}catch{/* Owner teardown already detached it. */}}}
  if(view&&!view.webContents.isDestroyed())view.webContents.close({waitForBeforeUnload:false});
  if(this.blocker!==undefined){if(powerSaveBlocker.isStarted(this.blocker))powerSaveBlocker.stop(this.blocker);this.blocker=undefined;}
  if(this.current.open)this.publish({open:false,phase:'closed',canGoBack:false,error:undefined});
  if(owner&&!owner.isDestroyed()&&owner.isFocused())owner.webContents.focus();
 }
}
