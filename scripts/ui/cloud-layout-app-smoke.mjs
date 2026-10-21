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
const output = resolve(root, process.argv[2] ?? 'work/cloud-layout-app-smoke');
let cloudData={products:[]};try{if(!process.env.XBOKS_CLOUD_LAYOUT_GENERATED)cloudData=JSON.parse(await readFile(join(root,'work/cloud-layout-public/data.json'),'utf8'));}catch{}
cloudData.version=JSON.parse(await readFile(join(root,'package.json'),'utf8')).version;
const fixturePath = '/__cloud-layout-app-smoke-fixture.js';
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
snapshot.auth.stored=true;snapshot.auth.gamertag='Layout Preview';snapshot.auth.username='layout-preview@example.invalid';snapshot.auth.note = 'Renderer smoke fixture only; no account or Xbox service was contacted.';
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
const cloudData = await (await fetch('/__cloud-layout-public.json')).json();
if(cloudData.products.length<8)cloudData.products=[...products.map((product,index)=>({...product,title:'Sample cloud record '+index,posterUrl:artwork('Sample cloud record '+index,index),heroUrl:artwork('Sample cloud record '+index,index)})),...Array.from({length:6},(_,index)=>({productId:index===0?'9N4PT8HGCDHQ':'E'+String(index).padStart(11,'0'),title:index===0?'Gears of War: E-Day':'Generated cloud record '+index,description:'Synthetic fixture metadata.',categories:[],posterUrl:artwork('Generated cloud record '+index),heroUrl:artwork('Generated cloud record '+index)})),{productId:'9NNX1VVR3KNQ',title:'Forza Horizon 5',description:'Synthetic fixture metadata; no public product response or game session is represented.',publisher:'Sample publisher',categories:[],posterUrl:artwork('Forza Horizon 5'),heroUrl:artwork('Forza Horizon 5')}];
const cloudProducts = [...Array.from({length:125},(_,index)=>({productId:'F'+String(index).padStart(11,'0'),title:'Cloud sample '+String(index).padStart(3,'0'),description:'Synthetic metadata used to test full cloud-catalog coverage.',publisher:'Sample publisher',categories:[]})),...cloudData.products];
snapshot.launcherUpdate={...(snapshot.launcherUpdate??{}),currentVersion:cloudData.version};
const cloudIds = cloudProducts.map(product=>product.productId);
const baseForza=cloudProducts.find(product=>product.productId==='9NNX1VVR3KNQ');
const edition={...baseForza,productId:'9NKX70BBCDRN',title:'Forza Horizon 5 Standard Edition',primaryProductId:'9NNX1VVR3KNQ',installability:'supported',supportNote:'Public Store bundle metadata fixture'};
products[0]={...baseForza,installability:'supported',supportNote:'Public Store metadata fixture'};products[3]=edition;byId.set(products[0].productId,products[0]);byId.set(edition.productId,edition);

for(const product of cloudProducts)byId.set(product.productId,product);
window.__cloudLayout={active:0,maxActive:0,reads:[],defer:false,pending:[],entitled:true,deferAccount:false,accountRequests:[],launches:[],deferLaunch:false,pendingLaunches:[],setAccount:patch=>{Object.assign(snapshot.auth,patch);for(const listener of listeners)listener(structuredClone(snapshot));},cloudIds,late:cloudProducts.at(-1).productId,setCompact:async value=>{const appearance=await import('/src/renderer/appearance.ts');appearance.saveAppearance({...appearance.loadAppearance(),compactMode:value});}};
const handlers = {
 getCloudPublicCatalog:async()=>({collections:{all:cloudIds,own:cloudData.products.slice(0,10).map(p=>p.productId),popular:cloudData.products.slice(0,8).map(p=>p.productId),recent:cloudData.products.slice(3,11).map(p=>p.productId),ea:cloudData.products.slice(7,11).map(p=>p.productId)},checkedAt:'2026-10-22T00:00:00Z'}),
 getCloudAccountCatalog:async()=>{const probe=window.__cloudLayout,result={status:'ready',titles:cloudIds.map(productId=>({productId,hasEntitlement:probe.entitled,supportedInputTypes:['controller']})),recentProductIds:cloudData.products.slice(0,5).map(p=>p.productId),checkedAt:'2026-10-22T00:00:00Z'};if(probe.deferAccount)return new Promise(resolve=>probe.accountRequests.push(()=>resolve(result)));return result;},
 startCloudStream:async productId=>{const probe=window.__cloudLayout;probe.launches.push(productId);if(probe.deferLaunch)await new Promise(resolve=>probe.pendingLaunches.push(resolve));return{phase:'closed'};},
 getCloudProducts:async ids=>{const probe=window.__cloudLayout;probe.active++;probe.maxActive=Math.max(probe.maxActive,probe.active);probe.reads.push(ids);try{if(probe.defer)await new Promise(resolve=>probe.pending.push(resolve));else await new Promise(resolve=>setTimeout(resolve,180));return cloudProducts.filter(product=>ids.includes(product.productId));}finally{probe.active--; }},
 getCloudStreamState:async()=>({phase:'closed'}),onCloudStreamState:()=>()=>{},getConsoleStreamState:async()=>({phase:'closed'}),onConsoleStreamState:()=>()=>{},onConsoleLibraryOpen:()=>()=>{},

 getSnapshot:async()=>structuredClone(snapshot), onSnapshot:callback=>{listeners.add(callback);return()=>listeners.delete(callback);}, onOperationLog:()=>()=>{}, isDemoTour:()=>false,
 getFeaturedCatalog:async()=>structuredClone(catalog), searchCatalog:async(query,cursor)=>pagedCatalog(query,cursor,'search'), getCatalogDetails:async id=>({...metadata(id),primaryProductId:byId.get(id)?.primaryProductId,...(cloudData.detailsById?.[id]??{}),productId:id}),
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
const watermark=document.createElement('div');watermark.textContent='ACTUAL APP FIXTURE · Public or generated test artwork · Sample account/catalog membership/input · No real account, Xbox stream or host actions';Object.assign(watermark.style,{position:'fixed',bottom:'12px',right:'16px',zIndex:'10000',background:'#132331',color:'#cce4f2',padding:'8px 12px',font:'13px sans-serif',pointerEvents:'none'});document.body.append(watermark);
`;

await mkdir(output, { recursive: true });
const report = { startedAt: new Date().toISOString(), fixtureOnly: true, originalWindowsRuntimeVerified: false, realXboxServicesVerified: false, operatingSystemOverlayVerified: false,
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
  server = await createServer({ root, cacheDir:join(profile,'vite-cache'), logLevel: 'error', server: { host: '127.0.0.1', port: rendererPort, strictPort: true, watch: { ignored: ['**/*'] } }, plugins: [{name:'reference-store-local-artwork',enforce:'pre',transform(code,id){if(!id.endsWith('/src/renderer/XboxStorePage.tsx'))return;return code.replace(/https:\/\/cms-assets\.xboxservices\.com\/[^']+/,storeArtworkPath);}}, {
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

  await wait(`Boolean(document.querySelector('.home-product'))`);
  await evaluate(`window.__cloudLayout.setCompact(false)`);await delay(180);
  await click('.sidebar [aria-label="Cloud gaming"]');
  await wait(`document.querySelectorAll('.cloud-row-cards .cloud-product[data-product-id]').length>8`);
  const geometry=`(()=>{const sidebar=document.querySelector('.sidebar').getBoundingClientRect(),content=document.querySelector('.content-shell').getBoundingClientRect(),top=document.querySelector('.topbar').getBoundingClientRect(),detail=document.querySelector('.cloud-product-detail')?.getBoundingClientRect();return{sidebar:sidebar.width,content:content.left,headerBottom:top.bottom,detailLeft:detail?.left,detailTop:detail?.top,viewport:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth};})()`;
  await check(`(${geometry}).sidebar===260&&(${geometry}).content===260&&!(${geometry}).overflow`,'Actual App expanded sidebar and content share the same260px origin');
  await click('.cloud-library-tabs button:nth-child(2)');await wait(`document.querySelectorAll('.cloud-library-grid .cloud-product[data-product-id]').length===60`);
  await check(`!window.__cloudLayout.reads.some(ids=>ids.includes(window.__cloudLayout.late))`,'late cloud title remains beyond the initial60 loaded entries');
  await evaluate(`window.__cloudLayout.defer=true`);
  await click('.search-box input');await send('Input.insertText',{text:'Fo'});await delay(120);
  await check(`window.__cloudLayout.pending.length===0&&!document.querySelector('.cloud-search-empty')`,'cloud search waits for250ms debounce and never reports an empty result before coverage');
  await send('Input.insertText',{text:'rza'});await key('Enter');
  await wait(`window.__cloudLayout.pending.length>0`);
  await check(`document.querySelector('.sidebar [aria-current="page"]')?.getAttribute('aria-label')==='Cloud gaming'&&!window.__referenceSmoke.calls.some(call=>call.method==='searchCatalog')&&!document.querySelector('.search-results')`,'actual topbar live search and Enter stay cloud-only without Store requests or local-game suggestions');
  await check(`Boolean(document.querySelector('.cloud-search-progress'))&&!document.querySelector('.cloud-search-empty')&&window.__cloudLayout.maxActive<=3`,'full-catalog hydration shows progress and keeps at most three bridge reads active');
  const hydrationReads=await evaluate(`window.__cloudLayout.reads.length`);
  await evaluate(`(()=>{const node=document.querySelector('.search-box input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,'Forza Horizon');node.dispatchEvent(new Event('input',{bubbles:true}));})()`);await delay(300);
  await check(`window.__cloudLayout.reads.length===${hydrationReads}&&window.__cloudLayout.pending.length>0&&!document.querySelector('.cloud-search-empty')`,'typing a newer cloud query coalesces existing hydration rather than restarting its metadata reads');
  await evaluate(`window.__cloudLayout.defer=false;window.__cloudLayout.pending.splice(0).forEach(resolve=>resolve())`);
  await wait(`Boolean(document.querySelector('.cloud-product[data-product-id="9NNX1VVR3KNQ"]'))&&!document.querySelector('.cloud-search-progress')`);
  await check(`document.querySelectorAll('.cloud-library-grid .cloud-product[data-product-id]').length===1&&document.querySelector('.cloud-product[data-product-id="9NNX1VVR3KNQ"] strong')?.textContent==='Forza Horizon 5'&&window.__cloudLayout.reads.every(ids=>ids.length<=60)&&window.__cloudLayout.maxActive<=3`,'full cloud search finds the exact late Forza title before pagination using bounded metadata batches');
  await capture('xboks-cloud-search-expanded');
  await click('.cloud-product[data-product-id="9NNX1VVR3KNQ"]');await wait(`Boolean(document.querySelector('.cloud-product-detail'))`);await delay(180);
  await check(`(${geometry}).detailLeft===260&&(${geometry}).detailTop===(${geometry}).headerBottom&&!(${geometry}).overflow`,'actual App cloud details start after the full expanded sidebar and below its real header');
  await check(`document.elementFromPoint(120,250)?.closest('.sidebar')&&document.querySelector('.cloud-product-detail')?.getAttribute('data-gamepad-detail')==='9NNX1VVR3KNQ'&&window.__referenceSmoke.calls.some(call=>call.method==='getCatalogDetails'&&call.args[0]==='9NNX1VVR3KNQ')`,'expanded labels stay clickable and details preserve the exact selected Product ID');
  await check(`document.querySelector('.cloud-detail-actions .cloud-play-action')?.textContent.trim()==='Play with Cloud'&&!document.querySelector('.cloud-detail-actions .cloud-play-action')?.disabled`,'native cloud detail uses the exact Play with Cloud action only for its current entitled sample account');
  await capture('xboks-cloud-detail-expanded');
  await evaluate(`window.__cloudLayout.setCompact(true)`);await delay(180);
  await check(`(${geometry}).sidebar===68&&(${geometry}).content===68&&(${geometry}).detailLeft===68&&(${geometry}).detailTop===(${geometry}).headerBottom`,'changing the actual appearance preference keeps compact sidebar, content and fixed details aligned68px');
  await capture('xboks-cloud-detail-compact');
  await evaluate(`window.__referenceSmoke.setSessionFullscreen(true)`);await wait(`document.documentElement.hasAttribute('data-fullscreen-experience')`);
  await check(`(${geometry}).sidebar===68&&(${geometry}).detailLeft===68&&(${geometry}).detailTop===(${geometry}).headerBottom&&Boolean(document.querySelector('.shell-header-controls time'))`,'Fullscreen Experience header effects preserve compact cloud-detail origin');await capture('xboks-cloud-detail-fullscreen');
  await evaluate(`window.__cloudLayout.setCompact(false)`);await delay(180);
  await check(`(${geometry}).sidebar===260&&(${geometry}).detailLeft===260&&(${geometry}).detailTop===(${geometry}).headerBottom`,'expanded Fullscreen Experience shares the same260px fixed-panel boundary');
  await send('Emulation.setDeviceMetricsOverride',{width:650,height:900,deviceScaleFactor:1,mobile:false});await delay(220);
  await check(`(${geometry}).sidebar===60&&(${geometry}).content===60&&(${geometry}).detailLeft===60&&(${geometry}).detailTop===64&&!(${geometry}).overflow`,'narrow viewport uses one60px rail and64px header for the actual fixed cloud detail');
  await send('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});await evaluate(`window.__referenceSmoke.setSessionFullscreen(false)`);await delay(180);
  await evaluate(`(()=>{const node=document.querySelector('.search-box input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,'Forza Horizon 5');node.dispatchEvent(new Event('input',{bubbles:true}));})()`);await wait(`!document.querySelector('.cloud-product-detail')&&document.querySelector('.cloud-library-page')?.dataset.cloudPage==='search'`);
  await check(`document.querySelector('.sidebar [aria-current="page"]')?.getAttribute('aria-label')==='Cloud gaming'&&!document.querySelector('.catalog-details-page')`,'editing the global cloud query dismisses the old detail without changing to Store or library');
  await click('.search-box button[aria-label="Clear search"]');await wait(`!document.querySelector('.cloud-product-detail')`);
  await check(`document.querySelector('.cloud-library-page')?.dataset.cloudPage==='all'&&document.querySelector('.search-box input')?.value===''&&!window.__referenceSmoke.calls.some(call=>call.method==='searchCatalog')`,'topbar clear closes cloud details and returns to the same cloud collection without Store navigation');
  await click('.search-box input');await send('Input.insertText',{text:'zzzz-no-cloud-match'});await key('Enter');await wait(`Boolean(document.querySelector('.cloud-search-empty'))`);
  await check(`!document.querySelector('.cloud-product[data-product-id]')&&!document.querySelector('.cloud-search-progress')`,'zero results appear only after complete cloud metadata coverage');
  await check(`!window.__referenceSmoke.calls.some(call=>['startCloudStream','startConsoleStream','wakeConsole'].includes(call.method))`,'search, layout and detail navigation never start or wake a stream');
  await click('.sidebar [aria-label="Home"]');await wait(`Boolean(document.querySelector('.home-product[data-product-id="9NNX1VVR3KNQ"]'))`);
  await click('.home-product[data-product-id="9NNX1VVR3KNQ"]');await wait(`Boolean(document.querySelector('.catalog-details-page[data-product-id="9NNX1VVR3KNQ"] .cloud-play-action'))`);
  await check(`document.querySelector('.catalog-detail-actions .cloud-play-action')?.textContent.trim()==='Play with Cloud'&&window.__cloudLayout.launches.length===0`,'actual CatalogDetails shows direct-entitlement cloud action without starting on mount');
  await evaluate(`window.__cloudLayout.deferLaunch=true;const button=document.querySelector('.catalog-detail-actions .cloud-play-action');button.click();button.click()`);await delay(160);
  await check(`window.__cloudLayout.launches.length===1&&window.__cloudLayout.launches[0]==='9NNX1VVR3KNQ'&&document.querySelector('.catalog-detail-actions .cloud-play-action')?.disabled&&window.__cloudLayout.pendingLaunches.length===1`,'same-turn double click dispatches one exact entitled product and keeps its action pending');
  await evaluate(`window.__cloudLayout.deferLaunch=false;window.__cloudLayout.pendingLaunches.splice(0).forEach(resolve=>resolve())`);await delay(160);
  await evaluate(`localStorage.setItem('xboks.interface-language.v1','el');window.dispatchEvent(new Event('storage'))`);await delay(160);
  await check(`document.querySelector('.catalog-detail-actions .cloud-play-action')?.textContent.trim()==='Αναπαραγωγή με το Cloud'`,'actual CatalogDetails uses the original Greek cloud-play resource label');
  await evaluate(`localStorage.setItem('xboks.interface-language.v1','en');window.dispatchEvent(new Event('storage'))`);await delay(160);
  await click('.sidebar [aria-label="Home"]');await wait(`Boolean(document.querySelector('.home-product[data-product-id="9NKX70BBCDRN"]'))`);
  await click('.home-product[data-product-id="9NKX70BBCDRN"]');await wait(`Boolean(document.querySelector('.catalog-details-page[data-product-id="9NKX70BBCDRN"] .cloud-play-action'))`);
  await check(`!window.__cloudLayout.cloudIds.includes('9NKX70BBCDRN')&&window.__referenceSmoke.calls.some(call=>call.method==='getCatalogDetails'&&call.args[0]==='9NKX70BBCDRN')`,'Forza Standard Edition action comes from its verified public primary-product mapping, not a title search');
  await click('.catalog-detail-actions .cloud-play-action');await delay(160);
  await check(`window.__cloudLayout.launches.length===2&&window.__cloudLayout.launches[1]==='9NNX1VVR3KNQ'`,'mapped Forza Standard Edition dispatches the entitled base product ID exactly');
  await evaluate(`window.__cloudLayout.entitled=false;window.__cloudLayout.setAccount({username:'no-cloud-access@example.invalid'})`);await delay(220);
  await check(`!document.querySelector('.catalog-detail-actions .cloud-play-action')&&window.__cloudLayout.launches.length===2`,'actual CatalogDetails hides the action when the new current account has no entitlement');
  await evaluate(`window.__cloudLayout.entitled=true;window.__cloudLayout.deferAccount=true;window.__cloudLayout.setAccount({username:'old-pending@example.invalid'})`);await wait(`window.__cloudLayout.accountRequests.length===1`);
  await evaluate(`window.__cloudLayout.entitled=false;window.__cloudLayout.setAccount({username:'new-pending@example.invalid'})`);await wait(`window.__cloudLayout.accountRequests.length===2`);
  await evaluate(`window.__cloudLayout.accountRequests[0]()`);await delay(160);
  await check(`!document.querySelector('.catalog-detail-actions .cloud-play-action')`,'late entitled result for the old account cannot restore CatalogDetails cloud access');
  await evaluate(`window.__cloudLayout.accountRequests[1]();window.__cloudLayout.deferAccount=false`);await delay(160);
  await check(`!document.querySelector('.catalog-detail-actions .cloud-play-action')&&window.__cloudLayout.launches.length===2`,'current denied account stays without an action after both deferred reads settle');
  await evaluate(`window.__cloudLayout.entitled=true;window.__cloudLayout.setAccount({username:'roundtrip-a@example.invalid'})`);await wait(`Boolean(document.querySelector('.catalog-detail-actions .cloud-play-action'))`);
  await evaluate(`window.__cloudLayout.entitled=false;window.__cloudLayout.deferAccount=true;window.__cloudLayout.setAccount({username:'roundtrip-b@example.invalid'})`);await wait(`window.__cloudLayout.accountRequests.length===3`);
  await evaluate(`window.__cloudLayout.setAccount({username:'roundtrip-a@example.invalid'})`);await wait(`window.__cloudLayout.accountRequests.length===4`);
  await check(`!document.querySelector('.catalog-detail-actions .cloud-play-action')&&window.__cloudLayout.launches.length===2`,'A-to-B-to-A identity changes cannot reuse A\'s old entitlement while the new account reads are pending');
  await evaluate(`window.__cloudLayout.accountRequests[2]();window.__cloudLayout.accountRequests[3]();window.__cloudLayout.deferAccount=false`);await delay(160);
  await check(`!document.querySelector('.catalog-detail-actions .cloud-play-action')&&window.__cloudLayout.launches.length===2`,'the fresh denied A snapshot remains authoritative after both round-trip reads settle');
  await evaluate(`window.__cloudLayout.entitled=true;window.__cloudLayout.setAccount({username:'installed-cloud@example.invalid'})`);await wait(`Boolean(document.querySelector('.catalog-detail-actions .cloud-play-action'))`);
  await click('.sidebar .recents button:first-of-type');await wait(`Boolean(document.querySelector('.game-details-page .cloud-play-action'))`);
  await check(`document.querySelector('.game-details-page .cloud-play-action')?.textContent.trim()==='Play with Cloud'&&window.__cloudLayout.launches.length===2`,'installed GameDetails wrapper exposes the same account-gated action without running the local game');
  await click('.game-details-page .cloud-play-action');await delay(160);
  await check(`window.__cloudLayout.launches.length===3&&window.__cloudLayout.launches[2]==='9N4PT8HGCDHQ'&&!window.__referenceSmoke.forbidden.includes('launchGame')`,'installed Gears cloud action dispatches its exact cloud product without a local game launch');
  const boundary=await evaluate(`({calls:window.__referenceSmoke.calls,forbidden:window.__referenceSmoke.forbidden,unexpected:window.__referenceSmoke.unexpected})`);
  Object.assign(report,boundary);report.checks.push({label:'No forbidden real install/launch/account mutation was requested',passed:!report.forbidden.length,actual:report.forbidden});
  report.checks.push({label:'All requested launcher APIs are explicit fixtures',passed:!report.unexpected.length,actual:report.unexpected});
} catch(error) { report.error=error.stack??String(error);console.error(report.error); }
finally {
  if(inspectBoundary)try{Object.assign(report,await inspectBoundary());}catch{}
  report.finishedAt=new Date().toISOString();report.passed=report.checks.filter(check=>check.passed).length;report.failed=report.checks.filter(check=>!check.passed).length;
  await writeFile(join(output,'cloud-layout-report.json'),`${JSON.stringify(report,null,2)}\n`);
  await writeFile(join(output,'README.txt'),'1920×1080 screenshots of the actual XBOKS React renderer, using explicit sample launcher APIs and generated SVG fixture artwork. No real account, backend, wallet, game install or Xbox service was contacted. The Store fallback image is served locally; the report records cached public or generated fixture artwork. Private HOME/XDG paths, disabled system/session D-Bus addresses and the localhost-only browser network boundary isolate the run. These checks do not verify original Windows runtime behavior, operating-system Game Bar integration, service licensing, or pixel parity. See renderer-smoke-report.json for exact checks/API calls.\n');
  socket?.close();
  if(chrome){const exited=chrome.exitCode===null?new Promise(resolve=>chrome.once('exit',resolve)):Promise.resolve();chrome.kill('SIGTERM');await exited;}
  await server?.close();await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});
}
console.log(`Renderer fixture checks: ${report.passed} passed, ${report.failed} failed. Artifacts: ${output}`);
if(report.error||report.failed||report.browserErrors.length)process.exitCode=1;
