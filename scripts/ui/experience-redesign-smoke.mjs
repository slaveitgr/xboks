#!/usr/bin/env node
/** Actual renderer integration checks in an isolated Chromium profile. The
 * launcher boundary and artwork are fixtures; no Electron/user backend is used.
 * Run: XBOKS_FIXTURE_BROWSER=electron node
 * scripts/ui/experience-redesign-smoke.mjs [output-directory] */
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { createServer as createSocketServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureContentSecurityPolicy, fixtureNetworkBoundary } from './local-network-boundary.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const output = resolve(root, process.argv[2] ?? 'work/redesign-2026-11/fullscreen-qa');
const fixturePath = '/__experience-redesign-fixture.js';
const fixture = String.raw`
import { demoSnapshot, demoAccountLibrary } from '/src/shared/demo-data.ts';
import {collectionKey, saveCollections} from '/src/renderer/LibraryChrome.tsx';
const calls = [], listeners = new Set(), fullscreenListeners = new Set(), modeEntryListeners = new Set(), keyringListeners = new Set(), remoteListeners = new Set(), cloudListeners = new Set();
let nativeFullscreen = false, deferEntry = false, pendingEntry, beforeAccountTransition, deferAudioWrite = false, pendingAudioWrite, failNextStoreDeals = false, failNextGamePassMore = false;
window.__redesignSmoke = { recordHistory(){saveCollections(collectionKey(snapshot.auth),{later:[],history:Object.fromEntries(snapshot.games.map((game,index)=>[game.id,1794142800000-index*1000]))});}, deferAudioWrite(){deferAudioWrite=true;}, audioWritePending(){return Boolean(pendingAudioWrite);}, settleAudioWrite(){const request=pendingAudioWrite;if(!request)throw Error('No fixture audio write is pending');pendingAudioWrite=undefined;request.resolve();}, transitionAccount(){beforeAccountTransition=structuredClone(snapshot.auth);snapshot.auth={...snapshot.auth,stored:true,running:true,gamertag:'Private stale gamer',avatarDataUrl:artwork('Private stale avatar'),profile:{...snapshot.auth.profile,gamertag:'Private stale gamer',gamerscore:21337}};for(const listener of listeners)listener(structuredClone(snapshot));}, resumeAccount(){if(!beforeAccountTransition)throw Error('No account transition fixture');snapshot.auth=beforeAccountTransition;beforeAccountTransition=undefined;for(const listener of listeners)listener(structuredClone(snapshot));}, deferModeEntry(){deferEntry=true;}, modeEntryPending(){return Boolean(pendingEntry);}, settleModeEntry(ok){const request=pendingEntry;if(!request)throw Error('No fixture entry is pending');pendingEntry=undefined;if(ok)request.resolve(true);else{nativeFullscreen=false;for(const listener of fullscreenListeners)listener(false);request.reject(Error('Fixture Xbox mode entry rejected.'));}}, disableLogin(){snapshot.backend.capabilities.login=false;for(const listener of listeners)listener(structuredClone(snapshot));}, signOut(){snapshot.auth={stored:false,running:false,note:'Fixture sign-out only'};for(const listener of listeners)listener(structuredClone(snapshot));}, setSessionFullscreen(value){snapshot.desktopSettings.fullscreenExperience=value;for(const listener of listeners)listener(structuredClone(snapshot));}, setFullscreen(value){nativeFullscreen=value;for(const listener of fullscreenListeners)listener(value);}, requestModeEntry(){for(const listener of modeEntryListeners)listener();}, subscriptions(){return{snapshot:listeners.size,fullscreen:fullscreenListeners.size,entry:modeEntryListeners.size,keyring:keyringListeners.size,remote:remoteListeners.size,cloud:cloudListeners.size};}, calls, forbidden: [], unexpected: [], pad: null, deferLocales: false, localeRequests: [] };
window.__redesignSmoke.failStoreDeals=()=>{failNextStoreDeals=true;};
window.__redesignSmoke.failGamePassMore=()=>{failNextGamePassMore=true;};
localStorage.clear(); localStorage.setItem('xboks.interface-language.v1', 'en');
const xml = value => value.replace(/[<>&"]/g, char => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[char]));
const artwork = (title, index = 0) => 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><defs><linearGradient id="g"><stop stop-color="'+['#2f5371','#5e2641','#235743','#7a5136'][index%4]+'"/><stop offset="1" stop-color="#131a22"/></linearGradient></defs><rect width="1600" height="900" fill="url(#g)"/><circle cx="1180" cy="300" r="260" fill="#ffffff10"/><text x="80" y="640" font-family="sans-serif" font-size="76" fill="white">'+xml(title)+'</text><text x="84" y="730" font-family="sans-serif" font-size="32" fill="#bec9cf">Renderer test artwork · sample metadata</text></svg>');
const snapshot = demoSnapshot();
snapshot.settings.installRoot = '/home/demo/Games/Xboks';
snapshot.desktopSettings = { canSetAutostart: true, fullscreenExperience: false, fullscreenExperienceSource: 'none', sessionType: 'wayland', desktop: 'Sample desktop', trayAvailable: true };
snapshot.games = snapshot.games.map((game, index) => ({...game, path: game.path.replace('Xodus Nexus','Xboks'), coverUrl: artwork(game.title,index), heroUrl: artwork(game.title,index)}));
snapshot.downloads = snapshot.downloads.map((task,index) => ({...task,destination:'/home/demo/Games/Xboks',canPause:task.status==='running',coverUrl:artwork(task.title,index)}));
snapshot.auth.profile={gamertag:'xboksPlayer',gamerscore:21337};
snapshot.games.push(...Array.from({length:6},(_,index)=>({...snapshot.games[0],id:'fixture-extra-'+index,storeId:undefined,title:'Fixture game '+(index+7),coverUrl:artwork('Fixture game '+(index+7),index),heroUrl:artwork('Fixture game '+(index+7),index)})));
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
for(const product of products)if(!map.has(product.productId))map.set(product.productId,{coverUrl:product.posterUrl,heroUrl:product.heroUrl});
const socialCapabilities={friends:true,presence:true,inbox:true,conversation:true,send:false,search:true,partyVoice:false};
const fixtureFriends=[{xuid:'12345',gamertag:'Fixture Friend One',presence:'online',activity:'Sample game activity'},{xuid:'67890',gamertag:'Fixture Friend Two',presence:'offline'},{xuid:'11112',gamertag:'Fixture Friend Three',presence:'unknown'}];
let fixtureVolume=50;
const social=extra=>({status:'ready',checkedAt:new Date().toISOString(),capabilities:{...socialCapabilities},selfXuid:'99999',...extra});
const handlers = {
 onConsoleLibraryOpen:()=>()=>{},
 onVoiceCaptureStop:()=>()=>{},
 getCloudPublicCatalog:async()=>({checkedAt:new Date().toISOString(),collections:{all:products.map(p=>p.productId),own:products.slice(2,5).map(p=>p.productId),popular:products.slice(0,4).map(p=>p.productId),recent:products.slice(4).map(p=>p.productId),ea:[]}}),
 getCloudProducts:async ids=>structuredClone(products.filter(p=>ids.includes(p.productId))),
 getCloudAccountCatalog:async()=>({status:'ready',titles:products.map((p,index)=>({productId:p.productId,titleId:'fixture-title-'+index,hasEntitlement:true,supportedInputTypes:['gamepad'],programs:['fixture'],streamYourOwn:index>1&&index<5})),recentProductIds:[products[0].productId],checkedAt:new Date().toISOString()}),
 getConsoleStreamDevices:async()=>({status:'ready',consoles:[{id:'fixture-console-one-x',name:'Sample Xbox One X',consoleType:'Xbox One X',powerState:'on',canStream:true,canWake:false}],checkedAt:new Date().toISOString()}),
 getCloudStreamState:async()=>({phase:'closed'}),onCloudStreamState:()=>()=>{},getConsoleStreamState:async()=>({phase:'closed'}),onConsoleStreamState:()=>()=>{},
 getXboxFriends:async()=>social({friends:structuredClone(fixtureFriends)}),
 searchXboxPeople:async query=>social({friends:fixtureFriends.filter(friend=>friend.gamertag.toLowerCase().includes(query.toLowerCase()))}),
 getXboxChats:async()=>social({conversations:[]}),
 getXboxConversation:async peerXuid=>social({peerXuid,messages:[{id:'fixture-message',senderXuid:peerXuid,text:'Explicit fixture conversation; no Xbox service contacted.',deleted:false}]}),
 getDesktopApps:async()=>({available:true,apps:[{id:'fixture-editor.desktop',name:'Fixture Editor',description:'Synthetic application entry; launching is disabled.',iconDataUrl:artwork('Fixture Editor')},{id:'fixture-player.desktop',name:'Fixture Player',description:'Synthetic player; no operating-system app is read.'}]}),
 getSnapshot:async()=>structuredClone(snapshot), onSnapshot:callback=>{listeners.add(callback);return()=>listeners.delete(callback);}, onOperationLog:()=>()=>{}, isDemoTour:()=>false,
 getFeaturedCatalog:async()=>structuredClone(catalog), searchCatalog:async(query,cursor)=>pagedCatalog(query,cursor,'search'), getCatalogDetails:async id=>metadata(id),
 getStoreCollection:async(kind,cursor)=>{if(!['all-pc','toppaid','addons','deals'].includes(kind))throw Error('Invalid fixture collection');if(kind==='deals'){if(failNextStoreDeals){failNextStoreDeals=false;throw Error('Synthetic Deals read failure.');}return{...structuredClone(catalog),query:'Deals',products:structuredClone(products.slice(6)),hasMore:false};}return pagedCatalog(kind,cursor,kind);},
 getStoreCategory:async(category,cursor)=>{if(category==='action-adventure')return pagedCatalog('Action & adventure',cursor,'category-'+category);if(category==='comedic')return{...structuredClone(catalog),products:structuredClone(products.slice(0,1)),hasMore:false};throw Error('Unrequested synthetic Store category.');},
 getAccountLibrary:async(kind,cursor,refresh)=>{if(kind!=='gamepass')return demoAccountLibrary(kind,map);if(cursor&&cursor!=='fixture-gamepass-page2')throw Error('Invalid fixture Game Pass cursor');if(cursor&&failNextGamePassMore){failNextGamePassMore=false;throw Error('Synthetic Game Pass continuation failure.');}const all=products.slice(0,6).map((product,index)=>({...structuredClone(product),categories:[index%2?'Puzzle':'Action'],access:'gamepass'}));return{kind,checkedAt:new Date().toISOString(),products:cursor?all.slice(3):all.slice(0,3),accessByProductId:Object.fromEntries(all.map(product=>[product.productId,'gamepass'])),cursor:cursor?undefined:'fixture-gamepass-page2'};}, getGameLaunchOptions:async()=>({cloudSaves:true,vcInstall:true}),
 getGameDetails:async id=>metadata(snapshot.games.find(game=>game.id===id)?.storeId??id),
 getGameActivity:async()=>({status:'available',minutesPlayed:71,lastPlayed:'2026-10-20T15:00:00.000Z'}), getGameAchievements:async()=>({status:'available',items:[]}),
 getGameLocales:id=>window.__redesignSmoke.deferLocales ? new Promise(resolve=>window.__redesignSmoke.localeRequests.push({id,resolve})) : Promise.resolve(['en-US','el-GR']), getLibraryProviders:async()=>['steam','ea'].map(id=>({id,installed:true})),
 getGuideAudio:async()=>({available:true,volume:fixtureVolume,muted:false}), setGuideAudio:async patch=>{if(deferAudioWrite){deferAudioWrite=false;await new Promise(resolve=>{pendingAudioWrite={resolve};});}if(patch.volume!==undefined)fixtureVolume=patch.volume;return{available:true,volume:fixtureVolume,muted:Boolean(patch.muted)};}, getBatteryPercentage:async()=>null,
 getBatteryStatus:async()=>({percentage:61,charging:true,externalPower:true}), getWindowFullscreen:async()=>nativeFullscreen,
 getFullscreenExperience:async()=>({active:nativeFullscreen,available:true,source:'gnome-extension'}),
 onWindowFullscreenChanged:listener=>{fullscreenListeners.add(listener);return()=>fullscreenListeners.delete(listener);},
 onXboxModeEntryRequested:listener=>{modeEntryListeners.add(listener);return()=>modeEntryListeners.delete(listener);},
 getXboxModeRestartStatus:async()=>({available:true}),
 setWindowFullscreen:async enabled=>{nativeFullscreen=enabled;for(const listener of fullscreenListeners)listener(enabled);if(enabled&&deferEntry){deferEntry=false;return new Promise((resolve,reject)=>{pendingEntry={resolve,reject};});}return enabled;},
 checkKeyring:async()=>structuredClone(keyring), startKeyring:async()=>structuredClone(keyring), createKeyringCollection:async()=>structuredClone(keyring),
 onKeyringStatus:listener=>{keyringListeners.add(listener);return()=>keyringListeners.delete(listener);},
 getRemotePlayState:async()=>structuredClone(closedPlayer),onRemotePlayState:listener=>{remoteListeners.add(listener);return()=>remoteListeners.delete(listener);},controlRemotePlay:async()=>structuredClone(closedPlayer),setRemotePlayObscured:async()=>{},
 getCloudGamingState:async()=>structuredClone(closedPlayer),onCloudGamingState:listener=>{cloudListeners.add(listener);return()=>cloudListeners.delete(listener);},controlCloudGaming:async()=>structuredClone(closedPlayer),setCloudGamingObscured:async()=>{},
 getDownloadCancelOptions:async()=>({deleteFilesAllowed:false,reason:'Renderer fixture; no files can be deleted.'}),
 updateSettings:async patch=>{Object.assign(snapshot.settings,patch);for(const listener of listeners)listener(structuredClone(snapshot));return structuredClone(snapshot.settings);},
 chooseDirectory:async()=>null, chooseFile:async()=>null,
};
const forbidden = new Set(['startCloudStream','exchangeCloudSdp','exchangeCloudIce','stopCloudStream','startConsoleStream','exchangeConsoleStreamSdp','exchangeConsoleStreamIce','stopConsoleStream','wakeConsole','sendXboxMessage','startInstall','launchGame','launchDesktopApp','removeGame','cancelDownload','pauseDownload','resumeDownload','removeDownload','installGameContent','updateInstalledGame','quitLauncher','openGuideSystemSettings','logout','login','openRemotePlay','openCloudGaming','prepareXboxModeRestart','restartIntoXboxMode','startKeyring','createKeyringCollection','updateBackend','installRuntime','installNexusRuntime','installLauncherUpdate','createGameShortcut','addToSteam','installGameVcRuntime','cancelGame','importGame','updateGame','openPath','clearFinishedDownloads']);
window.launcher = new Proxy({}, {get(_target,name){if(name==='getStoreWishlist')return undefined;return (...args)=>{calls.push({method:String(name),args});if(forbidden.has(String(name))){window.__redesignSmoke.forbidden.push(String(name));return Promise.reject(Error('Mutation disabled in renderer smoke fixture'));}if(handlers[name])return handlers[name](...args);window.__redesignSmoke.unexpected.push(String(name));return Promise.reject(Error('Unstubbed renderer API: '+String(name)));};}});
const pad = {index:0,id:'xboks-renderer-smoke',mapping:'standard',connected:true,axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))};
window.__redesignSmoke.pad = pad;
Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[pad]});
Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{enumerateDevices:async()=>[],getSupportedConstraints:()=>({}),addEventListener(){},removeEventListener(){},getUserMedia(){window.__redesignSmoke.forbidden.push('getUserMedia');return Promise.reject(Error('Microphone capture is disabled in renderer fixtures.'));}}});
await import('/src/renderer/main.tsx');
const watermark=document.createElement('div');watermark.textContent='ACTUAL APP FIXTURE · Synthetic launcher/catalog/input · No account, wallet or host actions';Object.assign(watermark.style,{position:'fixed',bottom:'12px',right:'16px',zIndex:'10000',background:'#132331',color:'#cce4f2',padding:'8px 12px',font:'13px sans-serif',pointerEvents:'none'});document.body.append(watermark);
`;

await mkdir(output, { recursive: true });
const report = { startedAt: new Date().toISOString(), fixtureOnly: true, originalWindowsRuntimeVerified: false, realXboxServicesVerified: false, operatingSystemOverlayVerified: false,
  checks: [], screenshots: [], browserErrors: [], blockedRequests: [], calls: [], forbidden: [], unexpected: [] };
async function sourceFingerprint() {
  const files=['package.json','scripts/ui/experience-redesign-smoke.mjs','scripts/ui/local-network-boundary.mjs','scripts/ui/electron-fixture-browser.mjs'];
  for(const directory of ['src/renderer','src/shared'])for(const file of await readdir(join(root,directory),{recursive:true})){
    if(/\.(?:tsx?|css)$/.test(file)&&!file.includes('.test.'))files.push(`${directory}/${file}`);
  }
  return Object.fromEntries(await Promise.all(files.sort().map(async file=>[file,createHash('sha256').update(await readFile(join(root,file))).digest('hex')])));
}
report.sourceFingerprint=await sourceFingerprint();
const profile = await mkdtemp(join(tmpdir(), 'xboks-experience-redesign-'));
const privatePaths={DISPLAY:'',WAYLAND_DISPLAY:'',XAUTHORITY:'',SESSION_MANAGER:'',XDG_ACTIVATION_TOKEN:'',DESKTOP_STARTUP_ID:'',HOME:join(profile,'home'),XDG_CONFIG_HOME:join(profile,'config'),XDG_CACHE_HOME:join(profile,'cache'),XDG_DATA_HOME:join(profile,'data'),XDG_RUNTIME_DIR:join(profile,'runtime'),DBUS_SESSION_BUS_ADDRESS:'unix:path=/nonexistent-xboks-fixture-session',DBUS_SYSTEM_BUS_ADDRESS:'unix:path=/nonexistent-xboks-fixture-system'};
for(const[key,path]of Object.entries(privatePaths))if(path&&!key.startsWith('DBUS'))await mkdir(path,{recursive:true,mode:0o700});
// Reuse only the original public artwork cached by the separate Store probe.
// This runner does not make a remote request. A fresh checkout uses SVG fixtures.
let storeArtwork;try{storeArtwork=await readFile(join(root,'work/reference/store-fallback-original.png'));}catch{}
const storeArtworkPath='/__reference-store-artwork.jpg';
report.storeArtwork=storeArtwork?'cached-public-fallback':'generated-fixture';
let chrome, socket, server, inspectBoundary, capture;
try {
  // Vite treats port=0 as its default port. Reserve an ephemeral number first
  // so an existing user's development server remains untouched.
  const reservation=createSocketServer();
  await new Promise((resolve,reject)=>{reservation.once('error',reject);reservation.listen(0,'127.0.0.1',resolve);});
  const rendererPort=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  server = await createServer({ root, cacheDir:join(profile,'vite-cache'), optimizeDeps:{entries:[join(root,'src/renderer/main.tsx')]}, logLevel: 'error', server: { host: '127.0.0.1', port: rendererPort, strictPort: true, watch: { ignored: ['**/*'] } }, plugins: [{name:'reference-store-local-artwork',enforce:'pre',transform(code,id){if(!id.endsWith('/src/renderer/XboxStorePage.tsx'))return;return code.replace(/https:\/\/cms-assets\.xboxservices\.com\/[^']+/,storeArtworkPath);}}, {
    name: 'xboks-experience-redesign-smoke', resolveId(id) { if (id === fixturePath) return id; }, load(id) { if (id === fixturePath) return fixture; },
    configureServer(vite) { vite.middlewares.use(storeArtworkPath,(_req,res)=>{res.setHeader('Content-Type',storeArtwork?'image/jpeg':'image/svg+xml');res.end(storeArtwork??'<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#264937"/><text x="32" y="200" fill="white" font-size="28">Store artwork fixture</text></svg>');});vite.middlewares.use('/__experience-redesign.html', async (_req,res) => {
      res.setHeader('Content-Type','text/html'); res.setHeader('Content-Security-Policy',fixtureContentSecurityPolicy); res.end(await vite.transformIndexHtml('/__experience-redesign.html', `<!doctype html><html><head><meta charset="utf-8"><title>XBOKS renderer fixture</title></head><body><div id="root"></div><script type="module" src="${fixturePath}"></script></body></html>`));
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
  await send('Page.navigate',{url:`${base}/__experience-redesign.html`});await send('Page.bringToFront');
  const evaluate=async(expression)=>{const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description??result.exceptionDetails.text);return result.result.value;};
  inspectBoundary=()=>evaluate(`({calls:window.__redesignSmoke?.calls??[],forbidden:window.__redesignSmoke?.forbidden??[],unexpected:window.__redesignSmoke?.unexpected??[],subscriptions:window.__redesignSmoke?.subscriptions?.()})`);
  const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const wait=async(expression)=>{for(let attempt=0;attempt<100;attempt++){if(await evaluate(expression))return;await delay(100);}throw Error(`Renderer condition timed out: ${expression}`);};
  const check=async(expression,label)=>{const actual=await evaluate(`Boolean(${expression})`);const passed=Boolean(actual);const result={label,passed,actual};if(!passed)result.context=await evaluate(`({focus:document.activeElement?.outerHTML.slice(0,600),page:document.querySelector('.sidebar [aria-current="page"]')?.getAttribute('aria-label'),detail:document.querySelector('[data-gamepad-detail]')?.getAttribute('data-gamepad-detail'),store:{heading:document.querySelector('.xbox-store-gallery-heading h1')?.textContent,count:document.querySelectorAll('.xbox-store-gallery-grid .xbox-store-product').length,searchCalls:window.__redesignSmoke.calls.filter(call=>call.method==='searchCatalog').length},installedArt:(()=>{const box=document.querySelector('.gd-hero-art')?.getBoundingClientRect();return box?{x:box.x,width:box.width}:undefined;})()})`);report.checks.push(result);console.log(`${passed?'PASS':'FAIL'} ${label}`);};
  const click=async(selector)=>{
    const target=await evaluate(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});if(!node)throw Error('Missing click target '+${JSON.stringify(selector)});if(node.disabled||node.closest('[inert],[hidden]'))throw Error('Unavailable click target '+${JSON.stringify(selector)});node.scrollIntoView({block:'center',inline:'center'});const box=node.getBoundingClientRect();if(!box.width||!box.height)throw Error('Invisible click target '+${JSON.stringify(selector)});return{x:box.x+box.width/2,y:box.y+box.height/2};})()`);
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',...target});await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...target});await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...target});await delay(160);
  };
  const key=async(value)=>{const code={Enter:13,Escape:27,Backspace:8,Tab:9,ArrowLeft:37,ArrowUp:38,ArrowRight:39,ArrowDown:40,Home:36,End:35}[value]??0;const fields={key:value,code:value,...(code?{windowsVirtualKeyCode:code,nativeVirtualKeyCode:code}:{})};await send('Input.dispatchKeyEvent',{type:'keyDown',...fields,...(value==='Enter'?{text:'\r',unmodifiedText:'\r'}:{})});await send('Input.dispatchKeyEvent',{type:'keyUp',...fields});await delay(160);};
  const pad=async(button)=>{await delay(100);await evaluate(`Object.assign(window.__redesignSmoke.pad.buttons[${button}],{pressed:true,value:1})`);await delay(100);await evaluate(`Object.assign(window.__redesignSmoke.pad.buttons[${button}],{pressed:false,value:0})`);await delay(180);};
  let clickMarker=0;
  const clickText=async(selector,text)=>{const marker=String(++clickMarker);await evaluate(`(()=>{const node=[...document.querySelectorAll(${JSON.stringify(selector)})].find(node=>{const copy=node.cloneNode(true);copy.querySelectorAll('[aria-hidden]').forEach(child=>child.remove());return copy.textContent.trim()===${JSON.stringify(text)};});if(!node)throw Error('Missing text action '+${JSON.stringify(text)});node.dataset.smokeClick=${JSON.stringify(marker)};})()`);await click(`[data-smoke-click="${marker}"]`);};
  const more=async(id)=>{await click('.console-shell-header button[aria-label="More"]');await wait(`Boolean(document.querySelector('#console-navigation-more'))`);await click(`#console-navigation-more [data-reference-menu-item="${id}"]`);await wait(`!document.querySelector('#console-navigation-more')`);};
  const consoleGeometry=async(name,selector,{modal=false,captureAt1080=true}={})=>{
    for(const [width,height]of[[1280,720],[1920,1080],[2560,1440]]){
      await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await delay(200);
      const actual=await evaluate(`(()=>{const box=node=>{if(!node)return null;const r=node.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};return{header:box(document.querySelector('.console-shell-header')),content:box(document.querySelector('.content-shell')),page:box(document.querySelector(${JSON.stringify(selector)})),search:box(document.querySelector('.console-search-surface')),searchInput:box(document.querySelector('.console-search-surface .search-box')),searchClose:box(document.querySelector('.console-search-close')),scroll:box(document.querySelector('.page-scroll')),noOldChrome:!document.querySelector('.app-shell > .sidebar,.content-shell > .topbar,.desktop-topbar,.desktop-sidebar'),documentWidth:document.documentElement.scrollWidth,headerHeightVariable:parseFloat(document.querySelector('.app-shell').style.getPropertyValue('--xboks-header-height'))};})()`);
      const fits=box=>Boolean(box)&&box.x>=-1&&box.right<=width+1&&box.y>=-1&&box.bottom<=height+1;
      const passed=actual.noOldChrome&&fits(actual.header)&&actual.content?.y>=actual.header.bottom-1&&actual.documentWidth<=width+1&&Math.abs(actual.headerHeightVariable-actual.header.height)<1&&(!modal||fits(actual.page))&&(!actual.search||(Math.abs(actual.search.y-actual.header.bottom)<2&&actual.scroll.y>=actual.search.bottom-1&&actual.scroll.height>100&&actual.searchInput?.x>=actual.search.x&&actual.searchInput?.right<=actual.search.right&&actual.searchInput?.y>=actual.search.y&&actual.searchInput?.bottom<=actual.search.bottom&&actual.searchClose?.x>=actual.searchInput.right&&actual.searchClose?.right<=actual.search.right&&actual.searchClose?.bottom<=actual.search.bottom));
      report.checks.push({label:`${name} ${width}x${height} uses the measured shared console header and fits the viewport`,passed,actual});console.log(`${passed?'PASS':'FAIL'} ${report.checks.at(-1).label}`);
      if(width===1920&&captureAt1080)await capture(`${name}-1920x1080`);
      if(width===1280&&modal&&captureAt1080)await capture(`${name}-1280x720`);
    }
    await send('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});await delay(150);
  };
  capture=async(name)=>{await evaluate('document.fonts.ready');await delay(180);const {data}=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(output,`${name}.png`),Buffer.from(data,'base64'));report.screenshots.push(`${name}.png`);};
  await wait(`Boolean(document.querySelector('.desktop-experience .desktop-primary-nav')) && document.querySelectorAll('.friends-dock-roster li').length===3`);
  await check(`JSON.stringify([...document.querySelectorAll('[data-desktop-page]')].map(node=>node.dataset.desktopPage))===JSON.stringify(['home','library','gamepass','store'])`, 'Desktop navigation follows the new Home, Library, Game Pass, Store ordering');
  await check(`Boolean(document.querySelector('.desktop-topbar .desktop-account'))&&!document.querySelector('.desktop-topbar .shell-clock,.desktop-topbar .shell-battery')&&!window.__redesignSmoke.calls.some(call=>call.method==='getBatteryStatus')`, 'Desktop profile is in the header and hidden power status does not poll');
  await check(`document.querySelectorAll('.friends-dock-roster li').length===3&&document.querySelector('.friends-dock-roster')?.textContent.includes('Sample game activity')`, 'Persistent friends dock renders explicit service-shaped roster and presence fixtures');
  const checkDockGeometry = async (width,height) => {
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await delay(180);
    const geometry=await evaluate(`(()=>{const rect=node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};return{panel:rect(document.querySelector('.desktop-sidebar-social')),heading:rect(document.querySelector('.friends-dock-heading')),search:rect(document.querySelector('.friends-dock-search'))};})()`);
    const fits=box=>box.x>=geometry.panel.x-1&&box.right<=geometry.panel.right+1&&box.y>=geometry.panel.y-1&&box.bottom<=geometry.panel.bottom+1;
    report.checks.push({label:`Desktop ${width}x${height} friends heading and search fit their rounded panel`,passed:fits(geometry.heading)&&fits(geometry.search),actual:geometry});
    console.log(`${report.checks.at(-1).passed?'PASS':'FAIL'} Desktop ${width}x${height} friends panel geometry`);
  };
  await checkDockGeometry(1920,1080);
  await capture('desktop-1920x1080');
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false});await delay(180);
  await check(`document.querySelector('.app-shell')?.hasAttribute('data-desktop-collapsed')&&!document.querySelector('.friends-dock')&&localStorage.getItem('xboks.desktop-dock.v1')===null`, 'Below 1440px the automatic dock collapses without persisting a user preference');
  await capture('desktop-1280x720');
  await click('.desktop-collapse');await wait(`document.querySelectorAll('.friends-dock-roster li').length===3`);
  await checkDockGeometry(1280,720);
  await check(`!document.querySelector('.app-shell')?.hasAttribute('data-desktop-collapsed')&&localStorage.getItem('xboks.desktop-dock.v1')==='expanded'`, 'Explicit expansion overrides automatic density and persists only the requested choice');
  await capture('desktop-expanded-1280x720');
  await send('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});await delay(180);
  await click('.desktop-collapse');
  await check(`document.querySelector('.app-shell')?.hasAttribute('data-desktop-collapsed')&&!document.querySelector('.friends-dock')&&Boolean(document.querySelector('.desktop-primary-nav'))`, 'Collapsing the sidebar removes its hidden friends subscriptions without hiding navigation');
  await capture('desktop-collapsed');
  await click('.desktop-collapse');await wait(`document.querySelectorAll('.friends-dock-roster li').length===3`);
  await click('.friends-dock-search input');await send('Input.insertText',{text:'One'});await key('Enter');
  await wait(`document.querySelectorAll('.friends-dock-roster li').length===1&&window.__redesignSmoke.calls.some(call=>call.method==='searchXboxPeople'&&call.args[0]==='One')`);
  await click('.friends-dock [data-social-peer="12345"]');
  await wait(`window.__redesignSmoke.calls.some(call=>call.method==='getXboxConversation'&&call.args[0]==='12345')&&document.querySelector('.xbox-social-panel')?.textContent.includes('Explicit fixture conversation')`);
  await check(`document.querySelector('.shell-flyout')?.textContent.includes('Fixture Friend One')&&!window.__redesignSmoke.calls.some(call=>call.method==='sendXboxMessage')`, 'A dock person opens the exact peer conversation without sending a message');
  await capture('desktop-friend-conversation');
  await click('.shell-flyout > header button[data-gamepad-cancel]');
  await wait(`!document.querySelector('.shell-flyout')`);
  await click('.desktop-topbar .search-box input');await send('Input.insertText',{text:'Fixture Friend'});await wait(`document.querySelectorAll('[data-search-person]').length===3`);
  await check(`window.__redesignSmoke.calls.some(call=>call.method==='searchXboxPeople'&&call.args[0]==='Fixture Friend')&&document.querySelector('.search-result-heading')?.textContent==='People'`, 'Global search resolves explicit account-backed People results rather than inventing users from local games');
  await click('[data-search-person="12345"]');await wait(`document.querySelector('.xbox-social-messages')?.textContent.includes('Explicit fixture conversation')`);await check(`!window.__redesignSmoke.calls.some(call=>call.method==='sendXboxMessage')`, 'Selecting a People search result opens the exact conversation without sending a message');await click('.shell-flyout > header button[data-gamepad-cancel]');await wait(`!document.querySelector('.shell-flyout')`);
  await wait(`Boolean(document.querySelector('.new-experience-home .new-home-featured-card'))`);
  await check(`!document.querySelector('.new-home-mru')&&Boolean(document.querySelector('.new-home-featured'))`, 'Installed games alone do not invent a New Experience recent-play history');
  await capture('desktop-home-no-history');
  await evaluate(`window.__redesignSmoke.recordHistory()`);await wait(`document.querySelectorAll('.new-home-recent-game').length===12`);
  await check(`document.querySelector('.new-home-recent-game')?.dataset.gameId==='demo-2'&&document.querySelector('.new-home-shelf')`, 'Recorded fixture play history adds ordered Jump back in items beside the returned catalog shelves');
  await capture('desktop-home-recorded-history');
  await click('.new-home-recent-game[data-game-id="demo-1"]');await wait(`Boolean(document.querySelector('.game-details-page[data-gamepad-detail="demo-1"]'))`);await pad(1);await wait(`Boolean(document.querySelector('.new-experience-home'))`);
  await click('[data-desktop-page="library"]');await wait(`Boolean(document.querySelector('.library-page'))`);
  await check(`JSON.stringify([...document.querySelectorAll('.xbox-library-tabs [role="tab"]')].map(node=>node.textContent.trim()))===JSON.stringify(['Installed','Apps','Recently played','My games'])&&document.querySelector('#library-tab-installed')?.getAttribute('aria-selected')==='true'`, 'Library follows the observed high-density Installed, Apps, Recently played and My games tabs');
  await capture('desktop-library-installed');await click('#library-tab-apps');await wait(`document.querySelectorAll('[data-desktop-app]').length===2`);
  await click('.desktop-app-toolbar input');await send('Input.insertText',{text:'Editor'});await check(`document.querySelectorAll('[data-desktop-app]').length===1&&document.querySelector('[data-desktop-app]')?.dataset.desktopApp==='fixture-editor.desktop'&&!window.__redesignSmoke.calls.some(call=>call.method==='launchDesktopApp')`, 'Apps reads and filters an explicit synthetic inventory without launching a host application');await capture('desktop-library-apps');
  await click('[data-desktop-page="store"]');await wait(`document.querySelectorAll('[data-store-hero]').length===6`);
  await check(`JSON.stringify([...document.querySelectorAll('[data-store-tab]')].map(node=>node.textContent.trim()))===JSON.stringify(['Browse','Deals'])&&document.querySelector('[data-store-tab="browse"]')?.getAttribute('aria-selected')==='true'&&Boolean(document.querySelector('[data-store-action="categories"]'))&&Boolean(document.querySelector('[data-store-action="wishlist"]'))&&!document.querySelector('.xbox-store-utilities')&&!document.querySelector('[data-store-category]')`, 'Store opens its observed Browse/Deals navigation with categories and wishlist actions above returned public games');await capture('desktop-store');
  await click('[data-store-hero="9N26X2PMTWBT"]');await wait(`Boolean(document.querySelector('.catalog-details-page'))`);await check(`window.__redesignSmoke.calls.some(call=>call.method==='getCatalogDetails'&&call.args[0]==='9N26X2PMTWBT')&&!window.__redesignSmoke.forbidden.length`, 'A Store hero opens the exact returned product details without installing or launching it');await pad(1);await wait(`Boolean(document.querySelector('.xbox-store-landing:not([hidden])'))`);
  await evaluate(`window.__redesignSmoke.failStoreDeals()`);await click('[data-store-tab="deals"]');await wait(`Boolean(document.querySelector('.xbox-store-message[role="alert"]'))`);
  await check(`document.querySelector('[data-store-tab="deals"]')?.getAttribute('aria-selected')==='true'&&!document.querySelector('.xbox-store-gallery-grid .xbox-store-product')`, 'A failed Deals read shows its error without reusing Browse products');
  await click('.xbox-store-message[role="alert"] button');await wait(`document.querySelectorAll('.xbox-store-gallery-grid .xbox-store-product').length===2`);
  await check(`JSON.stringify([...document.querySelectorAll('.xbox-store-gallery-grid [data-product-id]')].map(node=>node.dataset.productId))===JSON.stringify(['9PM3J18QM4Q3','9NGLST31DG26'])&&window.__redesignSmoke.calls.filter(call=>call.method==='getStoreCollection'&&call.args[0]==='deals').length===2`, 'Explicit Retry reads the dedicated Deals collection and displays only its returned membership');await capture('desktop-store-deals');
  await click('.xbox-store-gallery-grid .xbox-store-product button');await wait(`Boolean(document.querySelector('.catalog-details-page'))`);await pad(1);await wait(`document.querySelector('[data-store-tab="deals"]')?.getAttribute('aria-selected')==='true'&&document.querySelectorAll('.xbox-store-gallery-grid .xbox-store-product').length===2`);
  await check(`!document.querySelector('.catalog-details-page')&&!window.__redesignSmoke.forbidden.length`, 'Product Back preserves the Deals destination and its loaded collection');await pad(1);await wait(`Boolean(document.querySelector('.xbox-store-landing:not([hidden])'))`);
  await click('[data-store-action="wishlist"]');await wait(`document.querySelector('.xbox-store-message')?.textContent.includes('Your wishlist is unavailable')`);await check(`!document.querySelector('.xbox-store-gallery-grid .xbox-store-product')&&!window.__redesignSmoke.calls.some(call=>call.method==='getStoreWishlist')`, 'Wishlist reports its missing authenticated provider without fabricating products or signing in again');await capture('desktop-store-wishlist-unavailable');await pad(1);await wait(`Boolean(document.querySelector('.xbox-store-landing:not([hidden])'))`);
  await check(`document.activeElement?.dataset.storeAction==='wishlist'`, 'Wishlist Back restores its exact launcher action');
  await click('[data-store-action="categories"]');await wait(`document.querySelectorAll('[data-store-category]').length===18`);await capture('desktop-store-categories');
  await check(`(()=>{const grid=document.querySelector('.xbox-store-category-grid').getBoundingClientRect(),cards=[...document.querySelectorAll('[data-store-category]')].map(node=>node.getBoundingClientRect());return cards.every((card,index)=>card.left>=grid.left-1&&card.right<=grid.right+1&&(!index||Math.abs(card.top-cards[index-1].top)>1||card.left>=cards[index-1].right+1));})()`, 'Store category cards preserve visible grid gaps and never overlap their neighbors');
  await click('[data-store-action="redeem"]');await wait(`Boolean(document.querySelector('.xbox-store-redeem-dialog'))`);await check(`document.querySelector('.app-shell')?.inert&&document.querySelector('.xbox-store-redeem-dialog a')?.href==='https://redeem.microsoft.com/'&&!window.__redesignSmoke.forbidden.length`, 'Redeem explains its official account handoff and isolates input before any external action');await pad(1);await wait(`!document.querySelector('.xbox-store-redeem-dialog')`);await check(`!document.querySelector('.app-shell')?.inert&&document.activeElement?.dataset.storeAction==='redeem'`, 'Dismissing Redeem restores input and its original collection action');
  await click('[data-store-category="action-adventure"]');await wait(`Boolean(document.querySelector('.xbox-store-gallery-grid .xbox-store-product'))`);await capture('desktop-store-category');
  await click('.xbox-store-load-more button');await wait(`document.querySelectorAll('.xbox-store-gallery-grid .xbox-store-product').length===6`);await check(`!document.querySelector('.xbox-store-load-more')&&window.__redesignSmoke.calls.some(call=>call.method==='getStoreCategory'&&call.args[0]==='action-adventure'&&call.args[1]==='category-action-adventure-page2')`, 'Category pagination uses its actual category provider cursor and appends only returned games');
  await click('.xbox-store-gallery-grid .xbox-store-product button');await wait(`Boolean(document.querySelector('.catalog-details-page'))`);await capture('desktop-store-product');await pad(1);await wait(`Boolean(document.querySelector('.xbox-store-gallery:not([hidden])'))`);await check(`document.querySelectorAll('.xbox-store-gallery-grid .xbox-store-product').length===6`, 'Product Back retains the full paginated category collection');await pad(1);await wait(`Boolean(document.querySelector('.xbox-store-categories:not([hidden])'))`);
  await check(`document.activeElement?.dataset.storeCategory==='action-adventure'`, 'Store details and category Back restore the exact category origin');
  await click('[data-store-category="comedic"]');await wait(`document.querySelectorAll('.xbox-store-gallery-grid .xbox-store-product').length===1`);await check(`window.__redesignSmoke.calls.some(call=>call.method==='getStoreCategory'&&call.args[0]==='comedic')&&document.querySelector('.xbox-store-gallery-grid [data-product-id]')?.dataset.productId==='9N26X2PMTWBT'`, 'Mood categories display exact returned channel membership even without matching public genre tags');await capture('desktop-store-mood-category');await pad(1);await wait(`Boolean(document.querySelector('.xbox-store-categories:not([hidden])'))`);
  await pad(1);await wait(`Boolean(document.querySelector('.xbox-store-landing:not([hidden])'))`);await check(`document.activeElement?.dataset.storeAction==='categories'`, 'Category browser Back restores the landing categories action');
  await click('[data-desktop-page="home"]');await wait(`Boolean(document.querySelector('.new-experience-home'))`);
  await click('.desktop-account');await wait(`Boolean(document.querySelector('.shell-account-menu'))`);
  await check(`document.querySelector('.account-menu-summary')?.textContent.includes('xboksPlayer')&&document.querySelector('.account-menu-experience input')?.checked&&document.querySelector('.account-menu-experience input')?.disabled&&JSON.stringify([...document.querySelectorAll('.shell-account-menu > button,.shell-account-menu > a')].map(node=>{const copy=node.cloneNode(true);copy.querySelectorAll('[aria-hidden]').forEach(child=>child.remove());return copy.textContent.trim();}))===JSON.stringify(['Presence','View profile','Remote play','Settings','Redeem a code','Get help','Give feedback','Sign out'])`, 'The new account menu exposes its source-grounded destinations and an honest fixed New Experience indicator');await capture('desktop-account-menu');
  await clickText('.shell-account-menu button','View profile');await wait(`Boolean(document.querySelector('.profile-page'))`);await check(`document.querySelectorAll('.profile-recent-row > button').length===6&&Boolean(document.querySelector('.profile-achievements'))`, 'Profile includes only explicitly recorded recent games with truthful achievement availability');await capture('desktop-profile');
  await click('[data-desktop-page="home"]');await wait(`Boolean(document.querySelector('.new-experience-home'))`);
  await click('.desktop-account');await wait(`Boolean(document.querySelector('.shell-account-menu'))`);await clickText('.shell-account-menu button','Remote play');await wait(`document.querySelector('.console-library')?.textContent.includes('Sample Xbox One X')`);
  await check(`!document.querySelector('.shell-account-menu')&&window.__redesignSmoke.calls.some(call=>call.method==='getConsoleStreamDevices')&&!window.__redesignSmoke.calls.some(call=>call.method==='startConsoleStream'||call.method==='openRemotePlay')&&!window.__redesignSmoke.forbidden.length`, 'Account Remote play opens account-bound console discovery without a browser, extra login or automatic connection');await capture('desktop-account-remote-play');await pad(1);await wait(`!document.querySelector('.console-library')`);await check(`!document.querySelector('.app-shell')?.inert&&document.activeElement?.matches('.desktop-account')`, 'Remote play Back restores desktop input and the profile-menu entry point');
  await click('.desktop-account');await wait(`Boolean(document.querySelector('.shell-account-menu'))`);await clickText('.shell-account-menu button','Settings');
  await wait(`Boolean(document.querySelector('.xbox-settings-dialog'))`);
  await check(`Boolean(document.querySelector('.settings-v2-desktop'))&&document.querySelectorAll('.settings-v2-nav [role="tab"]').length===6&&document.querySelectorAll('.settings-v2-account-actions > *').length===10`, 'Desktop Settings uses the new six-group frame and ten real Account destinations');await capture('desktop-settings-account');
  await check(`document.querySelector('.desktop-topbar')?.inert&&document.querySelector('.desktop-sidebar')?.inert&&document.querySelector('.content-shell')?.inert`, 'Settings makes the full desktop header, sidebar and page inert');
  await evaluate(`window.__redesignSmoke.setSessionFullscreen(true)`);await wait(`Boolean(document.querySelector('.console-home .xbox-mode-home'))&&Boolean(document.querySelector('.xbox-settings-dialog'))`);
  await check(`(()=>{const surfaces=[...document.querySelectorAll('.app-shell > .sidebar,.app-shell > .content-shell,.app-shell > .desktop-topbar,.app-shell > .console-shell-header')];return surfaces.length>0&&surfaces.every(node=>node.inert);})()`, 'Desktop Settings keeps every replacement console surface inert after an external mode change');
  await pad(1);await wait(`!document.querySelector('.xbox-settings-dialog')`);
  await check(`!document.querySelector('.content-shell')?.inert&&Boolean(document.querySelector('.xbox-mode-home'))`, 'Closing Settings after an external mode change restores the console Home');
  await click('.console-home-shortcuts button[aria-label="Settings"]');await wait(`Boolean(document.querySelector('.xbox-settings-dialog'))`);
  await evaluate(`window.__redesignSmoke.setSessionFullscreen(false)`);await wait(`Boolean(document.querySelector('.desktop-experience .desktop-topbar'))&&Boolean(document.querySelector('.xbox-settings-dialog'))`);
  await check(`(()=>{const surfaces=[...document.querySelectorAll('.app-shell > .sidebar,.app-shell > .content-shell,.app-shell > .desktop-topbar,.app-shell > .console-shell-header')];return surfaces.length===3&&surfaces.every(node=>node.inert);})()`, 'Console Settings keeps the new desktop header, sidebar and page inert after returning externally');
  await pad(1);await wait(`!document.querySelector('.xbox-settings-dialog')`);
  await check(`!document.querySelector('.desktop-topbar')?.inert&&!document.querySelector('.desktop-sidebar')?.inert`, 'Closing Settings restores the new desktop surfaces');

  await evaluate(`window.__redesignSmoke.deferModeEntry()`);
  await click('.xbox-mode-entry');await wait(`Boolean(document.querySelector('.xbox-mode-entry-dialog'))`);
  await click('[data-xbox-mode-action="start"]');await wait(`window.__redesignSmoke.modeEntryPending()`);
  await check(`Boolean(document.querySelector('.desktop-experience'))&&!document.querySelector('.xbox-mode-home')&&Boolean(document.querySelector('.xbox-mode-entry-dialog'))&&document.querySelector('.app-shell')?.inert`, 'An early native fullscreen event keeps desktop and its blocking entry dialog mounted while the request is pending');
  await evaluate(`window.__redesignSmoke.settleModeEntry(false)`);
  await wait(`Boolean(document.querySelector('.xbox-mode-entry-dialog [data-xbox-mode-action="start"]:not(:disabled)'))&&document.querySelector('.xbox-mode-entry-dialog [role="alert"]')?.textContent.includes('Fixture Xbox mode entry rejected.')`);
  await check(`Boolean(document.querySelector('.desktop-experience'))&&!document.querySelector('.xbox-mode-home')&&document.querySelector('.app-shell')?.inert&&Boolean(document.querySelector('.xbox-mode-entry-dialog [data-xbox-mode-action="start"]:not(:disabled)'))`, 'A rejected native entry preserves its visible error and usable retry choice in the blocking dialog');
  await click('.xbox-mode-entry-dialog [data-xbox-mode-action="remain"]');await wait(`!document.querySelector('.xbox-mode-entry-dialog')`);
  await check(`Boolean(document.querySelector('.desktop-experience'))&&!document.querySelector('.app-shell')?.inert&&Boolean(document.querySelector('.xbox-mode-entry:not(:disabled)'))`, 'Remain on desktop restores normal input after a failed native entry');
  await click('.toast button');
  await evaluate(`window.__redesignSmoke.deferModeEntry()`);
  await click('.xbox-mode-entry');await wait(`Boolean(document.querySelector('.xbox-mode-entry-dialog'))`);
  await click('[data-xbox-mode-action="start"]');await wait(`window.__redesignSmoke.modeEntryPending()`);
  await check(`Boolean(document.querySelector('.desktop-experience'))&&!document.querySelector('.xbox-mode-home')&&Boolean(document.querySelector('.xbox-mode-entry-dialog'))&&document.querySelector('.app-shell')?.inert`, 'A successful entry keeps its blocking dialog until the native request settles');
  await evaluate(`window.__redesignSmoke.settleModeEntry(true)`);
  await wait(`Boolean(document.querySelector('.console-home .xbox-mode-home'))&&Boolean(document.querySelector('.console-home-status .shell-battery'))`);
  await check(`!document.querySelector('.desktop-topbar,.desktop-sidebar,.app-shell > .sidebar')&&document.querySelectorAll('.console-home-status time').length===1&&document.querySelectorAll('.console-home-status .shell-battery').length===1`, 'A native fullscreen event mounts the console Home with one shared clock and battery');
  for(const [width,height] of [[1280,720],[1920,1080],[2560,1440]]) {
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await delay(220);
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:2,y:2});
    await evaluate(`document.querySelector('.xbox-mode-home').scrollTop=0;document.querySelector('.console-home-game').focus()`);
    await capture(`console-${width}x${height}`);
    const layout=await evaluate(`(()=>{const box=node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right};};const main=document.querySelector('.xbox-mode-home');return{width:innerWidth,height:innerHeight,main:box(main),header:box(document.querySelector('.console-home-header')),actions:box(document.querySelector('.console-home-actions')),selected:box(document.querySelector('.console-home-game.selected')),scrollHeight:main.scrollHeight,clientHeight:main.clientHeight,bodyOverflow:document.documentElement.scrollWidth>innerWidth};})()`);
    report.checks.push({label:`Console ${width}x${height} contains all primary actions within the viewport`,passed:layout.main.x>=-1&&layout.main.right<=width+1&&layout.actions.bottom<=height+1&&!layout.bodyOverflow,actual:layout});
    console.log(`${report.checks.at(-1).passed?'PASS':'FAIL'} Console ${width}x${height} viewport layout`);
  }
  await send('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
  await evaluate(`document.querySelector('.console-home-game').focus()`);await pad(15);
  await check(`document.activeElement?.dataset.consoleHomeItem==='game:demo-1'&&document.querySelector('.console-home-game.selected')?.dataset.consoleHomeItem==='game:demo-1'&&!document.querySelector('.game-details-page')&&!window.__redesignSmoke.calls.some(call=>call.method==='launchGame')`, 'D-pad right selects the next game and changes its background without opening or launching');
  await pad(14);
  await check(`document.activeElement?.dataset.consoleHomeItem==='game:demo-2'&&document.querySelector('.console-home-game.selected')?.dataset.consoleHomeItem==='game:demo-2'`, 'D-pad left returns to the previous selection without leaving the recent-games row');
  for(let index=0;index<10;index++)await pad(15);
  await check(`(()=>{const active=document.activeElement,row=document.querySelector('.console-home-game-row'),a=active?.getBoundingClientRect(),r=row?.getBoundingClientRect();return active?.hasAttribute('data-console-home-item')&&row.scrollLeft>0&&a.left>=r.left-1&&a.right<=r.right+1;})()`, 'Controller navigation reveals offscreen game tiles and preserves row focus');
  await evaluate(`document.querySelector('[data-console-home-item="game:demo-1"]').focus()`);await pad(0);
  await wait(`Boolean(document.querySelector('.game-details-page[data-gamepad-detail="demo-1"]'))`);
  await check(`window.__redesignSmoke.calls.some(call=>call.method==='getGameDetails'&&call.args[0]==='demo-1')&&!window.__redesignSmoke.calls.some(call=>call.method==='launchGame')`, 'Controller A opens the selected installed game details without execution');
  await pad(1);await wait(`Boolean(document.querySelector('.xbox-mode-home'))`);
  await check(`Boolean(document.querySelector('.xbox-mode-home'))&&!document.querySelector('.game-details-page')&&document.activeElement?.dataset.consoleHomeItem==='game:demo-1'&&document.querySelector('.console-home-game.selected')?.dataset.consoleHomeItem==='game:demo-1'`, 'Controller B restores the exact console game selection and focus from installed details');
  await pad(5);await wait(`Boolean(document.querySelector('.library-page'))`);
  await check(`!document.querySelector('.xbox-mode-home')&&!window.__redesignSmoke.calls.some(call=>call.method==='launchGame')`, 'RB follows desktop navigation to Library without treating a focused tile as Play');
  await pad(4);await wait(`Boolean(document.querySelector('.xbox-mode-home'))`);
  await click('.console-home-shortcuts button[aria-label="Search"]');
  await wait(`document.activeElement?.matches('.search-box input')`);
  await check(`Boolean(document.querySelector('.console-search-surface .search-box input'))&&Boolean(document.querySelector('.console-shell-header'))`, 'Console Search opens a usable catalog search input');
  await consoleGeometry('console-search','.console-search-surface');
  await pad(1);await wait(`!document.querySelector('.console-search-surface')`);
  await check(`Boolean(document.querySelector('.console-shell-header'))&&!document.querySelector('.console-search-surface')`, 'Controller B closes Search before leaving its catalog destination');
  await pad(1);await wait(`Boolean(document.querySelector('.xbox-mode-home'))`);
  await click('.console-home-customize');await wait(`Boolean(document.querySelector('#settings-v2-tab-accessibility[aria-selected="true"]'))`);
  await check(`document.querySelector('.xbox-mode-home')?.closest('.content-shell')?.inert`, 'Appearance opens the actual accessibility settings and suspends Home input');
  await check(`document.querySelector('[data-settings-v2-route]')?.dataset.settingsV2Route==='accessibility'&&!document.querySelector('[data-settings-category-back]')&&document.querySelector('#settings-v2-heading')?.textContent==='Accessibility'`, 'Opening Appearance directly starts at the inline Accessibility root with no misleading detail Back');
  await pad(1);await wait(`!document.querySelector('.xbox-settings-dialog')`);
  // Additional all-destination console checks run before returning to desktop.
  await click('.console-shell-header button[aria-label="My Library"]');await wait(`Boolean(document.querySelector('.library-page'))`);
  await click('#library-tab-games');await wait(`Boolean(document.querySelector('.library-filter-count'))`);
  await consoleGeometry('console-library','.library-page');
  await check(`document.querySelector('.xbox-library-tabs button')&&getComputedStyle(document.querySelector('.xbox-library-tabs button')).fontSize.replace('px','')>=19&&document.querySelectorAll('.library-filters select').length===4`, 'Console Library has controller-sized tabs and all four functional filter controls');
  await evaluate(`document.querySelector('.library-filter-count').focus()`);await pad(12);
  await check(`Boolean(document.activeElement?.closest('[data-console-navigation]'))`, 'D-pad Up crosses from the Library control edge into the shared header');
  await pad(13);
  await check(`document.activeElement?.matches('.library-filter-count')`, 'D-pad Down restores the exact Library control left before entering the header');
  await click('.library-filter-count');await wait(`!document.querySelector('.library-filter-drawer').hidden`);
  await capture('console-library-filters');
  for(const label of ['Platform','Access','Play state','Sort games']){
    await evaluate(`document.querySelector('select[aria-label="${label}"]').focus()`);await pad(0);await wait(`Boolean(document.querySelector('.gamepad-select-dialog'))`);
    await check(`document.querySelector('.gamepad-select-dialog button')&&!document.querySelector('.gamepad-select-dialog').closest('.sidebar')`, `Controller A opens the actual ${label} options`);
    await pad(12);await check(`Boolean(document.activeElement?.closest('.gamepad-select-dialog'))`, `${label} options keep D-pad navigation inside their modal`);
    if(label==='Access') {await clickText('.gamepad-select-dialog button','Owned');await wait(`!document.querySelector('.gamepad-select-dialog')`);await check(`document.querySelector('select[aria-label="Access"]').value==='owned'&&document.querySelector('.library-filter-chips').textContent.includes('Owned')`, 'Selecting Owned changes the real Library filter and visible chip');}
    else{await pad(1);await wait(`!document.querySelector('.gamepad-select-dialog')`);}
  }
  await wait(`Boolean(document.querySelector('.library-card[data-gamepad-detail-target]'))`);
  await evaluate(`document.querySelector('.library-card[data-gamepad-detail-target]').focus()`);await pad(2);await wait(`Boolean(document.querySelector('[data-game-menu]'))`);
  await check(`document.querySelector('[data-game-menu] [role="menuitem"]')&&!window.__redesignSmoke.forbidden.length`, 'Library X opens the real game options without running an action');await capture('console-library-game-options');await pad(1);await wait(`!document.querySelector('[data-game-menu]')`);

  await click('.console-shell-header button[aria-label="Store"]');await wait(`Boolean(document.querySelector('.xbox-store-page'))&&document.querySelectorAll('.xbox-store-product').length>0`);
  await consoleGeometry('console-store','.xbox-store-page');
  await click('.xbox-store-product button');await wait(`Boolean(document.querySelector('.catalog-details-page'))`);
  await consoleGeometry('console-store-details','.catalog-details-page');
  await check(`Boolean(document.querySelector('.catalog-detail-actions'))&&!window.__redesignSmoke.forbidden.length`, 'Store selection opens real product information and actions without installation');await pad(1);await wait(`Boolean(document.querySelector('.xbox-store-page:not([hidden])'))&&!document.querySelector('.catalog-details-page')`);

  await click('.console-shell-header button[aria-label="Game Pass"]');await wait(`Boolean(document.querySelector('.game-pass-page .home-product'))`);
  await consoleGeometry('console-gamepass','.game-pass-page');
  await check(`window.__redesignSmoke.calls.some(call=>call.method==='getAccountLibrary'&&call.args[0]==='gamepass')&&Boolean(document.querySelector('.game-pass-actions'))`, 'Game Pass retains its account-backed catalog and real destinations in console mode');
  await evaluate(`window.__redesignSmoke.failGamePassMore()`);await clickText('#game-pass-games button','Load more');await wait(`Boolean(document.querySelector('#game-pass-games [role="alert"]'))`);
  await check(`document.querySelectorAll('.game-pass-page .home-product').length===3&&document.querySelector('#game-pass-games [role="alert"]')?.textContent.includes('current games are still shown')`, 'A failed Game Pass continuation retains the accepted account-owned first page');
  await click('#game-pass-games [role="alert"] button');await wait(`document.querySelectorAll('.game-pass-page .home-product').length===6`);
  await check(`window.__redesignSmoke.calls.filter(call=>call.method==='getAccountLibrary'&&call.args[0]==='gamepass'&&call.args[1]==='fixture-gamepass-page2').length===2&&!document.querySelector('#game-pass-games [role="alert"]')`, 'Game Pass Retry reuses the failed account cursor and appends validated returned products');await capture('console-gamepass-paginated');
  await clickText('.game-pass-actions button','Pin a genre');await wait(`Boolean(document.querySelector('#game-pass-genres'))`);await click('#game-pass-genres [data-reference-menu-item="Puzzle"]');await wait(`document.querySelectorAll('.game-pass-page .home-product').length===3`);await check(`[...document.querySelectorAll('.game-pass-page .home-product')].every(node=>['9P2N57MC619K','9N431PX143P8','9P74BRFBXXC6'].includes(node.dataset.productId))`, 'Game Pass genre selection filters the actually returned loaded account games');
  const gamePassReadsBeforeDetails=await evaluate(`window.__redesignSmoke.calls.filter(call=>call.method==='getAccountLibrary'&&call.args[0]==='gamepass').length`);
  await click('.game-pass-page .home-product[data-product-id="9N431PX143P8"]');await wait(`Boolean(document.querySelector('.catalog-details-page'))`);await check(`window.__redesignSmoke.calls.some(call=>call.method==='getCatalogDetails'&&call.args[0]==='9N431PX143P8')&&!window.__redesignSmoke.forbidden.length`, 'A second-page Game Pass product opens its exact details without launching or installing');await pad(1);await wait(`Boolean(document.querySelector('.game-pass-page .home-product'))&&!document.querySelector('.catalog-details-page')`);
  await check(`!document.querySelector('.game-pass-page')?.closest('[hidden]')&&document.querySelectorAll('.game-pass-page .home-product').length===3&&[...document.querySelectorAll('.game-pass-actions button')].some(button=>button.textContent.trim()==='Puzzle')&&document.activeElement?.dataset.productId==='9N431PX143P8'&&window.__redesignSmoke.calls.filter(call=>call.method==='getAccountLibrary'&&call.args[0]==='gamepass').length===${gamePassReadsBeforeDetails}`, 'Game Pass product Back retains loaded pages, the selected genre, exact card focus and its settled account read');await capture('console-gamepass-details-back');
  await clickText('.game-pass-actions button','All games');await wait(`document.querySelectorAll('.game-pass-page .home-product').length===6`);
  await click('.game-pass-refresh');await wait(`document.querySelectorAll('.game-pass-page .home-product').length===3`);await check(`window.__redesignSmoke.calls.some(call=>call.method==='getAccountLibrary'&&call.args[0]==='gamepass'&&call.args[1]===undefined&&call.args[2]===true)`, 'Explicit Game Pass Refresh rechecks account licenses from the first page');
  await evaluate(`window.__redesignSmoke.transitionAccount()`);await wait(`!document.querySelector('.game-pass-page .home-product')`);await check(`document.querySelector('.game-pass-page')?.textContent.includes('Checking your account')`, 'An account transition immediately removes the previous Game Pass inventory');await evaluate(`window.__redesignSmoke.resumeAccount()`);await wait(`document.querySelectorAll('.game-pass-page .home-product').length===3`);
  await more('cloud');await wait(`document.querySelectorAll('.cloud-product:not(.cloud-product-placeholder)').length>0`);
  await consoleGeometry('console-cloud','.cloud-library-page');
  await click('.console-shell-header button[aria-label="Search"]');await wait(`document.activeElement?.matches('.console-search-surface .search-box input')`);
  const searchCallsBefore=await evaluate(`window.__redesignSmoke.calls.filter(call=>call.method==='searchCatalog').length`);
  await send('Input.insertText',{text:'Forza'});await wait(`document.querySelectorAll('.cloud-library-grid .cloud-product').length===1`);
  await check(`document.querySelector('.cloud-library-page')&&document.querySelector('.cloud-library-grid').textContent.includes('Forza')&&window.__redesignSmoke.calls.filter(call=>call.method==='searchCatalog').length===${searchCallsBefore}`, 'Shared console Search searches cloud titles while Cloud Gaming is active');
  await consoleGeometry('console-cloud-search','.console-search-surface');await pad(1);await wait(`!document.querySelector('.console-search-surface')`);
  await click('.cloud-library-grid .cloud-product');await wait(`Boolean(document.querySelector('.cloud-product-detail'))`);
  await consoleGeometry('console-cloud-details','.cloud-product-detail',{modal:true});
  await check(`(()=>{const h=document.querySelector('.console-shell-header').getBoundingClientRect(),d=document.querySelector('.cloud-product-detail').getBoundingClientRect();return Math.abs(d.left)<1&&Math.abs(d.top-h.bottom)<2&&Boolean(document.querySelector('.cloud-detail-actions button:not(:disabled)'));})()`, 'Cloud details align to the measured console header with no old sidebar gutter');
  await pad(12);await check(`Boolean(document.activeElement?.closest('.cloud-product-detail'))`, 'Cloud detail navigation cannot jump to the header behind its modal');await pad(1);await wait(`!document.querySelector('.cloud-product-detail')`);

  await click('.console-shell-header .console-home-account');await wait(`Boolean(document.querySelector('.shell-account-menu'))`);await clickText('.shell-account-menu button','View profile');await wait(`Boolean(document.querySelector('.profile-page'))`);
  await consoleGeometry('console-profile','.profile-page');
  await check(`document.querySelector('.profile-page').textContent.includes('xboksPlayer')&&document.querySelector('.profile-page').textContent.includes('21,337')`, 'Console profile displays only explicit fixture gamertag and gamerscore data');
  await evaluate(`window.__redesignSmoke.transitionAccount()`);await check(`!document.querySelector('.profile-page').textContent.includes('Private stale gamer')&&!document.querySelector('.profile-page').textContent.includes('21,337')`, 'An account transition hides private data on the profile destination too');await evaluate(`window.__redesignSmoke.resumeAccount()`);
  await more('friends');await wait(`document.querySelectorAll('.xbox-social-person').length>0`);
  await consoleGeometry('console-friends','.shell-flyout',{modal:true});
  await click('.xbox-social-person[data-social-peer="12345"]');await wait(`document.querySelector('.xbox-social-messages')?.textContent.includes('Explicit fixture conversation')`);
  await capture('console-chat');await pad(12);await check(`Boolean(document.activeElement?.closest('.xbox-social-subpage'))`, 'Chat Back/refresh controls stay in the active conversation modal');
  await check(`document.querySelector('.xbox-social-composer button')?.disabled&&!window.__redesignSmoke.calls.some(call=>call.method==='sendXboxMessage')`, 'The fixture does not pretend messaging is enabled or send a message');await pad(1);await wait(`!document.querySelector('.xbox-social-subpage')`);await pad(1);await wait(`!document.querySelector('.shell-flyout')`);
  await more('notifications');await wait(`Boolean(document.querySelector('.shell-notification-list'))`);await consoleGeometry('console-notifications','.shell-flyout',{modal:true});await pad(1);await wait(`!document.querySelector('.shell-flyout')`);

  await more('queue');await wait(`Boolean(document.querySelector('.downloads-page'))`);await consoleGeometry('console-queue','.downloads-page');
  await click('[data-queue-options="demo-download-1"]');await wait(`Boolean(document.querySelector('#queue-menu-demo-download-1'))`);await check(`Boolean(document.querySelector('#queue-menu-demo-download-1 [role="menuitem"]'))&&!window.__redesignSmoke.forbidden.length`, 'Queue options preserve operation-specific actions without pausing or cancelling a real download');await capture('console-queue-options');await pad(1);await wait(`!document.querySelector('[data-game-menu]')`);
  await more('remote-play');await wait(`Boolean(document.querySelector('[data-console-id="fixture-console-one-x"]'))`);
  await consoleGeometry('console-remote-play','.console-library',{modal:true});
  await check(`document.querySelector('.console-shell-header')?.inert&&document.querySelector('.content-shell')?.inert`, 'Remote Play isolates both the shared console header and the page behind its portal');
  await click('[data-console-id="fixture-console-one-x"]');await check(`!document.querySelector('.console-connect').disabled&&!window.__redesignSmoke.calls.some(call=>call.method==='startConsoleStream')`, 'Choosing the explicit sample One X enables Connect without starting a stream');await pad(12);await check(`Boolean(document.activeElement?.closest('.console-library'))`, 'Remote Play controller navigation stays inside its own modal');await pad(1);await wait(`!document.querySelector('.console-library')`);

  await click('.console-shell-header button[aria-label="Settings"]');await wait(`Boolean(document.querySelector('.settings-v2-dialog'))`);
  await consoleGeometry('console-settings-account','.settings-v2-dialog',{modal:true});
  await check(`document.querySelectorAll('.settings-v2-nav [role="tab"]').length===6&&!document.querySelector('#settings-tab-application')&&document.querySelector('.console-shell-header')?.inert`, 'Fullscreen Settings uses all six SettingsV2 groups and suspends the shared header');
  await check(`document.querySelectorAll('.settings-v2-account-actions > *').length===10`, 'Console Account preserves all ten source-grounded destinations');
  for(const [group,route]of[['account','subscriptions'],['system','display'],['play-social','streaming']]){
    await click(`#settings-v2-tab-${group}`);
    if(group==='account')await clickText('.settings-v2-account-actions button','Subscriptions');else await click(`[data-settings-v2-open="${route}"]`);
    await wait(`document.querySelector('[data-settings-v2-route]')?.dataset.settingsV2Route==='${route}'`);await capture(`console-settings-${group}`);
    await check(`Boolean(document.querySelector('[data-settings-category-back]'))&&document.activeElement?.hasAttribute('data-settings-category-back')`, `Settings ${group} opens its ${route} detail with Back focused`);
    await pad(1);await wait(`!document.querySelector('[data-settings-category-back]')`);
    await check(`document.activeElement?.dataset.settingsV2Open==='${route}'`, `Settings detail Back restores the exact ${route} category card`);
  }
  await click('#settings-v2-tab-accessibility');await wait(`document.querySelector('[data-settings-v2-route]')?.dataset.settingsV2Route==='accessibility'`);await check(`!document.querySelector('[data-settings-category-back]')&&Boolean(document.querySelector('.settings-v2-content select'))`, 'Accessibility displays its actual motion options directly in the new category');await capture('console-settings-accessibility');
  await click('#settings-v2-tab-devices');await wait(`document.querySelector('[data-settings-v2-route]')?.dataset.settingsV2Route==='input'`);
  await check(`!document.querySelector('[data-settings-category-back]')&&document.querySelector('.settings-v2-content')?.textContent.includes('Controller')`, 'Devices displays its controller and input settings directly within the new category');await capture('console-settings-devices');
  await click('#settings-v2-tab-apps');await wait(`document.querySelector('[data-settings-v2-route]')?.dataset.settingsV2Route==='library'`);await wait(`document.querySelectorAll('.settings-v2-provider-card').length===7`);await check(`document.querySelector('#settings-v2-heading')?.textContent==='Apps'&&!document.querySelector('[data-settings-category-back]')`, 'Apps opens its inline root with the Apps heading and no misleading detail Back');await check(`document.querySelectorAll('.settings-v2-apps-section').length===2&&document.querySelectorAll('.settings-v2-provider-card').length===7`, 'Apps separates the two detected provider fixtures from all seven compatible providers without claiming account connection');await capture('console-settings-apps');
  await click('.settings-v2-provider-card');await wait(`Boolean(document.querySelector('[data-settings-subpage-back]:not([data-settings-category-back])'))`);await pad(1);
  await check(`document.querySelector('[data-settings-v2-route]')?.dataset.settingsV2Route==='library'&&!document.querySelector('[data-settings-subpage-back]')`, 'Provider Back returns to the inline Library category without closing Settings');
  await click('#settings-v2-tab-account');await clickText('.settings-v2-account-actions button','Privacy & safety');await wait(`document.querySelector('[data-settings-v2-route]')?.dataset.settingsV2Route==='privacy'`);await check(`Boolean(document.querySelector('[data-settings-category-back]'))&&document.querySelector('#settings-v2-heading')?.textContent==='Privacy & safety'`, 'Account Privacy opens its real corresponding options');await pad(1);
  await click('#settings-v2-tab-play-social');await click('[data-settings-v2-open="permissions"]');await wait(`document.querySelector('[data-settings-v2-route]')?.dataset.settingsV2Route==='permissions'`);await check(`Boolean(document.querySelector('[data-settings-category-back]'))`, 'Play & social Offline play retains its device-permission settings');await pad(1);
  await click('#settings-v2-tab-system');
  await check(`(()=>{const routes=[...document.querySelectorAll('[data-settings-v2-open]')].map(node=>node.dataset.settingsV2Open);return routes.indexOf('storage')<routes.indexOf('audio')&&!routes.includes('developer');})()`, 'System orders Install & storage before Audio and hides Developer until explicitly enabled');
  await click('[data-settings-v2-open="audio"]');await wait(`document.querySelector('[data-settings-v2-route]')?.dataset.settingsV2Route==='audio'`);
      await wait(`Boolean(document.querySelector('input[aria-label="System volume"]:not(:disabled)'))`);await evaluate(`window.__redesignSmoke.deferAudioWrite();document.querySelector('input[aria-label="System volume"]').focus()`);await pad(15);
      await wait(`window.__redesignSmoke.audioWritePending()`);await check(`document.activeElement?.matches('input[aria-label="System volume"]')&&document.activeElement.value==='51'&&!document.activeElement.disabled`, 'A pending audio write keeps the edited System volume range focused');
      await pad(15);await check(`window.__redesignSmoke.calls.filter(call=>call.method==='setGuideAudio').length===1&&document.activeElement?.matches('input[aria-label="System volume"]')`, 'Repeated D-pad input cannot issue another volume write while the first is pending');
      await evaluate(`window.__redesignSmoke.settleAudioWrite()`);await delay(150);await check(`document.activeElement?.matches('input[aria-label="System volume"]')&&document.activeElement.value==='51'&&document.querySelector('[data-settings-v2-route]')?.dataset.settingsV2Route==='audio'`, 'D-pad right edits the real controlled audio range and preserves slider focus after its reply');
      await pad(14);await wait(`window.__redesignSmoke.calls.some(call=>call.method==='setGuideAudio'&&call.args[0].volume===50)`);await check(`document.activeElement?.matches('input[aria-label="System volume"]')&&document.activeElement.value==='50'`, 'D-pad left returns the fixture volume without switching Settings sections');
      await capture('console-settings-audio-slider');

  await pad(1);await wait(`Boolean(document.querySelector('[data-settings-v2-open="audio"]'))`);
  await click('#settings-v2-tab-system');
  for(const route of ['xbox-mode','languages','storage','startup','notifications','about']){
    await click(`[data-settings-v2-open="${route}"]`);await wait(`document.querySelector('[data-settings-v2-route]')?.dataset.settingsV2Route==='${route}'`);
    await check(`Boolean(document.querySelector('[data-settings-category-back]'))&&Boolean(document.querySelector('#settings-v2-heading'))`, `System ${route} opens the corresponding working Settings detail`);
    if(route==='storage')await consoleGeometry('console-settings-storage','.settings-v2-dialog',{modal:true});
    if(route==='about'){await click('.original-about-settings .settings-nexus-extension > summary');await wait(`Boolean(document.querySelector('.original-about-settings .keyring-status')?.textContent.includes('Ready'))`);await check(`document.querySelector('.original-about-settings button[aria-label="Check keyring"]')?.getClientRects().length&&!window.__redesignSmoke.calls.some(call=>call.method==='startKeyring'||call.method==='createKeyringCollection')`, 'About keeps the actual system-keyring status reachable inside its engine disclosure without starting or modifying a wallet');}
    await pad(1);await wait(`Boolean(document.querySelector('[data-settings-v2-open="${route}"]'))`);
  }
  await click('[data-settings-v2-open="storage"]');await wait(`document.querySelector('[data-settings-v2-route]')?.dataset.settingsV2Route==='storage'`);
  await click('.settings-v2-content .engine-settings-extra > summary');
  await click('.settings-storage input[type="number"]');await key('End');await send('Input.insertText',{text:'1'});
  await check(`document.querySelector('.settings-storage input[type="number"]').value!=='0'&&!window.__redesignSmoke.calls.some(call=>call.method==='updateSettings'&&call.args[0].downloadLimitMiB)`, 'Storage edits remain unsaved until an explicit persistence action');
  await pad(1);await click('#settings-v2-tab-account');await clickText('.settings-v2-account-actions button','View profile');
  await wait(`Boolean(document.querySelector('.game-dialog[aria-label="Discard unsaved settings?"]'))`);await capture('console-settings-unsaved-confirm');await pad(1);
  await check(`Boolean(document.querySelector('.settings-v2-dialog'))&&!document.querySelector('.game-dialog[aria-label="Discard unsaved settings?"]')`, 'Cancelling a Settings destination handoff keeps the unsaved Settings session open');
  await click('#settings-v2-tab-system');await click('[data-settings-v2-open="storage"]');await click('.settings-v2-content .engine-settings-extra > summary');
  await check(`document.querySelector('.settings-storage input[type="number"]').value!=='0'`, 'Cancelling a destination handoff preserves the unsaved Storage value');
  await pad(1);await click('#settings-v2-tab-account');await clickText('.settings-v2-account-actions button','View profile');await wait(`Boolean(document.querySelector('.game-dialog[aria-label="Discard unsaved settings?"]'))`);
  await click('.game-dialog[aria-label="Discard unsaved settings?"] .primary');await wait(`!document.querySelector('.xbox-settings-dialog')&&Boolean(document.querySelector('.profile-page'))`);
  await check(`!document.querySelector('.console-shell-header').inert&&!document.querySelector('.content-shell').inert`, 'Explicitly discarding unsaved Settings completes the Profile destination handoff and restores input');
  await click('.console-shell-header button[aria-label="Settings"]');await wait(`Boolean(document.querySelector('.settings-v2-dialog'))`);
  await click('#settings-v2-tab-account');await pad(5);await check(`Boolean(document.querySelector('#settings-v2-tab-devices[aria-selected="true"]'))&&Boolean(document.querySelector('.settings-v2-dialog'))`, 'Settings RB changes only the active Settings category');
  await pad(4);await check(`Boolean(document.querySelector('#settings-v2-tab-account[aria-selected="true"]'))`, 'Settings LB returns to Account without navigating the page behind it');await pad(1);await wait(`!document.querySelector('.xbox-settings-dialog')`);
  await check(`!document.querySelector('.console-shell-header').inert&&!document.querySelector('.content-shell').inert`, 'Closing Settings restores both shared console surfaces');
  await click('.console-desktop-return');await wait(`Boolean(document.querySelector('.desktop-experience .desktop-topbar'))`);
  await check(`!document.querySelector('.xbox-mode-home')&&!document.querySelector('.desktop-topbar time,.desktop-topbar .shell-battery')&&Boolean(document.querySelector('.xbox-mode-entry'))`, 'Return to desktop restores desktop chrome without stale console status');
  await click('[data-desktop-page="home"]');await wait(`Boolean(document.querySelector('.new-experience-home'))`);
  await evaluate(`window.__redesignSmoke.setSessionFullscreen(true)`);await wait(`Boolean(document.querySelector('.xbox-mode-home'))`);
  await check(`Boolean(document.querySelector('.console-home'))`, 'An externally changed session snapshot also selects console Home');
  await evaluate(`window.__redesignSmoke.transitionAccount()`);
  await wait(`!document.querySelector('.console-home-account')?.textContent.includes('Private stale gamer')`);
  await check(`(()=>{const account=document.querySelector('.console-home-account');return Boolean(account)&&!account.textContent.includes('Private stale gamer')&&!account.textContent.includes('21,337')&&!account.querySelector('img,.subscription-badge,.console-home-score');})()`, 'An account transition hides stale console gamertag, avatar, membership and gamerscore');
  await evaluate(`window.__redesignSmoke.resumeAccount()`);
  await evaluate(`window.__redesignSmoke.setSessionFullscreen(false)`);await wait(`Boolean(document.querySelector('.desktop-experience'))`);
  await evaluate(`window.__redesignSmoke.signOut()`);await wait(`document.querySelector('.friends-dock')?.textContent.includes('Sign in to see your friends.')`);
  await check(`!document.querySelector('.friends-dock')?.textContent.includes('Fixture Friend')&&!document.querySelector('.desktop-account')?.getAttribute('title')?.includes('xboksPlayer')&&!document.querySelector('.desktop-account')?.textContent.includes('PC GAMES')`, 'Sign-out immediately removes private friends, membership and profile data');
  await evaluate(`window.__redesignSmoke.disableLogin()`);await click('.desktop-account');await wait(`Boolean(document.querySelector('.shell-account-menu'))`);await clickText('.shell-account-menu button','Sign in');await wait(`Boolean(document.querySelector('.settings-v2-dialog'))`);
  await click('#account-session-controls > summary');await check(`(()=>{const buttons=[...document.querySelectorAll('.settings-v2-content button')].filter(button=>button.textContent.includes('Sign in with Microsoft'));return buttons.length===1&&buttons[0].disabled&&!window.__redesignSmoke.calls.some(call=>call.method==='login');})()`, 'Signed-out Settings keeps its single Microsoft sign-in control disabled when the backend cannot sign in');await capture('desktop-settings-signed-out-guard');await pad(1);await wait(`!document.querySelector('.xbox-settings-dialog')`);
  const boundary=await inspectBoundary();Object.assign(report,boundary);
  report.checks.push({label:'No install, game launch, account, message or operating-system mutation was requested',passed:!report.forbidden.length,actual:report.forbidden});
  report.checks.push({label:'Every launcher method used by the actual App has an explicit fixture',passed:!report.unexpected.length,actual:report.unexpected});
} catch(error) {
  report.error=error.stack??String(error);console.error(report.error);
  if(capture)try{await capture('failure-state');}catch{}
} finally {
  if(inspectBoundary)try{Object.assign(report,await inspectBoundary());}catch{}
  const currentFingerprint=await sourceFingerprint();
  report.sourceChangedDuringRun=[...new Set([...Object.keys(report.sourceFingerprint),...Object.keys(currentFingerprint)])].filter(file=>report.sourceFingerprint[file]!==currentFingerprint[file]);
  if(report.sourceChangedDuringRun.length)report.error??='Source changed during the browser run; repeat against a stable candidate.';
  report.finishedAt=new Date().toISOString();report.passed=report.checks.filter(check=>check.passed).length;report.failed=report.checks.filter(check=>!check.passed).length;
  await writeFile(join(output,'experience-redesign-report.json'),JSON.stringify(report,null,2)+'\n');
  await writeFile(join(output,'source-fingerprint.json'),JSON.stringify({startedAt:report.startedAt,finishedAt:report.finishedAt,files:report.sourceFingerprint,sourceChangedDuringRun:report.sourceChangedDuringRun},null,2)+'\n');
  await writeFile(join(output,'README.txt'),'Screenshots exercise the actual XBOKS React App using generated fixture artwork, synthetic social/catalog data and a localhost-only browser network boundary. They are not original Xbox screenshots, real account tests, proof of operating-system integration, or pixel parity. Every screenshot carries a fixture watermark. Private profiles and HOME/XDG directories are deleted after each run.\n');
  socket?.close();
  if(chrome){const exited=chrome.exitCode===null&&chrome.signalCode===null?new Promise(resolve=>chrome.once('exit',resolve)):Promise.resolve();chrome.kill('SIGTERM');await exited;}
  await server?.close();await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});
}
console.log(`Experience redesign checks: ${report.passed} passed, ${report.failed} failed. Artifacts: ${output}`);
if(report.error||report.failed||report.browserErrors.length||report.forbidden.length||report.unexpected.length)process.exitCode=1;
