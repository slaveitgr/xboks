import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GuideOverlay, guideWindowFullscreenAvailable, handleGuideBack, toggleGuideWindowFullscreen, type GuideFullscreenSurface, type GuideTab } from './GuideOverlay';
import { registerBackHandler } from './gamepad-navigation';
import { demoSnapshot } from '../shared/demo-data';
const render = (tab: GuideTab, data = demoSnapshot(), requestXboxModeEntry?: () => Promise<void>) => renderToStaticMarkup(<GuideOverlay data={data} tab={tab} setTab={() => {}} close={() => {}} go={() => {}} openGame={() => {}} requestXboxModeEntry={requestXboxModeEntry} />);
afterEach(()=>vi.unstubAllGlobals());

it('exposes modal/controller close semantics and a selected tab', () => {
  const html = render('home');
  expect(html).toContain('aria-modal="true"'); expect(html).toContain('data-gamepad-cancel');
  expect(html.match(/aria-selected="true"/g)).toHaveLength(1); expect(html).toContain('No recently played games for this account.');
  expect(html).toContain('B Back'); expect(html).toContain('Win + G when configured');
});
it.each(['home','settings','browser','social','audio','capture','widgets'] as const)('marks the selected %s toolbar tab as the initial controller target', tab => {
  const html = render(tab);
  const initial = [...html.matchAll(/<button\b[^>]*data-gamepad-initial=""[^>]*>/g)].map(match => match[0]);
  expect(initial).toHaveLength(1); expect(initial[0]).toContain(`id="guide-tab-${tab}"`); expect(initial[0]).toContain('aria-selected="true"');
});
it('shows actual foreground application separately from owned games and does not fabricate recent play', () => {
  const data = demoSnapshot(); data.guideForeground = { desktopId: 'fixture-browser.desktop', name: 'Fixture browser', title: 'Fixture document' };
  const html = render('home', data);
  expect(html).toContain('Active application'); expect(html).toContain('Fixture browser'); expect(html).toContain('Fixture document');
  expect(html).toContain('aria-label="Return to Fixture browser"'); expect(html).toContain('data-guide-return-to-app');
  expect(html).toContain('No recently played games for this account.');
  for (const game of data.games) expect(html).not.toContain(game.title);
  expect(html.indexOf('guide-active-application')).toBeLessThan(html.indexOf('guide-action-pair'));
});
it('shows capability limits rather than fictitious social data or a stale signed-out profile', () => {
  const data=demoSnapshot(); data.auth.stored=false; data.auth.gamertag='StalePlayer';
  const html = render('social',data);
  expect(html).toContain('Sign in to your Xbox account to load friends and chats'); expect(html).toContain('Xbox party voice is not available in this version.'); expect(html).not.toContain('Online (');
  expect(html).toContain('Not signed in'); expect(html).not.toContain('StalePlayer');
});
it('labels capture as the XBOKS window and disables it when the capture adapter is unavailable', () => {
  const html = render('capture');
  expect(html).toContain('Captures the XBOKS window without this overlay');
  expect(html).toContain('Game video recording and capture outside XBOKS are not connected yet');
  expect(html).toMatch(/class="guide-wide guide-capture" disabled=""/);
  const capture=vi.fn(); vi.stubGlobal('window',{location:{hash:'#desktop-guide'},launcher:{captureLauncher:capture}});
  expect(render('capture')).not.toMatch(/class="guide-wide guide-capture" disabled=""/);
  expect(capture).not.toHaveBeenCalled();
});
it('renders settings safely without a browser bridge and distinguishes window fullscreen from the OS session',()=>{
  const data=demoSnapshot(); data.desktopSettings={canSetAutostart:true,fullscreenExperience:true,fullscreenExperienceSource:'environment'};
  const html=render('settings',data);
  expect(html).toContain('Enter window fullscreen');
  expect(html).toContain('Fullscreen Experience is managed by the gaming session.');
  expect(html).not.toContain('Fullscreen Experience settings');
  expect(html).toMatch(/<button[^>]*data-guide-fullscreen="[^"]*"[^>]*disabled=""/);
});
it('offers the launcher Xbox mode dialog from desktop Game Bar without invoking entry while rendering',()=>{
  vi.stubGlobal('window',{location:{hash:'#desktop-guide'},desktopGuide:{navigate:vi.fn()}});
  const request=vi.fn(async()=>{}),html=render('settings',demoSnapshot(),request);
  expect(html).toContain('Enter Xbox mode'); expect(html).not.toContain('Open app settings');
  expect(html).not.toContain('Enter window fullscreen'); expect(html).not.toContain('Exit window fullscreen');
  const fullscreenControl=html.match(/<button\b[^>]*data-guide-fullscreen[^>]*>/)?.[0];
  expect(fullscreenControl).toBeDefined(); expect(fullscreenControl).not.toContain('disabled');
  expect(request).not.toHaveBeenCalled();
});
it('disables desktop entry when its trusted launcher route is absent',()=>{
  vi.stubGlobal('window',{location:{hash:'#desktop-guide'},desktopGuide:{navigate:vi.fn()}});
  const html=render('settings');
  expect(html).toContain('Enter Xbox mode');
  expect(html.match(/<button\b[^>]*data-guide-fullscreen[^>]*>/)?.[0]).toContain('disabled');
});
it('does not identify the main app as the desktop guide merely because both expose the same bridge',()=>{
  vi.stubGlobal('window',{location:{hash:''},desktopGuide:{navigate:vi.fn()}});
  const html=render('settings'); expect(html).toContain('Enter window fullscreen'); expect(html).not.toContain('Open app settings');
});
it('localizes visible guide labels, capability explanations, hints and browser controls in Greek',()=>{
  vi.stubGlobal('localStorage',{getItem:()=> 'el'});
  const home=render('home');
  for(const label of ['Αρχική οθόνη','Βιβλιοθήκη','Ουρά εγκατάστασης','Κλείσιμο Game Bar','B Πίσω','Win + G εφόσον ρυθμιστεί']) expect(home).toContain(label);
  expect(render('settings')).toContain('Περισσότερες ρυθμίσεις');
  expect(render('audio')).toContain('Τοπική δοκιμή μικροφώνου');
  expect(render('audio')).toContain('Μείκτης εφαρμογών');
  expect(render('capture')).toContain('Λήψη στιγμιότυπου');
  expect(render('browser')).toContain('Αναζήτηση στο Web');
  expect(render('social')).toContain('Η φωνητική ομάδα Xbox δεν είναι διαθέσιμη σε αυτήν την έκδοση.');
});

describe('Guide window fullscreen boundary',()=>{
  function fixture():GuideFullscreenSurface {
    return {fullscreenElement:null,fullscreenEnabled:true,exitFullscreen:vi.fn(async()=>{}),documentElement:{requestFullscreen:vi.fn(async()=>{})}};
  }
  it('enters and exits only the inline document fullscreen API',async()=>{
    const doc=fixture(); expect(guideWindowFullscreenAvailable(doc,false)).toBe(true);
    await expect(toggleGuideWindowFullscreen(doc,false)).resolves.toBe(true);
    expect(doc.documentElement.requestFullscreen).toHaveBeenCalledOnce(); expect(doc.exitFullscreen).not.toHaveBeenCalled();
    doc.fullscreenElement={};
    await expect(toggleGuideWindowFullscreen(doc,false)).resolves.toBe(true); expect(doc.exitFullscreen).toHaveBeenCalledOnce();
  });
  it('never calls document fullscreen for the separate desktop overlay',async()=>{
    const doc=fixture(); doc.fullscreenElement={};
    expect(guideWindowFullscreenAvailable(doc,true)).toBe(false);
    await expect(toggleGuideWindowFullscreen(doc,true)).resolves.toBe(false);
    expect(doc.exitFullscreen).not.toHaveBeenCalled(); expect(doc.documentElement.requestFullscreen).not.toHaveBeenCalled();
  });
  it('returns the main launcher to desktop through the native bridge from the separate guide',async()=>{
    const doc=fixture(), setWindowFullscreen=vi.fn(async()=>false);
    expect(guideWindowFullscreenAvailable(doc,true,{setWindowFullscreen},true)).toBe(true);
    await expect(toggleGuideWindowFullscreen(doc,true,{setWindowFullscreen},true)).resolves.toBe(true);
    expect(setWindowFullscreen).toHaveBeenCalledWith(false);
    expect(doc.exitFullscreen).not.toHaveBeenCalled(); expect(doc.documentElement.requestFullscreen).not.toHaveBeenCalled();
  });
  it('does not offer native entry from the separate desktop guide and rejects a refused exit',async()=>{
    const doc=fixture(), setWindowFullscreen=vi.fn(async()=>true);
    await expect(toggleGuideWindowFullscreen(doc,true,{setWindowFullscreen},false)).resolves.toBe(false);
    expect(setWindowFullscreen).not.toHaveBeenCalled();
    await expect(toggleGuideWindowFullscreen(doc,true,{setWindowFullscreen},true)).rejects.toThrow('could not be changed');
  });
  it('requests the main launcher choice dialog from desktop Game Bar instead of entering native or document fullscreen',async()=>{
    const doc=fixture(),setWindowFullscreen=vi.fn(async()=>true),request=vi.fn(async()=>{});
    expect(guideWindowFullscreenAvailable(doc,true,{setWindowFullscreen},false,request)).toBe(true);
    await expect(toggleGuideWindowFullscreen(doc,true,{setWindowFullscreen},false,request)).resolves.toBe(true);
    expect(request).toHaveBeenCalledOnce();expect(setWindowFullscreen).not.toHaveBeenCalled();
    expect(doc.documentElement.requestFullscreen).not.toHaveBeenCalled();expect(doc.exitFullscreen).not.toHaveBeenCalled();
  });
  it('preserves native leave behavior when an entry route is also present',async()=>{
    const doc=fixture(),setWindowFullscreen=vi.fn(async()=>false),request=vi.fn(async()=>{});
    await expect(toggleGuideWindowFullscreen(doc,true,{setWindowFullscreen},true,request)).resolves.toBe(true);
    expect(setWindowFullscreen).toHaveBeenCalledWith(false);expect(request).not.toHaveBeenCalled();
  });
  it('propagates a rejected trusted entry request and never falls back to direct fullscreen',async()=>{
    const doc=fixture(),setWindowFullscreen=vi.fn(async()=>true),request=vi.fn(async()=>{throw Error('Guide lost focus');});
    await expect(toggleGuideWindowFullscreen(doc,true,{setWindowFullscreen},false,request)).rejects.toThrow('Guide lost focus');
    expect(setWindowFullscreen).not.toHaveBeenCalled();expect(doc.documentElement.requestFullscreen).not.toHaveBeenCalled();
  });
  it('exits an inline document fullscreen as well as its native window when both adapters exist',async()=>{
    const doc=fixture(), setWindowFullscreen=vi.fn(async()=>false); doc.fullscreenElement={};
    await expect(toggleGuideWindowFullscreen(doc,false,{setWindowFullscreen},false)).resolves.toBe(true);
    expect(setWindowFullscreen).toHaveBeenCalledWith(false); expect(doc.exitFullscreen).toHaveBeenCalledOnce();
  });
  it('honors missing or disabled fullscreen capability and propagates real adapter failure',async()=>{
    const doc=fixture(); doc.fullscreenEnabled=false;
    await expect(toggleGuideWindowFullscreen(doc,false)).resolves.toBe(false);
    expect(doc.documentElement.requestFullscreen).not.toHaveBeenCalled();
    await expect(toggleGuideWindowFullscreen(undefined,false)).resolves.toBe(false);
    doc.fullscreenEnabled=true; doc.documentElement.requestFullscreen=undefined;
    expect(guideWindowFullscreenAvailable(doc,false)).toBe(false);
    doc.documentElement.requestFullscreen=vi.fn(async()=>{throw new Error('Denied');});
    await expect(toggleGuideWindowFullscreen(doc,false)).rejects.toThrow('Denied');
  });
});

/** Minimal DOM boundary fixture exercises the shared dispatcher, not React internals. */
function scopesFixture() {
  let scopes:HTMLElement[]=[];
  const owner={querySelectorAll:()=>scopes,defaultView:undefined as unknown as Window};
  const win={document:owner,getComputedStyle:()=>({visibility:'visible',display:'block'})} as unknown as Window;
  owner.defaultView=win;
  const element=()=>({ownerDocument:owner,isConnected:true,closest:()=>null,getClientRects:()=>[{}],contains:(other:unknown)=>false,querySelector:vi.fn().mockReturnValue(null),matches:()=>false,click:vi.fn()}) as unknown as HTMLElement;
  const guide=element(), inner=element(), cancel=element();
  guide.contains=(value:Node|null)=>value===guide; inner.contains=(value:Node|null)=>value===inner;
  scopes=[guide];
  return {win,guide,inner,cancel,setScopes:(value:HTMLElement[])=>{scopes=value;}};
}
describe('Guide scoped Back and Escape',()=>{
  it('lets an inner registered menu consume Back even when the outer guide registered later',()=>{
    const f=scopesFixture(), close=vi.fn(), dismissMenu=vi.fn(()=>true);
    const removeMenu=registerBackHandler(f.win,dismissMenu,()=>f.inner);
    const outer=vi.fn(()=>{close();return true;}); const removeOuter=registerBackHandler(f.win,outer,()=>f.guide);
    f.setScopes([f.guide,f.inner]);
    expect(handleGuideBack(f.guide,close)).toBe(true);
    expect(dismissMenu).toHaveBeenCalledOnce(); expect(close).not.toHaveBeenCalled(); expect(outer).not.toHaveBeenCalled();
    removeMenu(); f.setScopes([f.guide]);
    expect(handleGuideBack(f.guide,close)).toBe(true); expect(close).toHaveBeenCalledOnce(); removeOuter();
  });
  it('cancels an unregistered inner modal without closing the guide',()=>{
    const f=scopesFixture(), close=vi.fn(); f.setScopes([f.guide,f.inner]);
    f.inner.querySelector=vi.fn().mockReturnValue(f.cancel);
    expect(handleGuideBack(f.guide,close)).toBe(true); expect(f.cancel.click).toHaveBeenCalledOnce(); expect(close).not.toHaveBeenCalled();
  });
  it('does not close the outer guide while an inner modal is busy or offers no Back action',()=>{
    const f=scopesFixture(), close=vi.fn(); f.setScopes([f.guide,f.inner]);
    f.cancel.matches=()=>true; f.inner.querySelector=vi.fn().mockReturnValue(f.cancel);
    expect(handleGuideBack(f.guide,close)).toBe(true); expect(f.cancel.click).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
    f.inner.querySelector=vi.fn().mockReturnValue(null);
    expect(handleGuideBack(f.guide,close)).toBe(true); expect(close).not.toHaveBeenCalled();
  });
  it('ignores hidden inner scopes and never dismisses an unmounted guide',()=>{
    const f=scopesFixture(), close=vi.fn(); f.inner.closest=vi.fn().mockReturnValue({hidden:true}); f.setScopes([f.guide,f.inner]);
    expect(handleGuideBack(f.guide,close)).toBe(true); expect(close).toHaveBeenCalledOnce();
    expect(handleGuideBack(null,close)).toBe(false); expect(close).toHaveBeenCalledOnce();
  });
});
