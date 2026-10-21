import type { DesktopGuideApi, LauncherApi } from '../shared/types';

declare global {
  interface Window { launcher: LauncherApi; desktopGuide?: DesktopGuideApi }
}

export {};
