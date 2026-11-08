import { useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX } from './XboxIcons';
import { SettingGroup, SettingToggle } from './OriginalSettings';
import type { GuideAudio } from '../shared/types';
import { LocalVoiceTest } from './LocalVoiceTest';
export function AudioSettings() {
  const [audio, setAudio] = useState<GuideAudio>();
  const [volume, setVolume] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; let cancelled = false; window.launcher.getGuideAudio().then(value => { if (!cancelled) { setAudio(value); if (value.available) setVolume(value.volume); } }).catch(() => { if (!cancelled) setError('System audio is unavailable.'); }); return () => { cancelled = true; mounted.current = false; }; }, []);
  async function update(patch: { volume?: number; muted?: boolean }) {
    if (pending.current || !mounted.current) return;
    pending.current = true; setBusy(true); setError('');
    try { const value = await window.launcher.setGuideAudio(patch); if (mounted.current) { setAudio(value); if (value.available) setVolume(value.volume); } }
    catch { if (mounted.current) setError('Audio settings could not be applied.'); } finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  return <div className="original-settings original-audio-settings">
    <SettingGroup title="Input device"><select aria-label="Voice input device" disabled><option>Default</option></select><small>Microphone routing is managed by your Linux desktop. Xbox voice chat is not connected yet.</small></SettingGroup>
    <SettingGroup title="Output device"><select aria-label="Voice output device" disabled><option>Default</option></select><small>Xbox voice output selection is not connected yet.</small></SettingGroup>
    <SettingGroup title="Voice volume"><input aria-label="Voice volume" type="range" min="0" max="100" value="100" disabled readOnly /></SettingGroup>
    <SettingGroup title="Push to talk"><SettingToggle label="Enable push to talk" reason="Xbox party voice chat is not implemented yet." /></SettingGroup>
    <SettingGroup title="Noise suppression"><SettingToggle label="Enable noise suppression" reason="Xbox party voice chat is not implemented yet." /></SettingGroup>
    <LocalVoiceTest />
    <SettingGroup title="Navigation sounds"><SettingToggle label="Enable controller navigation sounds" reason="Navigation sound playback is not implemented yet." /><SettingToggle label="Enable keyboard navigation sounds" reason="Navigation sound playback is not implemented yet." /><input aria-label="Navigation sound volume" type="range" min="0" max="100" value="50" disabled readOnly /></SettingGroup>
    <SettingGroup title="System volume">{audio?.available ? <><label className="xbox-volume">{volume}%<input aria-label="System volume" type="range" min="0" max="100" value={volume} readOnly={busy} aria-disabled={busy || undefined} data-gamepad-pending={busy ? '' : undefined} onChange={event => { if (!pending.current) setVolume(Number(event.target.value)); }} onPointerDown={event => { if (pending.current) event.preventDefault(); }} onKeyDown={event => { if (pending.current && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) event.preventDefault(); }} onPointerUp={() => { void update({ volume }); }} onKeyUp={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) void update({ volume }); }} /></label><div className="button-row"><button className="secondary" disabled={busy} onClick={() => void update({ volume })}>Apply volume</button><button className="secondary" disabled={busy} onClick={() => void update({ muted: !audio.muted })}>{audio.muted ? <VolumeX /> : <Volume2 />}{audio.muted ? 'Unmute' : 'Mute'}</button></div></> : <p role="status">{audio && !audio.available ? audio.reason : error || 'Checking audio service…'}</p>}{audio?.available && error ? <p role="alert">{error}</p> : null}</SettingGroup>
  </div>;
}
