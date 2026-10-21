import type { DownloadTask } from '../shared/types';
import { Download, Info, Pause, ChevronUp, X, RefreshCw, Trash2 } from './XboxIcons';
import type { ReferenceMenuItem } from './ReferenceMenu';
export interface DownloadMenuActions {
  details?: (task: DownloadTask) => void;
  retry: (task: DownloadTask) => void; pauseOrResume: (task: DownloadTask) => void;
  cancel: (operationId: string) => void; log: (operationId: string) => void; remove: (operationId: string) => void;
}
/** Product navigation and transfer mutations retain separate identities. */
export function downloadMenuItems(task: DownloadTask, actions: DownloadMenuActions, options: { retrying?: string } = {}, text = (en: string, _el: string) => en): ReferenceMenuItem[] {
  return [

        { id: 'details', label: text('View game details', 'Προβολή λεπτομερειών παιχνιδιού'), icon: <Info />, hidden: !actions.details, onSelect: () => actions.details?.(task) },
        { id: 'resume', label: text('Resume installation', 'Συνέχιση εγκατάστασης'), icon: <Download />, hidden: !['paused','failed'].includes(task.status), disabled: task.cancelling || task.controlPending || task.status === 'paused' && !task.canPause || Boolean(options.retrying), loading: options.retrying === task.id, onSelect: () => { if (task.status === 'failed') actions.retry(task); else actions.pauseOrResume(task); } },
        { id: 'pause', label: text('Pause installation', 'Παύση εγκατάστασης'), icon: <Pause />, hidden: task.status !== 'running', disabled: task.cancelling || !task.canPause || task.controlPending, title: !task.canPause ? text('Pause is available while downloading game files', 'Η παύση είναι διαθέσιμη κατά τη λήψη αρχείων παιχνιδιού') : undefined, onSelect: () => { actions.pauseOrResume(task); } },
        { id: 'prioritize', label: text('Move to top', 'Μετακίνηση στην αρχή'), icon: <ChevronUp />, hidden: task.status !== 'queued', disabled: true, title: text('Queue prioritization is not supported by this backend', 'Το backend δεν υποστηρίζει αλλαγή προτεραιότητας'), onSelect: () => {} },
        { id: 'cancel', label: text('Cancel installation', 'Ακύρωση εγκατάστασης'), icon: <X />, hidden: !['running','queued','paused','failed'].includes(task.status), disabled: task.cancelling || task.status === 'failed', onSelect: () => actions.cancel(task.id) },
        { id: 'retry', label: text('Retry installation', 'Επανάληψη εγκατάστασης'), icon: <RefreshCw />, hidden: task.status !== 'cancelled', disabled: Boolean(options.retrying) || task.cancelling, onSelect: () => { actions.retry(task); } },
        { id: 'log', label: text('Installation details', 'Λεπτομέρειες εγκατάστασης'), icon: <Info />, onSelect: () => actions.log(task.id) },
        { id: 'remove', label: text('Remove from queue', 'Κατάργηση από την ουρά'), icon: <Trash2 />, hidden: !['complete','cancelled'].includes(task.status), disabled: task.cancelling, onSelect: () => { actions.remove(task.id); } },

  ];
}
