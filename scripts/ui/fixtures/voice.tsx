import React,{useState}from'react';import{createRoot}from'react-dom/client';
import{LocalVoiceTest}from'/src/renderer/LocalVoiceTest.tsx';import{loadOriginalXboxUi}from'/src/renderer/XboxIcons.tsx';
import'/src/renderer/styles.css';import'/src/renderer/guide-overlay.css';
loadOriginalXboxUi();localStorage.setItem('xboks.interface-language.v1','en');
const checks:string[]=[],calls:any[]=[],streams:MediaStream[]=[],revokes=new Set<()=>void>();let permissions=0,releases=0;
(window as any).launcher={requestVoiceCapture:async()=>{permissions++;},releaseVoiceCapture:async()=>{releases++;},onVoiceCaptureStop:(callback:()=>void)=>{revokes.add(callback);return()=>revokes.delete(callback);}};
const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
navigator.mediaDevices.getUserMedia=async constraints=>{calls.push(constraints);const stream=await original(constraints);streams.push(stream);if(!stream.getAudioTracks().every(track=>/fake/i.test(track.label))){stream.getTracks().forEach(track=>track.stop());throw Error('Voice fixture requires Chromium fake media devices');}return stream;};
function Harness(){const[show,setShow]=useState(true);(window as any).voiceVisible=setShow;return <><div className="guide-overlay"><section className="guide-panel" style={{left:100,top:30,width:570,maxHeight:1000}}><div className="guide-panel-scroll">{show?<LocalVoiceTest/>:<p>Voice fixture unmounted</p>}</div></section></div><div style={{position:'fixed',bottom:14,right:20,zIndex:9999,background:'#132331',color:'#cce4f2',padding:12}}>FIXTURE · Chromium fake microphone · Audio muted · No Xbox connection</div></>;}
createRoot(document.getElementById('root')!).render(<Harness/>);
const pause=()=>new Promise(resolve=>setTimeout(resolve,100));const wait=async(test:()=>boolean)=>{for(let i=0;i<50;i++){if(test())return;await pause();}throw Error('Voice fixture timed out');};const check=(value:unknown,label:string)=>{if(!value)throw Error(label);checks.push(label);};
const button=(text:string)=>{const node=[...document.querySelectorAll<HTMLButtonElement>('.local-voice-test button')].find(node=>node.textContent===text);if(!node||node.disabled)throw Error('Unavailable '+text);node.focus();node.click();};
const toggle=(text:string)=>{const label=[...document.querySelectorAll<HTMLLabelElement>('.local-voice-test label')].find(label=>label.textContent===text);if(!label)throw Error('Missing '+text);label.querySelector<HTMLInputElement>('input')!.click();};
const active=()=>document.querySelector('.local-voice-test [role="status"]')?.textContent?.includes('Microphone active');const capture=async(name:string)=>{if(typeof(window as any).__captureFixture==='function')await(window as any).__captureFixture(name);};
(window as any).runVoiceChecks=async()=>{
 await pause();await pause();check(calls.length===0&&permissions===0,'mount enumerates devices without requesting microphone capture');await capture('local-microphone-stopped');
 button('Start test');await wait(()=>Boolean(active()));check(permissions===1&&calls.length===1&&calls[0].video===false,'explicit Start requests one grant and audio-only fake capture');
 check(streams[0].getAudioTracks().every(track=>/fake/i.test(track.label)),'Chromium fake microphone is enforced; no physical input is used');
 check(!document.querySelector<HTMLInputElement>('.local-voice-check input:checked')?.closest('label')?.textContent?.includes('Listen'),'capture starts with monitor playback off');
 await wait(()=>Number(document.querySelector('meter')?.value)>0);check(Number(document.querySelector('meter')?.value)>0,'real WebAudio analyser meters synthetic capture');await capture('local-microphone-running');
 toggle('Push to talk for this test');await pause();button('Hold to talk');const hold=document.activeElement!;hold.dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true,cancelable:true}));await pause();check(hold.textContent==='Test input open','focused Space key holds local test gate open');hold.dispatchEvent(new KeyboardEvent('keyup',{key:' ',bubbles:true,cancelable:true}));await pause();check(hold.textContent==='Hold to talk','keyup releases push-to-talk');
 toggle('Listen to my voice on this PC');await pause();check([...document.querySelectorAll('label')].find(label=>label.textContent==='Listen to my voice on this PC')?.querySelector<HTMLInputElement>('input')?.checked,'only explicit Listen starts local monitor (Chromium output muted)');
 button('Stop test');await wait(()=>!active());check(streams[0].getTracks().every(track=>track.readyState==='ended')&&releases===1,'Stop ends all acquired capture tracks and releases permission');
 button('Start test');await wait(()=>Boolean(active()));window.dispatchEvent(new Event('blur'));await wait(()=>!active());check(streams[1].getTracks().every(track=>track.readyState==='ended'),'window blur stops synthetic microphone and releases held input');
 button('Start test');await wait(()=>Boolean(active()));for(const stop of revokes)stop();await wait(()=>!active());check(streams[2].getTracks().every(track=>track.readyState==='ended'),'native stop notification stops every active capture track');
 button('Start test');await wait(()=>Boolean(active()));(window as any).voiceVisible(false);await pause();check(streams[3].getTracks().every(track=>track.readyState==='ended'),'unmount stops synthetic microphone without relying on a UI Stop click');
 return{passed:checks.length,checks,permissions,releases,captureRequests:calls,realMicrophoneCaptured:false,realAudioPlayed:false,realXboxRequests:false};
};
