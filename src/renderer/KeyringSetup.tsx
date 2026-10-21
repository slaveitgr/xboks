import { useEffect, useRef, useState } from 'react';
import { Check, CircleAlert, RefreshCw } from './XboxIcons';
import { LoaderCircle } from 'lucide-react';
import type { KeyringStatus } from '../shared/types';

export function KeyringSetup({ disabled = false, compact = false }: { disabled?: boolean; compact?: boolean }) {
  const [status, setStatus] = useState<KeyringStatus>();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const generation = useRef(0);
  async function check(start = false) {
    const id = ++generation.current;
    setBusy(true); setFailed(false);
    try {
      const result = await (start ? window.launcher.startKeyring() : window.launcher.checkKeyring());
      if (id === generation.current) setStatus(result);
    } catch {
      if (id === generation.current) setFailed(true);
    } finally { if (id === generation.current) setBusy(false); }
  }
  useEffect(() => { void check(); return () => { generation.current++; }; }, []);
  const message = failed
    ? 'Keyring status could not be checked. Open your desktop wallet settings and ensure the wallet is enabled and unlocked.'
    : status?.message ?? 'Checking the system wallet without reading saved credentials…';
  const actions = <div className="button-row">
    {status?.canStart ? <button className="secondary" aria-label="Start keyring service" title="Start an installed service without changing wallet security settings." disabled={busy || disabled} onClick={() => void check(true)}>{compact ? 'Start service' : 'Start keyring service'}</button> : null}
    <button className="secondary" aria-label="Check keyring" title="Check keyring" disabled={busy || disabled} onClick={() => void check()}><RefreshCw />{compact ? null : 'Check keyring'}</button>
  </div>;
  const icon = busy ? <LoaderCircle className="spin" /> : status?.state === 'ready' ? <Check /> : <CircleAlert />;
  const safety = 'Nexus can start an installed service. It does not install a provider, enable a wallet you disabled, change its password or reset stored credentials.';
  const gameModeHelp = 'Wallet setup and password prompts may not appear in Game Mode. Complete this step in Desktop Mode first, then return to Game Mode.';
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
