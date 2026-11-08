import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { applicationControlState, changeCompactMode, OriginalSettings, SettingToggle, readShowMyAppsPreference, saveShowMyAppsPreference } from './OriginalSettings';
import { handleSettingsBack, SettingsFrame } from './SettingsFrame';
import { loadAppearance, saveAppearance, type Appearance } from './appearance';
import { demoSnapshot } from '../shared/demo-data';
import type { AppSnapshot } from '../shared/types';
const appearance: Appearance = { compactMode:false, developerOptions:false, showBattery:false, reduceMotion:false, hideBackground:false };
const render = (section: Parameters<typeof OriginalSettings>[0]['section'], data = demoSnapshot(), language: 'en'|'el' = 'en') => renderToStaticMarkup(<OriginalSettings section={section} data={data} language={language} appearance={appearance} changeAppearance={() => {}} gameBar={() => {}} notificationChange={() => {}} desktopChange={() => {}} />);
const desktop = (data: AppSnapshot, overrides: Partial<NonNullable<AppSnapshot['desktopSettings']>> = {}) => { data.desktopSettings = { canSetAutostart: true, fullscreenExperience: false, fullscreenExperienceSource: 'none', ...overrides }; return data; };

describe('Application settings capability and account gates', () => {
 it('disables battery outside compact mode and without a battery while retaining the stored preference', () => {
  const data = desktop(demoSnapshot());
  expect(applicationControlState(data, {...appearance,showBattery:true}, 75).batteryDisabled).toBe(true);
  expect(applicationControlState(data, {...appearance,compactMode:true,showBattery:true}, null).batteryDisabled).toBe(true);
  expect(applicationControlState(data, {...appearance,compactMode:true,showBattery:true}, 75).batteryDisabled).toBe(false);
 });
 it('closes social UI before entering compact mode and does not treat leaving compact mode as entering a new session', () => {
  const actions: unknown[] = [];
  const change = (patch: Partial<Appearance>) => actions.push(patch);
  changeCompactMode(true, change, () => actions.push('close-social'), enabled => actions.push(enabled ? 'announce-enabled' : 'announce-disabled'));
  expect(actions).toEqual(['close-social','announce-enabled',{compactMode:true}]);
  actions.length = 0; changeCompactMode(false, change, () => actions.push('close-social'));
  expect(actions).toEqual([{compactMode:false}]);
 });
 it('distinguishes OS Fullscreen Experience from compact UI, and shows background launch only after autostart is enabled', () => {
  const data = desktop(demoSnapshot()); data.settings.launchOnLogin = false;
  expect(applicationControlState(data, {...appearance,compactMode:true}, 50)).toMatchObject({autostartDisabled:false,backgroundVisible:false,backgroundDisabled:true,trayDisabled:false});
  expect(render('application',data)).not.toContain('Launch the app in the background');
  expect(render('application',data)).not.toContain('Startup options are disabled');
  data.settings.launchOnLogin = true;
  expect(applicationControlState(data,appearance,50)).toMatchObject({backgroundVisible:true,backgroundDisabled:false});
  expect(render('application',data)).toContain('Launch the app in the background');
  desktop(data,{fullscreenExperience:true,fullscreenExperienceSource:'environment'});
  expect(applicationControlState(data,appearance,50)).toMatchObject({autostartDisabled:true,backgroundDisabled:true,trayDisabled:true});
  expect(render('application',data)).toContain('Startup options are disabled');
 });
 it('honors explicit Linux autostart/tray capability failures and leaves an unattempted tray available', () => {
  const data = demoSnapshot();
  expect(applicationControlState(data,appearance,50).autostartDisabled).toBe(true);
  desktop(data,{canSetAutostart:false,trayAvailable:false});
  expect(applicationControlState(data,appearance,50)).toMatchObject({autostartDisabled:true,trayDisabled:true});
  desktop(data,{trayAvailable:undefined});
  expect(applicationControlState(data,appearance,50).trayDisabled).toBe(false);
 });
 it('mounts offline permissions only for a fresh Store identity bound to the connected account', () => {
  const data = demoSnapshot(); data.auth.stored = true; data.auth.username = 'xbox@example.test';
  expect(render('application',data)).not.toContain('Offline permissions');
  data.auth.storeAccount = {account:data.auth.username,username:'store@example.test',source:'backend-store-account',checkedAt:new Date().toISOString()};
  expect(render('application',data)).toContain('Offline permissions');
  data.auth.storeAccount.checkedAt = new Date(Date.now()-11*60_000).toISOString();
  expect(render('application',data)).not.toContain('Offline permissions');
  data.auth.storeAccount.checkedAt = new Date().toISOString(); data.auth.storeAccount.account = 'other@example.test';
  expect(render('application',data)).not.toContain('Offline permissions');
  data.auth.storeAccount.account = data.auth.username; data.auth.stored = false;
  expect(render('application',data)).not.toContain('Offline permissions');
 });
 it('keeps the original Application groups and places interface language in closed Nexus settings', () => {
  const html = render('application',desktop(demoSnapshot()));
  expect(html).not.toContain('Streaming resolution');
  expect(html).not.toContain('Streaming</span>');
  expect(html).toContain('Show developer options');
  const disclosure=html.match(/<details\b[^>]*>[\s\S]*?<\/details>/)?.[0];
  expect(disclosure).toContain('Interface language');
  expect(disclosure?.split('>')[0]).not.toMatch(/\bopen\b/);
 });
});

describe('Original category layout and truthful service states', () => {
 it('does not fabricate billing, device identities or enabled service preferences', () => {
  const subscriptions = render('subscriptions');
  expect(subscriptions).toContain('Billing status unavailable');
  expect(subscriptions).not.toContain('renewal failed');
  expect(subscriptions.indexOf('XBOX GAME PASS')).toBeLessThan(subscriptions.indexOf('Connected accounts'));
  const notifications = render('notifications');
  expect((notifications.match(/disabled=""/g) ?? []).length).toBe(5);
  expect(notifications).toContain('Notify me when a game download finishes');
  expect(notifications).toContain('Show achievement notifications');
  const account = render('account');
  expect(account).toContain('https://account.xbox.com/settings');
  expect(account).toContain('Managed by Xbox privacy settings');
  expect(render('about')).not.toContain('F900D9D175867DF5');
 });
 it('shows the observed seven compatible providers without inventing detection or account connection', () => {
  const html=render('library');
  const names=['Battle.net','Steam','Ubisoft Connect','EA app','Epic Games Store','GOG GALAXY','Riot Games'];
  const cards=[...html.matchAll(/<button[^>]*class="settings-v2-provider-card"[\s\S]*?<\/button>/g)].map(match=>match[0]);
  expect(cards).toHaveLength(7);cards.forEach((card,index)=>expect(card).toContain(names[index]));
  for(const id of ['battlenet','steam','ubisoft','ea','epic','gog','riot'])expect(html).toContain(`./original-xbox/providers/${id}.png`);
  expect(html).toContain('Detected apps');expect(html).toContain('Compatible apps');expect(html).toContain('Checking installed apps');
  expect(html).not.toContain('Account connected');expect(html).not.toContain('Disconnected');
  expect(html).not.toContain('Automatically start extensions');expect(html).toContain('Add a game');
 });
 it('uses the observed inline accessibility controls and all four motion levels without adding a hover metadata preference', () => {
  const html=render('accessibility');
  expect(html).toContain('Show video preview on hover');expect(html).toContain('Show themes on profiles');
  expect(html).not.toContain('Show accessibility features on game card hover');
  for(const value of ['auto','full','simple','off'])expect(html).toContain(`value="${value}"`);
  expect((html.match(/disabled=""/g)??[]).length).toBe(3);
  expect(html).toContain('class="settings-control-reason"');
 });
 it('gives Greek controls unique accessible explanations, even when labels are repeated', () => {
  const html=renderToStaticMarkup(<><SettingToggle label="Ρύθμιση" reason="Πρώτη"/><SettingToggle label="Ρύθμιση" reason="Δεύτερη"/></>);
  const ids=[...html.matchAll(/aria-describedby="([^"]+)"/g)].map(match=>match[1]);
  expect(ids).toHaveLength(2); expect(new Set(ids).size).toBe(2);
 });
 it('localizes the category rail and original settings without translating provider brands', () => {
  const html=renderToStaticMarkup(<SettingsFrame active="library" select={()=>{}} close={()=>{}} busy={false} language="el">{render('library',demoSnapshot(),'el')}</SettingsFrame>);
  for(const text of ['Ρυθμίσεις','Εφαρμογές','Εντοπισμένες εφαρμογές','Συμβατές εφαρμογές','GOG GALAXY']) expect(html).toContain(text);
  expect(render('application',demoSnapshot(),'el')).toContain('Εμφάνιση ποσοστού ένδειξης μπαταρίας');
 });
 it('uses connected Xbox identity separately from Store identity and never shows stale profile data after sign-out', () => {
  const data=demoSnapshot(); data.auth.stored=true; data.auth.gamertag='ActualPlayer'; data.auth.username='player@example.test'; data.auth.avatarDataUrl='data:image/png;base64,STALE';
  const html=renderToStaticMarkup(<OriginalSettings section="subscriptions" data={data} appearance={appearance} changeAppearance={()=>{}} gameBar={()=>{}} notificationChange={()=>{}} desktopChange={()=>{}} accountSettings={()=>{}} />);
  expect(html).toContain('Connected accounts'); expect(html).toContain('ActualPlayer'); expect(html).toContain('player@example.test');
  expect(html).toContain('Manage account'); expect(html).toContain('Store identity unavailable');
  data.auth.stored=false;
  const signedOut=render('subscriptions',data);
  expect(signedOut).toContain('No Xbox account is connected.'); expect(signedOut).not.toContain('ActualPlayer'); expect(signedOut).not.toContain('STALE');
  expect(render('account',data)).not.toContain('ActualPlayer'); expect(render('account',data)).not.toContain('STALE');
 });
});

describe('Settings Back handling', () => {
 it('consumes Back while busy, returns from a provider subpage first, and closes only the main settings pane', () => {
  const close=vi.fn(), subpage=vi.fn();
  const surface={querySelector:vi.fn().mockReturnValue({disabled:false,click:subpage})} as unknown as Pick<HTMLElement,'querySelector'>;
  expect(handleSettingsBack(surface,true,close)).toBe(true);
  expect(close).not.toHaveBeenCalled(); expect(subpage).not.toHaveBeenCalled();
  expect(handleSettingsBack(surface,false,close)).toBe(true);
  expect(subpage).toHaveBeenCalledOnce(); expect(close).not.toHaveBeenCalled();
  surface.querySelector=vi.fn().mockReturnValue(null);
  expect(handleSettingsBack(surface,false,close)).toBe(true); expect(close).toHaveBeenCalledOnce();
 });
});

it('migrates, persists and applies appearance without clearing the battery preference when compact mode changes', () => {
 let saved = '{"hideBackground":true,"showBattery":true}';
 const attributes = new Map<string, boolean>();
 vi.stubGlobal('localStorage', { getItem: () => saved, setItem: (_key: string, value: string) => { saved=value; } });
 vi.stubGlobal('document', { documentElement: { toggleAttribute: (key:string, value:boolean) => { attributes.set(key,value); } } });
 try {
  const old = loadAppearance(); expect(old).toMatchObject({hideBackground:true,compactMode:true,showBattery:true,developerOptions:false});
  expect(saveAppearance({...old,compactMode:false,developerOptions:true})).toBe(true);
  expect(loadAppearance()).toMatchObject({compactMode:false,showBattery:true});
  expect(attributes.get('data-compact-mode')).toBe(false); expect(attributes.get('data-developer-options')).toBe(true);
  expect(attributes.has('data-fullscreen-experience')).toBe(false);
  saved='null'; expect(loadAppearance().reduceMotion).toBe(false);
 } finally { vi.unstubAllGlobals(); }
});

it('persists My apps visibility and announces only saved changes to the library', () => {
 let value: string | null=null;const events: Array<{type:string;detail:boolean}>=[];
 vi.stubGlobal('localStorage',{getItem:()=>value,setItem:(key:string,next:string)=>{expect(key).toBe('xboks.library.show-apps');value=next;}});
 vi.stubGlobal('window',{dispatchEvent:(event:CustomEvent<boolean>)=>{events.push({type:event.type,detail:event.detail});}});
 try {
  expect(readShowMyAppsPreference()).toBe(true);expect(saveShowMyAppsPreference(false)).toBe(true);expect(readShowMyAppsPreference()).toBe(false);
  expect(events).toEqual([{type:'xboks-library-apps-changed',detail:false}]);
  vi.stubGlobal('localStorage',{getItem:()=>{throw Error('blocked');},setItem:()=>{throw Error('blocked');}});
  expect(readShowMyAppsPreference()).toBe(true);expect(saveShowMyAppsPreference(true)).toBe(false);expect(events).toHaveLength(1);
 } finally {vi.unstubAllGlobals();}
});
