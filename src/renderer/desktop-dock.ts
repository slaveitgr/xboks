import {useEffect, useState} from 'react';

export type DockPreference = 'automatic' | 'expanded' | 'collapsed';
export const DOCK_PREFERENCE_KEY = 'xboks.desktop-dock.v1';
export function dockCollapsed(preference: DockPreference, width: number): boolean {
  if (width < 960) return true;
  return preference === 'collapsed' || (preference === 'automatic' && width < 1440);
}
export function readDockPreference(storage?: Pick<Storage, 'getItem'>): DockPreference {
  try { const value = (storage ?? localStorage).getItem(DOCK_PREFERENCE_KEY); return value === 'expanded' || value === 'collapsed' ? value : 'automatic'; }
  catch { return 'automatic'; }
}
export function useDesktopDock() {
  const [preference, setPreference] = useState(readDockPreference);
  const [width, setWidth] = useState(() => typeof window === 'undefined' ? 1920 : window.innerWidth);
  useEffect(() => { const resize = () => setWidth(window.innerWidth); window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize); }, []);
  return {collapsed: dockCollapsed(preference, width), setCollapsed(value: boolean) {
    const next = value ? 'collapsed' : 'expanded'; setPreference(next);
    try { localStorage.setItem(DOCK_PREFERENCE_KEY, next); } catch { /* Keep this session's explicit choice. */ }
  }};
}
