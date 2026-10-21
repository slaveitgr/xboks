/** A loaded official page does not prove sign-in, subscription or streaming. */
export interface CloudGamingState {
  open: boolean;
  phase: 'closed' | 'loading' | 'ready' | 'error';
  canGoBack: boolean;
  /** Origin only; never export an authentication URL, query or account data. */
  origin?: string;
  error?: string;
  blockedNavigation?: boolean;
}
export type CloudGamingCommand = 'back' | 'home' | 'retry' | 'close';
export const CLOUD_GAMING_TOOLBAR_HEIGHT = 64;
