#!/usr/bin/env node
/** Actual renderer integration checks in an isolated Chromium profile. The
 * launcher boundary and artwork are fixtures; no Electron/user backend is used.
 * Run: XBOKS_FIXTURE_BROWSER=electron node
 * scripts/ui/reference-app-smoke.mjs [output-directory] */
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer as createSocketServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureContentSecurityPolicy, fixtureNetworkBoundary } from './local-network-boundary.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const output = resolve(root, process.argv[2] ?? 'outputs/reference-ui-2026-10-21');
const fixturePath = '/__reference-app-smoke-fixture.js';
const fixture = String.raw`
import { demoSnapshot, demoAccountLibrary } from '/src/shared/demo-data.ts';
const calls = [], listeners = new Set(), fullscreenListeners = new Set(), modeEntryListeners = new Set(), keyringListeners = new Set(), remoteListeners = new Set(), cloudListeners = new Set();
let nativeFullscreen = false;
window.__referenceSmoke = { setSessionFullscreen(value){snapshot.desktopSettings.fullscreenExperience=value;for(const listener of listeners)listener(structuredClone(snapshot));}, setFullscreen(value){nativeFullscreen=value;for(const listener of fullscreenListeners)listener(value);}, requestModeEntry(){for(const listener of modeEntryListeners)listener();}, subscriptions(){return{snapshot:listeners.size,fullscreen:fullscreenListeners.size,entry:modeEntryListeners.size,keyring:keyringListeners.size,remote:remoteListeners.size,cloud:cloudListeners.size};}, calls, forbidden: [], unexpected: [], pad: null, deferLocales: false, localeRequests: [] };
localStorage.clear(); localStorage.setItem('xboks.interface-language.v1', 'en');
const xml = value => value.replace(/[<>&"]/g, char => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[char]));
const artwork = (title, index = 0) => 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><defs><linearGradient id="g"><stop stop-color="'+['#2f5371','#5e2641','#235743','#7a5136'][index%4]+'"/><stop offset="1" stop-color="#131a22"/></linearGradient></defs><rect width="1600" height="900" fill="url(#g)"/><circle cx="1180" cy="300" r="260" fill="#ffffff10"/><text x="80" y="640" font-family="sans-serif" font-size="76" fill="white">'+xml(title)+'</text><text x="84" y="730" font-family="sans-serif" font-size="32" fill="#bec9cf">Renderer test artwork · sample metadata</text></svg>');
const snapshot = demoSnapshot();
snapshot.settings.installRoot = '/home/demo/Games/Xboks';
snapshot.desktopSettings = { canSetAutostart: true, fullscreenExperience: false, fullscreenExperienceSource: 'none', sessionType: 'wayland', desktop: 'Sample desktop', trayAvailable: true };
snapshot.games = snapshot.games.map((game, index) => ({...game, path: game.path.replace('Xodus Nexus','Xboks'), coverUrl: artwork(game.title,index), heroUrl: artwork(game.title,index)}));
snapshot.downloads = snapshot.downloads.map((task,index) => ({...task,destination:'/home/demo/Games/Xboks',canPause:task.status==='running',coverUrl:artwork(task.title,index)}));
snapshot.auth.note = 'Renderer smoke fixture only; no account or Xbox service was contacted.';
const products = [
 ['9N26X2PMTWBT','Wolfenstein II: The New Colossus'], ['9P2N57MC619K','Sea of Thieves'], ['9PJTHRNVH62H','Grounded'],
 ['9N431PX143P8','Forza Horizon 6'], ['9NPKGVXPFRSX','Age of Mythology: Retold'], ['9P74BRFBXXC6','DOOM Eternal'],
 ['9PM3J18QM4Q3','Minecraft Dungeons II'], ['9NGLST31DG26','A Game About Digging A Hole'],
].map(([productId,title],index)=>({productId,title,description:'Renderer fixture description for '+title+'. No Xbox service was contacted.\n\nAdditional sample description.',publisher:'Sample publisher',categories:['Action','Adventure'],posterUrl:artwork(title,index),heroUrl:artwork(title,index),installability:'supported',supportNote:'Renderer fixture only.',includedWith:'Game Pass'}));
const byId = new Map(products.map(product=>[product.productId,product]));
for(const game of snapshot.games) if(!byId.has(game.storeId)) byId.set(game.storeId,{productId:game.storeId,title:game.title,publisher:game.publisher,description:'Renderer fixture description.',categories:['Action'],heroUrl:game.heroUrl});
const metadata = productId => { const product=byId.get(productId); return {productId,title:product?.title??productId,description:product?.description??'Renderer fixture description.',publisher:product?.publisher??'Sample publisher',heroUrl:product?.heroUrl,categories:product?.categories??[],handheldCompatibility:productId==='9N26X2PMTWBT'?{rating:'optimized',source:'microsoft-catalog',platform:'windows-pc',rawRating:1,criteria:['defaults-work','iconography','text-input','ui-legibility','supported-display'].map(id=>({id,rating:'optimized'}))}:undefined,screenshots:[0,1,2,3,4,5,6].map(index=>artwork((product?.title??productId)+' · '+(index+1),index))}; };
const catalog = {query:'',market:'US',products,hasMore:false,fetchedAt:new Date().toISOString(),source:'Microsoft Store'};
const keyring = {state:'ready',gameMode:false,canStart:false,canUnlock:false,canCreate:false,message:'Renderer fixture; no system wallet inspected.'};
const closedPlayer = {open:false,phase:'closed',canGoBack:false};
function pagedCatalog(query,cursor,scope){
 if(cursor&&cursor!==scope+'-page2')throw Error('Invalid fixture paging cursor');
 return{...structuredClone(catalog),query,products:structuredClone(cursor?products.slice(4,6):products.slice(0,4)),hasMore:!cursor,cursor:cursor?undefined:scope+'-page2'};
}
const map = new Map(snapshot.games.map(game=>[game.storeId,{coverUrl:game.coverUrl,heroUrl:game.heroUrl}]));
const handlers = {
 getSnapshot:async()=>structuredClone(snapshot), onSnapshot:callback=>{listeners.add(callback);return()=>listeners.delete(callback);}, onOperationLog:()=>()=>{}, isDemoTour:()=>false,
 getFeaturedCatalog:async()=>structuredClone(catalog), searchCatalog:async(query,cursor)=>pagedCatalog(query,cursor,'search'), getCatalogDetails:async id=>metadata(id),
 getStoreCollection:async(kind,cursor)=>{if(!['all-pc','toppaid','addons'].includes(kind))throw Error('Invalid fixture collection');return pagedCatalog(kind,cursor,kind);},
 getAccountLibrary:async kind=>demoAccountLibrary(kind,map), getGameLaunchOptions:async()=>({cloudSaves:true,vcInstall:true}),
 getGameDetails:async id=>metadata(snapshot.games.find(game=>game.id===id)?.storeId??id),
 getGameActivity:async()=>({status:'available',minutesPlayed:71,lastPlayed:'2026-10-20T15:00:00.000Z'}), getGameAchievements:async()=>({status:'available',items:[]}),
 getGameLocales:id=>window.__referenceSmoke.deferLocales ? new Promise(resolve=>window.__referenceSmoke.localeRequests.push({id,resolve})) : Promise.resolve(['en-US','el-GR']), getLibraryProviders:async()=>['steam','ea'].map(id=>({id,installed:true})),
 getGuideAudio:async()=>({available:false,reason:'Audio adapter is not connected in renderer fixtures.'}), getBatteryPercentage:async()=>null,
 getBatteryStatus:async()=>({percentage:61,charging:true,externalPower:true}), getWindowFullscreen:async()=>nativeFullscreen,
 getFullscreenExperience:async()=>({active:nativeFullscreen,available:true,source:'gnome-extension'}),
 onWindowFullscreenChanged:listener=>{fullscreenListeners.add(listener);return()=>fullscreenListeners.delete(listener);},
 onXboxModeEntryRequested:listener=>{modeEntryListeners.add(listener);return()=>modeEntryListeners.delete(listener);},
 getXboxModeRestartStatus:async()=>({available:true}),
 setWindowFullscreen:async enabled=>{nativeFullscreen=enabled;for(const listener of fullscreenListeners)listener(enabled);return enabled;},
 checkKeyring:async()=>structuredClone(keyring), startKeyring:async()=>structuredClone(keyring), createKeyringCollection:async()=>structuredClone(keyring),
 onKeyringStatus:listener=>{keyringListeners.add(listener);return()=>keyringListeners.delete(listener);},
 getRemotePlayState:async()=>structuredClone(closedPlayer),onRemotePlayState:listener=>{remoteListeners.add(listener);return()=>remoteListeners.delete(listener);},controlRemotePlay:async()=>structuredClone(closedPlayer),setRemotePlayObscured:async()=>{},
 getCloudGamingState:async()=>structuredClone(closedPlayer),onCloudGamingState:listener=>{cloudListeners.add(listener);return()=>cloudListeners.delete(listener);},controlCloudGaming:async()=>structuredClone(closedPlayer),setCloudGamingObscured:async()=>{},
 getDownloadCancelOptions:async()=>({deleteFilesAllowed:false,reason:'Renderer fixture; no files can be deleted.'}),
 updateSettings:async patch=>{Object.assign(snapshot.settings,patch);for(const listener of listeners)listener(structuredClone(snapshot));return structuredClone(snapshot.settings);},
 chooseDirectory:async()=>null, chooseFile:async()=>null,
};
const forbidden = new Set(['startInstall','launchGame','removeGame','cancelDownload','pauseDownload','resumeDownload','removeDownload','installGameContent','updateInstalledGame','quitLauncher','logout','login','openRemotePlay','openCloudGaming','prepareXboxModeRestart','restartIntoXboxMode','startKeyring','createKeyringCollection','updateBackend','installRuntime','installNexusRuntime','installLauncherUpdate','createGameShortcut','addToSteam','installGameVcRuntime','cancelGame','importGame','updateGame','openPath','clearFinishedDownloads']);
window.launcher = new Proxy({}, {get(_target,name){if(name==='getStoreWishlist')return undefined;return (...args)=>{calls.push({method:String(name),args});if(forbidden.has(String(name))){window.__referenceSmoke.forbidden.push(String(name));return Promise.reject(Error('Mutation disabled in renderer smoke fixture'));}if(handlers[name])return handlers[name](...args);window.__referenceSmoke.unexpected.push(String(name));return Promise.reject(Error('Unstubbed renderer API: '+String(name)));};}});
const pad = {index:0,id:'xboks-renderer-smoke',mapping:'standard',connected:true,axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))};
window.__referenceSmoke.pad = pad;
Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[pad]});
await import('/src/renderer/main.tsx');
const watermark=document.createElement('div');watermark.textContent='ACTUAL APP FIXTURE · Synthetic launcher/catalog/input · No account, wallet or host actions';Object.assign(watermark.style,{position:'fixed',bottom:'12px',right:'16px',zIndex:'10000',background:'#132331',color:'#cce4f2',padding:'8px 12px',font:'13px sans-serif',pointerEvents:'none'});document.body.append(watermark);
`;

await mkdir(output, { recursive: true });
const report = { startedAt: new Date().toISOString(), fixtureOnly: true, originalWindowsRuntimeVerified: false, realXboxServicesVerified: false, operatingSystemOverlayVerified: false,
  checks: [], screenshots: [], browserErrors: [], blockedRequests: [], calls: [], forbidden: [], unexpected: [] };
const profile = await mkdtemp(join(tmpdir(), 'xboks-reference-app-'));
const privatePaths={HOME:join(profile,'home'),XDG_CONFIG_HOME:join(profile,'config'),XDG_CACHE_HOME:join(profile,'cache'),XDG_DATA_HOME:join(profile,'data'),XDG_RUNTIME_DIR:join(profile,'runtime'),DBUS_SESSION_BUS_ADDRESS:'unix:path=/nonexistent-xboks-fixture-session',DBUS_SYSTEM_BUS_ADDRESS:'unix:path=/nonexistent-xboks-fixture-system'};
for(const[key,path]of Object.entries(privatePaths))if(!key.startsWith('DBUS'))await mkdir(path,{recursive:true,mode:0o700});
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
  server = await createServer({ root, cacheDir:join(profile,'vite-cache'), logLevel: 'error', server: { host: '127.0.0.1', port: rendererPort, strictPort: true, watch: { ignored: ['**/*'] } }, plugins: [{name:'reference-store-local-artwork',enforce:'pre',transform(code,id){if(!id.endsWith('/src/renderer/XboxStorePage.tsx'))return;return code.replace(/https:\/\/cms-assets\.xboxservices\.com\/[^']+/,storeArtworkPath);}}, {
    name: 'xboks-reference-app-smoke', resolveId(id) { if (id === fixturePath) return id; }, load(id) { if (id === fixturePath) return fixture; },
    configureServer(vite) { vite.middlewares.use(storeArtworkPath,(_req,res)=>{res.setHeader('Content-Type',storeArtwork?'image/jpeg':'image/svg+xml');res.end(storeArtwork??'<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#264937"/><text x="32" y="200" fill="white" font-size="28">Store artwork fixture</text></svg>');});vite.middlewares.use('/__reference-app-smoke.html', async (_req,res) => {
      res.setHeader('Content-Type','text/html'); res.setHeader('Content-Security-Policy',fixtureContentSecurityPolicy); res.end(await vite.transformIndexHtml('/__reference-app-smoke.html', `<!doctype html><html><head><meta charset="utf-8"><title>xboks renderer fixture</title></head><body><div id="root"></div><script type="module" src="${fixturePath}"></script></body></html>`));
    }); },
  }] });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  const electronBrowser=process.env.XBOKS_FIXTURE_BROWSER==='electron';
  chrome = spawn(electronBrowser ? join(root,'node_modules/electron/dist/electron') : process.env.CHROME_BIN ?? '/usr/bin/google-chrome', [...(electronBrowser?[join(root,'scripts/ui/electron-fixture-browser.mjs'),`--xboks-fixture-origin=${base}`]:[]),'--headless','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--disable-background-networking','--disable-extensions','--disable-component-extensions-with-background-pages','--disable-default-apps','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'], { stdio: 'ignore', env:{...process.env,...privatePaths} });
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
  await send('Page.navigate',{url:`${base}/__reference-app-smoke.html`});await send('Page.bringToFront');
  const evaluate=async(expression)=>{const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description??result.exceptionDetails.text);return result.result.value;};
  inspectBoundary=()=>evaluate(`({calls:window.__referenceSmoke?.calls??[],forbidden:window.__referenceSmoke?.forbidden??[],unexpected:window.__referenceSmoke?.unexpected??[],subscriptions:window.__referenceSmoke?.subscriptions?.()})`);
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

  await wait(`Boolean(document.querySelector('.home-product[data-product-id="9N26X2PMTWBT"]'))`);await capture('home');
  await check(`document.querySelector('.shell-header-controls')?.dataset.shellDisplayMode==='desktop'&&document.querySelectorAll('.shell-header-controls button').length===1&&!document.querySelector('.shell-header-controls time,.shell-header-controls .shell-battery,.shell-header-controls .guide-trigger')&&!window.__referenceSmoke.calls.some(call=>call.method==='getBatteryStatus')`,'Desktop header has only Xbox mode and does not read hidden power status');
  await evaluate(`localStorage.setItem('xboks.interface-language.v1','el');window.dispatchEvent(new Event('storage'));`);await delay(120);await capture('header-desktop-el');
  await check(`document.querySelector('.xbox-mode-entry')?.textContent==='Λειτουργία Xbox'`,'Desktop entry uses the requested Greek Xbox mode label');
  await click('.xbox-mode-entry');await wait(`Boolean(document.querySelector('.xbox-mode-entry-dialog'))`);await capture('mode-entry-el');
  await check(`document.activeElement?.matches('[data-xbox-mode-action="remain"]')&&document.querySelectorAll('[data-xbox-mode-action]').length===3&&!window.__referenceSmoke.calls.some(call=>['setWindowFullscreen','prepareXboxModeRestart','restartIntoXboxMode'].includes(call.method))`,'Opening Xbox mode presents three explicit choices on safe Remain without entering or restarting');
  await pad(1);await check(`!document.querySelector('.xbox-mode-entry-dialog')&&document.activeElement?.matches('.xbox-mode-entry')&&!document.querySelector('.app-shell')?.inert`,'Controller B cancels mode entry and restores header focus');
  await evaluate(`window.__referenceSmoke.requestModeEntry()`);await wait(`Boolean(document.querySelector('.xbox-mode-entry-dialog'))`);
  await check(`document.activeElement?.matches('[data-xbox-mode-action="remain"]')`,'A synthetic native handoff opens the same guarded choice dialog');
  await key('Escape');await wait(`!document.querySelector('.xbox-mode-entry-dialog')`);
  await click('.xbox-mode-entry');await wait(`Boolean(document.querySelector('.xbox-mode-entry-dialog'))`);await click('[data-xbox-mode-action="start"]');
  await wait(`document.querySelector('.shell-header-controls')?.dataset.shellDisplayMode==='fullscreen'&&Boolean(document.querySelector('.shell-battery[data-power-icon="charging"]'))`);await capture('header-fullscreen-el');
  await check(`!document.querySelector('.shell-header-controls button')&&Boolean(document.querySelector('.shell-header-controls time'))&&Boolean(document.querySelector('.shell-battery[data-power-icon="charging"]'))&&document.documentElement.hasAttribute('data-fullscreen-experience')`,'Native fullscreen displays only clock and real-boundary charging state');
  await evaluate(`window.__referenceSmoke.setFullscreen(false)`);await wait(`Boolean(document.querySelector('.xbox-mode-entry'))`);
  await check(`!document.querySelector('.shell-header-controls time,.shell-header-controls .shell-battery')&&!document.documentElement.hasAttribute('data-fullscreen-experience')`,'External native fullscreen exit restores desktop entry without stale clock or power controls');
  await evaluate(`window.__referenceSmoke.setSessionFullscreen(true)`);await wait(`document.querySelector('.shell-header-controls')?.dataset.shellDisplayMode==='fullscreen'`);
  await check(`!document.querySelector('.shell-header-controls button')&&Boolean(document.querySelector('.shell-header-controls time'))`,'An externally changed gaming-session snapshot activates fullscreen status without a button click');
  await evaluate(`window.__referenceSmoke.setSessionFullscreen(false)`);await wait(`Boolean(document.querySelector('.xbox-mode-entry'))`);
  await check(`!document.querySelector('.shell-header-controls time,.shell-header-controls .shell-battery')`,'Leaving the gaming session through a new snapshot restores desktop tools');

  await evaluate(`localStorage.setItem('xboks.interface-language.v1','en');window.dispatchEvent(new Event('storage'));`);await delay(120);

  const origin='.home-product[data-product-id="9N26X2PMTWBT"]';await click(origin);
  await wait(`Boolean(document.querySelector('.catalog-details-page[data-product-id="9N26X2PMTWBT"]'))`);await capture('product-details');
  await check(`window.__referenceSmoke.calls.some(call=>call.method==='getCatalogDetails'&&call.args[0]==='9N26X2PMTWBT')&&!window.__referenceSmoke.calls.some(call=>call.method==='searchCatalog')`,'Home product click fetches exact Product ID without title search');
  await wait(`document.querySelector('.handheld-compatibility-entry')?.dataset.handheldRating==='optimized'`);
  await click('.handheld-compatibility-entry');await wait(`Boolean(document.querySelector('.handheld-compatibility-dialog'))`);
  await evaluate(`localStorage.setItem('xboks.interface-language.v1','el');window.dispatchEvent(new Event('storage'));`);await delay(120);await capture('handheld-optimized-el');
  await check(`document.querySelector('.app-shell')?.inert&&document.querySelector('.handheld-compatibility-dialog')?.contains(document.activeElement)&&document.querySelectorAll('[data-criterion-state="optimized"]').length===5`,'Explicit Windows handheld criteria fixture opens the information sheet and owns focus');
  await pad(1);await check(`!document.querySelector('.handheld-compatibility-dialog')&&!document.querySelector('.app-shell')?.inert&&document.activeElement?.matches('.handheld-compatibility-entry')&&Boolean(document.querySelector('.catalog-details-page'))`,'Handheld B closes the sheet and restores its entry without navigating away');
  await evaluate(`localStorage.setItem('xboks.interface-language.v1','en');window.dispatchEvent(new Event('storage'));`);await delay(120);
  await click('.shell-back');await wait(`Boolean(document.querySelector(${JSON.stringify(origin)}))`);await delay(250);
  await check(`document.activeElement?.matches(${JSON.stringify(origin)})`,'Header Back restores the same Home product control');
  await click('.sidebar button[aria-label="Store"]');await wait(`Boolean(document.querySelector('.xbox-store-product[data-product-id="9N431PX143P8"] button'))`);await capture('store-landing');
  await check(`document.querySelectorAll('[data-store-action]').length===5&&document.querySelectorAll('[data-store-spotlight]').length===1&&!document.querySelector('.xbox-store-art-error')`,'Actual Store renders one original fallback and five functional shortcuts');
  await click('.xbox-store-product[data-product-id="9N431PX143P8"] button');await wait(`Boolean(document.querySelector('.catalog-details-page[data-product-id="9N431PX143P8"]'))`);
  await check(`document.querySelector('.xbox-store-page')?.hidden&&getComputedStyle(document.querySelector('.content-shell')).gridTemplateRows.startsWith('88px')`,'Product details hide retained Store state and restore the ordinary header layout');
  await check(`document.querySelector('.catalog-detail-actions .primary')?.textContent.includes('View in library')`,'Installed Store product exposes View in library');
  await click('.catalog-detail-actions .primary');await wait(`Boolean(document.querySelector('.game-details-page[data-gamepad-detail="demo-1"]'))`);await capture('installed-details');
  await check(`(()=>{const box=document.querySelector('.gd-hero-art')?.getBoundingClientRect();return box&&Math.abs(box.width-584)<1&&Math.abs(box.left-1109)<1;})()`,'Actual App installed hero retains 584px media at reference x1109');
  await check(`document.querySelector('.game-details-page')?.getAttribute('data-gamepad-detail')==='demo-1'&&window.__referenceSmoke.calls.some(call=>call.method==='getGameDetails'&&call.args[0]==='demo-1')`,'View in library selects exact installed game, not first library item');
  await click('.handheld-compatibility-entry');await wait(`Boolean(document.querySelector('.handheld-compatibility-dialog[data-handheld-rating="unknown"]'))`);await capture('handheld-unknown');
  await check(`document.querySelectorAll('[data-criterion-state="not-provided"]').length===5&&!document.querySelector('[data-criterion-state="optimized"]')&&document.querySelector('.handheld-rating-context')?.textContent.includes('Linux / Proton compatibility has not been verified')`,'Missing catalog rating remains unknown and never certifies Linux or individual checks');
  await click('[data-handheld-dismiss]');await wait(`!document.querySelector('.handheld-compatibility-dialog')`);
  await check(`document.activeElement?.matches('.handheld-compatibility-entry')&&Boolean(document.querySelector('.game-details-page'))`,'Handheld acknowledgement returns to the installed game and restores focus');
  await click('.gd-manage-trigger');await wait(`Boolean(document.querySelector('[data-reference-menu]'))`);
  await check(`document.activeElement?.getAttribute('data-reference-menu-item')==='details'`,'Installed Manage focuses first enabled action');
  await pad(1);await check(`!document.querySelector('[data-game-menu]')&&document.activeElement?.matches('.gd-manage-trigger')&&Boolean(document.querySelector('.game-details-page'))`,'Manage B dismisses first and restores trigger without leaving details');
  await click('.gd-manage-trigger');await wait(`Boolean(document.querySelector('[data-reference-menu-item="settings"]'))`);await click('[data-reference-menu-item="settings"]');await wait(`Boolean(document.querySelector('[role="dialog"][aria-label="Settings for Forza Horizon 6"]'))`);
  await check(`!document.querySelector('[data-game-menu]')&&Boolean(document.activeElement?.closest('[role="dialog"][aria-label="Settings for Forza Horizon 6"]'))`,'Manage settings action dismisses popup before next dialog owns focus');
  await pad(1);await check(`!document.querySelector('[role="dialog"]')&&document.activeElement?.matches('.gd-manage-trigger')`,'Game-settings B closes dialog and returns focus to Manage');
  await pad(5);await check(`document.querySelector('.gd-tabs [aria-selected="true"]')?.textContent==='Reviews'&&Boolean(document.querySelector('.game-details-page'))`,'Installed product RB selects Reviews without changing app page');await pad(4);

  await accountSettings();await click('#settings-tab-application');await capture('settings-application');
  await check(`document.querySelectorAll('.xbox-settings-nav [role="tab"]').length===9`,'Settings exposes all nine original categories');
  await click('#settings-tab-install');await capture('settings-install');
  await check(`document.querySelector('select[aria-label="Default install location"]')?.value==='/home/demo/Games/Xboks'`,'Install settings display the Xboks fixture installation folder');
  await click('#settings-tab-library');await wait(`document.querySelectorAll('.settings-reference-provider-card').length===5`);await capture('settings-library');
  await check(`JSON.stringify([...document.querySelectorAll('.settings-reference-provider-card strong')].map(node=>node.textContent))===JSON.stringify(['EA App','Epic Games Store','GOG GALAXY','Steam','Ubisoft Connect PC'])`,'Library providers preserve Windows reference order');
  await click('.settings-reference-provider-card');await wait(`Boolean(document.querySelector('[data-settings-subpage-back]'))`);await capture('settings-provider-detail');
  await pad(1);await check(`Boolean(document.querySelector('.xbox-settings-dialog'))&&!document.querySelector('[data-settings-subpage-back]')&&document.activeElement?.matches('.settings-reference-provider-card')`,'Provider subpage B returns to provider list and original card before closing Settings');
  await click('#settings-tab-subscriptions');await capture('settings-subscriptions');
  await check(`Boolean(document.querySelector('[aria-label="Xbox gaming account"]'))&&Boolean(document.querySelector('[aria-label="Microsoft Store account"]'))`,'Subscriptions distinguish Xbox and Microsoft Store account surfaces');
  await pad(1);await check(`!document.querySelector('.xbox-settings-dialog')&&Boolean(document.querySelector('.game-details-page'))`,'Settings B closes only settings and preserves installed product');

  await click('.queue-summary');await wait(`Boolean(document.querySelector('[data-queue-options="demo-download-1"]'))`);await click('[data-queue-options="demo-download-1"]');await wait(`Boolean(document.querySelector('[data-reference-menu-item="details"]'))`);await capture('queue-menu');
  const before=await evaluate(`window.__referenceSmoke.calls.filter(call=>call.method==='searchCatalog').length`);
  await click('[data-reference-menu-item="details"]');await wait(`Boolean(document.querySelector('.catalog-details-page[data-product-id="9NPKGVXPFRSX"]'))`);
  await check(`!document.querySelector('[data-game-menu]')&&window.__referenceSmoke.calls.some(call=>call.method==='getCatalogDetails'&&call.args[0]==='9NPKGVXPFRSX')&&window.__referenceSmoke.calls.filter(call=>call.method==='searchCatalog').length===${before}`,'Queue View details dismisses menu and fetches its exact Product ID without title search');
  await click('.shell-back');await wait(`Boolean(document.querySelector('.downloads-page'))`);await delay(250);
  await check(`document.activeElement?.matches('[data-queue-options="demo-download-1"]')`,'Queue details Back restores its originating operation menu trigger');

  // Library card activation must use the same shell history as Home/Store.
  await click('.sidebar button[aria-label="My Library"]');await wait(`Boolean(document.querySelector('[data-gamepad-detail-target="demo-1"]'))`);
  await click('[data-gamepad-detail-target="demo-1"]');await wait(`Boolean(document.querySelector('.game-details-page[data-gamepad-detail="demo-1"]'))`);
  await click('.sidebar button[aria-label="Store"]');await wait(`Boolean(document.querySelector('.xbox-store-page:not([hidden])'))`);
  await click('.shell-back');await wait(`Boolean(document.querySelector('.game-details-page[data-gamepad-detail="demo-1"]'))`);
  await check(`document.querySelector('.game-details-page')?.getAttribute('data-gamepad-detail')==='demo-1'`,'Library-origin details survive Store navigation and Header Back');
  await click('.shell-back');await wait(`!document.querySelector('.game-details-page')&&Boolean(document.querySelector('[data-gamepad-detail-target="demo-1"]'))`);await delay(250);
  await check(`document.activeElement?.matches('[data-gamepad-detail-target="demo-1"]')`,'Library-origin details Back returns to the originating grid card');

  // Resolve B before a cancelled A request: A must not overwrite B's manifest.
  await evaluate(`window.__referenceSmoke.deferLocales=true;window.__referenceSmoke.localeRequests=[];`);
  await click('[data-gamepad-detail-target="demo-1"]');await wait(`Boolean(document.querySelector('.game-details-page[data-gamepad-detail="demo-1"]'))`);
  await click('.gd-manage-trigger');await wait(`Boolean(document.querySelector('[data-reference-menu-item="settings"]'))`);await click('[data-reference-menu-item="settings"]');
  await wait(`window.__referenceSmoke.localeRequests.some(request=>request.id==='demo-1')`);await pad(1);
  await click('.shell-back');await wait(`!document.querySelector('.game-details-page')&&Boolean(document.querySelector('[data-gamepad-detail-target="demo-2"]'))`);
  await click('[data-gamepad-detail-target="demo-2"]');await wait(`Boolean(document.querySelector('.game-details-page[data-gamepad-detail="demo-2"]'))`);
  await click('.gd-manage-trigger');await wait(`Boolean(document.querySelector('[data-reference-menu-item="settings"]'))`);await click('[data-reference-menu-item="settings"]');
  await wait(`window.__referenceSmoke.localeRequests.some(request=>request.id==='demo-2')`);
  await evaluate(`window.__referenceSmoke.localeRequests.find(request=>request.id==='demo-2').resolve(['fr-FR'])`);
  await wait(`Boolean(document.querySelector('.game-dialog select option[value="fr-FR"]'))`);
  await evaluate(`window.__referenceSmoke.localeRequests.find(request=>request.id==='demo-1').resolve(['de-DE'])`);await delay(250);
  await check(`Boolean(document.querySelector('.game-dialog select option[value="fr-FR"]'))&&!document.querySelector('.game-dialog select option[value="de-DE"]')&&document.querySelector('.game-dialog')?.getAttribute('aria-label')==='Settings for Gears of War: E-Day'`,'Cancelled game A locale response cannot overwrite game B settings');
  await evaluate(`window.__referenceSmoke.deferLocales=false`);await pad(1);

  // A Sidebar origin has no product/card focus selector. Once restored, future
  // child mutations must not pin its scroll position to that saved history.
  await click('.sidebar button[aria-label="Home"]');await wait(`Boolean(document.querySelector(${JSON.stringify(origin)}))`);
  await evaluate(`(()=>{const scroll=document.querySelector('.page-scroll');const max=scroll.scrollHeight-scroll.clientHeight;if(max<40)throw Error('Home fixture needs a real scroll range');window.__referenceSmoke.scroll={saved:Math.floor(max/4),next:Math.floor(max/2)};scroll.scrollTop=window.__referenceSmoke.scroll.saved;})()`);
  await click('.sidebar button[aria-label="Store"]');await wait(`Boolean(document.querySelector('.xbox-store-page:not([hidden])'))`);
  await click('.shell-back');await wait(`Boolean(document.querySelector(${JSON.stringify(origin)}))`);await delay(250);
  await check(`Math.abs(document.querySelector('.page-scroll').scrollTop-window.__referenceSmoke.scroll.saved)<2`,'Sidebar Back restores saved scroll without a product focus selector');
  await evaluate(`(()=>{const scroll=document.querySelector('.page-scroll');scroll.scrollTop=window.__referenceSmoke.scroll.next;scroll.firstElementChild.appendChild(document.createComment('Fixture child mutation verifies bounded history observer cleanup'));})()`);await delay(250);
  await check(`Math.abs(document.querySelector('.page-scroll').scrollTop-window.__referenceSmoke.scroll.next)<2`,'Later child mutation does not lock restored Sidebar scroll');

  // Exercise the real App's persistent Store, exact product route and history.
  await click('.sidebar button[aria-label="Store"]');await wait(`Boolean(document.querySelector('.xbox-store-page:not([hidden]) [data-store-action="all-pc"]'))`);
  await click('[data-store-action="all-pc"]');await wait(`document.querySelectorAll('.xbox-store-gallery-grid .xbox-store-product').length===4`);
  await check(`window.__referenceSmoke.calls.some(call=>call.method==='getStoreCollection'&&call.args[0]==='all-pc'&&!call.args[1])&&document.querySelector('.xbox-store-gallery-heading h2')?.textContent==='All PC games'`,'All PC games uses the named collection through the actual App bridge');
  await click('.xbox-store-load-more button');await wait(`document.querySelectorAll('.xbox-store-gallery-grid .xbox-store-product').length===6`);
  await check(`window.__referenceSmoke.calls.some(call=>call.method==='getStoreCollection'&&call.args[0]==='all-pc'&&call.args[1]==='all-pc-page2')`,'Collection Load more passes its exact cursor and appends the returned page');
  const collectionReads=await evaluate(`window.__referenceSmoke.calls.filter(call=>call.method==='getStoreCollection').length`);
  const retainedProduct='.xbox-store-gallery-grid .xbox-store-product[data-product-id="9P74BRFBXXC6"] button';
  await click(retainedProduct);await wait(`Boolean(document.querySelector('.catalog-details-page[data-product-id="9P74BRFBXXC6"]'))`);await capture('store-collection-product-details');
  await check(`document.querySelector('.xbox-store-page')?.hidden&&document.querySelector('.catalog-details-page h1')?.textContent==='DOOM Eternal'&&window.__referenceSmoke.calls.some(call=>call.method==='getCatalogDetails'&&call.args[0]==='9P74BRFBXXC6')`,'A second-page collection card opens its exact real details component while retaining the gallery');
  await pad(1);await wait(`!document.querySelector('.catalog-details-page')&&!document.querySelector('.xbox-store-page')?.hidden`);await delay(200);
  await check(`document.querySelector('.xbox-store-gallery-heading h2')?.textContent==='All PC games'&&document.querySelectorAll('.xbox-store-gallery-grid .xbox-store-product').length===6&&window.__referenceSmoke.calls.filter(call=>call.method==='getStoreCollection').length===${collectionReads}`,'Product B restores the same collection and both cached pages without a new request');
  await check(`document.activeElement?.matches(${JSON.stringify(retainedProduct)})`,'Collection details Back restores the exact second-page product control');await capture('store-collection-restored');

  await click('.search-box input');await send('Input.insertText',{text:'fixture search'});await key('Enter');
  await wait(`document.querySelector('.xbox-store-gallery-heading h2')?.textContent.includes('fixture search')&&document.querySelectorAll('.xbox-store-gallery-grid .xbox-store-product').length===4`);
  await click('.xbox-store-load-more button');await wait(`document.querySelectorAll('.xbox-store-gallery-grid .xbox-store-product').length===6`);
  const searchReads=await evaluate(`window.__referenceSmoke.calls.filter(call=>call.method==='searchCatalog').length`);
  await check(`window.__referenceSmoke.calls.some(call=>call.method==='searchCatalog'&&call.args[0]==='fixture search'&&call.args[1]==='search-page2')`,'Global search and Load more call the actual Store search bridge with its original query and cursor');
  await click(retainedProduct);await wait(`Boolean(document.querySelector('.catalog-details-page[data-product-id="9P74BRFBXXC6"]'))`);await click('.shell-back');
  await wait(`!document.querySelector('.catalog-details-page')&&document.querySelector('.xbox-store-gallery-heading h2')?.textContent.includes('fixture search')`);await delay(200);
  await check(`document.querySelector('.xbox-store-gallery-heading h2')?.textContent.includes('fixture search')&&document.querySelectorAll('.xbox-store-gallery-grid .xbox-store-product').length===6&&window.__referenceSmoke.calls.filter(call=>call.method==='searchCatalog').length===${searchReads}`,'Header Back preserves search text and both cached pages without restarting page1');
  await check(`document.activeElement?.matches(${JSON.stringify(retainedProduct)})`,'Search product Header Back restores the exact second-page product control');await capture('store-search-restored');
  await pad(1);await wait(`Boolean(document.querySelector('[data-store-spotlight]'))&&!document.querySelector('.catalog-details-page')`);
  await check(`document.querySelector('.xbox-store-page')?.classList.contains('xbox-store-landing')`,'A second controller B returns from search results to Store landing before shell history');
  await click('[data-store-action="wishlist"]');await wait(`document.querySelector('.xbox-store-message')?.textContent.includes('wishlist is unavailable')`);
  await check(`!window.__referenceSmoke.calls.some(call=>call.method==='getStoreWishlist')`,'Cloud wishlist stays explicitly unavailable without an invented account provider');
  await pad(1);await wait(`Boolean(document.querySelector('[data-store-spotlight]'))`);
  await click('[data-store-action="redeem"]');await wait(`Boolean(document.querySelector('.xbox-store-redeem-dialog'))`);
  await check(`document.activeElement?.matches('[data-gamepad-cancel]')&&document.querySelector('.xbox-store-redeem-dialog a')?.href==='https://redeem.microsoft.com/'&&document.querySelector('.app-shell')?.inert`,'Actual App Redeem owns focus on Cancel and exposes only the explicit official Microsoft continuation');
  await pad(1);await check(`!document.querySelector('.xbox-store-redeem-dialog')&&!document.querySelector('.app-shell')?.inert&&document.activeElement?.matches('[data-store-action="redeem"]')`,'Redeem controller B releases inert state and restores its own Store trigger');

  await accountSettings();
  await evaluate(`localStorage.setItem('xboks.interface-language.v1','el');window.dispatchEvent(new Event('storage'));`);
  await click('#settings-tab-application');await capture('settings-application-el');
  await click('#settings-tab-install');await capture('settings-install-el');
  report.greekInstallLayout=await evaluate(`(()=>{const description=document.querySelector('.original-install-description')?.getBoundingClientRect();const location=document.querySelector('.original-install-settings select')?.getBoundingClientRect();return{descriptionHeight:description?.height,locationTop:location?.top};})()`);
  await click('#settings-tab-library');await wait(`document.querySelectorAll('.settings-reference-provider-card').length===5`);await capture('settings-library-el');
  await check(`(()=>{const s=window.__referenceSmoke.subscriptions();return s.snapshot===1&&s.fullscreen===1&&s.entry===1&&s.remote===1&&s.cloud===1;})()`,'StrictMode mount/unmount cycles leave one live subscription per persistent launcher surface');
  const boundary=await evaluate(`({calls:window.__referenceSmoke.calls,forbidden:window.__referenceSmoke.forbidden,unexpected:window.__referenceSmoke.unexpected})`);
  Object.assign(report,boundary);report.checks.push({label:'No install/launch/account mutation was requested',passed:!report.forbidden.length,actual:report.forbidden});
  report.checks.push({label:'All requested launcher APIs are explicit fixtures',passed:!report.unexpected.length,actual:report.unexpected});
} catch(error) { report.error=error.stack??String(error);console.error(report.error); }
finally {
  if(inspectBoundary)try{Object.assign(report,await inspectBoundary());}catch{}
  report.finishedAt=new Date().toISOString();report.passed=report.checks.filter(check=>check.passed).length;report.failed=report.checks.filter(check=>!check.passed).length;
  await writeFile(join(output,'renderer-smoke-report.json'),`${JSON.stringify(report,null,2)}\n`);
  await writeFile(join(output,'README.txt'),'1920×1080 screenshots of the actual xboks React renderer, using explicit sample launcher APIs and generated SVG fixture artwork. No real account, backend, wallet, game install or Xbox service was contacted. The Store fallback image is served locally; the report records cached public or generated fixture artwork. Private HOME/XDG paths, disabled system/session D-Bus addresses and the localhost-only browser network boundary isolate the run. These checks do not verify original Windows runtime behavior, operating-system Game Bar integration, service licensing, or pixel parity. See renderer-smoke-report.json for exact checks/API calls.\n');
  socket?.close();
  if(chrome){const exited=chrome.exitCode===null?new Promise(resolve=>chrome.once('exit',resolve)):Promise.resolve();chrome.kill('SIGTERM');await exited;}
  await server?.close();await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});
}
console.log(`Renderer fixture checks: ${report.passed} passed, ${report.failed} failed. Artifacts: ${output}`);
if(report.error||report.failed||report.browserErrors.length)process.exitCode=1;
