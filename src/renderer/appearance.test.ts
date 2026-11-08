import {afterEach, expect, it, vi} from 'vitest';
import type {Appearance} from './appearance';
const base: Appearance = {compactMode:true,hideBackground:false,reduceMotion:false,developerOptions:false,showBattery:false};
afterEach(() => {vi.unstubAllGlobals();vi.resetModules();});
it('keeps legacy motion preferences and validates the new four-level preference',async()=>{
  let saved='{"reduceMotion":true}';vi.stubGlobal('localStorage',{getItem:()=>saved,setItem:(_key:string,next:string)=>{saved=next;}});
  const motion=await import('./appearance');
  expect(motion.animationLevel(motion.loadAppearance())).toBe('off');
  saved='{"animationLevel":"simple"}';expect(motion.animationLevel(motion.loadAppearance())).toBe('simple');
  saved='{"animationLevel":"untrusted"}';expect(motion.animationLevel(motion.loadAppearance())).toBe('auto');
});
it('applies Full, Reduced and Off separately and follows system changes only in System default',async()=>{
  const flags=new Map<string,boolean>();let listener=()=>{};
  const media={matches:false,addEventListener:(_event:string,cb:()=>void)=>{listener=cb;}};
  vi.stubGlobal('document',{documentElement:{toggleAttribute:(key:string,next:boolean)=>{flags.set(key,next);}}});
  vi.stubGlobal('window',{matchMedia:()=>media,dispatchEvent:()=>true});
  const motion=await import('./appearance');
  motion.applyAppearance({...base,animationLevel:'simple'});expect(flags.get('data-simple-motion')).toBe(true);expect(flags.get('data-reduce-motion')).toBe(false);
  motion.applyAppearance({...base,animationLevel:'off'});expect(flags.get('data-simple-motion')).toBe(false);expect(flags.get('data-reduce-motion')).toBe(true);
  motion.applyAppearance({...base,animationLevel:'full'});media.matches=true;listener();expect(flags.get('data-simple-motion')).toBe(false);expect(flags.get('data-reduce-motion')).toBe(false);
  motion.applyAppearance({...base,animationLevel:'auto'});expect(flags.get('data-simple-motion')).toBe(true);media.matches=false;listener();expect(flags.get('data-simple-motion')).toBe(false);
});
