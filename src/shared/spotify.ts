/** Local Spotify desktop transport. This is not Spotify Web API authorization. */
export interface SpotifyState {
  status: 'available' | 'not-running' | 'unsupported' | 'error';
  source: 'linux-mpris';
  playbackStatus: 'playing' | 'paused' | 'stopped' | 'unknown';
  track?: { title: string; artists: string[]; album?: string; artUrl?: string; durationMs?: number };
  positionMs?: number;
  capabilities: { playPause: boolean; previous: boolean; next: boolean; seek: boolean; open: boolean };
  reason?: string;
  /** Fixed local diagnostic codes only; never raw D-Bus bodies or player data. */
  diagnostic?: { code: 'access-denied' | 'read-failed'; stage: 'discovery' | 'identity' | 'player-properties' };
}
export type SpotifyCommand = { action: 'play-pause' | 'previous' | 'next' | 'open' }
  | { action: 'seek'; positionMs: number };
