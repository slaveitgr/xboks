import { useEffect, useRef, useState } from 'react';
import type { Game, GameOperation } from '../shared/types';
import { CircleAlert, Gamepad2, X } from './XboxIcons';
import { LoaderCircle } from 'lucide-react';
import './launch-experience.css';
export function LaunchExperience({ operation, game, close }: { operation: GameOperation; game?: Game; close: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const [log, setLog] = useState(''), [error, setError] = useState('');
  const failed = operation.status === 'failed';
  useEffect(() => {
    const origin = document.activeElement as HTMLElement | null;
    const background = [...document.querySelectorAll<HTMLElement>('.app-shell,.shell-flyout-backdrop,.guide-backdrop')];
    const previous = background.map(element => element.inert); background.forEach(element => { element.inert=true; });
    root.current?.querySelector<HTMLElement>('button')?.focus();
    return () => { background.forEach((element,index) => { element.inert=previous[index]; }); if (origin?.isConnected) origin.focus(); };
  }, []);
  async function readLog() {
    try { setLog((await window.launcher.readDiagnosticLog(operation.id)).content); setError(''); }
    catch { setError('The diagnostic log could not be read.'); }
  }
  return <div className="launch-experience-backdrop"><div ref={root} className="launch-experience" role="dialog" aria-modal="true" aria-labelledby="launch-experience-title" onKeyDown={event => {
    if(event.key==='Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    if(event.key==='Tab') {
      const controls=[...root.current!.querySelectorAll<HTMLElement>('button:not(:disabled),summary')];
      if(event.shiftKey && document.activeElement===controls[0]) {event.preventDefault();controls.at(-1)?.focus();}
      else if(!event.shiftKey && document.activeElement===controls.at(-1)) {event.preventDefault();controls[0]?.focus();}
    }
  }}>
    <button className="launch-experience-close" aria-label={failed ? 'Close launch error' : 'Hide launch progress'} data-gamepad-cancel onClick={close}><X /></button>
    <div className="launch-experience-art">{game?.heroUrl || game?.coverUrl || game?.coverDataUrl ? <img src={game.heroUrl ?? game.coverUrl ?? game.coverDataUrl} alt="" /> : <Gamepad2 />}</div>
    <div className="launch-experience-content"><h2 id="launch-experience-title">{operation.title}</h2><p className="launch-experience-status" role={failed ? 'alert' : 'status'}>{failed ? <CircleAlert /> : <LoaderCircle className="spin" />}{failed ? 'Unable to launch your game' : 'Preparing your game'}</p>
    {failed ? <p>{operation.error ?? operation.phase}</p> : <><div className="launch-experience-progress" aria-hidden="true"><i /></div><p>You can keep browsing while the game starts.</p></>}
    <details><summary>{failed ? 'Error details' : 'Preparation details'}</summary><p>{operation.phase}</p>{operation.logPath ? <button className="secondary" onClick={() => void readLog()}>Read diagnostic log</button> : null}{log ? <pre>{log}</pre> : null}{error ? <p role="alert">{error}</p> : null}</details>
    <button className="secondary" onClick={close}>{failed ? 'Close' : 'Keep browsing'}</button></div>
  </div></div>;
}
