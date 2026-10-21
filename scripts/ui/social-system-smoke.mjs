#!/usr/bin/env node
/** Isolated renderer fixtures. No real Xbox accounts, messages, host devices or
 * power actions. Run: XBOKS_FIXTURE_BROWSER=electron node
 * scripts/ui/social-system-smoke.mjs [output-folder] [install|voice|controller|xbox-mode] */
import { createServer } from 'vite';
import { createServer as createSocketServer } from 'node:net';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureContentSecurityPolicy, fixtureNetworkBoundary } from './local-network-boundary.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const output=resolve(root,process.argv[2]??'outputs/social-system-2026-10-21');
const voiceOnly=process.argv[3]==='voice';
const installOnly=process.argv[3]==='install';
const widgetsOnly=process.argv[3]==='widgets';
const remoteOnly=process.argv[3]==='remote';
const controllerOnly=process.argv[3]==='controller';
const modeEntryOnly=process.argv[3]==='xbox-mode';
const fixtures=modeEntryOnly?[['xbox-mode-entry','runXboxModeEntryChecks']]:controllerOnly?[['guide-controller','runGuideControllerChecks']]:remoteOnly?[['remote-play','runRemotePlayChecks']]:widgetsOnly?[['guide-widgets','runGuideWidgetChecks']]:voiceOnly?[['voice','runVoiceChecks']]:installOnly?[['package-install','runPackageInstallChecks']]:[['xbox-social','runSocialChecks'],['guide-system','runSystemChecks']];
const report={startedAt:new Date().toISOString(),fixtureOnly:true,realXboxRequests:false,realMessagesSent:false,realSystemActions:false,realMicrophoneCaptured:false,fakeChromiumMedia:voiceOnly,originalWindowsRuntimeVerified:false,checks:[],screenshots:[],browserErrors:[],blockedRequests:[]};
await mkdir(output,{recursive:true});
const profile=await mkdtemp(join(tmpdir(),'xboks-social-system-'));let server,chrome,socket;
try{
 const reservation=createSocketServer();await new Promise((resolve,reject)=>{reservation.once('error',reject);reservation.listen(0,'127.0.0.1',resolve);});const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
 server=await createServer({root,...(installOnly?{cacheDir:join(profile,'vite-cache')}:{}) ,logLevel:'error',server:{host:'127.0.0.1',port,strictPort:true,watch:{ignored:['**/*']}},plugins:[{name:'social-system-smoke',configureServer(vite){for(const [fixture] of fixtures)vite.middlewares.use(`/__${fixture}-smoke.html`,async(_req,res)=>{res.setHeader('Content-Type','text/html');res.setHeader('Content-Security-Policy',fixtureContentSecurityPolicy);res.end(await vite.transformIndexHtml(`/__${fixture}-smoke.html`,`<!doctype html><html><head><meta charset="utf-8"><title>XBOKS component fixture</title></head><body><div id="root"></div><script type="module" src="/scripts/ui/fixtures/${fixture}.tsx"></script></body></html>`));});}}]});await server.listen();const base=`http://127.0.0.1:${port}`;
 const electronBrowser=process.env.XBOKS_FIXTURE_BROWSER==='electron';
 chrome=spawn(electronBrowser?join(root,'node_modules/electron/dist/electron'):process.env.CHROME_BIN??'/usr/bin/google-chrome',[...(electronBrowser?[join(root,'scripts/ui/electron-fixture-browser.mjs'),`--xboks-fixture-origin=${base}`]:[]),'--headless',...(installOnly?['--disable-extensions','--disable-component-extensions-with-background-pages','--disable-default-apps']:[]),...(voiceOnly?['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--mute-audio','--autoplay-policy=no-user-gesture-required']:[]),'--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--disable-background-networking','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
 let chromePort;for(let attempt=0;attempt<100&&!chromePort;attempt++){try{chromePort=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);}catch{}if(!chromePort)await new Promise(resolve=>setTimeout(resolve,100));}if(!chromePort)throw Error('Chromium did not start');
 const tab=(await(await fetch(`http://127.0.0.1:${chromePort}/json`)).json()).find(value=>value.type==='page');socket=new WebSocket(tab.webSocketDebuggerUrl);await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}));let id=0;const pending=new Map();
 const send=(method,params={})=>new Promise((resolve,reject)=>{const current=++id;const timeout=setTimeout(()=>{pending.delete(current);reject(Error(`CDP timeout: ${method}`));},90000);pending.set(current,message=>{clearTimeout(timeout);message.error?reject(Error(JSON.stringify(message.error))):resolve(message.result);});socket.send(JSON.stringify({id:current,method,params}));});
 const evaluate=async expression=>{const value=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(value.exceptionDetails)throw Error(value.exceptionDetails.exception?.description??value.exceptionDetails.text);return value.result.value;};
 const capture=async name=>{try{await evaluate('document.fonts.ready');await new Promise(resolve=>setTimeout(resolve,180));const{data}=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(output,`${name}.png`),Buffer.from(data,'base64'));const layout=await evaluate(`(()=>{const panel=document.querySelector('.guide-panel,.shell-flyout');const box=panel?.getBoundingClientRect();return{panel:box?{x:box.x,y:box.y,width:box.width,height:box.height}:null,focus:document.activeElement?.getAttribute('aria-label')||document.activeElement?.textContent?.trim().slice(0,80),horizontalOverflow:panel?panel.scrollWidth>panel.clientWidth+2:false};})()`);report.screenshots.push({name:`${name}.png`,...layout});}catch(error){report.browserErrors.push(String(error));}finally{await evaluate('window.__pendingFixtureCapture=undefined');}};
 const networkBoundary=fixtureNetworkBoundary(base,report,electronBrowser?async url=>{try{return(await readFile(join(profile,'fixture-network-denials.jsonl'),'utf8')).split('\n').some(line=>line&&JSON.parse(line).url===url);}catch{return false;}}:undefined);
 socket.addEventListener('message',event=>{const message=JSON.parse(event.data);networkBoundary.handle(message);if(message.id){pending.get(message.id)?.(message);pending.delete(message.id);}else if(message.method==='Runtime.exceptionThrown')report.browserErrors.push(message.params.exceptionDetails.exception?.description??message.params.exceptionDetails.text);else if(message.method==='Runtime.bindingCalled'&&message.params.name==='referenceCapture')void capture(message.params.payload);});
 await send('Page.enable');await send('Runtime.enable');await send('Runtime.addBinding',{name:'referenceCapture'});await networkBoundary.install(send);await send('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});await send('Emulation.setFocusEmulationEnabled',{enabled:true});
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`window.__captureFixture=async name=>{window.__pendingFixtureCapture=name;window.referenceCapture(name);while(window.__pendingFixtureCapture)await new Promise(resolve=>setTimeout(resolve,50));};`});
 for(const[fixture,method]of fixtures){
  await send('Page.navigate',{url:`${base}/__${fixture}-smoke.html`});await send('Page.bringToFront');for(let attempt=0;attempt<100;attempt++){if(await evaluate(`typeof window.${method}==='function'`))break;if(attempt===99)throw Error(`${fixture} did not load`);await new Promise(resolve=>setTimeout(resolve,100));}
  const result=await evaluate(`window.${method}()`);report[fixture]=result;for(const label of result.checks)report.checks.push({fixture,label,passed:true});console.log(`${fixture}: ${result.passed} passed`);
 }
}catch(error){report.error=error.stack??String(error);console.error(report.error);}
finally{
 report.finishedAt=new Date().toISOString();report.passed=report.checks.length;await writeFile(join(output,'renderer-smoke-report.json'),`${JSON.stringify(report,null,2)}\n`);await writeFile(join(output,'README.txt'),'1920×1080 previews of actual XBOKS React components with isolated sample launcher APIs. All account names, messages, network/device names, capabilities and OS action results are fixtures. A visible watermark identifies each preview. No real Xbox request/message or host network/Bluetooth/power action occurred. Voice mode forces Chromium fake media devices and muted audio; no physical microphone is captured. These previews do not verify original Windows runtime behavior, service permissions or compositor/OS overlay integration. Reproduce with node scripts/ui/social-system-smoke.mjs.\n');socket?.close();if(chrome){const exited=chrome.exitCode===null?new Promise(resolve=>chrome.once("exit",resolve)):Promise.resolve();chrome.kill('SIGTERM');await exited;}await server?.close();await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});
}
console.log(`Fixture checks: ${report.passed}; screenshots: ${report.screenshots.length}. Artifacts: ${output}`);if(report.error||report.browserErrors.length)process.exitCode=1;
