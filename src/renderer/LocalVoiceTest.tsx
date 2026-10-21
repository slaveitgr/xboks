import { useEffect, useRef, useState } from 'react';
import { Mic } from './XboxIcons';
import { useReferenceLocale } from './ReferenceLocale';
import { browserVoiceEngine, initialVoiceTestState, LocalVoiceTestEngine, type VoiceTestEnvironment } from './voice-test';
import './local-voice-test.css';

const greekErrors: Record<string,string> = {
  'Microphone permission was denied.':'Δεν δόθηκε άδεια μικροφώνου.', 'No microphone is available.':'Δεν υπάρχει διαθέσιμο μικρόφωνο.',
  'The microphone could not be opened. It may be busy.':'Δεν ήταν δυνατό το άνοιγμα του μικροφώνου. Ίσως χρησιμοποιείται ήδη.',
  'The selected microphone or setting is unavailable.':'Το επιλεγμένο μικρόφωνο ή ρύθμιση δεν είναι διαθέσιμα.',
  'The selected audio device was disconnected.':'Η επιλεγμένη συσκευή ήχου αποσυνδέθηκε.',
  'The microphone stopped or was disconnected.':'Το μικρόφωνο σταμάτησε ή αποσυνδέθηκε.',
  'The local test stopped after 60 seconds.':'Η τοπική δοκιμή σταμάτησε μετά από 60 δευτερόλεπτα.',
};
/** No capture on mount. The Start button is the sole permission/capture entry. */
export function LocalVoiceTest({ environment }: { environment?: VoiceTestEnvironment }) {
  const { text:t,language } = useReferenceLocale();
  const engine = useRef<LocalVoiceTestEngine>();
  const [state,setState] = useState(initialVoiceTestState);
  useEffect(() => {
    const owner = environment ? new LocalVoiceTestEngine(environment) : browserVoiceEngine(); engine.current = owner;
    const unsubscribe = owner.subscribe(setState); void owner.refreshDevices();
    const release = () => owner.setTalking(false);
    const blur = () => { release(); if(owner.state.phase==='running') void owner.stop(); };
    const hidden = () => { if(document.visibilityState!=='visible') void owner.stop(); };
    const devices = () => { void owner.refreshDevices(); };
    const revoked = typeof window.launcher?.onVoiceCaptureStop === 'function' ? window.launcher.onVoiceCaptureStop(() => { void owner.stop(); }) : undefined;
    window.addEventListener('blur',blur);window.addEventListener('gamepaddisconnected',release);document.addEventListener('visibilitychange',hidden);navigator.mediaDevices?.addEventListener('devicechange',devices);
    return () => { unsubscribe(); engine.current=undefined;window.removeEventListener('blur',blur);window.removeEventListener('gamepaddisconnected',release);document.removeEventListener('visibilitychange',hidden);navigator.mediaDevices?.removeEventListener('devicechange',devices);revoked?.();void owner.stop(); };
  }, [environment]);
  const active = state.phase !== 'idle' || state.permissionPending, running = state.phase === 'running';
  const available = Boolean(environment || (typeof window!=='undefined' && typeof window.launcher?.requestVoiceCapture==='function' && typeof navigator.mediaDevices?.getUserMedia==='function'));
  return <section className="local-voice-test" aria-label={t('Local microphone test','Τοπική δοκιμή μικροφώνου')}>
    <h3><Mic />{t('Local microphone test','Τοπική δοκιμή μικροφώνου')}</h3>
    <p>{t('Test your microphone on this PC. No audio is recorded or sent to Xbox.','Δοκιμάστε το μικρόφωνο σε αυτόν τον υπολογιστή. Ο ήχος δεν καταγράφεται ούτε αποστέλλεται στο Xbox.')}</p>
    <label>{t('Input device','Συσκευή εισόδου')}<select aria-label={t('Local test input device','Συσκευή εισόδου τοπικής δοκιμής')} value={state.inputId} disabled={active} onChange={event=>engine.current?.setInput(event.target.value)}><option value="">{t('Default','Προεπιλογή')}</option>{state.inputs.filter(device=>device.id&&device.id!=='default').map(device=><option key={device.id} value={device.id}>{device.label}</option>)}</select></label>
    <label>{t('Output device for this test','Συσκευή εξόδου για αυτήν τη δοκιμή')}<select aria-label={t('Local test output device','Συσκευή εξόδου τοπικής δοκιμής')} value={state.outputId} disabled={!running||!state.outputSupported} onChange={event=>void engine.current?.setOutput(event.target.value)}><option value="">{t('Default','Προεπιλογή')}</option>{state.outputs.filter(device=>device.id&&device.id!=='default').map(device=><option key={device.id} value={device.id}>{device.label}</option>)}</select></label>
    <div className="local-voice-buttons"><button type="button" className="secondary" disabled={!available||active} onClick={()=>void engine.current?.start()}>{t('Start test','Έναρξη δοκιμής')}</button><button type="button" className="secondary" disabled={!active} onClick={()=>void engine.current?.stop()}>{t('Stop test','Διακοπή δοκιμής')}</button><button type="button" className="secondary" disabled={active} onClick={()=>void engine.current?.refreshDevices()}>{t('Refresh devices','Ανανέωση συσκευών')}</button></div>
    <p role="status">{state.phase==='starting'||state.permissionPending?t('Requesting microphone access…','Αίτημα πρόσβασης στο μικρόφωνο…'):running?t('Microphone active · local test only','Μικρόφωνο ενεργό · μόνο τοπική δοκιμή'):t('Microphone stopped','Το μικρόφωνο έχει σταματήσει')}</p>
    <label>{t('Input level before mute','Ένταση εισόδου πριν τη σίγαση')}<meter aria-label={t('Microphone input level','Ένταση εισόδου μικροφώνου')} min="0" max="100" value={state.level}/></label>
    <label className="local-voice-check"><input type="checkbox" checked={state.muted} onChange={event=>engine.current?.setMuted(event.target.checked)}/>{t('Mute test input','Σίγαση εισόδου δοκιμής')}</label>
    <label className="local-voice-check"><input type="checkbox" checked={state.noiseSuppression} disabled={!state.noiseSupported} onChange={event=>void engine.current?.setNoiseSuppression(event.target.checked)}/>{t('Noise suppression','Καταστολή θορύβου')}</label>
    {!state.noiseSupported?<small>{t('Noise suppression is not reported as available by this audio service.','Η υπηρεσία ήχου δεν αναφέρει διαθέσιμη καταστολή θορύβου.')}</small>:null}
    {running&&state.noiseApplied!==undefined?<small>{state.noiseApplied?t('Noise suppression reported active by the device.','Η συσκευή αναφέρει ενεργή καταστολή θορύβου.'):t('Noise suppression reported inactive by the device.','Η συσκευή αναφέρει ανενεργή καταστολή θορύβου.')}</small>:null}
    <label className="local-voice-check"><input type="checkbox" checked={state.pushToTalk} onChange={event=>engine.current?.setPushToTalk(event.target.checked)}/>{t('Push to talk for this test','Πιέστε για ομιλία σε αυτήν τη δοκιμή')}</label>
    {state.pushToTalk?<><button type="button" className={`secondary local-voice-hold${state.talking?' talking':''}`} disabled={!running} onPointerDown={event=>{event.currentTarget.setPointerCapture(event.pointerId);engine.current?.setTalking(true);}} onPointerUp={()=>engine.current?.setTalking(false)} onPointerCancel={()=>engine.current?.setTalking(false)} onLostPointerCapture={()=>engine.current?.setTalking(false)} onBlur={()=>engine.current?.setTalking(false)} onKeyDown={event=>{if(event.key===' '||event.key==='Enter'){event.preventDefault();engine.current?.setTalking(true);}}} onKeyUp={event=>{if(event.key===' '||event.key==='Enter'){event.preventDefault();engine.current?.setTalking(false);}}}>{state.talking?t('Test input open','Η είσοδος δοκιμής είναι ανοικτή'):t('Hold to talk','Κρατήστε πατημένο για ομιλία')}</button><small>{t('Hold with the pointer, or Space/Enter while this button is focused. This shortcut works inside this window.','Κρατήστε πατημένο με τον δείκτη ή Space/Enter όσο το κουμπί έχει εστίαση. Η συντόμευση λειτουργεί μέσα σε αυτό το παράθυρο.')}</small></>:null}
    <label className="local-voice-check"><input type="checkbox" checked={state.listening} disabled={!running} onChange={event=>void engine.current?.setListening(event.target.checked)}/>{t('Listen to my voice on this PC','Ακρόαση της φωνής μου σε αυτόν τον υπολογιστή')}</label>
    <label>{t('Test playback volume','Ένταση αναπαραγωγής δοκιμής')}<input type="range" aria-label={t('Test playback volume','Ένταση αναπαραγωγής δοκιμής')} min="0" max="100" value={state.volume} disabled={!running} onChange={event=>engine.current?.setVolume(Number(event.target.value))}/></label>
    <small>{t('Listening starts off. Use headphones to avoid feedback. Closing or hiding this test stops the microphone.','Η ακρόαση ξεκινά απενεργοποιημένη. Χρησιμοποιήστε ακουστικά για αποφυγή μικροφωνισμού. Το κλείσιμο ή η απόκρυψη της δοκιμής σταματά το μικρόφωνο.')}</small>
    {!available?<p>{t('Microphone testing is unavailable in this app session.','Η δοκιμή μικροφώνου δεν είναι διαθέσιμη σε αυτήν τη συνεδρία εφαρμογής.')}</p>:null}
    {state.error?<p className="local-voice-error" role="alert">{language==='el'?greekErrors[state.error]??state.error:state.error}</p>:null}
  </section>;
}
