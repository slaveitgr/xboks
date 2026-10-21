#!/usr/bin/env electron
/** Native WebContentsView focus/isolation fixture, no Xbox/network/console.
 * Compile only this manager, then run:
 * node_modules/.bin/esbuild src/main/remote-play.ts --bundle --platform=node --format=esm --external:electron --outfile=work/remote-play-fixture.mjs
 * node_modules/.bin/electron scripts/ui/remote-play-native-smoke.mjs outputs/remote-play-native work/remote-play-fixture.mjs
 */
import {app,BrowserWindow,session} from 'electron';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
const scriptIndex=process.argv.findIndex(value=>!value.startsWith('-')&&resolve(value)===fileURLToPath(import.meta.url));
const output=resolve(process.argv[scriptIndex+1]??'outputs/remote-play-native-2026-10-21'),moduleFile=resolve(process.argv[scriptIndex+2]??'dist-electron/main/remote-play.js');
const profile=await mkdtemp(join(tmpdir(),'xboks-remote-native-fixture-'));app.setPath('userData',profile);app.commandLine.appendSwitch('disable-background-networking');
const report={fixtureOnly:true,realXboxRequests:false,realConsoleConnected:false,realMicrophoneCaptured:false,checks:[],errors:[]};let owner,remote;
const check=(value,label)=>{if(!value)throw Error(label);report.checks.push(label);console.log('PASS '+label);};const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const deadline=setTimeout(()=>{report.errors.push('Native fixture timed out');void finish(1);},45000);let finishing=false;
async function finish(code){if(finishing)return;finishing=true;clearTimeout(deadline);try{remote?.destroy();if(owner&&!owner.isDestroyed())owner.destroy();await mkdir(output,{recursive:true});await writeFile(join(output,'native-remote-play-report.json'),JSON.stringify({...report,passed:report.checks.length},null,2)+'\n');await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});}finally{app.exit(code);}}
void app.whenReady().then(async()=>{
try{
 session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*','ws://*/*','wss://*/*']},(_details,callback)=>callback({cancel:true}));
 const {RemotePlay,REMOTE_PLAY_URL}=await import(pathToFileURL(moduleFile).href),partition=session.fromPartition('persist:xboks-remote-play');
 await partition.protocol.handle('https',request=>{if(request.url!==REMOTE_PLAY_URL)throw Error('Fixture forbids navigation '+request.url);return new Response('<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'"><title>Local remote-player fixture</title><body style="background:#173d36;color:white;font:20px sans-serif"><p>Local player fixture · no console connection</p><input id="game" autofocus><script>window.fixtureKeys=[];addEventListener("keydown",e=>fixtureKeys.push(e.key));</script>',{headers:{'Content-Type':'text/html'}});});
 owner=new BrowserWindow({width:1280,height:800,show:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true}});
 await owner.loadURL('data:text/html,<title>Trusted launcher fixture</title><body><button id="toolbar">Trusted toolbar</button><script>document.getElementById("toolbar").focus()</script>');owner.show();owner.focus();
 const states=[];remote=new RemotePlay({changed:value=>states.push(value)});await remote.open(owner);
 for(let attempt=0;attempt<100&&remote.state.phase==='loading';attempt++)await pause(50);
 check(remote.state.phase==='ready','official-origin page loaded entirely from local intercepted fixture');check(BrowserWindow.getAllWindows().length===1,'Remote Play adds no separate BrowserWindow');
 const children=owner.contentView.children,view=children.find(child=>child.webContents&&child.webContents!==owner.webContents);check(Boolean(view),'native remote WebContentsView is attached inside the existing launcher');const contents=view.webContents;
 await pause(180);check(contents.id!==owner.webContents.id,'remote content has a distinct WebContents identity');check(contents.getLastWebPreferences().preload===undefined,'remote content has no launcher preload');check(contents.getLastWebPreferences().sandbox===true&&contents.getLastWebPreferences().nodeIntegration===false,'remote view remains sandboxed without Node');
 check(await contents.executeJavaScript('typeof window.launcher==="undefined"&&typeof require==="undefined"'),'remote page cannot access launcher APIs or Node');check(await contents.executeJavaScript('document.hasFocus()'),'focused remote player document owns keyboard/controller focus');check(!(await owner.webContents.executeJavaScript('document.hasFocus()')),'launcher document.hasFocus is false while native player owns focus, blocking app gamepad polling');
 const bounds=view.getBounds(),size=owner.getContentSize();check(bounds.y===64&&bounds.width===size[0]&&bounds.height===size[1]-64,'native view leaves trusted64px toolbar outside remote content');
 contents.sendInputEvent({type:'keyDown',keyCode:'Escape'});contents.sendInputEvent({type:'keyUp',keyCode:'Escape'});await pause(100);check(remote.state.open&&await contents.executeJavaScript('fixtureKeys.includes("Escape")'),'game Escape reaches the player and does not close the host');
 contents.sendInputEvent({type:'keyDown',keyCode:'F6',modifiers:['control']});contents.sendInputEvent({type:'keyUp',keyCode:'F6',modifiers:['control']});await pause(100);check(await owner.webContents.executeJavaScript('document.hasFocus()'),'Ctrl+F6 returns focus to the trusted launcher toolbar');
 remote.setObscured(true);check(!view.getVisible(),'opening Game Bar can hide the native player view');remote.setObscured(false);await pause(100);check(view.getVisible()&&await contents.executeJavaScript('document.hasFocus()'),'closing Game Bar restores native player focus without another load');
 remote.destroy();await pause(100);check(contents.isDestroyed()&&owner.contentView.children.length===children.length-1,'closing host destroys the remote renderer and removes native child view');check(remote.state.phase==='closed'&&states.at(-1).open===false,'close publishes truthful closed state');
 console.log(`Native Remote Play fixture: ${report.checks.length} passed`);await finish(0);
}catch(error){report.errors.push(error.stack??String(error));console.error(error);await finish(1);}
});
