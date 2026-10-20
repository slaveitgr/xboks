import { Trash2 } from 'lucide-react';
import type { Game } from '../shared/types';

export function GameRemovalContents({ game, busy, close, remove }: {
  game: Game; busy: boolean; close: () => void; remove: (mode: 'library' | 'delete-files') => void;
}) {
  return <><h2>Remove {game.title}?</h2>
    <p>Keep the files, or permanently delete this installation folder. Deleted files and saves inside it cannot be restored from Trash. Saves stored outside this folder are not affected.</p>
    <code className="remove-path">{game.path}</code>
    <div className="dialog-actions"><button className="secondary" disabled={busy} data-gamepad-cancel onClick={close}>Cancel</button>
      <button className="secondary" disabled={busy} onClick={() => remove('library')}>Keep files</button>
      <button className="secondary danger" disabled={busy} onClick={() => remove('delete-files')}><Trash2 />Delete files permanently</button></div>
  </>;
}
