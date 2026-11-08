import {expect, it} from 'vitest';
import {dockCollapsed, readDockPreference, DOCK_PREFERENCE_KEY} from './desktop-dock';
it('uses the shipped 960/1440 desktop dock breakpoints and retains explicit expansion', () => {
  expect([959,960,1280,1439,1440,1920].map(width => dockCollapsed('automatic',width))).toEqual([true,true,true,true,false,false]);
  expect(dockCollapsed('expanded',1110)).toBe(false); expect(dockCollapsed('expanded',900)).toBe(true);
  expect(dockCollapsed('collapsed',1920)).toBe(true);
});
it('recovers from missing/invalid/unavailable dock preferences', () => {
  expect(readDockPreference({getItem:key => key === DOCK_PREFERENCE_KEY ? 'expanded' : null})).toBe('expanded');
  expect(readDockPreference({getItem:() => 'unrecognized'})).toBe('automatic');
  expect(readDockPreference({getItem:() => {throw Error('unavailable');}})).toBe('automatic');
});
