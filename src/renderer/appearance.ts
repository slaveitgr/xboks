export interface Appearance { reduceMotion: boolean; hideBackground: boolean; }
const key = 'xboks.appearance.v1';
export function loadAppearance(): Appearance {
  try { const value = JSON.parse(localStorage.getItem(key) ?? '{}'); return { reduceMotion: value?.reduceMotion === true, hideBackground: value?.hideBackground === true }; }
  catch { return { reduceMotion: false, hideBackground: false }; }
}
export function applyAppearance(value: Appearance) {
  document.documentElement.toggleAttribute('data-reduce-motion', value.reduceMotion);
  document.documentElement.toggleAttribute('data-hide-background', value.hideBackground);
}
export function saveAppearance(value: Appearance): boolean {
  applyAppearance(value);
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}
