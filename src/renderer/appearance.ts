export interface Appearance { reduceMotion: boolean; hideBackground: boolean; compactMode: boolean; developerOptions: boolean; showBattery: boolean; }
const key = 'xboks.appearance.v1';
export function loadAppearance(): Appearance {
  try { const value = JSON.parse(localStorage.getItem(key) ?? '{}'); return { reduceMotion: value?.reduceMotion === true, hideBackground: value?.hideBackground === true, compactMode: value?.compactMode !== false, developerOptions: value?.developerOptions === true, showBattery: value?.showBattery === true }; }
  catch { return { reduceMotion: false, hideBackground: false, compactMode: true, developerOptions: false, showBattery: false }; }
}
export function applyAppearance(value: Appearance) {
  document.documentElement.toggleAttribute('data-reduce-motion', value.reduceMotion);
  document.documentElement.toggleAttribute('data-hide-background', value.hideBackground);
  document.documentElement.toggleAttribute('data-compact-mode', value.compactMode);
  document.documentElement.toggleAttribute('data-developer-options', value.developerOptions);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('xboks-appearance', { detail: value }));
}
export function saveAppearance(value: Appearance): boolean {
  applyAppearance(value);
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}
