import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Sidebar,GlobalSearch,SettingsPage} from '/src/renderer/App.tsx';
import {ShellHeaderControls} from '/src/renderer/ShellHeaderControls.tsx';
import {CloudLibraryPage} from '/src/renderer/CloudLibrary.tsx';
import {ConfirmationProvider} from '/src/renderer/Confirmation.tsx';
import {CloudStreamHost} from '/src/renderer/CloudStream.tsx';
import {applyAppearance,loadAppearance} from '/src/renderer/appearance.ts';
import {GamepadNavigation} from '/src/renderer/GamepadNavigation.tsx';
import {demoSnapshot} from '/src/shared/demo-data.ts';
import {loadOriginalXboxUi,ChevronLeft} from '/src/renderer/XboxIcons.tsx';
import type {CloudProduct,CloudPublicCatalog,CloudStreamApi} from '/src/shared/cloud-library.ts';
import type {CloudSessionState,CloudAccountCatalog} from '/src/shared/cloud-stream.ts';
import type {AuthStatus,GameStoreDetails} from '/src/shared/types.ts';
import type {CloudLoginCountry} from '/src/shared/cloud-region.ts';
import type {PadAction} from '/src/renderer/gamepad-navigation.ts';
import '/src/renderer/styles.css';
import '/src/renderer/xbox-mode.css';
import '/src/renderer/xbox-shell.css';
import '/src/renderer/xbox-library.css';
import '/src/renderer/settings-frame.css';
loadOriginalXboxUi();
localStorage.setItem('xboks.interface-language.v1','en');applyAppearance(loadAppearance());
Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});
Object.defineProperty(document,'hasFocus',{configurable:true,value:()=>true});
Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[]});

let savedCountry:CloudLoginCountry='auto',countryAttempts:CloudLoginCountry[]=[],countryPersists:CloudLoginCountry[]=[],rejectCountrySave=false,deferCountrySave=false,finishCountrySave:(()=>void)|undefined,deferAccountRead=false,finishAccountRead:(()=>void)|undefined;
const inputs=new Set<(action:PadAction)=>void>(),listeners=new Set<(state:CloudSessionState)=>void>();
const calls:{method:string;ids?:string[];refresh?:boolean}[]=[],launches:string[]=[],stops:(string|undefined)[]=[],detailReads:string[]=[];
let detailsById:Record<string,Partial<GameStoreDetails>>={};
let products:CloudProduct[]=[],catalog:CloudPublicCatalog,accountSignedIn=true,failPublic=true,publicReads=0,accountReads=0,outerBack=0,signIns=0;
let session:CloudSessionState={phase:'closed'},deferStart=false,finishStart:(()=>void)|undefined,deferStop=false,finishStop:(()=>void)|undefined;
let deferDetails=false;const pendingDetails=new Map<string,(value:GameStoreDetails)=>void>();
let updateAuth:(value:AuthStatus)=>void,updateMount:(value:boolean)=>void,showApplicationSettings:(value:boolean)=>void;
const accountTitles=()=>products.map((product,index)=>({productId:product.productId,titleId:`fixture-title-${index}`,hasEntitlement:index!==products.length-1,supportedInputTypes:index%2?['controller']:['controller','touch'],programs:['fixture-only']}));
const account=():CloudAccountCatalog=>({status:accountSignedIn?'ready':'signed-out',titles:accountSignedIn?accountTitles():[],recentProductIds:accountSignedIn?products.slice(0,5).map(product=>product.productId):[],checkedAt:'2026-10-22T00:00:00Z'});
const emit=(value:CloudSessionState)=>{session=value;for(const callback of listeners)callback(structuredClone(value));};
const bridge:CloudStreamApi&{getCatalogDetails:(id:string)=>Promise<GameStoreDetails>}={
 getCloudPublicCatalog:async refresh=>{publicReads++;calls.push({method:'public',refresh});if(failPublic)throw Error('Synthetic public catalog outage');return structuredClone(catalog);},
 getCloudProducts:async ids=>{calls.push({method:'products',ids});return structuredClone(products.filter(product=>ids.includes(product.productId)));},
 getCloudAccountCatalog:async refresh=>{accountReads++;calls.push({method:'account',refresh});if(deferAccountRead)await new Promise<void>(resolve=>{finishAccountRead=resolve;});return structuredClone(account());},
 getCatalogDetails:async id=>{detailReads.push(id);const product=products.find(item=>item.productId===id)!;if(deferDetails)return new Promise(resolve=>pendingDetails.set(id,resolve));return{productId:id,title:product.title,publisher:product.publisher,description:`Sample detail response for ${product.title}. This fixture cannot contact an account or start an Xbox stream.`,categories:product.categories,screenshots:[],...detailsById[id]};},
 startCloudStream:async productId=>{launches.push(productId);if(deferStart)await new Promise<void>(resolve=>{finishStart=resolve;});const value:CloudSessionState={phase:'queued',id:'fixture-owned-session',productId,waitSeconds:120};emit(value);return structuredClone(value);},
 getCloudStreamState:async()=>structuredClone(session),
 onCloudStreamState:callback=>{listeners.add(callback);return()=>listeners.delete(callback);},
 stopCloudStream:async id=>{stops.push(id);if(deferStop)await new Promise<void>(resolve=>{finishStop=resolve;});if(session.id===id)emit({phase:'closed'});},
 exchangeCloudSdp:async()=>{throw Error('No SDP or network transport is allowed in this fixture.');},
 exchangeCloudIce:async()=>{throw Error('No ICE or network transport is allowed in this fixture.');},
};
(window as any).launcher={...bridge,onOperationLog:()=>()=>{},getWindowFullscreen:async()=>false,onWindowFullscreenChanged:()=>()=>{},onXboxModeEntryRequested:()=>()=>{},getBatteryPercentage:async()=>null,getBatteryStatus:async()=>({percentage:null,charging:false,externalPower:true}),getFullscreenExperience:async()=>({active:false,available:false,source:'none'})};
const snapshot=demoSnapshot();snapshot.auth={running:false,stored:true,username:'cloud-preview@example.invalid',gamertag:'Cloud Preview',note:'Isolated sample account'};snapshot.games=[];snapshot.downloads=[];
function Harness(){const[auth,setAuth]=useState(snapshot.auth),[mount,setMount]=useState(true),[query,setQuery]=useState(''),[country,setCountry]=useState<CloudLoginCountry>('auto'),[application,setApplication]=useState(false);showApplicationSettings=setApplication;const saveCountry=async(value:CloudLoginCountry)=>{countryAttempts.push(value);if(rejectCountrySave)throw Error('PRIVATE_COUNTRY_FAILURE');if(deferCountrySave)await new Promise<void>(resolve=>{finishCountrySave=resolve;});savedCountry=value;countryPersists.push(value);setCountry(value);};(window as any).launcher.updateSettings=async(patch:any)=>{if(!patch.cloudLoginCountry)throw Error('Only the fixture cloud-country preference is writable');await saveCountry(patch.cloudLoginCountry);return{...snapshot.settings,cloudLoginCountry:patch.cloudLoginCountry};};updateAuth=setAuth;updateMount=setMount;
 return <><div className="app-shell xbox-mode"><Sidebar data={{...snapshot,auth}} page="cloud" go={()=>{}} onPanel={()=>{}}/><section className="content-shell"><header className="topbar"><button className="shell-back" aria-label="Back" onClick={()=>{}}><ChevronLeft/></button><div className="shell-version">XBOKS · Cloud UI preview</div><GlobalSearch games={[]} page="cloud" query={query} change={setQuery} submit={()=>{}} select={()=>{}}/><ShellHeaderControls sessionFullscreen={false} integrationAvailable={false} onError={()=>{}}/></header><div className="page-scroll">{mount?<CloudLibraryPage bridge={bridge} auth={auth} signIn={()=>signIns++} country={country} saveCountry={saveCountry}/>:null}</div></section></div>{mount?<CloudStreamHost bridge={bridge}/>:null}{application?<ConfirmationProvider><SettingsPage data={{...snapshot,auth,settings:{...snapshot.settings,cloudLoginCountry:country}}} initialSection="application" toast={()=>{}} close={()=>setApplication(false)}/></ConfirmationProvider>:null}<GamepadNavigation activateOnFocus nativeControlsActive subscribeInput={callback=>{inputs.add(callback);return()=>inputs.delete(callback);}} back={()=>outerBack++} page={()=>{}}/></>;
}
const mark=document.createElement('div');mark.textContent='ACTUAL XBOKS CLOUD UI · Public artwork · Sample account/access/SSO/session · No Xbox stream';Object.assign(mark.style,{position:'fixed',bottom:'12px',right:'16px',zIndex:'10000',background:'#132331',color:'#cce4f2',padding:'8px 12px',font:'13px sans-serif',pointerEvents:'none'});document.body.append(mark);
const pause=()=>new Promise(resolve=>setTimeout(resolve,120)),checks:string[]=[];
const check=(value:unknown,label:string)=>{if(!value)throw Error(`${label}; focus=${document.activeElement?.outerHTML.slice(0,220)}`);checks.push(label);};
const wait=async(test:()=>unknown,label:string)=>{for(let attempt=0;attempt<100;attempt++){if(test())return;await pause();}throw Error('Timed out: '+label);};
const click=(selector:string)=>{const target=document.querySelector<HTMLElement>(selector);if(!target||target.matches(':disabled'))throw Error('Unavailable '+selector);target.focus();target.click();};
const native=async(action:PadAction)=>{for(const callback of inputs)callback(action);await pause();};
const capture=async(name:string)=>{document.querySelector('.page-scroll')?.scrollTo(0,0);if(typeof(window as any).__captureFixture==='function')await(window as any).__captureFixture(name);};
const tab=async(index:number)=>{click(`.cloud-library-tabs button:nth-child(${index+1})`);await pause();};
const field=(selector:string,value:string)=>{const node=document.querySelector<HTMLInputElement|HTMLSelectElement>(selector)!;const prototype=node.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value')!.set!.call(node,value);node.dispatchEvent(new Event(node.tagName==='SELECT'?'change':'input',{bubbles:true}));};
const tiles=()=>[...document.querySelectorAll<HTMLButtonElement>('.cloud-library-grid .cloud-product[data-product-id]')];
const dialog=()=>document.querySelector<HTMLElement>('.cloud-product-detail');
const signOut=()=>{accountSignedIn=false;emit({phase:'closed'});updateAuth({running:false,stored:false,note:'Fixture signed out; no real token was present'});};
void (async()=>{const data=await(await fetch('/__cloud-fixture-data.json')).json();products=data.products;catalog=data.catalog;detailsById=data.detailsById??{};createRoot(document.getElementById('root')!).render(<Harness/>);})();
(window as any).runCloudLibraryChecks=async()=>{
 await wait(()=>document.querySelector('.cloud-library-error'),'initial outage');
 check(publicReads===1&&accountReads===1&&launches.length===0&&stops.length===0,'initial browsing reads catalog/account without starting or stopping a stream');
 check(document.querySelector('.sidebar [aria-current="page"]')?.getAttribute('aria-label')==='Cloud gaming','the actual production sidebar selects Cloud gaming');
 check(document.querySelector('.sidebar')?.getBoundingClientRect().width===68,'fixture uses the same production68px navigation rail and shell CSS as the main entry');
 check(document.querySelector('.cloud-library-error')?.textContent?.includes('could not load')&&!document.body.textContent?.includes('Synthetic public catalog outage'),'catalog failure presents localized Retry without raw adapter diagnostics');
 failPublic=false;click('.cloud-library-error button');await wait(()=>document.querySelectorAll('.cloud-game-row .cloud-product[data-product-id]').length>8,'home catalog');
 check(calls.some(call=>call.method==='public'&&call.refresh)&&calls.some(call=>call.method==='account'&&call.refresh),'Retry refreshes both public metadata and the current account');
 check(document.querySelector('.cloud-account-status')?.textContent?.includes('Ready to play with your XBOKS account'),'readiness reflects the synthetic account response');
 check(['mru','popular','recent','ea','own'].every(key=>document.querySelector('.cloud-game-row-'+key)),'cloud home exposes recent, popular, added, EA and stream-own sections');
 check(launches.length===0,'loading home rows and images never auto-starts a cloud session');
 await capture('xboks-cloud-gaming');
 const region=()=>document.querySelector<HTMLElement>('.cloud-region-dialog');
 click('.cloud-region-trigger');await pause();
 check(region()&&document.querySelector<HTMLSelectElement>('.cloud-region-dialog select')?.value==='auto'&&countryAttempts.length===0,'opening cloud settings defaults to Automatic and performs no persistence or sign-in');
 check(JSON.stringify([...document.querySelectorAll<HTMLOptionElement>('.cloud-region-dialog option')].map(option=>option.value))===JSON.stringify(['auto','pl','us','br','jp','kr']),'country choices expose only the supported Automatic/Poland/US/Brazil/Japan/Korea values');
 check(region()?.textContent?.includes('does not change your network route or subscription'),'country copy explains login compatibility without claiming a VPN or subscription change');
 await native('accept');await pause();const countryPicker=document.querySelector<HTMLElement>('.gamepad-select-dialog');check(Boolean(countryPicker),'controller A opens the country selector above its settings scope');
 const countryOption=countryPicker!.querySelector<HTMLElement>('button')!,countryRect=countryOption.getBoundingClientRect();check(document.elementFromPoint(countryRect.x+countryRect.width/2,countryRect.y+countryRect.height/2)?.closest('.gamepad-select-dialog')===countryPicker,'country gamepad picker is visually above the settings backdrop, not merely focused behind it');
 await native('down');await native('back');check(!document.querySelector('.gamepad-select-dialog')&&Boolean(region())&&countryAttempts.length===0,'controller B closes only the country picker without persisting its highlight');
 await native('back');check(!region()&&document.activeElement?.classList.contains('cloud-region-trigger')&&document.querySelector('[data-cloud-page]')?.getAttribute('data-cloud-page')==='home'&&outerBack===0,'a second B closes only cloud settings and restores its trigger without changing the cloud route');
 click('.cloud-region-trigger');await pause();field('.cloud-region-dialog select','us');click('.cloud-region-dialog footer button:first-child');await pause();check(!region()&&savedCountry==='auto'&&countryPersists.length===0,'Cancel discards a draft country without saving');
 click('.cloud-region-trigger');await pause();check(document.querySelector<HTMLSelectElement>('.cloud-region-dialog select')?.value==='auto','reopening settings restores the persisted value rather than the cancelled draft');field('.cloud-region-dialog select','pl');await pause();await capture('xboks-cloud-settings');click('.cloud-region-dialog footer button:first-child');await pause();
 rejectCountrySave=true;click('.cloud-region-trigger');await pause();field('.cloud-region-dialog select','us');click('.cloud-region-dialog footer .primary');await pause();check(region()?.querySelector('[role="alert"]')?.textContent?.includes('could not be saved')&&!region()?.textContent?.includes('PRIVATE_COUNTRY_FAILURE')&&savedCountry==='auto'&&countryPersists.length===0,'rejected country save stays in the dialog with a safe error and preserves the previous value');rejectCountrySave=false;await native('back');
 click('.cloud-region-trigger');await pause();field('.cloud-region-dialog select','pl');deferCountrySave=true;deferAccountRead=true;const previousCountryAttempts=countryAttempts.length,previousCountryReads=accountReads;click('.cloud-region-dialog footer .primary');document.querySelector<HTMLButtonElement>('.cloud-region-dialog footer .primary')!.click();await pause();check(countryAttempts.length===previousCountryAttempts+1&&Boolean(finishCountrySave)&&[...region()!.querySelectorAll<HTMLButtonElement|HTMLSelectElement>('button,select')].every(control=>control.disabled),'pending Save is serialized and disables repeated dialog actions');await native('back');check(Boolean(region())&&savedCountry==='auto','Back cannot claim cancellation after country saving has been dispatched');finishCountrySave!();deferCountrySave=false;await wait(()=>!region()&&accountReads>previousCountryReads,'new country account read');
 check(savedCountry==='pl'&&JSON.stringify(countryPersists)===JSON.stringify(['pl'])&&document.querySelector('.cloud-account-status')?.textContent?.includes('Connecting'),'only explicit successful Save changes the country and starts a fresh account availability read');
 document.querySelector<HTMLButtonElement>('.cloud-game-row-popular .cloud-product[data-product-id]')!.click();await pause();check(document.querySelector<HTMLButtonElement>('.cloud-detail-actions .primary')?.disabled===true&&launches.length===0,'country change invalidates previous Play readiness while its account check is pending');click('.cloud-detail-back');deferAccountRead=false;finishAccountRead!();await wait(()=>document.querySelector('.cloud-account-status')?.textContent?.includes('Ready to play'),'fresh country account readiness');check(launches.length===0,'changing cloud country and refreshing its account never starts a game automatically');
 showApplicationSettings(true);await wait(()=>document.querySelector('.cloud-region-inline'),'Application cloud entry');check(document.querySelector('.cloud-region-inline')?.textContent?.includes('Country for cloud sign-in: Poland'),'actual Application Settings embeds the inline cloud entry with the persisted country');const beforeInline=countryAttempts.length;click('.cloud-region-inline .cloud-region-trigger');await pause();check(document.querySelector<HTMLSelectElement>('.cloud-region-dialog select')?.value==='pl','Application Settings opens the same actual country dialog with the saved value');await native('back');check(!region()&&Boolean(document.querySelector('.xbox-settings-dialog'))&&countryAttempts.length===beforeInline,'Back from the inline cloud dialog leaves Application Settings open and performs no save');await native('back');await pause();check(!document.querySelector('.xbox-settings-dialog')&&outerBack===0,'a second Back closes Application Settings without leaving the underlying cloud route');
 await tab(2);await wait(()=>tiles().length===catalog.collections.own.length,'own products');
 check(document.querySelector('.cloud-library-header h1')?.textContent==='Stream your own game','the own-game route uses its in-app header rather than a web page');
 check(tiles().every(tile=>products.some(product=>product.productId===tile.dataset.productId&&tile.textContent?.includes(product.title))),'each rendered card retains the exact product ID and its own title');
 await capture('xboks-cloud-own-games');
 document.querySelector<HTMLSelectElement>('.cloud-library-controls select')!.focus();await native('accept');check(Boolean(document.querySelector('.gamepad-select-dialog')),'controller A opens the sort picker in its own modal scope');await native('down');await native('accept');check(document.querySelector<HTMLSelectElement>('.cloud-library-controls select')!.value==='name'&&!document.querySelector('.gamepad-select-dialog'),'controller direction and A choose A–Z and close only the picker');await pause();const titleOrder=tiles().map(tile=>products.find(product=>product.productId===tile.dataset.productId)!.title);
 check(JSON.stringify(titleOrder)===JSON.stringify([...titleOrder].sort((a,b)=>a.localeCompare(b))),'A–Z sorts the loaded cards without mixing their IDs');
 click('.cloud-library-controls button');await pause();field('.cloud-library-filters input',products[2].title);await pause();
 check(tiles().length===1&&tiles()[0].dataset.productId===products[2].productId,'search filters loaded cloud products by their exact title');
 field('.cloud-library-filters input','');field('.cloud-library-filters select','touch');await pause();
 check(tiles().length>0&&tiles().every(tile=>accountTitles().find(title=>title.productId===tile.dataset.productId)?.supportedInputTypes.includes('touch')),'input filtering uses the returned account title capabilities');
 field('.cloud-library-filters select','all');field('.cloud-library-controls select','relevance');await pause();
 const first=tiles()[0];first.focus();await native('right');check(document.activeElement!==first&&launches.length===0,'controller movement changes focus without starting a game');first.focus();await native('accept');await pause();
 check(Boolean(dialog())&&dialog()?.getAttribute('data-gamepad-detail')===first.dataset.productId&&detailReads.at(-1)===first.dataset.productId,'controller A opens product-specific in-app details');
 check(launches.length===0&&document.querySelector<HTMLButtonElement>('.cloud-detail-actions .primary')?.disabled===false,'opening details only enables the explicit Play action');
 await capture('xboks-cloud-game-details');
 await native('back');check(!dialog()&&document.activeElement===first&&outerBack===0,'controller B dismisses details, restores its card, and leaves the cloud route open');
 deferDetails=true;const productA=tiles()[0].dataset.productId!,productB=tiles()[1].dataset.productId!;tiles()[0].click();await pause();click('.cloud-detail-back');await pause();tiles()[1].click();await pause();
 pendingDetails.get(productA)?.({productId:productA,title:'stale fixture response',description:'STALE_DETAIL_MUST_NOT_APPEAR',categories:[],screenshots:[]});await pause();
 check(dialog()?.getAttribute('data-gamepad-detail')===productB&&!dialog()?.textContent?.includes('STALE_DETAIL'),'late detail response from the previous product cannot overwrite the current product');
 deferDetails=false;click('.cloud-detail-back');await pause();
 const denied=products.at(-1)!;document.querySelector<HTMLButtonElement>(`.cloud-product[data-product-id="${denied.productId}"]`)!.click();await pause();
 check(document.querySelector<HTMLButtonElement>('.cloud-detail-actions .primary')?.disabled&&dialog()?.textContent?.includes('does not have access'),'an explicit entitlement denial disables Play with its reason');
 click('.cloud-detail-back');await pause();tiles()[0].click();await pause();const chosen=dialog()!.getAttribute('data-gamepad-detail')!;deferStart=true;click('.cloud-detail-actions .primary');document.querySelector<HTMLButtonElement>('.cloud-detail-actions .primary')!.click();await pause();
 check(launches.length===1&&launches[0]===chosen&&Boolean(finishStart),'only explicit Play starts the selected product and serializes repeated activation');
 finishStart!();deferStart=false;await wait(()=>document.querySelector('[data-cloud-session-phase="queued"]'),'sample queue');
 check(document.documentElement.dataset.cloudStreamInput==='menu'&&document.querySelector('.cloud-stream-host')?.textContent?.includes('Waiting for your turn'),'the account session response displays the native queue host and reserves menu input');
 check(!document.querySelector('.cloud-stream-video video'),'queued fixture state does not fabricate a connected video stream');
 await capture('xboks-cloud-session-queue');
 deferStop=true;click('.cloud-stream-loading>button');document.querySelector<HTMLButtonElement>('.cloud-stream-loading>button')!.click();await pause();check(stops.length===1&&stops[0]==='fixture-owned-session','ending a queued session is serialized and bound to its local session capability');
 finishStop!();deferStop=false;await wait(()=>!document.querySelector('.cloud-stream-host'),'closed queue');
 check(!document.documentElement.hasAttribute('data-cloud-stream-input'),'closing a session releases the streaming input scope');
 emit({phase:'queued',id:'fixture-old-session',productId:chosen,waitSeconds:90});await pause();deferStop=true;click('.cloud-stream-loading>button');await pause();emit({phase:'closed'});emit({phase:'queued',id:'fixture-newer-session',productId:productB,waitSeconds:30});await pause();finishStop!();deferStop=false;await pause();check(Boolean(document.querySelector('.cloud-stream-host'))&&session.id==='fixture-newer-session'&&document.querySelector('.cloud-stream-loading h1')?.textContent===products.find(product=>product.productId===productB)?.title,'a late old stop acknowledgement cannot hide a newer native cloud session');emit({phase:'closed'});await pause();
 signOut();await pause();await pause();check(!dialog()&&document.querySelector('.cloud-account-status')?.textContent?.includes('Sign in to XBOKS to play'),'account change clears the selected account detail and presents signed-out readiness');
 await tab(0);check(!document.querySelector('.cloud-game-row-mru'),'old account recent games disappear after sign-out');
 await tab(2);await wait(()=>tiles().length>0,'signed-out public own catalog');tiles()[0].click();await pause();check(document.querySelector<HTMLButtonElement>('.cloud-detail-actions .primary')?.disabled===true&&launches.length===1,'public browsing after logout cannot reuse the old account access or auto-start');
 click('.cloud-detail-back');await pause();await tab(0);click('.cloud-account-status button');await pause();check(signIns===1&&launches.length===1,'sign-in is an explicit launcher action and does not start a game');
 updateMount(false);await pause();check(listeners.size===0,'unmount removes the cloud session subscription');
 return{checks,passed:checks.length,calls,launches,stops,detailReads,countryAttempts,countryPersists,realXboxRequests:false,realCredentials:false,realSsoPurged:false,syntheticAccountInvalidation:true,realStreamStarted:false,realController:false};
};
