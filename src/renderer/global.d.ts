import type { LauncherApi } from '../shared/types';

declare global {
  interface Window { launcher: LauncherApi; desktopGuide?: {
    toggle(): Promise<void>; close(): Promise<void>;
    navigate(page: string, gameId?: string): Promise<void>;
    onNavigate(callback: (value: { page: string; gameId?: string }) => void): () => void;
  } }
}

export {};
