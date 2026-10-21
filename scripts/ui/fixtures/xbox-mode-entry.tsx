import React, {useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {XboxModeEntryDialog} from '/src/renderer/XboxModeEntryDialog.tsx';
import {GamepadNavigation} from '/src/renderer/GamepadNavigation.tsx';
import type {PadAction} from '/src/renderer/gamepad-navigation.ts';
import '/src/renderer/styles.css';

// Every privileged method here is synthetic. This fixture cannot reboot,
// change autostart, enter native fullscreen, or call the host launcher.
localStorage.setItem('xboks.interface-language.v1','el');
Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});
Object.defineProperty(document,'hasFocus',{configurable:true,value:()=>true});
Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[]});
const inputs=new Set<(value:PadAction)=>void>();
let reads=0,prepares=0,restarts:string[]=[],starts=0,closes=0,outerBacks=0;
let available=true,statusError=false,expired=false,deferPrepare=false,deferStart=false,deferRestart=false,startError=false,restartError=false;
let finishPrepare:(()=>void)|undefined,finishStart:(()=>void)|undefined,finishRestart:(()=>void)|undefined;
const bridge={
 getXboxModeRestartStatus:async()=>{reads++;if(statusError)throw Error('Synthetic status error');return{available,reason:available?undefined:'Fixture restart is unavailable in this desktop session.'};},
 prepareXboxModeRestart:async()=>{const id=++prepares;if(deferPrepare)await new Promise<void>(resolve=>{finishPrepare=()=>{finishPrepare=undefined;resolve();};});return{token:`fixture-confirmation-${id}`,expiresAt:new Date(Date.now()+(expired?-1000:60000)).toISOString()};},
 restartIntoXboxMode:async(token:string)=>{restarts.push(token);if(deferRestart)await new Promise<void>(resolve=>{finishRestart=()=>{finishRestart=undefined;resolve();};});if(restartError)throw Error('Fixture restart was refused.');},
};
function Harness(){
 const[open,setOpen]=useState(false),trigger=useRef<HTMLButtonElement>(null);
 const close=()=>{closes++;setOpen(false);requestAnimationFrame(()=>trigger.current?.focus());};
 return <><main className="app-shell xbox-mode" style={{display:'block',padding:48,background:'linear-gradient(120deg,#16372c,#20252e)',color:'#fff'}}><button ref={trigger} data-mode-trigger data-gamepad-initial style={{height:32,border:'1px solid #77818d',borderRadius:8,padding:'0 18px',background:'#3c424b'}} onClick={()=>setOpen(true)}>Λειτουργία Xbox</button><h1 style={{marginTop:100,fontSize:36}}>Xbox Game Pass</h1><p>Isolated Xbox mode entry fixture</p><button data-background-action style={{height:36,marginTop:24,padding:'0 16px'}}>Background action</button></main>{open?<XboxModeEntryDialog bridge={bridge} close={close} startNow={async()=>{starts++;if(startError)throw Error('Fixture fullscreen was refused.');if(deferStart)await new Promise<void>(resolve=>{finishStart=()=>{finishStart=undefined;resolve();};});}}/>:null}<GamepadNavigation activateOnFocus nativeControlsActive subscribeInput={callback=>{inputs.add(callback);return()=>inputs.delete(callback);}} back={()=>outerBacks++} page={()=>{throw Error('Modal navigation must not switch the underlying page.');}}/></>;
}
const watermark=document.createElement('div');watermark.textContent='MODAL FIXTURE · Synthetic restart bridge · No reboot, autostart or OS changes';Object.assign(watermark.style,{position:'fixed',bottom:'14px',right:'20px',zIndex:'9999',background:'#132331',padding:'10px 14px',font:'14px sans-serif',color:'#cce4f2',pointerEvents:'none'});document.body.append(watermark);
createRoot(document.getElementById('root')!).render(<Harness/>);
const checks:string[]=[],pause=()=>new Promise(resolve=>setTimeout(resolve,100));
const check=(value:unknown,label:string)=>{if(!value)throw Error(`${label}; focus=${document.activeElement?.outerHTML.slice(0,180)}`);checks.push(label);};
const modal=()=>document.querySelector<HTMLElement>('.xbox-mode-entry-dialog');
const action=(name:string)=>document.querySelector<HTMLButtonElement>(`[data-xbox-mode-action="${name}"]`)!;
const dispatch=(value:PadAction)=>{for(const callback of inputs)callback(value);};
const native=async(value:PadAction)=>{dispatch(value);await pause();};
const key=async(value:string,shiftKey=false)=>{document.activeElement?.dispatchEvent(new KeyboardEvent('keydown',{key:value,shiftKey,bubbles:true,cancelable:true}));await pause();};
const open=async()=>{check(document.activeElement?.hasAttribute('data-mode-trigger'),'closing the modal restores the header trigger');await native('accept');check(Boolean(modal()),'native A on the launcher trigger opens the actual portal dialog');};
const restartFocus=async()=>{await native('up');await native('up');check(document.activeElement===action('restart'),'native D-pad reaches the explicit Restart CTA');};
const capture=async(name:string)=>{if(typeof(window as any).__captureFixture==='function')await(window as any).__captureFixture(name);};
(window as any).runXboxModeEntryChecks=async()=>{
 await pause();await pause();await open();
 check(reads===1&&prepares===0&&restarts.length===0&&starts===0,'opening reads restart availability without preparing, rebooting or entering fullscreen');
 check(modal()?.parentElement===document.querySelector('.xbox-mode-entry-backdrop')&&modal()?.parentElement?.parentElement===document.body,'dialog is portaled to document.body outside launcher layout');
 check(document.activeElement===action('remain'),'safe initial controller focus is Remain on desktop');
 check(modal()?.textContent?.includes('Επανεκκίνηση σε λειτουργία Xbox')&&modal()?.textContent?.includes('Έναρξη τώρα (δεν υπάρχουν αλλαγές επιδόσεων)')&&modal()?.textContent?.includes('Παραμείνετε στην επιφάνεια εργασίας'),'Greek title and three choices match the requested Linux entry flow');
 check(modal()?.textContent?.includes('GNOME δεν εφαρμόζει πρόσθετες βελτιστοποιήσεις επιδόσεων'),'Greek copy explains that GNOME restart adds no performance optimizations');
 const rect=modal()!.getBoundingClientRect(),style=getComputedStyle(modal()!);
 check(rect.width===520&&rect.height===305&&Math.abs(rect.x-700)<1&&Math.abs(rect.y-387.5)<1,'1920×1080 dialog measures 520×305 and is centered at the reference position');
 check(style.backgroundColor==='rgb(255, 255, 255)'&&style.borderRadius==='7px'&&getComputedStyle(action('restart')).backgroundColor==='rgb(0, 103, 192)','dialog matches the white card, seven-pixel corners and reference blue primary action');
 check([...modal()!.querySelectorAll('button')].every(button=>button.getBoundingClientRect().height===32),'all three footer actions are 32 pixels tall');
 await capture('xbox-mode-entry-greek');
 await key('Tab');check(document.activeElement===action('restart'),'Tab wraps from the final action to the first enabled modal action');await key('Tab',true);check(document.activeElement===action('remain'),'Shift+Tab wraps back inside the dialog');
 await native('up');check(document.activeElement===action('start'),'native D-pad navigates from Remain to Start now');deferStart=true;dispatch('accept');dispatch('accept');await pause();check(starts===1&&prepares===0&&restarts.length===0&&action('start').disabled,'repeated native A serializes Start now without preparing or rebooting');await native('back');await key('Escape');action('remain').click();await pause();check(Boolean(modal())&&action('remain').disabled&&closes===0&&outerBacks===0,'B, Escape and Remain cannot claim cancellation after Start now is dispatched');finishStart!();deferStart=false;await pause();check(!modal()&&closes===1,'successful Start now closes the modal once');
 await open();startError=true;await native('up');await native('accept');check(Boolean(modal())&&document.querySelector('[role="alert"]')?.textContent==='Fixture fullscreen was refused.','Start now failure stays in the dialog with a local error');startError=false;const startsBeforeBack=starts;await native('back');check(!modal()&&starts===startsBeforeBack&&restarts.length===0&&outerBacks===0,'native B dismisses only the modal without entering or rebooting');
 available=false;await open();check(action('restart').disabled&&modal()?.textContent?.includes('Fixture restart is unavailable'),'unavailable restart is disabled with the actual capability reason');await native('up');await native('up');check(document.activeElement===action('start')&&prepares===0,'D-pad cannot select an unavailable Restart action');await key('Escape');check(!modal()&&prepares===0&&restarts.length===0&&outerBacks===0,'Escape cancels locally and never falls through to the underlying page');
 available=true;statusError=true;await open();check(action('restart').disabled&&Boolean(document.querySelector('[role="status"]')),'failed availability read keeps restart disabled');await native('back');statusError=false;
 expired=true;await open();await restartFocus();await native('accept');check(prepares===1&&restarts.length===0&&Boolean(modal())&&document.querySelector('[role="alert"]')?.textContent?.includes('έληξε'),'expired prepared token cannot dispatch a restart and leaves a localized inline retry error');
 expired=false;await restartFocus();deferPrepare=true;dispatch('accept');dispatch('accept');await pause();check(prepares===2&&restarts.length===0&&Boolean(finishPrepare),'pending Restart preparation is serialized before dispatch');await native('back');finishPrepare!();deferPrepare=false;await pause();check(!modal()&&restarts.length===0,'B during preparation prevents a delayed restart after the modal closes');
 await open();await restartFocus();deferRestart=true;dispatch('accept');dispatch('accept');await pause();check(prepares===3&&restarts.length===1&&restarts[0]==='fixture-confirmation-3'&&Boolean(finishRestart),'explicit Restart prepares a fresh token and invokes the synthetic restart once');const closesBeforeRestart=closes;await native('back');await key('Escape');action('remain').click();await pause();check(Boolean(modal())&&action('remain').disabled&&closes===closesBeforeRestart&&outerBacks===0,'B, Escape and Remain cannot claim cancellation after the restart request is dispatched');finishRestart!();deferRestart=false;await pause();check(!modal()&&closes===closesBeforeRestart+1,'successful dispatched restart closes through its completion path');
 restartError=true;await open();await restartFocus();await native('accept');check(Boolean(modal())&&!action('remain').disabled&&document.querySelector('[role="alert"]')?.textContent==='Fixture restart was refused.','restart dispatch failure unlocks cancellation and remains visible in the modal');await native('back');restartError=false;
 localStorage.setItem('xboks.interface-language.v1','en');window.dispatchEvent(new CustomEvent('xboks-interface-language',{detail:'en'}));await pause();await open();check(modal()?.textContent?.includes('Restart into Xbox mode')&&modal()?.textContent?.includes('Start now (no performance changes)')&&modal()?.textContent?.includes('Remain on desktop'),'English choices preserve the same explicit actions');await capture('xbox-mode-entry-english');const finalStarts=starts,finalRestarts=restarts.length,finalPrepares=prepares;await native('accept');check(!modal()&&starts===finalStarts&&restarts.length===finalRestarts&&prepares===finalPrepares,'A on Remain on desktop closes without any entry or restart side effect');
 return{checks,passed:checks.length,reads,prepares,restarts,starts,closes,geometry:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},realSystemActions:false,restartBridgeSynthetic:true,realNativeIpc:false,physicalControllerVerified:false};
};
