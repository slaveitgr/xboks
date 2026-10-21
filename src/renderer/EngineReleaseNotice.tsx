import { CircleAlert, Info } from './XboxIcons';
import { useReferenceLocale } from './ReferenceLocale';

/** Update discovery is independent of the installed engine's health. */
export function EngineReleaseNotice({ state, error, installed, runtime = false }: {
  state?: 'available' | 'unpublished' | 'error'; error?: string; installed: boolean; runtime?: boolean;
}) {
  const { text } = useReferenceLocale();
  if (state === 'unpublished') return <p className="engine-release-note" role="status"><Info /><span>
    {runtime ? text('No runtime update has been published on the xboks release channel yet.', 'Δεν έχει δημοσιευτεί ακόμη ενημέρωση runtime στο κανάλι εκδόσεων του xboks.')
      : text('No Engine update has been published on the xboks release channel yet.', 'Δεν έχει δημοσιευτεί ακόμη ενημέρωση Engine στο κανάλι εκδόσεων του xboks.')}
    {installed ? ` ${text('The installed version remains selected.', 'Η εγκατεστημένη έκδοση παραμένει επιλεγμένη.')}` : ''}
  </span></p>;
  if (error) return <div className="alert amber" role="status"><CircleAlert /><span>{error}</span></div>;
  return null;
}
