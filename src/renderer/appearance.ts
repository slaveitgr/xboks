export type AnimationLevel = 'auto' | 'full' | 'simple' | 'off';
export interface Appearance { reduceMotion: boolean; hideBackground: boolean; compactMode: boolean; developerOptions: boolean; showBattery: boolean; animationLevel?: AnimationLevel; }
const key = 'xboks.appearance.v1';
export function animationLevel(value: Appearance): AnimationLevel { return value.animationLevel ?? (value.reduceMotion ? 'off' : 'auto'); }
export function loadAppearance(): Appearance {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? '{}');
    const motion = ['auto','full','simple','off'].includes(value?.animationLevel) ? value.animationLevel as AnimationLevel : undefined;
    return { reduceMotion: value?.reduceMotion === true, hideBackground: value?.hideBackground === true, compactMode: value?.compactMode !== false, developerOptions: value?.developerOptions === true, showBattery: value?.showBattery === true, ...(motion ? {animationLevel: motion} : {}) };
  } catch { return { reduceMotion: false, hideBackground: false, compactMode: true, developerOptions: false, showBattery: false }; }
}
let latestAppearance: Appearance | undefined, systemMotion: MediaQueryList | undefined;
function applyMotion(value: Appearance) {
  const level = animationLevel(value);
  document.documentElement.toggleAttribute('data-reduce-motion', level === 'off');
  document.documentElement.toggleAttribute('data-simple-motion', level === 'simple' || level === 'auto' && systemMotion?.matches === true);
}
export function applyAppearance(value: Appearance) {
  latestAppearance = value;
  if (!systemMotion && typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    systemMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    systemMotion.addEventListener('change', () => { if (latestAppearance) applyMotion(latestAppearance); });
  }
  applyMotion(value);
  document.documentElement.toggleAttribute('data-hide-background', value.hideBackground);
  document.documentElement.toggleAttribute('data-compact-mode', value.compactMode);
  document.documentElement.toggleAttribute('data-developer-options', value.developerOptions);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('xboks-appearance', { detail: value }));
}
export function saveAppearance(value: Appearance): boolean {
  applyAppearance(value);
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}
