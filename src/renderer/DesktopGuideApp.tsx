import { useEffect, useState } from 'react';
import type { AppSnapshot, Page } from '../shared/types';
import { GuideOverlay, cycleGuideTab, type GuideTab } from './GuideOverlay';
import { GamepadNavigation, useBackHandler } from './GamepadNavigation';

export function DesktopGuideApp() {
  const [data, setData] = useState<AppSnapshot>();
  const [tab, setTab] = useState<GuideTab>('home');
  const [error, setError] = useState('');
  const close = () => { void window.desktopGuide?.close(); };
  useBackHandler(() => { close(); return true; }, !data);
  useEffect(() => {
    document.documentElement.classList.add('desktop-guide-surface');
    void window.launcher.getSnapshot().then(setData).catch(() => setError('Game Bar could not load. Press Escape to close.'));
    return window.launcher.onSnapshot(setData);
  }, []);
  const go = (page: Page) => { void window.desktopGuide?.navigate(page); };
  return <>{data ? <GuideOverlay data={data} tab={tab} setTab={setTab} close={close} go={go}
    openGame={id => { void window.desktopGuide?.navigate('library', id); }} /> : <button onClick={close}>{error || 'Loading Game Bar…'}</button>}
    <GamepadNavigation back={close} page={delta => setTab(current => cycleGuideTab(current, delta))} /></>;
}
