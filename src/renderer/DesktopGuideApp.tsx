import { useEffect, useState } from 'react';
import type { AppSnapshot, Page } from '../shared/types';
import { GuideOverlay, cycleGuideTab, type GuideTab } from './GuideOverlay';
import { GamepadNavigation, useBackHandler } from './GamepadNavigation';
import type { PadAction } from './gamepad-navigation';

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
  const requestXboxModeEntry = typeof window.desktopGuide?.requestXboxModeEntry === 'function'
    ? () => window.desktopGuide!.requestXboxModeEntry() : undefined;
  const controller = data?.desktopSettings?.gameBarController;
  const nativeControlsActive = controller?.status === 'listening' && controller.devices > 0 && controller.navigationSurface === 'guide';
  const subscribeInput = typeof window.desktopGuide?.onInput === 'function'
    ? (dispatch: (action: PadAction) => void) => window.desktopGuide!.onInput!(action => {
      dispatch(action === 'previous' ? 'previous-page' : action === 'next' ? 'next-page' : action);
    }) : undefined;
  return <>{data ? <GuideOverlay data={data} tab={tab} setTab={setTab} close={close} go={go} requestXboxModeEntry={requestXboxModeEntry}
    openGame={id => { void window.desktopGuide?.navigate('library', id); }} /> : <button onClick={close}>{error || 'Loading Game Bar…'}</button>}
    <GamepadNavigation activateOnFocus subscribeInput={subscribeInput} nativeControlsActive={nativeControlsActive} back={close} page={delta => setTab(current => cycleGuideTab(current, delta))} /></>;
}
