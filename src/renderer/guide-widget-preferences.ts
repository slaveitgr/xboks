export const guideWidgetIds = ['home', 'settings', 'browser', 'audio', 'capture', 'performance', 'spotify', 'social', 'gallery'] as const;
export type GuideWidgetId = typeof guideWidgetIds[number];
export const guidePreferenceKey = 'xboks.gamebar.widgets.v1';
export interface GuideWidgetPreferences {
  version: 1; favorites: GuideWidgetId[]; pinned: GuideWidgetId[]; hidden: GuideWidgetId[];
  theme: 'dark' | 'light' | 'system'; opacity: number; reducedMotion: boolean;
  compact: boolean; showHints: boolean; largerText: boolean; startHome: boolean; captureNotifications: boolean;
}
export const defaultGuideWidgetPreferences: GuideWidgetPreferences = { version:1, favorites:[...guideWidgetIds], pinned:[], hidden:[], theme:'dark', opacity:100, reducedMotion:false, compact:false, showHints:true, largerText:false, startHome:false, captureNotifications:true };
const valid=(value:unknown):value is GuideWidgetId=>typeof value==='string' && (guideWidgetIds as readonly string[]).includes(value);
const ids=(value:unknown,fallback:GuideWidgetId[])=>Array.isArray(value)?[...new Set(value.filter(valid))]:[...fallback];
/** Only preferences owned by this renderer are persisted. No account/device data. */
export function decodeGuideWidgetPreferences(raw:string|null):GuideWidgetPreferences {
  let value:Record<string,unknown>={};try{const parsed:unknown=JSON.parse(raw??'null');if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed)&&(parsed as {version?:unknown}).version===1)value=parsed as Record<string,unknown>;}catch{/* Defaults on malformed/old storage. */}
  const fallback=defaultGuideWidgetPreferences;
  return {version:1,favorites:ids(value.favorites,fallback.favorites),pinned:ids(value.pinned,[]).filter(id=>['performance','spotify','gallery'].includes(id)),hidden:ids(value.hidden,[]).filter(id=>id!=='home'&&id!=='settings'),theme:['dark','light','system'].includes(String(value.theme))?value.theme as GuideWidgetPreferences['theme']:'dark',opacity:typeof value.opacity==='number'&&Number.isFinite(value.opacity)?Math.max(30,Math.min(100,Math.round(value.opacity))):100,...Object.fromEntries((['reducedMotion','compact','showHints','largerText','startHome','captureNotifications'] as const).map(key=>[key,typeof value[key]==='boolean'?value[key]:fallback[key]]))} as GuideWidgetPreferences;
}
export function readGuideWidgetPreferences():GuideWidgetPreferences {try{return decodeGuideWidgetPreferences(localStorage.getItem(guidePreferenceKey));}catch{return decodeGuideWidgetPreferences(null);}}
export function saveGuideWidgetPreferences(value:GuideWidgetPreferences):void {try{localStorage.setItem(guidePreferenceKey,JSON.stringify(value));}catch{/* Session preferences remain usable. */}}
export function toggleGuideWidgetPreference(value:GuideWidgetPreferences,key:'favorites'|'pinned'|'hidden',id:GuideWidgetId):GuideWidgetPreferences {
 const list=value[key];return decodeGuideWidgetPreferences(JSON.stringify({...value,[key]:list.includes(id)?list.filter(item=>item!==id):[...list,id]}));
}
