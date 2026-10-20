import { useEffect, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import type { GuideAudio } from '../shared/types';
export function AudioSettings() {
  const [audio, setAudio] = useState<GuideAudio>();
  const [volume, setVolume] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { let cancelled = false; window.launcher.getGuideAudio().then(value => { if (!cancelled) { setAudio(value); if (value.available) setVolume(value.volume); } }).catch(() => { if (!cancelled) setError('System audio is unavailable.'); }); return () => { cancelled = true; }; }, []);
  async function update(patch: { volume?: number; muted?: boolean }) {
    setBusy(true); setError('');
    try { const value = await window.launcher.setGuideAudio(patch); setAudio(value); if (value.available) setVolume(value.volume); }
    catch { setError('Audio settings could not be applied.'); } finally { setBusy(false); }
  }
  return <section className="settings-card"><h2>Audio</h2><h3>Output device</h3><p>The system default output is used. Change device routing in your Linux sound settings.</p><h3>System volume</h3>{audio?.available ? <><label className="xbox-volume">{volume}%<input aria-label="System volume" type="range" min="0" max="100" value={volume} disabled={busy} onChange={event => setVolume(Number(event.target.value))} /></label><div className="button-row"><button className="secondary" disabled={busy} onClick={() => void update({ volume })}>Apply volume</button><button className="secondary" disabled={busy} onClick={() => void update({ muted: !audio.muted })}>{audio.muted ? <VolumeX /> : <Volume2 />}{audio.muted ? 'Unmute' : 'Mute'}</button></div></> : <p role="status">{audio && !audio.available ? audio.reason : error || 'Checking audio service…'}</p>}{audio?.available && error ? <p role="alert">{error}</p> : null}<h3>Voice and app mixer</h3><p>Microphone selection, noise suppression and individual app volume are not connected yet.</p></section>;
}
