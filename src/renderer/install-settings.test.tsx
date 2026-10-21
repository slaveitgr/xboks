import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { applyInstallPreferenceAction, InstallSettings } from './InstallSettings';
import { demoSnapshot } from '../shared/demo-data';
import type { Settings } from '../shared/types';

function fixture() {
  let value = { ...demoSnapshot().settings, installRoot:'/home/example/Games/Xboks', downloadLimitMiB: 24, parallelDownloads: 4, downloadSpeedUnit:'bytes' as const } as Settings;
  let latest=value;
  const writes: Settings[]=[];
  return { read:()=>value, write:(next:Settings)=>{value=next;writes.push(next);}, latestSnapshot:()=>latest, snapshot:(next:Settings)=>{latest=next;}, writes };
}
function deferred<T>() { let resolve!: (value:T)=>void, reject!: (error:unknown)=>void; const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;}); return {promise,resolve,reject}; }
afterEach(()=>vi.unstubAllGlobals());

describe('Install preference persistence',()=>{
 it('changes display units optimistically and sends only that preference, retaining bandwidth and storage settings',async()=>{
  const state=fixture(), before={...state.read()}, pending=deferred<Settings>();
  const persist=vi.fn(()=>pending.promise);
  const operation=applyInstallPreferenceAction(async()=>({downloadSpeedUnit:'bits'}),state,persist);
  await Promise.resolve();
  expect(state.read()).toMatchObject({downloadSpeedUnit:'bits',downloadLimitMiB:24,parallelDownloads:4,installRoot:'/home/example/Games/Xboks'});
  expect(persist).toHaveBeenCalledOnce(); expect(persist).toHaveBeenCalledWith({downloadSpeedUnit:'bits'});
  expect(before.downloadSpeedUnit).toBe('bytes');
  const saved={...before,downloadSpeedUnit:'bits' as const,market:'el-GR'};
  pending.resolve(saved); await expect(operation).resolves.toBe(true);
  expect(state.read()).toBe(saved);
  expect(state.read().downloadLimitMiB).toBe(24);
 });
 it('rolls an optimistic shortcut preference back and propagates persistence failure',async()=>{
  const state=fixture(), before=state.read(), pending=deferred<Settings>();
  const operation=applyInstallPreferenceAction(async()=>({createDesktopShortcut:true}),state,()=>pending.promise);
  await Promise.resolve(); expect(state.read().createDesktopShortcut).toBe(true);
  pending.reject(new Error('Disk is read-only'));
  await expect(operation).rejects.toThrow('Disk is read-only');
  expect(state.read()).toBe(before); expect(state.writes).toHaveLength(2);
 });
 it('preserves a newer authoritative snapshot on failure instead of reverting unrelated settings',async()=>{
  const state=fixture(), pending=deferred<Settings>();
  const operation=applyInstallPreferenceAction(async()=>({downloadSpeedUnit:'bits'}),state,()=>pending.promise);
  await Promise.resolve();
  const latest={...state.latestSnapshot(),installRoot:'/mnt/games/Xboks',downloadLimitMiB:8}; state.snapshot(latest);
  pending.reject(new Error('Update rejected'));
  await expect(operation).rejects.toThrow('Update rejected');
  expect(state.read()).toBe(latest); expect(state.read().downloadSpeedUnit).toBe('bytes');
 });
 it('treats folder cancellation as a no-op and never persists a cancelled choice',async()=>{
  const state=fixture(), before=state.read(), persist=vi.fn();
  await expect(applyInstallPreferenceAction(async()=>undefined,state,persist)).resolves.toBe(false);
  expect(persist).not.toHaveBeenCalled(); expect(state.read()).toBe(before); expect(state.writes).toHaveLength(0);
 });
 it('commits a chosen folder without resetting other settings or changing the bandwidth cap',async()=>{
  const state=fixture(), saved={...state.read(),installRoot:'/mnt/games/Xboks'};
  const persist=vi.fn(async()=>saved);
  await applyInstallPreferenceAction(async()=>({installRoot:saved.installRoot}),state,persist);
  expect(persist).toHaveBeenCalledOnce(); expect(persist).toHaveBeenCalledWith({installRoot:'/mnt/games/Xboks'});
  expect(state.read()).toBe(saved); expect(state.read().downloadLimitMiB).toBe(24);
 });
 it('rebases on snapshots received while the folder picker is open, including cancellation and picker errors',async()=>{
  for(const mode of ['choose','cancel','error'] as const){
   const state=fixture(), picker=deferred<{installRoot:string}|undefined>(), persist=vi.fn(async patch=>({...state.latestSnapshot(),...patch}));
   const operation=applyInstallPreferenceAction(()=>picker.promise,state,persist);
   const latest={...state.read(),downloadLimitMiB:16,parallelDownloads:2}; state.snapshot(latest);
   if(mode==='error') {picker.reject(new Error('Folder picker unavailable')); await expect(operation).rejects.toThrow('Folder picker unavailable');}
   else {picker.resolve(mode==='choose'?{installRoot:'/games/Selected'}:undefined); await operation;}
   expect(state.read()).toMatchObject({downloadLimitMiB:16,parallelDownloads:2});
   if(mode==='choose') expect(state.read().installRoot).toBe('/games/Selected');
   else {expect(state.read()).toBe(latest);expect(persist).not.toHaveBeenCalled();}
  }
 });
});

describe('Original Install settings view',()=>{
 function render(language:'en'|'el'='en', disabled = false){
  vi.stubGlobal('localStorage',{getItem:()=>language});
  const data=demoSnapshot(); data.settings={...data.settings,installRoot:'/home/example/Games/Xboks',createDesktopShortcut:false,downloadSpeedUnit:'bytes'};
  return renderToStaticMarkup(<InstallSettings data={data} working={()=>{}} disabled={disabled}/>);
 }
 it('renders the captured groups in order, showing real storage and units without Nexus implementation details',()=>{
  const html=render();
  const labels=['Game installation options','Default install location','Create a desktop shortcut on install','Enable automatic updates','Includes pre-download updates','Enable downloads and updates during gameplay','Download speed unit'];
  let previous=-1; for(const label of labels){const index=html.indexOf(label);expect(index).toBeGreaterThan(previous);previous=index;}
  expect(html).toContain('<option value="/home/example/Games/Xboks" selected="">/home/example/Games/Xboks</option>');
  expect(html).toContain('<option value="bytes" selected="">Bytes per second</option>');
  expect(html).toContain('Bits per second');
  expect(html).not.toContain('Wine / Xodus'); expect(html).not.toContain('Parallel streams'); expect(html).not.toContain('MiB/s');
 });
 it('keeps provider update policies unavailable rather than fabricating editable or enabled provider state',()=>{
  const html=render();
  const controls=[...html.matchAll(/<div class="original-setting-control"[\s\S]*?<\/div>/g)].map(match=>match[0]);
  const shortcut=controls.find(control=>control.includes('Create a desktop shortcut on install'))!;
  expect(shortcut).not.toContain('disabled=""'); expect(shortcut).not.toContain('checked=""');
  for(const label of ['Enable automatic updates','Enable downloads and updates during gameplay']){
   const control=controls.find(control=>control.includes(label))!;
   expect(control).toContain('disabled=""'); expect(control).not.toContain('checked=""');
   expect(control).toContain('aria-describedby=');
  }
 });
 it('localizes all original install groups and display units in Greek',()=>{
  const html=render('el');
  for(const label of ['Επιλογές εγκατάστασης παιχνιδιού','Προεπιλεγμένο σημείο εγκατάστασης','Δημιουργία συντόμευσης επιφάνειας εργασίας κατά την εγκατάσταση','Ενεργοποίηση αυτόματων ενημερώσεων','Ενεργοποίηση λήψεων και ενημερώσεων κατά τη διάρκεια του παιχνιδιού','Μονάδα ταχύτητας λήψης','Bit ανά δευτερόλεπτο','Byte ανά δευτερόλεπτο']) expect(html).toContain(label);
  expect(html).not.toContain('Enable automatic updates');
 });
 it('disables mutable install preferences during another Settings operation',()=>{
  const html=render('en',true);
  expect((html.match(/disabled=""/g)??[])).toHaveLength(5); // location, shortcut, units, two unsupported policies
 });
});
