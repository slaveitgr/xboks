/** Offline full-App regression boundary. All account, service and media state below is simulated. */
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
/** State and media are deliberately simulated; the full App and both hosts are real. */
const sessionListeners = {cloud:new Set(),console:new Set()};
const sessionState = {cloud:{phase:'closed'},console:{phase:'closed'}};
const nextOptions = {cloud:{},console:{}};
let sessionSerial = 0;
const streamFixture = window.__streamFixture = {
 records:[],events:[],players:[],pendingReads:[],pendingStops:[],pendingSdp:[],
 configure(kind,options){nextOptions[kind]={...options};},
 listen(kind,listener){sessionListeners[kind].add(listener);return()=>sessionListeners[kind].delete(listener);},
 emit(kind,state){sessionState[kind]=structuredClone(state);this.events.push({kind,id:state.id,phase:state.phase,event:'push'});for(const listener of sessionListeners[kind])listener(structuredClone(state));},
 begin(kind,product){
  const options={readyAfter:3,...nextOptions[kind]},id=`fixture-${kind}-${++sessionSerial}`;
  nextOptions[kind]={};
  const record={kind,id,product,options,polls:0,sdp:0,ice:0,stops:0};this.records.push(record);
  const state={id,phase:'provisioning',...(kind==='cloud'?{productId:product}:{consoleId:product})};
  record.state=state;this.emit(kind,state);return structuredClone(state);
 },
 async read(kind,id){
  if(!id)return structuredClone(sessionState[kind]);
  const record=this.records.find(record=>record.kind===kind&&record.id===id);
  if(!record)throw Error('Unknown isolated fixture session');
  record.polls++;
  const value={...record.state,phase:record.polls>=record.options.readyAfter?'ready':'provisioning'};
  // Match main: publish BEFORE the invoke promise resolves, including same-phase pushes.
  this.emit(kind,record.options.deferPoll?record.state:value);
  const reply=()=>{this.events.push({kind,id,phase:value.phase,event:'reply'});return structuredClone(value);};
  if(record.options.deferPoll)return new Promise(resolve=>this.pendingReads.push({kind,id,resolve:()=>resolve(reply())}));
  await Promise.resolve();return reply();
 },
 async stop(kind,id){
  const record=this.records.find(record=>record.kind===kind&&record.id===id);if(record)record.stops++;
  const finish=()=>{if(sessionState[kind].id===id)this.emit(kind,{phase:'closed'});return{phase:'closed'};};
  if(record?.options.deferStop)return new Promise(resolve=>this.pendingStops.push({kind,id,resolve:()=>resolve(finish())}));
  return finish();
 },
 async sdp(kind,id,sdp){
  const record=this.records.find(record=>record.kind===kind&&record.id===id);if(!record)throw Error('Unexpected fixture SDP');
  record.sdp++;this.events.push({kind,id,event:'sdp',offerPresent:typeof sdp==='string'&&sdp.startsWith('fixture-offer')});
  if(record.options.deferSdp)await new Promise(resolve=>this.pendingSdp.push({kind,id,resolve}));
  return'fixture-answer';
 },
 async ice(kind,id,candidates){
  const record=this.records.find(record=>record.kind===kind&&record.id===id);if(!record)throw Error('Unexpected fixture ICE');
  record.ice++;this.events.push({kind,id,event:'ice',candidates:candidates.length});
  return[{candidate:'a=end-of-candidates',sdpMid:'0',sdpMLineIndex:0}];
 },
 async createPlayer(container,config){
  const kind=container==='xboks-console-video'?'console':'cloud',id=sessionState[kind].id;
  const listeners=new Map(),record={kind,id,closed:false,binds:0,offers:0,local:0,remote:0,ice:0,video:false};this.players.push(record);
  let node;
  const bus={on(name,listener){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(listener);},removeListener(name,listener){listeners.get(name)?.delete(listener);}};
  const emit=(name,value)=>{for(const listener of listeners.get(name)??[])listener(value);};
  const showVideo=()=>setTimeout(()=>{
   if(record.closed||sessionState[kind].id!==id)return;
   emit('connectionstate',{state:'connected'});
   node=document.createElement('video');node.dataset.fixtureSession=id;node.setAttribute('aria-label','Simulated video event: no media is decoded');
   Object.defineProperties(node,{videoWidth:{value:1920},videoHeight:{value:1080}});
   document.getElementById(container)?.append(node);
   setTimeout(()=>{if(!record.closed&&node?.isConnected){record.video=true;node.dispatchEvent(new Event('playing'));}},40);
  },30);
  const peer={iceGatheringState:'complete',
   async createOffer(){record.offers++;return{type:'offer',sdp:'fixture-offer useinbandfec=1'};},
   async setLocalDescription(){record.local++;},async setRemoteDescription(){record.remote++;},
   addEventListener(){},removeEventListener(){},async addIceCandidate(){record.ice++;showVideo();},close(){}
  };
  const player={_webrtcClient:peer,getEventBus:()=>bus,bind(){record.binds++;config.input_driver.setApplication(player);},getIceCandidates:()=>[],getChannelProcessor:()=>({sendTransaction(){}}),close(){record.closed=true;node?.remove();listeners.clear();}};
  return player;
 }
};
const handlers = {
 getCloudPublicCatalog:async()=>({collections:{all:cloudIds,own:cloudData.products.slice(0,10).map(p=>p.productId),popular:cloudData.products.slice(0,8).map(p=>p.productId),recent:cloudData.products.slice(3,11).map(p=>p.productId),ea:cloudData.products.slice(7,11).map(p=>p.productId)},checkedAt:'2026-10-22T00:00:00Z'}),
 getCloudAccountCatalog:async()=>{const probe=window.__cloudLayout,result={status:'ready',titles:cloudIds.map(productId=>({productId,hasEntitlement:probe.entitled,supportedInputTypes:['controller']})),recentProductIds:cloudData.products.slice(0,5).map(p=>p.productId),checkedAt:'2026-10-22T00:00:00Z'};if(probe.deferAccount)return new Promise(resolve=>probe.accountRequests.push(()=>resolve(result)));return result;},
 startCloudStream:async productId=>{window.__cloudLayout.launches.push(productId);return window.__streamFixture.begin('cloud',productId);},
 getCloudProducts:async ids=>{const probe=window.__cloudLayout;probe.active++;probe.maxActive=Math.max(probe.maxActive,probe.active);probe.reads.push(ids);try{if(probe.defer)await new Promise(resolve=>probe.pending.push(resolve));else await new Promise(resolve=>setTimeout(resolve,180));return cloudProducts.filter(product=>ids.includes(product.productId));}finally{probe.active--; }},
 getCloudStreamState:id=>window.__streamFixture.read('cloud',id),onCloudStreamState:listener=>window.__streamFixture.listen('cloud',listener),
 stopCloudStream:id=>window.__streamFixture.stop('cloud',id),exchangeCloudSdp:(id,sdp)=>window.__streamFixture.sdp('cloud',id,sdp),exchangeCloudIce:(id,candidates)=>window.__streamFixture.ice('cloud',id,candidates),
 getConsoleStreamState:id=>window.__streamFixture.read('console',id),onConsoleStreamState:listener=>window.__streamFixture.listen('console',listener),onConsoleLibraryOpen:()=>()=>{},
 getConsoleStreamDevices:async()=>({status:'ready',consoles:[{id:'00000000-0000-4000-a000-000000000001',name:'Sample One X · fixture',consoleType:'Xbox One X',powerState:'on',canStream:true,canWake:false}],checkedAt:'2026-10-22T00:00:00Z'}),
 startConsoleStream:id=>window.__streamFixture.begin('console',id),stopConsoleStream:id=>window.__streamFixture.stop('console',id),
 exchangeConsoleStreamSdp:(id,sdp)=>window.__streamFixture.sdp('console',id,sdp),exchangeConsoleStreamIce:(id,candidates)=>window.__streamFixture.ice('console',id,candidates),

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
const watermark=document.createElement('div');watermark.textContent='ACTUAL APP REGRESSION FIXTURE · Simulated service state, peer, video event and sample account · No real stream or host actions';Object.assign(watermark.style,{position:'fixed',bottom:'12px',right:'16px',zIndex:'10000',background:'#132331',color:'#cce4f2',padding:'8px 12px',font:'13px sans-serif',pointerEvents:'none'});document.body.append(watermark);
