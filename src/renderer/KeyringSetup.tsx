import { useEffect, useRef, useState } from 'react';
import { Check, CircleAlert, RefreshCw } from './XboxIcons';
import { LoaderCircle } from 'lucide-react';
import type { KeyringStatus } from '../shared/types';

export function KeyringSetup({ disabled = false, compact = false }: { disabled?: boolean; compact?: boolean }) {
  const [status, setStatus] = useState<KeyringStatus>();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const generation = useRef(0);
  async function check(start = false, create = false) {
    const id = ++generation.current;
    setBusy(true); setFailed(false);
    try {
      const result = await (create ? window.launcher.createKeyringCollection() : start ? window.launcher.startKeyring() : window.launcher.checkKeyring());
      if (id === generation.current) setStatus(result);
    } catch {
      if (id === generation.current) setFailed(true);
    } finally { if (id === generation.current) setBusy(false); }
  }
  useEffect(() => { void check(); return () => { generation.current++; }; }, []);
  useEffect(() => window.launcher.onKeyringStatus?.(result => {
    generation.current++;
    setStatus(result); setFailed(false); setBusy(false);
  }), []);
  const message = failed
    ? 'Keyring status could not be checked. Open your desktop wallet settings and ensure the wallet is enabled and unlocked.'
    : status?.message ?? 'Checking the system wallet without reading saved credentials…';
  const actions = <div className="button-row">
    {status?.state === 'needs-setup' && status.canCreate ? <button className="secondary" aria-label="Create wallet" title="Open the system wallet dialog. Choose your password there, not in XBOKS Engine." disabled={busy || disabled} onClick={() => void check(false, true)}>Create wallet</button> : null}
    {status?.canStart || status?.canUnlock ? <button className="secondary" aria-label={status.canUnlock ? 'Unlock wallet' : 'Start keyring service'} title="Start or unlock the installed wallet using its own password window. Security settings are unchanged." disabled={busy || disabled} onClick={() => void check(true)}>{status.canUnlock ? 'Unlock wallet' : compact ? 'Start service' : 'Start keyring service'}</button> : null}
    <button className="secondary" aria-label="Check keyring" title="Check keyring" disabled={busy || disabled} onClick={() => void check()}><RefreshCw />{compact ? null : 'Check keyring'}</button>
  </div>;
  const icon = busy ? <LoaderCircle className="spin" /> : status?.state === 'ready' ? <Check /> : <CircleAlert />;
  const safety = 'Your wallet provider handles its password window. XBOKS Engine does not receive the password, enable a disabled wallet or reset stored credentials.';
  const gameModeHelp = 'Use Start service or Unlock wallet for this session. Create wallet opens your provider’s setup dialog when no collection exists. If setup is unavailable here, complete it in Desktop Mode.';
  if (compact) {
    const problem = failed || Boolean(status && !['ready', 'stopped'].includes(status.state));
    const label = busy ? 'Checking…' : failed ? 'Unavailable' : status ? {
      ready: 'Ready', stopped: 'Not running', locked: 'Locked', disabled: 'Disabled',
      missing: 'Not installed', 'needs-setup': 'Setup needed', unavailable: 'Unavailable',
    }[status.state] : 'Checking…';
    return <section className="keyring-setup keyring-compact" aria-label="System keyring">
      <div className="keyring-compact-row"><div className="keyring-status" role="status" aria-live="polite">{icon}<div><strong>System keyring</strong><small>{label}</small></div></div>{actions}</div>
      {problem ? <>
        <p className="keyring-problem">{message}</p>
        <details className="keyring-help"><summary>Help</summary>{status?.gameMode ? <p className="fine-print">{gameModeHelp}</p> : null}<p className="fine-print">{safety}</p></details>
      </> : null}
    </section>;
  }
  return <section className="keyring-setup" aria-label="System keyring">
    <div className="keyring-status" role="status" aria-live="polite">
      {icon}
      <div><strong>System keyring</strong><p>{message}</p></div>
    </div>
    {status?.gameMode && status.state !== 'ready' ? <p className="fine-print">{gameModeHelp}</p> : null}
    {actions}
    <p className="fine-print">{safety}</p>
  </section>;
}
