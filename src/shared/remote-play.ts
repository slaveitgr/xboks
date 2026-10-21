/** Trusted host state; page-ready never asserts a console/WebRTC connection. */
export interface RemotePlayState {
  open:boolean;
  phase:'closed'|'loading'|'ready'|'error';
  canGoBack:boolean;
  error?:string;
}
export type RemotePlayCommand='back'|'home'|'retry'|'close';
export const REMOTE_PLAY_TOOLBAR_HEIGHT=64;
