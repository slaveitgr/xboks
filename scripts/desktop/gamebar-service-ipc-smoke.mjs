/** Native, isolated production-main/preload service lifecycle regression.
 * Run after build with Electron --no-sandbox and an ignored output folder.
 * All product windows are forced offscreen; account/backend, session helpers,
 * external applications, network access and real console connections are off.
 */
import {app,BrowserWindow as NativeWindow,ipcMain,session,shell} from 'electron';
import childProcess from 'node:child_process';
import {registerHooks,syncBuiltinESMExports} from 'node:module';
import {promises as fs,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const scriptIndex=process.argv.findIndex(value=>resolve(value)===fileURLToPath(import.meta.url));
const output=resolve(root,process.argv[scriptIndex+1]??'work/gamebar-service-ipc');
const profile=await fs.mkdtemp(join(tmpdir(),'xboks-service-ipc-'));
for(const name of['profile','config','data','cache','logs','pictures'])await fs.mkdir(join(profile,name));
for(const[key,name]of Object.entries({userData:'profile',sessionData:'profile',cache:'cache',logs:'logs',pictures:'pictures'}))app.setPath(key,join(profile,name));
Object.assign(process.env,{XBOKS_DEMO:'1',XBOKS_FULLSCREEN_EXPERIENCE:'0',XDG_CONFIG_HOME:join(profile,'config'),XDG_DATA_HOME:join(profile,'data'),XDG_CACHE_HOME:join(profile,'cache'),DBUS_SESSION_BUS_ADDRESS:`unix:path=${join(profile,'no-session-bus')}`,PIPEWIRE_REMOTE:'xboks-service-no-host-pipewire',GIO_USE_VFS:'local'});
for(const key of['VITE_DEV_SERVER_URL','XBOKS_SMOKE_SCREENSHOT','XODUS_NEXUS_SMOKE_SCREENSHOT','XBOKS_DEMO_CAPTURE_DIR','XODUS_DEMO_CAPTURE_DIR','XODUS_NEXUS_SMOKE_STORE','XODUS_NEXUS_SMOKE_STORE_QUERY'])delete process.env[key];
process.argv.push('--gamebar-service');
for(const option of['disable-background-networking','disable-gpu','mute-audio'])app.commandLine.appendSwitch(option);
const report={startedAt:new Date().toISOString(),actualElectron:true,productionMainAndPreload:true,offscreen:true,isolatedDemoProfile:true,serviceUnitModified:false,actualConsoleConnection:false,checks:[],failures:[],helperAttempts:[],networkAttempts:0,externalOpens:[],rendererErrors:[],nativeWindows:[]};
const check=(condition,label)=>{report.checks.push({label,passed:Boolean(condition)});if(!condition)report.failures.push(label);console.log(`${condition?'PASS':'FAIL'} ${label}`);};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function wait(predicate,label,timeout=8000){const end=Date.now()+timeout;while(Date.now()<end){if(await predicate())return;await pause(25);}throw Error(`Timed out: ${label}`);}
const fetchOriginal=globalThis.fetch;globalThis.fetch=async()=>{report.networkAttempts++;throw Error('Network forbidden in service IPC smoke.');};
const originals={};
for(const method of['spawn','spawnSync','execFile','execFileSync','exec','execSync']){
 originals[method]=childProcess[method];childProcess[method]=function(command,...args){if(/(?:^|\/)(?:python3(?:\.\d+)?|gjs(?:-[\d.]+)?|wpctl|pw-dump|playerctl|spotify|xboks-engine|xodus-cli|xodus-service|systemctl)$/.test(String(command))){report.helperAttempts.push(String(command));throw Error('External helpers forbidden in service IPC smoke.');}return originals[method].call(this,command,...args);};
}
const shellOriginal=shell.openExternal;shell.openExternal=async target=>{report.externalOpens.push(String(target));throw Error('External applications forbidden.');};syncBuiltinESMExports();
const facade=join(profile,'offscreen-electron.mjs');
await fs.writeFile(facade,`import {BrowserWindow as NativeWindow} from 'electron';\nexport * from 'electron';\nexport function BrowserWindow(options={}){const window=new NativeWindow({...options,show:false,focusable:false,webPreferences:{...options.webPreferences,offscreen:true}});window.__showRequests=0;window.show=()=>{window.__showRequests++;};window.showInactive=()=>{};window.focus=()=>{};window.setFocusable=()=>{};window.isFocused=()=>false;return window;}\nObject.setPrototypeOf(BrowserWindow,NativeWindow);BrowserWindow.prototype=NativeWindow.prototype;\n`);
const prefix=pathToFileURL(join(root,'dist-electron')+sep).href;
const hooks=registerHooks({resolve(specifier,context,next){return specifier==='electron'&&context.parentURL?.startsWith(prefix)?{url:pathToFileURL(facade).href,shortCircuit:true}:next(specifier,context);}});
const channels=new Set(),handleOriginal=ipcMain.handle;
ipcMain.handle=function(channel,listener){channels.add(channel);return handleOriginal.call(this,channel,listener);};
app.on('browser-window-created',(_event,window)=>{report.nativeWindows.push(window.id);window.webContents.on('render-process-gone',(_event,details)=>report.rendererErrors.push(details.reason));});
void app.whenReady().then(()=>session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*','ws://*/*','wss://*/*']},(_details,callback)=>callback({cancel:true})));
const evaluate=(window,source)=>window.webContents.executeJavaScript(source);
const blocked=(target,call,reason)=>target.executeJavaScript(`(${call}).then(()=>false,error=>error.message.includes(${JSON.stringify(reason)}))`);
let quitRequests=0,observeQuit=false,finished=false;
app.on('before-quit',()=>{if(observeQuit)quitRequests++;});
function finish(forceExit=true){
 if(finished)return;finished=true;
 report.status=report.failures.length?'failed':'passed';report.finishedAt=new Date().toISOString();report.passed=report.checks.filter(check=>check.passed).length;
 mkdirSync(output,{recursive:true});writeFileSync(join(output,'electron-gamebar-service-ipc-report.json'),JSON.stringify(report,null,2)+'\n');
 app.removeAllListeners('window-all-closed');app.on('window-all-closed',()=>{});for(const window of NativeWindow.getAllWindows())window.destroy();
 globalThis.fetch=fetchOriginal;shell.openExternal=shellOriginal;ipcMain.handle=handleOriginal;for(const[method,original]of Object.entries(originals))childProcess[method]=original;syncBuiltinESMExports();hooks.deregister();
 rmSync(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});clearTimeout(watchdog);const code=report.status==='passed'?0:1;
 console.log(`Native service IPC: ${report.passed}/${report.checks.length}; ${report.status}. ${output}`);
 if(forceExit||code){app.exit(code);process.reallyExit(code);}
}
const watchdog=setTimeout(()=>{report.failures.push('Service IPC smoke timed out.');finish();},30000);
process.once('uncaughtException',error=>{report.failures.push(`Uncaught native lifecycle error: ${error.message}`);finish();});
await import(pathToFileURL(join(root,'dist-electron/main/index.js')).href);
async function run(){
 try{
  await wait(()=>channels.has('remote-play-state'),'service IPC readiness',15000);await pause(100);
  check(NativeWindow.getAllWindows().length===0,'service startup creates zero launcher, Guide or account windows');
  app.emit('activate');let main;
  await wait(()=>{main=NativeWindow.getAllWindows().find(window=>window.getTitle()==='XBOKS');return main&&!main.webContents.isLoading();},'launcher activation');
  await wait(()=>evaluate(main,"typeof window.launcher?.getRemotePlayState==='function'"),'production preload');
  const snapshot=await evaluate(main,'window.launcher.getSnapshot()');
  check(snapshot.desktopSettings.gameBarResident===true,'native demo snapshot reports explicit service residency');
  check(snapshot.desktopSettings.gameBarController?.status==='stopped'&&snapshot.desktopSettings.gameBarController?.devices===0,'demo service never starts the native controller listener or claims a host device');
  check(!main.isVisible()&&main.webContents.isOffscreen(),'activated launcher remains offscreen with no focus steal');
  check(JSON.stringify(await evaluate(main,'window.launcher.getRemotePlayState()'))===JSON.stringify({open:false,phase:'closed',canGoBack:false}),'Remote Play starts closed and claims no console connection');
  check(await blocked(main.webContents,'window.launcher.openRemotePlay()','disabled in demo mode'),'main Remote Play open rejects before any official web view or account access');
  check(await blocked(main.webContents,"window.launcher.controlRemotePlay('retry')",'must be controlled from the launcher'),'main demo Remote Play control rejects without loading web content');
  check(await blocked(main.webContents,"window.launcher.setRemotePlayObscured('true')",'Invalid Remote Play view state'),'main rejects non-boolean Remote Play obscuring payload');
  for(const call of['window.launcher.getXboxModeRestartStatus()','window.launcher.prepareXboxModeRestart()',"window.launcher.restartIntoXboxMode('synthetic-token')"])
    check(await blocked(main.webContents,call,'disabled in demo mode'),`demo main refuses ${call} before any startup or power operation`);
  await wait(()=>evaluate(main,"Boolean(document.querySelector('.xbox-mode-entry'))"),'header ready for trusted Guide handoff');
  await evaluate(main,"Object.defineProperty(document,'hasFocus',{configurable:true,value:()=>true});true");
  main.webContents.send('xbox-mode-entry-requested');
  await wait(()=>evaluate(main,"Boolean(document.querySelector('.xbox-mode-entry-dialog'))"),'trusted Game Bar handoff dialog');
  check(await evaluate(main,"document.querySelectorAll('.xbox-mode-entry-dialog button').length===3"),'trusted production preload handoff opens existing choices after focus/native-state recheck');
  check(!main.isFullScreen(),'trusted handoff opens choices without entering native fullscreen');
  await evaluate(main,"document.querySelector('[data-xbox-mode-action=remain]').click()");
  await wait(()=>evaluate(main,"!document.querySelector('.xbox-mode-entry-dialog')"),'handoff Remain');
  await evaluate(main,"Object.defineProperty(document,'hasFocus',{configurable:true,value:()=>false});true");
  main.webContents.send('xbox-mode-entry-requested'); await pause(100);
  check(await evaluate(main,"!document.querySelector('.xbox-mode-entry-dialog')"),'trusted handoff is discarded if renderer focus has since left');
  await evaluate(main,"document.querySelector('.xbox-mode-entry').click()");
  await wait(()=>evaluate(main,"Boolean(document.querySelector('.xbox-mode-entry-dialog'))"),'real header entry dialog');
  check(await evaluate(main,"document.querySelectorAll('.xbox-mode-entry-dialog button').length===3"),'production header opens the three-choice Xbox mode dialog');
  await wait(()=>evaluate(main,"document.querySelector('.xbox-mode-entry-status')?.textContent.includes('unavailable')"),'disabled demo restart capability');
  check(await evaluate(main,"document.querySelector('[data-xbox-mode-action=restart]').disabled"),'production demo dialog never enables a host restart');
  await evaluate(main,"document.querySelector('[data-xbox-mode-action=remain]').click()");
  await wait(()=>evaluate(main,"!document.querySelector('.xbox-mode-entry-dialog')"),'Remain on desktop');
  await wait(()=>evaluate(main,"document.activeElement===document.querySelector('.xbox-mode-entry')"),'header focus after dialog inert cleanup');
  check(await evaluate(main,"document.activeElement===document.querySelector('.xbox-mode-entry')"),'Remain returns to the actual header trigger without entering fullscreen');
  await evaluate(main,'window.launcher.setRemotePlayObscured(true)');await evaluate(main,'window.launcher.setRemotePlayObscured(false)');
  check(NativeWindow.getAllWindows().length===1,'Remote Play demo calls create no extra native windows');
  await evaluate(main,"document.querySelector('.account-summary').click()");
  await wait(()=>evaluate(main,"Boolean(document.querySelector('.shell-account-menu'))"),'account menu');
  await evaluate(main,"Array.from(document.querySelectorAll('.shell-account-menu button')).find(b=>b.textContent.includes('View profile')).click()");
  await wait(()=>evaluate(main,"Boolean(document.querySelector('.profile-page'))"),'in-app profile route');
  check(await evaluate(main,"document.querySelector('.profile-page').textContent.includes('Gamerscore is unavailable')"),'profile route keeps an absent provider score unknown');
  await evaluate(main,'window.launcher.refreshXboxProfile()');
  check(!main.isFullScreen(),'demo profile refresh does not invoke mode or host account actions');
  await evaluate(main,"Array.from(document.querySelectorAll('.sidebar nav button')).find(b=>b.textContent.includes('Cloud gaming')).click()");
  await wait(()=>evaluate(main,"Boolean(document.querySelector('.cloud-gaming-page'))"),'Cloud gaming route');
  await evaluate(main,"document.querySelector('.cloud-gaming-page button').click()");
  await wait(()=>evaluate(main,"document.querySelector('.cloud-gaming-page [role=alert]')?.textContent.includes('could not open')"),'demo cloud refusal');
  check(NativeWindow.getAllWindows().length===1&&main.contentView.children.length===0,'demo Cloud entry opens no native page, sign-in or stream');
  check(JSON.stringify(await evaluate(main,'window.launcher.getCloudGamingState()'))===JSON.stringify({open:false,phase:'closed',canGoBack:false}),'cloud state is closed before any explicit allowed native open');
  await evaluate(main,'window.desktopGuide.toggle()');let guide;
  await wait(()=>{guide=NativeWindow.getAllWindows().find(window=>window.webContents.getURL().endsWith('#desktop-guide'));return guide&&!guide.webContents.isLoading();},'lazy Guide');
  check(NativeWindow.getAllWindows().length===2,'Guide is created lazily only after an explicit toggle');
  check(await blocked(guide.webContents,'window.launcher.openRemotePlay()','must be opened from the launcher'),'Guide cannot initiate native Remote Play');
  check(await blocked(guide.webContents,"window.launcher.controlRemotePlay('close')",'must be controlled from the launcher'),'Guide cannot control native Remote Play');
  check(await blocked(guide.webContents,'window.launcher.setRemotePlayObscured(true)','Invalid Remote Play view state'),'Guide cannot obscure the launcher native player');
  for(const call of['window.launcher.getXboxModeRestartStatus()','window.launcher.prepareXboxModeRestart()',"window.launcher.restartIntoXboxMode('synthetic-token')"])
    check(await blocked(guide.webContents,call,'disabled in demo mode'),`demo Guide refuses ${call} without host actions`);
  check(await blocked(guide.webContents,'window.desktopGuide.requestXboxModeEntry()','disabled in demo mode'),'demo Guide entry request refuses host mode actions');
  for(const call of['window.launcher.openCloudGaming()',"window.launcher.controlCloudGaming('retry')",'window.launcher.setCloudGamingObscured(true)','window.launcher.refreshXboxProfile()'])
    check(await blocked(guide.webContents,call,call.includes('setCloud')?'Invalid Cloud gaming':call.includes('refreshXbox')?'from the launcher':'from the launcher'),`Guide rejects ${call}`);
  const {BrowserWindow:HiddenWindow}=await import(pathToFileURL(facade).href);
  const document=join(profile,'untrusted.html');await fs.writeFile(document,'<!doctype html><title>Untrusted IPC fixture</title>');
  const rogue=new HiddenWindow({webPreferences:{preload:join(root,'dist-electron/preload/index.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}});await rogue.loadFile(document);
  for(const call of['window.launcher.getRemotePlayState()','window.launcher.openRemotePlay()',"window.launcher.controlRemotePlay('close')",'window.launcher.setRemotePlayObscured(true)'])check(await blocked(rogue.webContents,call,'Invalid launcher window'),`unregistered window rejects ${call}`);
  for(const call of['window.launcher.getXboxModeRestartStatus()','window.launcher.prepareXboxModeRestart()',"window.launcher.restartIntoXboxMode('synthetic-token')"])
    check(await blocked(rogue.webContents,call,'Invalid launcher window'),`unregistered window rejects ${call}`);
  check(await blocked(rogue.webContents,'window.desktopGuide.requestXboxModeEntry()','Invalid launcher window'),'unregistered window cannot request Game Bar Xbox mode handoff');
  for(const call of['window.launcher.openCloudGaming()','window.launcher.getCloudGamingState()',"window.launcher.controlCloudGaming('close')",'window.launcher.setCloudGamingObscured(true)','window.launcher.refreshXboxProfile()'])
    check(await blocked(rogue.webContents,call,'Invalid launcher window'),`unregistered window rejects ${call}`);
  rogue.destroy();
  const mainId=main.id;main.close();await pause(50);
  check(!main.isDestroyed()&&NativeWindow.fromId(mainId)===main,'normal launcher Close hides instead of destroying the resident service window');
  const shows=main.__showRequests;app.emit('activate');await pause(100);
  check(main.__showRequests>shows,'activating the resident service reshow requests the existing hidden launcher');
  main.destroy();app.emit('activate');await pause(100);
  const reopened=NativeWindow.getAllWindows().find(window=>window.getTitle()==='XBOKS');
  check(Boolean(reopened)&&reopened.id!==mainId,'service activation recreates a destroyed launcher even when the lazy Guide exists');
  if(reopened){await wait(()=>!reopened.webContents.isLoading(),'recreated launcher document');main=reopened;}
  else {guide.destroy();app.emit('activate');await wait(()=>{main=NativeWindow.getAllWindows().find(window=>window.getTitle()==='XBOKS');return main&&!main.webContents.isLoading();},'fallback launcher for Quit check');}
  check(report.helperAttempts.length===0&&report.externalOpens.length===0,'service and IPC checks spawn no host helper or external application');
  check(NativeWindow.getAllWindows().every(window=>!window.isVisible()),'all native test and product surfaces remain hidden');
  check(report.rendererErrors.length===0,'main and Guide renderers remain alive during the checks');
  // Let the actual isolated Electron process quit. Cancelling before-quit to
  // keep a test alive changes Electron's own close semantics and is not proof
  // of a terminal Quit. Persist evidence synchronously in will-quit instead.
  let closePrevented;
  main.on('close',event=>{closePrevented=event.defaultPrevented;});
  app.once('will-quit',()=>{
   check(quitRequests===1,'explicit Quit reaches the real Electron before-quit lifecycle');
   check(closePrevented===false&&main.isDestroyed(),'explicit Quit bypasses the resident Close-to-hide guard');
   check(NativeWindow.getAllWindows().length===0,'real terminal Quit closes all main and Guide native surfaces');
   finish(false);
  });
  observeQuit=true;void evaluate(main,'void window.launcher.quitLauncher();true').catch(()=>{});
 }catch(error){report.failures.push(error.stack??String(error));console.error(error);finish();}
}
void app.whenReady().then(run);
