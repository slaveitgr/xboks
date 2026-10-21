import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { HandheldCompatibility } from '../shared/handheld-compatibility';
import { Check, ChevronRight, HandheldOptimized, HandheldPlayable, HandheldUnsupported, HandheldUnknown, Info, X } from './XboxIcons';
import { useBackHandler } from './GamepadNavigation';
import { useReferenceLocale } from './ReferenceLocale';
import { handheldCriterionLabels } from './handheld-criterion-labels';
import './handheld-compatibility.css';

export function handheldRatingLabel(rating: HandheldCompatibility['rating'] | undefined, text: (en: string, el: string) => string): string {
  switch (rating) {
    case 'optimized': return text('Handheld optimized', 'Βελτιστοποιημένο για συσκευή χειρός');
    case 'playable': return text('Mostly Compatible', 'Κυρίως συμβατό');
    case 'unsupported': return text('Unsupported', 'Δεν υποστηρίζεται');
    default: return text('Handheld compatibility', 'Συμβατότητα συσκευής χειρός');
  }
}

/** Public Windows catalog classification; never a Linux/Proton play gate. */
export function HandheldCompatibilityEntry({ value, open }: { value?: HandheldCompatibility; open: () => void }) {
  const { text } = useReferenceLocale();
  const Icon = value?.rating === 'optimized' ? HandheldOptimized : value?.rating === 'playable' ? HandheldPlayable : value?.rating === 'unsupported' ? HandheldUnsupported : HandheldUnknown;
  return <button className="handheld-compatibility-entry" data-handheld-rating={value?.rating ?? 'unknown'} aria-haspopup="dialog" onClick={open}>
    <Icon /><span>{handheldRatingLabel(value?.rating, text)}</span><ChevronRight />
  </button>;
}

function HandheldIllustration({ optimized }: { optimized: boolean }) {
  return <svg className="handheld-illustration" viewBox="0 0 420 340" aria-hidden="true">
    <defs><linearGradient id="handheld-device" x1="0" x2="1" y1="0" y2="1"><stop stopColor="#172d2b" /><stop offset="1" stopColor="#253c37" /></linearGradient><linearGradient id="handheld-disc" x1="0" x2="1"><stop stopColor="#0e4c3d" /><stop offset=".55" stopColor="#15765b" /><stop offset="1" stopColor="#183e35" /></linearGradient></defs>
    <g stroke="currentColor" strokeWidth="3" strokeLinejoin="round">
      <path fill="currentColor" opacity=".07" stroke="none" d="M68 231 119 114 343 142 302 263Z" />
      <path fill="url(#handheld-device)" d="m59 247 189-55 116 48-1 28-188 58-116-52Z" />
      <path fill="none" d="m59 247 117 51 188-58M176 298v28" />
      <path fill="#152723" d="m115 246 126-36 67 28-127 39Z" />
      <ellipse cx="92" cy="260" rx="12" ry="6" /><ellipse cx="322" cy="256" rx="12" ry="6" />
      <path d="m102 278 20-6m-14-2 8 10m211-42 9-2m-4 10 9-3" fill="none" />
      <path fill="currentColor" opacity=".12" stroke="none" d="m118 188 63 90 140-40 33-103-107 36Z" />
      <ellipse cx="233" cy="160" rx="74" ry="99" transform="rotate(24 233 160)" fill="url(#handheld-disc)" />
      <ellipse cx="222" cy="152" rx="74" ry="99" transform="rotate(24 222 152)" fill="#163c32" />
      {optimized ? <path d="m186 167 24 20 48-84" fill="none" strokeWidth="15" strokeLinecap="round" /> : <><path d="M211 121c4-24 42-20 38 2-2 13-26 19-25 37" fill="none" strokeWidth="10" strokeLinecap="round" /><circle cx="220" cy="181" r="5" fill="currentColor" stroke="none" /></>}
    </g>
  </svg>;
}

function HandheldArtwork({ rating }: { rating: HandheldCompatibility['rating'] }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [rating]);
  // The optional local reference kit is extracted from the supplied package.
  // A source-only checkout uses the native illustration above.
  const source = typeof document === 'undefined' ? undefined : new URL(`./original-xbox/handheld/${rating}.png`, document.baseURI).href;
  return source && !failed ? <img className="handheld-illustration" src={source} alt="" onError={() => setFailed(true)} /> : <HandheldIllustration optimized={rating === 'optimized'} />;
}

export function HandheldCompatibilityDialog({ title, value, close }: { title: string; value?: HandheldCompatibility; close: () => void }) {
  const { text, language } = useReferenceLocale();
  const root = useRef<HTMLElement>(null), closeRef = useRef(close); closeRef.current = close;
  const rating = value?.rating ?? 'unknown', optimized = rating === 'optimized';
  useBackHandler(() => { closeRef.current(); return true; }, true, () => root.current);
  useEffect(() => {
    const origin = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const shell = document.querySelector<HTMLElement>('.app-shell'), inert = shell?.inert ?? false;
    if (shell) shell.inert = true;
    root.current?.querySelector<HTMLButtonElement>('[data-handheld-dismiss]')?.focus({ preventScroll: true });
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !root.current?.contains(document.activeElement)) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeRef.current(); }
      if (event.key === 'Tab') {
        const buttons = [...root.current.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
        if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1)?.focus(); }
        else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0]?.focus(); }
      }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); if (shell) shell.inert = inert; if (origin?.isConnected) origin.focus({ preventScroll: true }); };
  }, []);
  const heading = optimized ? text('This game is optimized for handheld play', 'Αυτό το παιχνίδι είναι βελτιστοποιημένο για συσκευές χειρός')
    : rating === 'playable' ? text('This game may need adjustments on handheld devices', 'Αυτό το παιχνίδι μπορεί να χρειάζεται προσαρμογές σε συσκευές χειρός')
    : rating === 'unsupported' ? text('This game does not meet the handheld guidelines', 'Αυτό το παιχνίδι δεν πληροί τις οδηγίες για συσκευές χειρός')
    : text('Handheld compatibility has not been provided for this game', 'Δεν έχουν δοθεί πληροφορίες συμβατότητας συσκευών χειρός για αυτό το παιχνίδι');
  const criteria = [
    [text('Ready with default settings', 'Έτοιμο με τις προεπιλεγμένες ρυθμίσεις'), text('Play using the controller without first changing display or input settings.', 'Παιχνίδι με χειριστήριο χωρίς αρχική αλλαγή ρυθμίσεων εικόνας ή εισόδου.')],
    [text('Controller prompts', 'Ενδείξεις χειριστηρίου'), text('On-screen prompts match the controller buttons.', 'Οι ενδείξεις στην οθόνη αντιστοιχούν στα κουμπιά του χειριστηρίου.')],
    [text('Text entry', 'Εισαγωγή κειμένου'), text('Text fields support the on-screen keyboard.', 'Τα πεδία κειμένου υποστηρίζουν το πληκτρολόγιο οθόνης.')],
    [text('Readable interface', 'Ευανάγνωστο περιβάλλον'), text('Menus and text remain legible on a handheld screen.', 'Τα μενού και το κείμενο παραμένουν ευανάγνωστα στη μικρή οθόνη.')],
    [text('Supported display', 'Υποστηριζόμενη οθόνη'), text('The game supports the handheld display and fullscreen resolution.', 'Το παιχνίδι υποστηρίζει την οθόνη και την ανάλυση πλήρους οθόνης της συσκευής.')],
  ];
  const ids = ['defaults-work', 'iconography', 'text-input', 'ui-legibility', 'supported-display'] as const;
  const content = <section ref={root} className="handheld-compatibility-dialog" data-handheld-rating={rating} role="dialog" aria-modal="true" aria-labelledby="handheld-dialog-title" aria-describedby="handheld-rating-context">
    <button className="handheld-dialog-close" data-gamepad-cancel aria-label={text('Close', 'Κλείσιμο')} onClick={close}><X /></button>
    <div className="handheld-dialog-columns">
      <div className="handheld-dialog-visual"><HandheldArtwork rating={rating} /><button className="primary" data-handheld-dismiss onClick={close}>{text('Got it', 'Το κατάλαβα')}</button></div>
      <div className="handheld-dialog-information"><h2 id="handheld-dialog-title">{heading}</h2><p className="handheld-game-title">{title}</p>
        <h3>{handheldRatingLabel(rating, text)}</h3>
        <p>{text('Xbox classification for Windows handhelds. The five areas below show individual results only when provided by the catalog.', 'Αξιολόγηση Xbox για συσκευές χειρός Windows. Οι πέντε τομείς παρακάτω εμφανίζουν αναλυτικό αποτέλεσμα μόνο όταν το παρέχει ο κατάλογος.')}</p>
        <ul className="handheld-criteria">{criteria.map(([label, description], index) => {
          const result = value?.criteria?.find(item => item.id === ids[index])?.rating;
          const known = result === 'optimized' || result === 'playable' || result === 'unsupported';
          return <li key={label} data-criterion-state={known ? result : 'not-provided'}>{result === 'optimized' ? <Check /> : <Info />}<div>{known ? <p>{handheldCriterionLabels[ids[index]][result][language]}</p> : <><strong>{label}</strong><p>{description}</p><small>{text('Test result not provided', 'Δεν έχει δοθεί αποτέλεσμα ελέγχου')}</small></>}</div></li>;
        })}</ul>
        <p id="handheld-rating-context" className="handheld-rating-context">{text('Xbox rating for Windows handhelds. Linux / Proton compatibility has not been verified.', 'Αξιολόγηση Xbox για συσκευές χειρός Windows. Η συμβατότητα Linux / Proton δεν έχει επαληθευτεί.')}</p>
      </div>
    </div>
  </section>;
  return typeof document === 'undefined' ? content : createPortal(content, document.body);
}
