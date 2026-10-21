#!/usr/bin/env node
/** Actual renderer integration checks in an isolated Chromium profile. The
 * launcher boundary and artwork are fixtures; no Electron/user backend is used.
 * Run: node scripts/ui/reference-app-smoke.mjs [output-directory] */
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer as createSocketServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const output = resolve(root, process.argv[2] ?? 'outputs/reference-ui-2026-10-21');
const fixturePath = '/__reference-app-smoke-fixture.js';
const fixture = String.raw`
import { demoSnapshot, demoAccountLibrary } from '/src/shared/demo-data.ts';
const calls = [], listeners = new Set();
window.__referenceSmoke = { calls, forbidden: [], unexpected: [], pad: null, deferLocales: false, localeRequests: [] };
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
const metadata = productId => { const product=byId.get(productId); return {productId,title:product?.title??productId,description:product?.description??'Renderer fixture description.',publisher:product?.publisher??'Sample publisher',heroUrl:product?.heroUrl,categories:product?.categories??[],screenshots:[0,1,2,3,4,5,6].map(index=>artwork((product?.title??productId)+' · '+(index+1),index))}; };
const catalog = {query:'',market:'US',products,hasMore:false,fetchedAt:new Date().toISOString(),source:'Microsoft Store'};
const map = new Map(snapshot.games.map(game=>[game.storeId,{coverUrl:game.coverUrl,heroUrl:game.heroUrl}]));
const handlers = {
 getSnapshot:async()=>structuredClone(snapshot), onSnapshot:callback=>{listeners.add(callback);return()=>listeners.delete(callback);}, onOperationLog:()=>()=>{}, isDemoTour:()=>false,
 getFeaturedCatalog:async()=>structuredClone(catalog), searchCatalog:async query=>({...structuredClone(catalog),query}), getCatalogDetails:async id=>metadata(id),
 getAccountLibrary:async kind=>demoAccountLibrary(kind,map), getGameLaunchOptions:async()=>({cloudSaves:true,vcInstall:true}),
 getGameDetails:async id=>metadata(snapshot.games.find(game=>game.id===id)?.storeId??id),
 getGameActivity:async()=>({status:'available',minutesPlayed:71,lastPlayed:'2026-10-20T15:00:00.000Z'}), getGameAchievements:async()=>({status:'available',items:[]}),
 getGameLocales:id=>window.__referenceSmoke.deferLocales ? new Promise(resolve=>window.__referenceSmoke.localeRequests.push({id,resolve})) : Promise.resolve(['en-US','el-GR']), getLibraryProviders:async()=>['steam','ea'].map(id=>({id,installed:true})),
 getGuideAudio:async()=>({available:false,reason:'Audio adapter is not connected in renderer fixtures.'}), getBatteryPercentage:async()=>null,
 checkKeyring:async()=>({state:'ready',gameMode:false,canStart:false,message:'Renderer fixture; no system wallet inspected.'}),
 getDownloadCancelOptions:async()=>({deleteFilesAllowed:false,reason:'Renderer fixture; no files can be deleted.'}),
 updateSettings:async patch=>{Object.assign(snapshot.settings,patch);for(const listener of listeners)listener(structuredClone(snapshot));return structuredClone(snapshot.settings);},
 chooseDirectory:async()=>null, chooseFile:async()=>null,
};
const forbidden = new Set(['startInstall','launchGame','removeGame','cancelDownload','pauseDownload','resumeDownload','removeDownload','installGameContent','updateInstalledGame','quitLauncher','logout','login','openRemotePlay','updateBackend','installRuntime','installNexusRuntime','installLauncherUpdate','createGameShortcut','addToSteam','installGameVcRuntime','cancelGame','importGame','updateGame','openPath','clearFinishedDownloads']);
window.launcher = new Proxy({}, {get(_target,name){return (...args)=>{calls.push({method:String(name),args});if(forbidden.has(String(name))){window.__referenceSmoke.forbidden.push(String(name));return Promise.reject(Error('Mutation disabled in renderer smoke fixture'));}if(handlers[name])return handlers[name](...args);window.__referenceSmoke.unexpected.push(String(name));return Promise.reject(Error('Unstubbed renderer API: '+String(name)));};}});
const pad = {index:0,id:'xboks-renderer-smoke',mapping:'standard',connected:true,axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))};
window.__referenceSmoke.pad = pad;
Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[pad]});
await import('/src/renderer/main.tsx');
`;

await mkdir(output, { recursive: true });
const report = { startedAt: new Date().toISOString(), fixtureOnly: true, originalWindowsRuntimeVerified: false, realXboxServicesVerified: false, operatingSystemOverlayVerified: false,
  checks: [], screenshots: [], browserErrors: [], blockedRequests: [], calls: [], forbidden: [], unexpected: [] };
const profile = await mkdtemp(join(tmpdir(), 'xboks-reference-app-'));
let chrome, socket, server, inspectBoundary;
try {
  // Vite treats port=0 as its default port. Reserve an ephemeral number first
  // so an existing user's development server remains untouched.
  const reservation=createSocketServer();
  await new Promise((resolve,reject)=>{reservation.once('error',reject);reservation.listen(0,'127.0.0.1',resolve);});
  const rendererPort=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  server = await createServer({ root, logLevel: 'error', server: { host: '127.0.0.1', port: rendererPort, strictPort: true, watch: { ignored: ['**/*'] } }, plugins: [{
    name: 'xboks-reference-app-smoke', resolveId(id) { if (id === fixturePath) return id; }, load(id) { if (id === fixturePath) return fixture; },
    configureServer(vite) { vite.middlewares.use('/__reference-app-smoke.html', async (_req,res) => {
      res.setHeader('Content-Type','text/html'); res.end(await vite.transformIndexHtml('/__reference-app-smoke.html', `<!doctype html><html><head><meta charset="utf-8"><title>xboks renderer fixture</title></head><body><div id="root"></div><script type="module" src="${fixturePath}"></script></body></html>`));
    }); },
  }] });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  chrome = spawn(process.env.CHROME_BIN ?? '/usr/bin/google-chrome', ['--headless','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--disable-background-networking','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'], { stdio: 'ignore' });
  let port;
  for (let attempt=0;attempt<100&&!port;attempt++) { try { port=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]); } catch {} if(!port)await new Promise(resolve=>setTimeout(resolve,100)); }
  if(!port)throw Error('Chromium did not start');
  const tab=(await(await fetch(`http://127.0.0.1:${port}/json`)).json()).find(item=>item.type==='page');
  socket=new WebSocket(tab.webSocketDebuggerUrl); await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}));
  let id=0; const pending=new Map();
  const send=(method,params={})=>new Promise((resolve,reject)=>{const current=++id;const timeout=setTimeout(()=>{pending.delete(current);reject(Error(`CDP timeout: ${method}`));},20000);pending.set(current,message=>{clearTimeout(timeout);message.error?reject(Error(JSON.stringify(message.error))):resolve(message.result);});socket.send(JSON.stringify({id:current,method,params}));});
  socket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.id){pending.get(message.id)?.(message);pending.delete(message.id);}else if(message.method==='Runtime.exceptionThrown')report.browserErrors.push(message.params.exceptionDetails.exception?.description??message.params.exceptionDetails.text);else if(message.method==='Fetch.requestPaused'){const {requestId,request}=message.params; if(request.url.startsWith(base))void send('Fetch.continueRequest',{requestId});else{report.blockedRequests.push(request.url);void send('Fetch.failRequest',{requestId,errorReason:'BlockedByClient'});}}});
  await send('Page.enable'); await send('Runtime.enable'); await send('Fetch.enable',{patterns:[{urlPattern:'http*',requestStage:'Request'}]});
  await send('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:`${base}/__reference-app-smoke.html`});await send('Page.bringToFront');
  const evaluate=async(expression)=>{const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description??result.exceptionDetails.text);return result.result.value;};
  inspectBoundary=()=>evaluate(`({calls:window.__referenceSmoke?.calls??[],forbidden:window.__referenceSmoke?.forbidden??[],unexpected:window.__referenceSmoke?.unexpected??[]})`);
  const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const wait=async(expression)=>{for(let attempt=0;attempt<100;attempt++){if(await evaluate(expression))return;await delay(100);}throw Error(`Renderer condition timed out: ${expression}`);};
  const check=async(expression,label)=>{const actual=await evaluate(expression);const passed=Boolean(actual);const result={label,passed,actual};if(!passed)result.context=await evaluate(`({focus:document.activeElement?.outerHTML.slice(0,600),page:document.querySelector('.sidebar [aria-current="page"]')?.getAttribute('aria-label'),detail:document.querySelector('[data-gamepad-detail]')?.getAttribute('data-gamepad-detail'),installedArt:(()=>{const box=document.querySelector('.gd-hero-art')?.getBoundingClientRect();return box?{x:box.x,width:box.width}:undefined;})()})`);report.checks.push(result);console.log(`${passed?'PASS':'FAIL'} ${label}`);};
  const click=async(selector)=>{
    const target=await evaluate(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});if(!node)throw Error('Missing click target '+${JSON.stringify(selector)});if(node.disabled||node.closest('[inert],[hidden]'))throw Error('Unavailable click target '+${JSON.stringify(selector)});node.scrollIntoView({block:'center',inline:'center'});const box=node.getBoundingClientRect();if(!box.width||!box.height)throw Error('Invisible click target '+${JSON.stringify(selector)});return{x:box.x+box.width/2,y:box.y+box.height/2};})()`);
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',...target});await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...target});await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...target});await delay(160);
  };
  const key=async(value)=>{await send('Input.dispatchKeyEvent',{type:'keyDown',key:value});await send('Input.dispatchKeyEvent',{type:'keyUp',key:value});await delay(160);};
  const pad=async(button)=>{await delay(100);await evaluate(`Object.assign(window.__referenceSmoke.pad.buttons[${button}],{pressed:true,value:1})`);await delay(100);await evaluate(`Object.assign(window.__referenceSmoke.pad.buttons[${button}],{pressed:false,value:0})`);await delay(180);};
  const capture=async(name)=>{await evaluate('document.fonts.ready');await delay(180);const {data}=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(output,`${name}.png`),Buffer.from(data,'base64'));report.screenshots.push(`${name}.png`);};
  const accountSettings=async()=>{await click('.account-summary');await wait(`Boolean(document.querySelector('.shell-account-menu'))`);await evaluate(`(()=>{const button=[...document.querySelectorAll('.shell-account-menu button')].find(button=>button.textContent.trim()==='Settings');if(!button)throw Error('Settings menu action missing');button.click();})()`);await wait(`Boolean(document.querySelector('.xbox-settings-dialog'))`);};

  await wait(`Boolean(document.querySelector('.home-product[data-product-id="9N26X2PMTWBT"]'))`);await capture('home');
  const origin='.home-product[data-product-id="9N26X2PMTWBT"]';await click(origin);
  await wait(`Boolean(document.querySelector('.catalog-details-page[data-product-id="9N26X2PMTWBT"]'))`);await capture('product-details');
  await check(`window.__referenceSmoke.calls.some(call=>call.method==='getCatalogDetails'&&call.args[0]==='9N26X2PMTWBT')&&!window.__referenceSmoke.calls.some(call=>call.method==='searchCatalog')`,'Home product click fetches exact Product ID without title search');
  await click('.shell-back');await wait(`Boolean(document.querySelector(${JSON.stringify(origin)}))`);await delay(250);
  await check(`document.activeElement?.matches(${JSON.stringify(origin)})`,'Header Back restores the same Home product control');
  await click('.sidebar button[aria-label="Store"]');await wait(`Boolean(document.querySelector('.catalog-card[data-product-id="9N431PX143P8"] button'))`);
  await click('.catalog-card[data-product-id="9N431PX143P8"] button');await wait(`Boolean(document.querySelector('.catalog-details-page[data-product-id="9N431PX143P8"]'))`);
  await check(`document.querySelector('.catalog-detail-actions .primary')?.textContent.includes('View in library')`,'Installed Store product exposes View in library');
  await click('.catalog-detail-actions .primary');await wait(`Boolean(document.querySelector('.game-details-page[data-gamepad-detail="demo-1"]'))`);await capture('installed-details');
  await check(`(()=>{const box=document.querySelector('.gd-hero-art')?.getBoundingClientRect();return box&&Math.abs(box.width-584)<1&&Math.abs(box.left-1109)<1;})()`,'Actual App installed hero retains 584px media at reference x1109');
  await check(`document.querySelector('.game-details-page')?.getAttribute('data-gamepad-detail')==='demo-1'&&window.__referenceSmoke.calls.some(call=>call.method==='getGameDetails'&&call.args[0]==='demo-1')`,'View in library selects exact installed game, not first library item');
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
  await click('.sidebar button[aria-label="Store"]');await wait(`Boolean(document.querySelector('.store-page'))`);
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
  await click('.sidebar button[aria-label="Store"]');await wait(`Boolean(document.querySelector('.store-page'))`);
  await click('.shell-back');await wait(`Boolean(document.querySelector(${JSON.stringify(origin)}))`);await delay(250);
  await check(`Math.abs(document.querySelector('.page-scroll').scrollTop-window.__referenceSmoke.scroll.saved)<2`,'Sidebar Back restores saved scroll without a product focus selector');
  await evaluate(`(()=>{const scroll=document.querySelector('.page-scroll');scroll.scrollTop=window.__referenceSmoke.scroll.next;scroll.firstElementChild.appendChild(document.createComment('Fixture child mutation verifies bounded history observer cleanup'));})()`);await delay(250);
  await check(`Math.abs(document.querySelector('.page-scroll').scrollTop-window.__referenceSmoke.scroll.next)<2`,'Later child mutation does not lock restored Sidebar scroll');

  await accountSettings();
  await evaluate(`localStorage.setItem('xboks.interface-language.v1','el');window.dispatchEvent(new Event('storage'));`);
  await click('#settings-tab-application');await capture('settings-application-el');
  await click('#settings-tab-install');await capture('settings-install-el');
  report.greekInstallLayout=await evaluate(`(()=>{const description=document.querySelector('.original-install-description')?.getBoundingClientRect();const location=document.querySelector('.original-install-settings select')?.getBoundingClientRect();return{descriptionHeight:description?.height,locationTop:location?.top};})()`);
  await click('#settings-tab-library');await wait(`document.querySelectorAll('.settings-reference-provider-card').length===5`);await capture('settings-library-el');
  const boundary=await evaluate(`({calls:window.__referenceSmoke.calls,forbidden:window.__referenceSmoke.forbidden,unexpected:window.__referenceSmoke.unexpected})`);
  Object.assign(report,boundary);report.checks.push({label:'No install/launch/account mutation was requested',passed:!report.forbidden.length,actual:report.forbidden});
  report.checks.push({label:'All requested launcher APIs are explicit fixtures',passed:!report.unexpected.length,actual:report.unexpected});
} catch(error) { report.error=error.stack??String(error);console.error(report.error); }
finally {
  if(inspectBoundary)try{Object.assign(report,await inspectBoundary());}catch{}
  report.finishedAt=new Date().toISOString();report.passed=report.checks.filter(check=>check.passed).length;report.failed=report.checks.filter(check=>!check.passed).length;
  await writeFile(join(output,'renderer-smoke-report.json'),`${JSON.stringify(report,null,2)}\n`);
  await writeFile(join(output,'README.txt'),'1920×1080 screenshots of the actual xboks React renderer, using explicit sample launcher APIs and generated SVG fixture artwork. No real account, backend, wallet, game install or Xbox service was contacted. These checks do not verify original Windows runtime behavior, operating-system Game Bar integration, service licensing, or pixel parity. See renderer-smoke-report.json for exact checks/API calls.\n');
  socket?.close();
  if(chrome){const exited=chrome.exitCode===null?new Promise(resolve=>chrome.once('exit',resolve)):Promise.resolve();chrome.kill('SIGTERM');await exited;}
  await server?.close();await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});
}
console.log(`Renderer fixture checks: ${report.passed} passed, ${report.failed} failed. Artifacts: ${output}`);
if(report.error||report.failed||report.browserErrors.length)process.exitCode=1;
