// Real GJS/Gio on an isolated bus, synthetic player only. Never the host player.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const processes=[];
const desktopRoot=await mkdtemp(path.join(os.tmpdir(),'xboks-spotify-desktop-'));
function start(file,args=[],environment={}){
 const child=spawn('gjs',['-m',file,...args],{stdio:['pipe','pipe','pipe'],env:{...process.env,GIO_USE_VFS:'local',...environment}});processes.push(child);
 const messages=[],listeners=new Set();let stderr='';child.stderr.on('data',data=>{stderr+=data;});
 createInterface({input:child.stdout}).on('line',line=>{const value=JSON.parse(line);messages.push(value);for(const listener of listeners)listener(value);});
 const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
 const wait=(predicate,from=0)=>{const present=messages.slice(from).find(predicate);if(present)return Promise.resolve(present);return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{listeners.delete(listener);reject(Error(`Timeout ${file}; ${stderr}; ${JSON.stringify(messages)}`));},5000);const listener=value=>{if(predicate(value)){clearTimeout(timer);listeners.delete(listener);resolve(value);}};listeners.add(listener);});};
 return{child,messages,wait,exited,send:value=>child.stdin.write(JSON.stringify(value)+'\n')};
}
try{
 await mkdir(path.join(desktopRoot,'applications'));
 // Synthetic fixed Snap desktop ID: no host install and never launched.
 await writeFile(path.join(desktopRoot,'applications','spotify_spotify.desktop'),'[Desktop Entry]\nType=Application\nName=Spotify fixture\nExec=/bin/false\n');
 const fake=start('scripts/desktop/fixtures/spotify-service.js',['org.mpris.MediaPlayer2.vlc']);await fake.wait(v=>v.event==='ready');
 const helper=start('assets/desktop/spotify-client.js',[],{XDG_DATA_HOME:desktopRoot,XDG_DATA_DIRS:desktopRoot});let id=0;
 const request=async(method,command)=>{const requestId=++id;helper.send({id:requestId,method,...(command?{command}:{})});return helper.wait(v=>v.id===requestId);};
 let reply=await request('state');assert.equal(reply.state.status,'not-running');assert.equal(reply.state.capabilities.open,true,'fixed Snap desktop ID is discoverable without launching it');assert.equal(fake.messages.filter(v=>v.event==='called').length,0);
 const service=start('scripts/desktop/fixtures/spotify-service.js');await service.wait(v=>v.event==='ready');
 reply=await request('state');assert.equal(reply.ok,true);assert.equal(reply.state.status,'available');
 assert.equal(reply.state.track.title,'Track "one" Δ');assert.deepEqual(reply.state.track.artists,['Synthetic artist']);assert.equal(reply.state.positionMs,12345);assert.equal(reply.state.track.durationMs,180000);
 assert.deepEqual(reply.state.capabilities,{playPause:true,next:true,previous:false,seek:true,open:true});
 assert.equal(service.messages.filter(v=>v.event==='called').length,0,'read-only discovery must not change playback');
 reply=await request('control',{action:'previous'});assert.equal(reply.ok,false);assert.equal(reply.error,'unsupported-control');assert.equal(service.messages.filter(v=>v.method==='Previous').length,0);
 reply=await request('control',{action:'play-pause'});assert.equal(reply.ok,true);assert.equal(reply.state.playbackStatus,'paused');await service.wait(v=>v.method==='Pause');
 service.send({canPause:false});await service.wait(v=>v.event==='configured');
 reply=await request('control',{action:'play-pause'});assert.equal(reply.ok,true);assert.equal(reply.state.playbackStatus,'playing');await service.wait(v=>v.method==='Play');
 reply=await request('control',{action:'seek',positionMs:42000});assert.equal(reply.ok,true);assert.equal(reply.state.positionMs,42000);
 const seek=await service.wait(v=>v.method==='SetPosition');assert.deepEqual(seek.detail,{track:'/com/spotify/track/synthetic',position:42000000});
 const seekCount=service.messages.filter(v=>v.method==='SetPosition').length;
 reply=await request('control',{action:'seek',positionMs:200000});assert.equal(reply.ok,false);assert.equal(service.messages.filter(v=>v.method==='SetPosition').length,seekCount);
 reply=await request('control',{action:'open',uri:'file:///tmp/run'});assert.equal(reply.ok,false);assert.equal(reply.error,'invalid-command');
 reply=await request('control',{action:'open'});assert.equal(reply.ok,true);await service.wait(v=>v.method==='Raise');
 reply=await request('control',{action:'next'});assert.equal(reply.ok,true);assert.equal(reply.state.track.title,'Next synthetic track');
 const configured=service.messages.length;service.send({canControl:false});await service.wait(v=>v.event==='configured',configured);
 reply=await request('control',{action:'next'});assert.equal(reply.ok,false);assert.equal(reply.error,'unsupported-control');assert.equal(service.messages.filter(v=>v.method==='Next').length,1);
 const second=start('scripts/desktop/fixtures/spotify-service.js',['org.mpris.MediaPlayer2.spotify.instance123']);await second.wait(v=>v.event==='ready');
 reply=await request('state');assert.equal(reply.state.status,'not-running');assert.equal(reply.state.reason,'ambiguous-player');assert.equal(reply.state.track,undefined);
 second.child.kill('SIGTERM');await second.exited;
 service.child.kill('SIGTERM');await service.exited;
 reply=await request('state');assert.equal(reply.state.status,'not-running');assert.equal(reply.state.track,undefined);assert.equal(reply.state.positionMs,undefined);
 const denied=start('scripts/desktop/fixtures/spotify-denied-service.js');await denied.wait(v=>v.event==='ready');
 reply=await request('state');assert.equal(reply.ok,true);assert.equal(reply.state.status,'error');assert.equal(reply.state.reason,'permission-denied');
 assert.equal(reply.state.diagnostic.code,'access-denied');assert.ok(['identity','player-properties'].includes(reply.state.diagnostic.stage));
 assert.equal(reply.state.track,undefined);assert.equal(reply.state.positionMs,undefined);assert.equal(reply.state.playbackStatus,'unknown');
 assert.deepEqual(reply.state.capabilities,{playPause:false,next:false,previous:false,seek:false,open:true});
 reply=await request('control',{action:'next'});assert.equal(reply.ok,false);assert.equal(reply.error,'unavailable');
 assert.equal(reply.state.reason,'permission-denied');assert.ok(denied.messages.some(v=>v.event==='denied'));
 denied.child.kill('SIGTERM');await denied.exited;
 helper.child.stdin.end();assert.deepEqual(await helper.exited,{code:0,signal:null});
 assert.equal(fake.messages.filter(v=>v.event==='called').length,0,'other MPRIS players must never receive controls');
 console.log(JSON.stringify({status:'passed',transport:'real-gjs-isolated-dbus',discoveryReadOnly:true,spotifyOnly:true,capabilityGuards:true,pauseResume:true,absoluteTrackBoundSeek:true,explicitRaise:true,ownerDisappearance:true,permissionDenied:true,hostPlaybackChanged:false}));
}finally{for(const child of processes)child.kill('SIGKILL');await rm(desktopRoot,{recursive:true,force:true});}
