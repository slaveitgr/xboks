import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Camera, ChevronRight, Cog, Download, ExternalLink, Gamepad2, Globe, Home, Library, Maximize, Mic, Search, Users, Volume2, VolumeX, X } from 'lucide-react';
import type { AppSnapshot, GuideAudio, Page } from '../shared/types';
import './guide-overlay.css';

export const guideTabs = ['home', 'settings', 'browser', 'social', 'audio', 'capture'] as const;
export type GuideTab = typeof guideTabs[number];
const tabs = [
  { id: 'home', label: 'Home', icon: Home }, { id: 'settings', label: 'Settings', icon: Cog },
  { id: 'browser', label: 'Browser', icon: Globe }, { id: 'social', label: 'Friends', icon: Users },
  { id: 'audio', label: 'Audio', icon: Volume2 }, { id: 'capture', label: 'Capture', icon: Camera },
] as const;

export function GuideOverlay({ data, tab, setTab, close, go, openGame }: {
  data: AppSnapshot; tab: GuideTab; setTab: (tab: GuideTab) => void; close: () => void;
  go: (page: Page) => void; openGame: (id: string) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [audio, setAudio] = useState<GuideAudio>();
  const [volume, setVolume] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [query, setQuery] = useState('');
  const [capturePath, setCapturePath] = useState('');
  const [now, setNow] = useState(() => new Date());
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const shell = document.querySelector<HTMLElement>('.app-shell');
    const wasInert = shell?.inert ?? false;
    if (shell) shell.inert = true;
    root.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
    return () => { if (shell) shell.inert = wasInert; if (previous?.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    let cancelled = false;
    window.launcher.getGuideAudio().then(value => { if (!cancelled) { setAudio(value); if (value.available) setVolume(value.volume); } })
      .catch(() => { if (!cancelled) setAudio({ available: false, reason: 'System audio is unavailable.' }); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 30000); return () => window.clearInterval(timer); }, []);
  const navigate = (page: Page) => { close(); go(page); };
  async function updateAudio(patch: { volume?: number; muted?: boolean }) {
    if (busy) return;
    setBusy(true);
    try { const value = await window.launcher.setGuideAudio(patch); setAudio(value); if (value.available) setVolume(value.volume); }
    catch { setMessage('The audio setting could not be applied.'); }
    finally { setBusy(false); }
  }
  async function capture() {
    setBusy(true); setMessage('');
    try {
      document.documentElement.setAttribute('data-guide-capture', '');
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const path = await window.launcher.captureLauncher(); setCapturePath(path); setMessage('Screenshot saved to Pictures/xboks.');
    } catch { setMessage('The screenshot could not be saved.'); }
    finally { document.documentElement.removeAttribute('data-guide-capture'); setBusy(false); }
  }
  const audioControls = <>
    {!audio ? <p className="guide-muted" role="status">Checking system audio…</p> : audio.available ? <div className="guide-volume">
      <button aria-label={audio.muted ? 'Unmute system audio' : 'Mute system audio'} disabled={busy} onClick={() => void updateAudio({ muted: !audio.muted })}>{audio.muted ? <VolumeX /> : <Volume2 />}</button>
      <label><span>System volume <b>{volume}%</b></span><input aria-label="System volume" type="range" min="0" max="100" value={volume} disabled={busy} onChange={event => setVolume(Number(event.target.value))} onPointerUp={() => void updateAudio({ volume })} onKeyUp={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) void updateAudio({ volume }); }} onBlur={() => { if (volume !== audio.volume) void updateAudio({ volume }); }} /></label>
    </div> : <p className="guide-note">{audio.reason}</p>}
  </>;
  return <div ref={root} className="guide-overlay" data-gamepad-sections role="dialog" aria-modal="true" aria-label="xboks Game Bar" onMouseDown={event => { if (event.target === event.currentTarget) close(); }} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    if (event.key === 'Tab') {
      const nodes = Array.from(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled)') ?? []).filter(el => el.getClientRects().length > 0);
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }}>
    <div className="guide-tabs" role="tablist" aria-label="Game Bar sections">{tabs.map(({ id, label, icon: Icon }) => <button key={id} role="tab" id={`guide-tab-${id}`} aria-label={label} title={label} aria-selected={tab === id} aria-controls="guide-panel" onClick={() => setTab(id)} onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault(); const index = guideTabs.indexOf(id); const next = guideTabs[(index + (event.key === 'ArrowRight' ? 1 : -1) + guideTabs.length) % guideTabs.length];
      setTab(next); root.current?.querySelector<HTMLButtonElement>(`#guide-tab-${next}`)?.focus();
    }}><Icon /></button>)}</div>
    <div className="guide-system"><time>{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time><button data-gamepad-cancel aria-label="Close Game Bar" onClick={close}><X /></button></div>
    <section className="guide-panel" id="guide-panel" role="tabpanel" aria-labelledby={`guide-tab-${tab}`} tabIndex={-1}>
      <h2>{tabs.find(item => item.id === tab)?.label}</h2>
      <div className="guide-panel-scroll">
        {tab === 'home' ? <>
          <div className="guide-action-pair"><button onClick={() => navigate('home')}><Home />Home</button><button onClick={() => navigate('library')}><Library />Library</button></div>
          <div className="guide-recent-list">{data.games.slice(0, 4).map(game => <button key={game.id} onClick={() => { close(); openGame(game.id); }}>{game.coverUrl || game.coverDataUrl ? <img src={game.coverUrl ?? game.coverDataUrl} alt="" /> : <Gamepad2 />}<span><strong>{game.title}</strong><small>{game.installState === 'ready' ? 'Installed' : 'View game'}</small></span><ChevronRight /></button>)}</div>
          {!data.games.length ? <p className="guide-muted">Your recent games will appear here after you add games to the library.</p> : null}
          <hr /><button className="guide-row" onClick={() => navigate('downloads')}><Download />Install queue<ChevronRight /></button>
        </> : null}
        {tab === 'settings' ? <>{audioControls}<button className="guide-wide" onClick={() => { void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => setMessage('Full screen could not be changed.')); }}><Maximize />{document.fullscreenElement ? 'Exit full screen' : 'Enter full screen'}</button><hr /><button className="guide-row" onClick={() => navigate('settings')}><Cog />More settings<ChevronRight /></button><p className="guide-note">Network, Bluetooth and power controls are not connected yet.</p></> : null}
        {tab === 'audio' ? <>{audioControls}<hr /><h3>Default output</h3><p className="guide-muted">Uses the current system output through PipeWire.</p><h3><Mic />Microphone and app mixer</h3><p className="guide-note">Microphone, device selection and individual app volume controls are not connected yet.</p></> : null}
        {tab === 'capture' ? <><button className="guide-wide guide-capture" disabled={busy} onClick={() => void capture()}><Camera />{busy ? 'Saving…' : 'Take screenshot'}</button><p className="guide-muted">Captures the xboks window without this overlay. Saved as PNG in Pictures/xboks.</p>{capturePath ? <button className="guide-wide" onClick={() => void window.launcher.openPath(capturePath).catch(() => setMessage('The screenshot could not be opened.'))}>Open screenshot<ExternalLink /></button> : null}<hr /><p className="guide-note">Game video recording and capture outside xboks are not connected yet.</p></> : null}
        {tab === 'social' ? <><div className="guide-profile"><Users /><div><strong>{data.auth.gamertag ?? data.auth.username ?? 'Not signed in'}</strong><small>Xbox account</small></div></div><p className="guide-note">Friends, chat and party services are not connected yet. No online status is inferred from sign-in.</p><button className="guide-wide" onClick={() => navigate('settings')}>Account settings<ChevronRight /></button></> : null}
        {tab === 'browser' ? <><form className="guide-web-search" onSubmit={event => { event.preventDefault(); const text = query.trim(); if (text) window.open(`https://www.bing.com/search?q=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer'); }}><Search /><input aria-label="Search the web" placeholder="Search the web" value={query} onChange={event => setQuery(event.target.value)} /><button type="submit" disabled={!query.trim()} aria-label="Open search in browser"><ChevronRight /></button></form><p className="guide-muted">Search opens in your default browser. An embedded browser widget is not available yet.</p><a className="guide-wide" href="https://www.xbox.com/play" target="_blank" rel="noreferrer">Xbox on the web<ExternalLink /></a></> : null}
        {message ? <p className="guide-message" role="status">{message}</p> : null}
      </div>
    </section>
    <div className="guide-hints">A Select · B Close · LB / RB Sections · Ctrl + G Toggle</div>
  </div>;
}
