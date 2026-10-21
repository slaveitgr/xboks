#!/usr/bin/env node
/** Full actual-App state/polling regression in an isolated Electron browser.
 * Provider APIs, the Player/peer constructor and its video event are fixtures;
 * App, CloudStreamHost, ConsoleStreamHost and connectCloudPlayer are real.
 * No production launcher, current account, media or host session is contacted.
 * Run: XBOKS_FIXTURE_BROWSER=electron node
 * scripts/ui/stream-session-app-smoke.mjs [output-directory]
 * Optional XBOKS_STREAM_FIXTURE_BASELINE_DIR supplies literal older host sources
 * for an expected-failure reproduction; source hashes are saved in the report. */
import { createServer } from 'vite';
import {createHash} from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer as createSocketServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureContentSecurityPolicy, fixtureNetworkBoundary } from './local-network-boundary.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const output = resolve(root, process.argv[2] ?? 'work/stream-session-app-smoke');
const cloudData={products:[],version:JSON.parse(await readFile(join(root,'package.json'),'utf8')).version};
const baselineDir=process.env.XBOKS_STREAM_FIXTURE_BASELINE_DIR?resolve(root,process.env.XBOKS_STREAM_FIXTURE_BASELINE_DIR):undefined;
const hostSources={};for(const name of ['CloudStream.tsx','ConsoleStream.tsx'])hostSources[name]=await readFile(join(baselineDir??join(root,'src/renderer'),name),'utf8');
const fixturePath = '/__cloud-layout-app-smoke-fixture.js';
const fixture = await readFile(join(root,'scripts/ui/fixtures/stream-session-app.tsx'),'utf8');

await mkdir(output, { recursive: true });
const report = { actualFullApp:true,fixturePlayerOnly:true,realMediaDecoded:false,realStreamStarted:false,sourceVersion:cloudData.version,baselineDir,hostSources:Object.fromEntries(Object.entries(hostSources).map(([name,code])=>[name,createHash('sha256').update(code).digest('hex')])),startedAt: new Date().toISOString(), fixtureOnly: true, originalWindowsRuntimeVerified: false, realXboxServicesVerified: false, operatingSystemOverlayVerified: false,
  checks: [], screenshots: [], browserErrors: [], blockedRequests: [], calls: [], forbidden: [], unexpected: [] };
const profile = await mkdtemp(join(tmpdir(), 'xboks-reference-app-'));
const privatePaths={DISPLAY:'',WAYLAND_DISPLAY:'',XAUTHORITY:'',SESSION_MANAGER:'',XDG_ACTIVATION_TOKEN:'',DESKTOP_STARTUP_ID:'',HOME:join(profile,'home'),XDG_CONFIG_HOME:join(profile,'config'),XDG_CACHE_HOME:join(profile,'cache'),XDG_DATA_HOME:join(profile,'data'),XDG_RUNTIME_DIR:join(profile,'runtime'),DBUS_SESSION_BUS_ADDRESS:'unix:path=/nonexistent-xboks-fixture-session',DBUS_SYSTEM_BUS_ADDRESS:'unix:path=/nonexistent-xboks-fixture-system'};
for(const[key,path]of Object.entries(privatePaths))if(path&&!key.startsWith('DBUS'))await mkdir(path,{recursive:true,mode:0o700});
// Reuse only the original public artwork cached by the separate Store probe.
// This runner does not make a remote request. A fresh checkout uses SVG fixtures.
let storeArtwork;try{storeArtwork=await readFile(join(root,'work/reference/store-fallback-original.png'));}catch{}
const storeArtworkPath='/__reference-store-artwork.jpg';
report.storeArtwork=storeArtwork?'cached-public-fallback':'generated-fixture';
let chrome, socket, server, inspectBoundary;
try {
  // Vite treats port=0 as its default port. Reserve an ephemeral number first
  // so an existing user's development server remains untouched.
  const reservation=createSocketServer();
  await new Promise((resolve,reject)=>{reservation.once('error',reject);reservation.listen(0,'127.0.0.1',resolve);});
  const rendererPort=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  server = await createServer({ root, cacheDir:join(profile,'vite-cache'), logLevel: 'error', server: { host: '127.0.0.1', port: rendererPort, strictPort: true, watch: { ignored: ['**/*'] } }, plugins: [{name:'stream-session-fixture-player',enforce:'pre',transform(code,id){for(const [name,source] of Object.entries(hostSources))if(id.endsWith('/src/renderer/'+name))return source;if(!id.endsWith('/src/renderer/cloud-player.ts'))return;const marker='const factory: CloudPlayerFactory = async (container, config) => {';if(code.split(marker).length!==2)throw Error('Fixture Player injection marker changed');return code.replace(marker,marker+'\n  return window.__streamFixture.createPlayer(container,config);');}},{name:'reference-store-local-artwork',enforce:'pre',transform(code,id){if(!id.endsWith('/src/renderer/XboxStorePage.tsx'))return;return code.replace(/https:\/\/cms-assets\.xboxservices\.com\/[^']+/,storeArtworkPath);}}, {
    name: 'xboks-reference-app-smoke', resolveId(id) { if (id === fixturePath) return id; }, load(id) { if (id === fixturePath) return fixture; },
    configureServer(vite) { vite.middlewares.use('/__cloud-layout-public.json',(_req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(cloudData));});vite.middlewares.use(storeArtworkPath,(_req,res)=>{res.setHeader('Content-Type',storeArtwork?'image/jpeg':'image/svg+xml');res.end(storeArtwork??'<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#264937"/><text x="32" y="200" fill="white" font-size="28">Store artwork fixture</text></svg>');});vite.middlewares.use('/__cloud-layout-app-smoke.html', async (_req,res) => {
      res.setHeader('Content-Type','text/html'); res.setHeader('Content-Security-Policy',fixtureContentSecurityPolicy); res.end(await vite.transformIndexHtml('/__cloud-layout-app-smoke.html', `<!doctype html><html><head><meta charset="utf-8"><title>XBOKS renderer fixture</title></head><body><div id="root"></div><script type="module" src="${fixturePath}"></script></body></html>`));
    }); },
  }] });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  const electronBrowser=process.env.XBOKS_FIXTURE_BROWSER==='electron';
  chrome = spawn(electronBrowser ? join(root,'node_modules/electron/dist/electron') : process.env.CHROME_BIN ?? '/usr/bin/google-chrome', [...(electronBrowser?[join(root,'scripts/ui/electron-fixture-browser.mjs'),`--xboks-fixture-origin=${base}`]:[]),'--headless','--ozone-platform=headless','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--disable-background-networking','--disable-extensions','--disable-component-extensions-with-background-pages','--disable-default-apps','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'], { stdio: 'ignore', env:{...process.env,...privatePaths} });
  let port;
  for (let attempt=0;attempt<100&&!port;attempt++) { try { port=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]); } catch {} if(!port)await new Promise(resolve=>setTimeout(resolve,100)); }
  if(!port)throw Error('Chromium did not start');
  const tab=(await(await fetch(`http://127.0.0.1:${port}/json`)).json()).find(item=>item.type==='page');
  socket=new WebSocket(tab.webSocketDebuggerUrl); await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}));
  let id=0; const pending=new Map();
  const send=(method,params={})=>new Promise((resolve,reject)=>{const current=++id;const timeout=setTimeout(()=>{pending.delete(current);reject(Error(`CDP timeout: ${method}`));},20000);pending.set(current,message=>{clearTimeout(timeout);message.error?reject(Error(JSON.stringify(message.error))):resolve(message.result);});socket.send(JSON.stringify({id:current,method,params}));});
  const networkBoundary=fixtureNetworkBoundary(base,report,electronBrowser?async url=>{try{return(await readFile(join(profile,'fixture-network-denials.jsonl'),'utf8')).split('\n').some(line=>line&&JSON.parse(line).url===url);}catch{return false;}}:undefined);
  socket.addEventListener('message',event=>{const message=JSON.parse(event.data);networkBoundary.handle(message);if(message.id){pending.get(message.id)?.(message);pending.delete(message.id);}else if(message.method==='Runtime.exceptionThrown')report.browserErrors.push(message.params.exceptionDetails.exception?.description??message.params.exceptionDetails.text);});
  await send('Page.enable'); await send('Runtime.enable'); await networkBoundary.install(send);
  await send('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});await send('Emulation.setFocusEmulationEnabled',{enabled:true});
  await send('Page.navigate',{url:`${base}/__cloud-layout-app-smoke.html`});await send('Page.bringToFront');
  const evaluate=async(expression)=>{const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description??result.exceptionDetails.text);return result.result.value;};
  inspectBoundary=()=>evaluate(`({calls:window.__referenceSmoke?.calls??[],forbidden:window.__referenceSmoke?.forbidden??[],unexpected:window.__referenceSmoke?.unexpected??[],subscriptions:window.__referenceSmoke?.subscriptions?.(),streamFixture:window.__streamFixture?{records:window.__streamFixture.records,events:window.__streamFixture.events,players:window.__streamFixture.players,pendingReads:window.__streamFixture.pendingReads.map(request=>({kind:request.kind,id:request.id})),pendingStops:window.__streamFixture.pendingStops.map(request=>({kind:request.kind,id:request.id}))}:undefined})`);
  const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const wait=async(expression)=>{for(let attempt=0;attempt<100;attempt++){if(await evaluate(expression))return;await delay(100);}throw Error(`Renderer condition timed out: ${expression}`);};
  const check=async(expression,label)=>{const actual=await evaluate(expression);const passed=Boolean(actual);const result={label,passed,actual};if(!passed)result.context=await evaluate(`({focus:document.activeElement?.outerHTML.slice(0,600),page:document.querySelector('.sidebar [aria-current="page"]')?.getAttribute('aria-label'),detail:document.querySelector('[data-gamepad-detail]')?.getAttribute('data-gamepad-detail'),store:{heading:document.querySelector('.xbox-store-gallery-heading h2')?.textContent,count:document.querySelectorAll('.xbox-store-gallery-grid .xbox-store-product').length,searchCalls:window.__referenceSmoke.calls.filter(call=>call.method==='searchCatalog').length},installedArt:(()=>{const box=document.querySelector('.gd-hero-art')?.getBoundingClientRect();return box?{x:box.x,width:box.width}:undefined;})()})`);report.checks.push(result);console.log(`${passed?'PASS':'FAIL'} ${label}`);};
  const click=async(selector)=>{
    const target=await evaluate(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});if(!node)throw Error('Missing click target '+${JSON.stringify(selector)});if(node.disabled||node.closest('[inert],[hidden]'))throw Error('Unavailable click target '+${JSON.stringify(selector)});node.scrollIntoView({block:'center',inline:'center'});const box=node.getBoundingClientRect();if(!box.width||!box.height)throw Error('Invisible click target '+${JSON.stringify(selector)});return{x:box.x+box.width/2,y:box.y+box.height/2};})()`);
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',...target});await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...target});await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...target});await delay(160);
  };
  const key=async(value)=>{await send('Input.dispatchKeyEvent',{type:'keyDown',key:value});await send('Input.dispatchKeyEvent',{type:'keyUp',key:value});await delay(160);};
  const pad=async(button)=>{await delay(100);await evaluate(`Object.assign(window.__referenceSmoke.pad.buttons[${button}],{pressed:true,value:1})`);await delay(100);await evaluate(`Object.assign(window.__referenceSmoke.pad.buttons[${button}],{pressed:false,value:0})`);await delay(180);};
  const capture=async(name)=>{await evaluate('document.fonts.ready');await delay(180);const {data}=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(output,`${name}.png`),Buffer.from(data,'base64'));report.screenshots.push(`${name}.png`);};
  const accountSettings=async()=>{await click('.account-summary');await wait(`Boolean(document.querySelector('.shell-account-menu'))`);await evaluate(`(()=>{const button=[...document.querySelectorAll('.shell-account-menu button')].find(button=>button.textContent.trim()==='Settings');if(!button)throw Error('Settings menu action missing');button.click();})()`);await wait(`Boolean(document.querySelector('.xbox-settings-dialog'))`);};

  await wait(`Boolean(document.querySelector('.home-product'))`);
  await check(`Boolean(document.querySelector('.app-shell .sidebar'))&&document.querySelector('.app-shell .topbar')!==null`,'Actual full App shell and native stream hosts are mounted');
  await click('.sidebar [aria-label="Cloud gaming"]');
  await wait(`Boolean(document.querySelector('.cloud-library-page'))`);
  await click('.search-box input');await send('Input.insertText',{text:'Forza Horizon 5'});await key('Enter');
  await wait(`Boolean(document.querySelector('.cloud-product[data-product-id="9NNX1VVR3KNQ"]'))&&!document.querySelector('.cloud-search-progress')`);
  await click('.cloud-product[data-product-id="9NNX1VVR3KNQ"]');
  await wait(`Boolean(document.querySelector('.cloud-detail-actions .cloud-play-action:not(:disabled)'))`);
  await check(`window.__streamFixture.records.length===0&&window.__streamFixture.players.length===0`,'Catalog focus/details never create a session or media peer');
  await click('.cloud-detail-actions .cloud-play-action');
  await wait(`window.__streamFixture.records[0]?.polls===1`);
  await check(`document.querySelector('[data-cloud-session-phase="provisioning"]')&&window.__streamFixture.events.filter(event=>event.id===window.__streamFixture.records[0].id).slice(-2).map(event=>event.event).join(',')==='push,reply'`,'Cloud poll receives the same Provisioning push before its invoke response while real Preparing UI is visible');
  await capture('cloud-preparing-fixture');
  await wait(`document.querySelector('[data-cloud-session-phase="ready"]')&&window.__streamFixture.players[0]?.video`);
  await check(`window.__streamFixture.records[0].polls===3&&window.__streamFixture.records[0].sdp===1&&window.__streamFixture.records[0].ice===1`,'Repeated same-phase Cloud pushes continue polling to ready and invoke one actual host SDP/ICE handshake');
  await check(`window.__streamFixture.players[0].offers===1&&window.__streamFixture.players[0].local===1&&window.__streamFixture.players[0].remote===1&&!document.querySelector('[data-cloud-session-phase] .cloud-stream-loading')&&document.documentElement.dataset.cloudStreamInput==='active'`,'Actual cloud-player adapter binds the fixture peer and leaves Preparing after its explicitly simulated playing event');
  await capture('cloud-ready-simulated-video-event');
  const readyPolls=await evaluate(`window.__streamFixture.records[0].polls`);await delay(2200);
  await check(`window.__streamFixture.records[0].polls===${readyPolls}`,'Cloud ready stops preparation polling instead of starting a duplicate peer');
  await click('[aria-label="End cloud session"]');await click('.cloud-stream-menu button:last-of-type');
  await wait(`!document.querySelector('[data-cloud-session-phase]')`);
  await check(`window.__streamFixture.records[0].stops===1&&window.__streamFixture.players[0].closed&&!document.documentElement.dataset.cloudStreamInput`,'Explicit End session closes only its cloud peer and releases the shared input lease');

  await evaluate(`window.__streamFixture.configure('cloud',{readyAfter:1,deferPoll:true})`);
  await click('.cloud-detail-actions .cloud-play-action');await wait(`window.__streamFixture.pendingReads.length===1`);
  await check(`Boolean(document.querySelector('[data-cloud-session-phase="provisioning"] .cloud-stream-loading'))&&!document.querySelector('.cloud-stream-menu')&&document.querySelector('[data-cloud-session-phase] [data-gamepad-cancel]')?.textContent.includes('Return to cloud games')`,'A new Cloud session resets prior video/menu state and offers the real preparation cancel action');
  await click('[data-cloud-session-phase] [data-gamepad-cancel]');await wait(`!document.querySelector('[data-cloud-session-phase]')`);
  await evaluate(`window.__streamFixture.pendingReads.splice(0).forEach(request=>request.resolve())`);await delay(2200);
  await check(`!document.querySelector('[data-cloud-session-phase]')&&window.__streamFixture.records[1].polls===1&&window.__streamFixture.records[1].sdp===0&&window.__streamFixture.players.length===1&&!document.documentElement.dataset.cloudStreamInput`,'Cancelled Cloud preparation ignores its late ready response and cannot restart polling, media or input');

  await evaluate(`window.__streamFixture.configure('cloud',{readyAfter:1,deferPoll:true,deferStop:true})`);
  await click('.cloud-detail-actions .cloud-play-action');await wait(`window.__streamFixture.pendingReads.length===1`);
  await click('[data-cloud-session-phase] [data-gamepad-cancel]');await wait(`window.__streamFixture.pendingStops.length===1`);
  await evaluate(`window.__streamFixture.configure('cloud',{readyAfter:1,deferPoll:true});window.__streamFixture.begin('cloud','9NNX1VVR3KNQ')`);
  await wait(`window.__streamFixture.pendingReads.length===2`);
  await check(`document.querySelector('[data-cloud-session-phase="provisioning"]')&&window.__streamFixture.records[3].polls===1`,'A replacement Cloud session owns its own same-phase preparation loop while the old stop is pending');
  await evaluate(`window.__streamFixture.pendingReads.shift().resolve()`);await delay(180);
  await check(`document.querySelector('[data-cloud-session-phase="provisioning"]')&&window.__streamFixture.records[2].sdp===0&&window.__streamFixture.records[3].sdp===0&&window.__streamFixture.players.length===1`,'A late ready response from the old Cloud ID cannot replace the active preparation or start its media');
  await click('[data-cloud-session-phase] [data-gamepad-cancel]');await wait(`!document.querySelector('[data-cloud-session-phase]')`);
  await check(`window.__streamFixture.records[3].stops===1`,'A pending old Cloud stop never blocks cancellation of the replacement session');
  await evaluate(`window.__streamFixture.pendingReads.splice(0).forEach(request=>request.resolve());window.__streamFixture.pendingStops.splice(0).forEach(request=>request.resolve())`);await delay(2200);
  await check(`!document.querySelector('[data-cloud-session-phase]')&&window.__streamFixture.records[2].sdp===0&&window.__streamFixture.records[3].sdp===0&&window.__streamFixture.players.length===1&&!document.documentElement.dataset.cloudStreamInput`,'Late Cloud ready and stop replies after cancellation cannot reopen a host or leak input');

  await click('.sidebar [aria-label="Remote Play"]');await wait(`Boolean(document.querySelector('.console-device'))`);
  await check(`window.__streamFixture.records.filter(record=>record.kind==='console').length===0`,'Opening the native Console picker never starts a stream automatically');
  await click('.console-device');await click('.console-connect');
  await wait(`window.__streamFixture.records[4]?.polls===1`);
  await check(`document.querySelector('[data-console-session-phase="provisioning"]')&&window.__streamFixture.events.filter(event=>event.id===window.__streamFixture.records[4].id).slice(-2).map(event=>event.event).join(',')==='push,reply'`,'Console poll also receives its same-phase push before the invoke response');
  await wait(`document.querySelector('[data-console-session-phase="ready"]')&&window.__streamFixture.players[1]?.video`);
  await check(`window.__streamFixture.records[4].polls===3&&window.__streamFixture.records[4].sdp===1&&window.__streamFixture.records[4].ice===1&&!document.querySelector('[data-console-session-phase] .cloud-stream-loading')`,'Repeated Console pushes continue to ready, one actual host handshake and a labeled simulated video event');
  const consoleReadyPolls=await evaluate(`window.__streamFixture.records[4].polls`);await delay(2200);
  await check(`window.__streamFixture.records[4].polls===${consoleReadyPolls}`,'Console ready stops preparation reads without duplicate media connection');
  await click('[aria-label="End remote play"]');await click('.cloud-stream-menu button:last-of-type');await wait(`!document.querySelector('[data-console-session-phase]')`);
  await check(`window.__streamFixture.records[4].stops===1&&window.__streamFixture.players[1].closed&&!document.documentElement.dataset.cloudStreamInput`,'Console End session disposes its media peer and shared input lease');

  await evaluate(`window.__streamFixture.configure('console',{readyAfter:1,deferPoll:true})`);
  await click('.sidebar [aria-label="Remote Play"]');await wait(`Boolean(document.querySelector('.console-device'))`);await click('.console-device');await click('.console-connect');
  await wait(`window.__streamFixture.pendingReads.length===1`);
  await click('[data-console-session-phase] [data-gamepad-cancel]');await wait(`!document.querySelector('[data-console-session-phase]')`);
  await evaluate(`window.__streamFixture.pendingReads.splice(0).forEach(request=>request.resolve())`);await delay(2200);
  await check(`!document.querySelector('[data-console-session-phase]')&&window.__streamFixture.records[5].polls===1&&window.__streamFixture.records[5].sdp===0&&window.__streamFixture.players.length===2&&!document.documentElement.dataset.cloudStreamInput`,'Cancelled Console preparation rejects its late ready response without restarting input or video');
  const boundary=await evaluate(`({calls:window.__referenceSmoke.calls,forbidden:window.__referenceSmoke.forbidden,unexpected:window.__referenceSmoke.unexpected})`);
  Object.assign(report,boundary);report.checks.push({label:'No forbidden real install/launch/account/system mutation was requested',passed:!report.forbidden.length,actual:report.forbidden});
  report.checks.push({label:'All requested launcher APIs are explicit fixtures',passed:!report.unexpected.length,actual:report.unexpected});
} catch(error) { report.error=error.stack??String(error);console.error(report.error); }
finally {
  if(inspectBoundary)try{Object.assign(report,await inspectBoundary());}catch{}
  report.finishedAt=new Date().toISOString();report.passed=report.checks.filter(check=>check.passed).length;report.failed=report.checks.filter(check=>!check.passed).length;
  await writeFile(join(output,'stream-session-app-report.json'),`${JSON.stringify(report,null,2)}\n`);
  await writeFile(join(output,'README.txt'),'Full actual XBOKS React App/CloudStreamHost/ConsoleStreamHost regression. Provider state, the Peer/Player object and playing event are explicitly simulated; no real frames are decoded. The production connectCloudPlayer handshake runs against the fixture peer and bridge. Generated SVG metadata is test artwork. No real account, backend, wallet, game install or Xbox service was contacted. The Store fallback image is served locally; the report records cached public or generated fixture artwork. Private HOME/XDG paths, disabled system/session D-Bus addresses and the localhost-only browser network boundary isolate the run. These checks do not verify original Windows runtime behavior, operating-system Game Bar integration, service licensing, or pixel parity. See stream-session-app-report.json for exact checks/API calls.\n');
  socket?.close();
  if(chrome){const exited=chrome.exitCode===null?new Promise(resolve=>chrome.once('exit',resolve)):Promise.resolve();chrome.kill('SIGTERM');await exited;}
  await server?.close();await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});
}
console.log(`Renderer fixture checks: ${report.passed} passed, ${report.failed} failed. Artifacts: ${output}`);
if(report.error||report.failed||report.browserErrors.length)process.exitCode=1;
