#!/usr/bin/env node
/** Actual renderer integration checks in an isolated Chromium profile. The
 * launcher boundary and artwork are fixtures; no Electron/user backend is used.
 * Run: XBOKS_FIXTURE_BROWSER=electron node
 * scripts/ui/experience-redesign-smoke.mjs [output-directory] */
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer as createSocketServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureContentSecurityPolicy, fixtureNetworkBoundary } from './local-network-boundary.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const output = resolve(root, process.argv[2] ?? 'work/redesign-2026-11/qa');
const fixturePath = '/__experience-redesign-fixture.js';
const fixture = String.raw`
import { demoSnapshot, demoAccountLibrary } from '/src/shared/demo-data.ts';
const calls = [], listeners = new Set(), fullscreenListeners = new Set(), modeEntryListeners = new Set(), keyringListeners = new Set(), remoteListeners = new Set(), cloudListeners = new Set();
let nativeFullscreen = false, deferEntry = false, pendingEntry, beforeAccountTransition;
window.__redesignSmoke = { transitionAccount(){beforeAccountTransition=structuredClone(snapshot.auth);snapshot.auth={...snapshot.auth,stored:true,running:true,gamertag:'Private stale gamer',avatarDataUrl:artwork('Private stale avatar'),profile:{...snapshot.auth.profile,gamertag:'Private stale gamer',gamerscore:21337}};for(const listener of listeners)listener(structuredClone(snapshot));}, resumeAccount(){if(!beforeAccountTransition)throw Error('No account transition fixture');snapshot.auth=beforeAccountTransition;beforeAccountTransition=undefined;for(const listener of listeners)listener(structuredClone(snapshot));}, deferModeEntry(){deferEntry=true;}, modeEntryPending(){return Boolean(pendingEntry);}, settleModeEntry(ok){const request=pendingEntry;if(!request)throw Error('No fixture entry is pending');pendingEntry=undefined;if(ok)request.resolve(true);else{nativeFullscreen=false;for(const listener of fullscreenListeners)listener(false);request.reject(Error('Fixture Xbox mode entry rejected.'));}}, signOut(){snapshot.auth={stored:false,running:false,note:'Fixture sign-out only'};for(const listener of listeners)listener(structuredClone(snapshot));}, setSessionFullscreen(value){snapshot.desktopSettings.fullscreenExperience=value;for(const listener of listeners)listener(structuredClone(snapshot));}, setFullscreen(value){nativeFullscreen=value;for(const listener of fullscreenListeners)listener(value);}, requestModeEntry(){for(const listener of modeEntryListeners)listener();}, subscriptions(){return{snapshot:listeners.size,fullscreen:fullscreenListeners.size,entry:modeEntryListeners.size,keyring:keyringListeners.size,remote:remoteListeners.size,cloud:cloudListeners.size};}, calls, forbidden: [], unexpected: [], pad: null, deferLocales: false, localeRequests: [] };
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
const socialCapabilities={friends:true,presence:true,inbox:true,conversation:true,send:false,search:true,partyVoice:false};
const fixtureFriends=[{xuid:'12345',gamertag:'Fixture Friend One',presence:'online',activity:'Sample game activity'},{xuid:'67890',gamertag:'Fixture Friend Two',presence:'offline'},{xuid:'11112',gamertag:'Fixture Friend Three',presence:'unknown'}];
const social=extra=>({status:'ready',checkedAt:new Date().toISOString(),capabilities:{...socialCapabilities},selfXuid:'99999',...extra});
const handlers = {
 onConsoleLibraryOpen:()=>()=>{},
 getCloudAccountCatalog:async()=>({status:'unsupported',titles:[],recentProductIds:[],checkedAt:new Date().toISOString(),reason:'Cloud access is not provided by this renderer fixture.'}),
 getCloudStreamState:async()=>({phase:'closed'}),onCloudStreamState:()=>()=>{},getConsoleStreamState:async()=>({phase:'closed'}),onConsoleStreamState:()=>()=>{},
 getXboxFriends:async()=>social({friends:structuredClone(fixtureFriends)}),
 searchXboxPeople:async query=>social({friends:fixtureFriends.filter(friend=>friend.gamertag.toLowerCase().includes(query.toLowerCase()))}),
 getXboxChats:async()=>social({conversations:[]}),
 getXboxConversation:async peerXuid=>social({peerXuid,messages:[{id:'fixture-message',senderXuid:peerXuid,text:'Explicit fixture conversation; no Xbox service contacted.',deleted:false}]}),
 getSnapshot:async()=>structuredClone(snapshot), onSnapshot:callback=>{listeners.add(callback);return()=>listeners.delete(callback);}, onOperationLog:()=>()=>{}, isDemoTour:()=>false,
 getFeaturedCatalog:async()=>structuredClone(catalog), searchCatalog:async(query,cursor)=>pagedCatalog(query,cursor,'search'), getCatalogDetails:async id=>metadata(id),
 getStoreCollection:async(kind,cursor)=>{if(!['all-pc','toppaid','addons'].includes(kind))throw Error('Invalid fixture collection');return pagedCatalog(kind,cursor,kind);},
 getAccountLibrary:async kind=>demoAccountLibrary(kind,map), getGameLaunchOptions:async()=>({cloudSaves:true,vcInstall:true}),
 getGameDetails:async id=>metadata(snapshot.games.find(game=>game.id===id)?.storeId??id),
 getGameActivity:async()=>({status:'available',minutesPlayed:71,lastPlayed:'2026-10-20T15:00:00.000Z'}), getGameAchievements:async()=>({status:'available',items:[]}),
 getGameLocales:id=>window.__redesignSmoke.deferLocales ? new Promise(resolve=>window.__redesignSmoke.localeRequests.push({id,resolve})) : Promise.resolve(['en-US','el-GR']), getLibraryProviders:async()=>['steam','ea'].map(id=>({id,installed:true})),
 getGuideAudio:async()=>({available:false,reason:'Audio adapter is not connected in renderer fixtures.'}), getBatteryPercentage:async()=>null,
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
const forbidden = new Set(['sendXboxMessage','startInstall','launchGame','removeGame','cancelDownload','pauseDownload','resumeDownload','removeDownload','installGameContent','updateInstalledGame','quitLauncher','logout','login','openRemotePlay','openCloudGaming','prepareXboxModeRestart','restartIntoXboxMode','startKeyring','createKeyringCollection','updateBackend','installRuntime','installNexusRuntime','installLauncherUpdate','createGameShortcut','addToSteam','installGameVcRuntime','cancelGame','importGame','updateGame','openPath','clearFinishedDownloads']);
window.launcher = new Proxy({}, {get(_target,name){if(name==='getStoreWishlist')return undefined;return (...args)=>{calls.push({method:String(name),args});if(forbidden.has(String(name))){window.__redesignSmoke.forbidden.push(String(name));return Promise.reject(Error('Mutation disabled in renderer smoke fixture'));}if(handlers[name])return handlers[name](...args);window.__redesignSmoke.unexpected.push(String(name));return Promise.reject(Error('Unstubbed renderer API: '+String(name)));};}});
const pad = {index:0,id:'xboks-renderer-smoke',mapping:'standard',connected:true,axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))};
window.__redesignSmoke.pad = pad;
Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[pad]});
await import('/src/renderer/main.tsx');
const watermark=document.createElement('div');watermark.textContent='ACTUAL APP FIXTURE · Synthetic launcher/catalog/input · No account, wallet or host actions';Object.assign(watermark.style,{position:'fixed',bottom:'12px',right:'16px',zIndex:'10000',background:'#132331',color:'#cce4f2',padding:'8px 12px',font:'13px sans-serif',pointerEvents:'none'});document.body.append(watermark);
`;

await mkdir(output, { recursive: true });
const report = { startedAt: new Date().toISOString(), fixtureOnly: true, originalWindowsRuntimeVerified: false, realXboxServicesVerified: false, operatingSystemOverlayVerified: false,
  checks: [], screenshots: [], browserErrors: [], blockedRequests: [], calls: [], forbidden: [], unexpected: [] };
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
  const check=async(expression,label)=>{const actual=await evaluate(expression);const passed=Boolean(actual);const result={label,passed,actual};if(!passed)result.context=await evaluate(`({focus:document.activeElement?.outerHTML.slice(0,600),page:document.querySelector('.sidebar [aria-current="page"]')?.getAttribute('aria-label'),detail:document.querySelector('[data-gamepad-detail]')?.getAttribute('data-gamepad-detail'),store:{heading:document.querySelector('.xbox-store-gallery-heading h2')?.textContent,count:document.querySelectorAll('.xbox-store-gallery-grid .xbox-store-product').length,searchCalls:window.__redesignSmoke.calls.filter(call=>call.method==='searchCatalog').length},installedArt:(()=>{const box=document.querySelector('.gd-hero-art')?.getBoundingClientRect();return box?{x:box.x,width:box.width}:undefined;})()})`);report.checks.push(result);console.log(`${passed?'PASS':'FAIL'} ${label}`);};
  const click=async(selector)=>{
    const target=await evaluate(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});if(!node)throw Error('Missing click target '+${JSON.stringify(selector)});if(node.disabled||node.closest('[inert],[hidden]'))throw Error('Unavailable click target '+${JSON.stringify(selector)});node.scrollIntoView({block:'center',inline:'center'});const box=node.getBoundingClientRect();if(!box.width||!box.height)throw Error('Invisible click target '+${JSON.stringify(selector)});return{x:box.x+box.width/2,y:box.y+box.height/2};})()`);
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',...target});await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...target});await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...target});await delay(160);
  };
  const key=async(value)=>{const code=value==='Enter'?13:value==='Escape'?27:0;const fields={key:value,code:value,...(code?{windowsVirtualKeyCode:code,nativeVirtualKeyCode:code}:{})};await send('Input.dispatchKeyEvent',{type:'keyDown',...fields,...(value==='Enter'?{text:'\r',unmodifiedText:'\r'}:{})});await send('Input.dispatchKeyEvent',{type:'keyUp',...fields});await delay(160);};
  const pad=async(button)=>{await delay(100);await evaluate(`Object.assign(window.__redesignSmoke.pad.buttons[${button}],{pressed:true,value:1})`);await delay(100);await evaluate(`Object.assign(window.__redesignSmoke.pad.buttons[${button}],{pressed:false,value:0})`);await delay(180);};
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
  await checkDockGeometry(1280,720);
  await capture('desktop-1280x720');
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
  await click('.desktop-account');await wait(`Boolean(document.querySelector('.shell-account-menu'))`);
  await evaluate(`[...document.querySelectorAll('.shell-account-menu button')].find(button=>button.textContent.trim()==='Settings').click()`);
  await wait(`Boolean(document.querySelector('.xbox-settings-dialog'))`);
  await check(`document.querySelector('.desktop-topbar')?.inert&&document.querySelector('.desktop-sidebar')?.inert&&document.querySelector('.content-shell')?.inert`, 'Settings makes the full desktop header, sidebar and page inert');
  await evaluate(`window.__redesignSmoke.setSessionFullscreen(true)`);await wait(`Boolean(document.querySelector('.console-home .xbox-mode-home'))&&Boolean(document.querySelector('.xbox-settings-dialog'))`);
  await check(`(()=>{const surfaces=[...document.querySelectorAll('.app-shell > .sidebar,.app-shell > .content-shell,.app-shell > .desktop-topbar')];return surfaces.length>0&&surfaces.every(node=>node.inert);})()`, 'Desktop Settings keeps every replacement console surface inert after an external mode change');
  await pad(1);await wait(`!document.querySelector('.xbox-settings-dialog')`);
  await check(`!document.querySelector('.content-shell')?.inert&&Boolean(document.querySelector('.xbox-mode-home'))`, 'Closing Settings after an external mode change restores the console Home');
  await click('.console-home-shortcuts button[aria-label="Settings"]');await wait(`Boolean(document.querySelector('.xbox-settings-dialog'))`);
  await evaluate(`window.__redesignSmoke.setSessionFullscreen(false)`);await wait(`Boolean(document.querySelector('.desktop-experience .desktop-topbar'))&&Boolean(document.querySelector('.xbox-settings-dialog'))`);
  await check(`(()=>{const surfaces=[...document.querySelectorAll('.app-shell > .sidebar,.app-shell > .content-shell,.app-shell > .desktop-topbar')];return surfaces.length===3&&surfaces.every(node=>node.inert);})()`, 'Console Settings keeps the new desktop header, sidebar and page inert after returning externally');
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
  await check(`Boolean(document.querySelector('.search-box input'))&&!document.querySelector('.xbox-mode-home')`, 'Console Search opens a usable catalog search input');
  await pad(1);await wait(`Boolean(document.querySelector('.xbox-mode-home'))`);
  await click('.console-home-customize');await wait(`Boolean(document.querySelector('#settings-tab-accessibility[aria-selected="true"]'))`);
  await check(`document.querySelector('.xbox-mode-home')?.closest('.content-shell')?.inert`, 'Appearance opens the actual accessibility settings and suspends Home input');
  await pad(1);await wait(`!document.querySelector('.xbox-settings-dialog')`);
  await click('.console-desktop-return');await wait(`Boolean(document.querySelector('.desktop-experience .desktop-topbar'))`);
  await check(`!document.querySelector('.xbox-mode-home')&&!document.querySelector('.desktop-topbar time,.desktop-topbar .shell-battery')&&Boolean(document.querySelector('.xbox-mode-entry'))`, 'Return to desktop restores desktop chrome without stale console status');
  await evaluate(`window.__redesignSmoke.setSessionFullscreen(true)`);await wait(`Boolean(document.querySelector('.xbox-mode-home'))`);
  await check(`Boolean(document.querySelector('.console-home'))`, 'An externally changed session snapshot also selects console Home');
  await evaluate(`window.__redesignSmoke.transitionAccount()`);
  await wait(`!document.querySelector('.console-home-account')?.textContent.includes('Private stale gamer')`);
  await check(`(()=>{const account=document.querySelector('.console-home-account');return Boolean(account)&&!account.textContent.includes('Private stale gamer')&&!account.textContent.includes('21,337')&&!account.querySelector('img,.subscription-badge,.console-home-score');})()`, 'An account transition hides stale console gamertag, avatar, membership and gamerscore');
  await evaluate(`window.__redesignSmoke.resumeAccount()`);
  await evaluate(`window.__redesignSmoke.setSessionFullscreen(false)`);await wait(`Boolean(document.querySelector('.desktop-experience'))`);
  await evaluate(`window.__redesignSmoke.signOut()`);await wait(`document.querySelector('.friends-dock')?.textContent.includes('Sign in to see your friends.')`);
  await check(`!document.querySelector('.friends-dock')?.textContent.includes('Fixture Friend')&&!document.querySelector('.desktop-account')?.getAttribute('title')?.includes('xboksPlayer')&&!document.querySelector('.desktop-account')?.textContent.includes('PC GAMES')`, 'Sign-out immediately removes private friends, membership and profile data');
  const boundary=await inspectBoundary();Object.assign(report,boundary);
  report.checks.push({label:'No install, game launch, account, message or operating-system mutation was requested',passed:!report.forbidden.length,actual:report.forbidden});
  report.checks.push({label:'Every launcher method used by the actual App has an explicit fixture',passed:!report.unexpected.length,actual:report.unexpected});
} catch(error) {
  report.error=error.stack??String(error);console.error(report.error);
  if(capture)try{await capture('failure-state');}catch{}
} finally {
  if(inspectBoundary)try{Object.assign(report,await inspectBoundary());}catch{}
  report.finishedAt=new Date().toISOString();report.passed=report.checks.filter(check=>check.passed).length;report.failed=report.checks.filter(check=>!check.passed).length;
  await writeFile(join(output,'experience-redesign-report.json'),JSON.stringify(report,null,2)+'\n');
  await writeFile(join(output,'README.txt'),'Screenshots exercise the actual XBOKS React App using generated fixture artwork, synthetic social/catalog data and a localhost-only browser network boundary. They are not original Xbox screenshots, real account tests, proof of operating-system integration, or pixel parity. Every screenshot carries a fixture watermark. Private profiles and HOME/XDG directories are deleted after each run.\n');
  socket?.close();
  if(chrome){const exited=chrome.exitCode===null?new Promise(resolve=>chrome.once('exit',resolve)):Promise.resolve();chrome.kill('SIGTERM');await exited;}
  await server?.close();await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});
}
console.log(`Experience redesign checks: ${report.passed} passed, ${report.failed} failed. Artifacts: ${output}`);
if(report.error||report.failed||report.browserErrors.length||report.forbidden.length||report.unexpected.length)process.exitCode=1;
