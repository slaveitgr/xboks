import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { DownloadTask } from '../shared/types';
import { DownloadCancelDialog } from './DownloadCancelDialog';
const task: DownloadTask = { id: 'sample', kind: 'install', title: '<Game>', productId: 'SAMPLE', destination: '/example/new game', status: 'running', phase: '', progress: null, log: [], startedAt: '' };
const render = (patch = {}, options = { deleteFilesAllowed: true }) => renderToStaticMarkup(<DownloadCancelDialog task={{ ...task, ...patch }} options={options} loading={false} busy={false} close={() => {}} choose={() => {}} />);
it('offers both choices, defaults to keep and requires explicit confirmation before permanent deletion', () => {
  const html = render(); expect(html).toContain('Cancel &lt;Game&gt;?'); expect(html).toContain('Cancel and keep files'); expect(html).toContain('Cancel and delete files');
  expect(html).toMatch(/data-gamepad-initial/); expect(html).toContain('This cannot be undone');
  expect(html).toMatch(/<button class="secondary danger" disabled/); expect(html).toContain('data-gamepad-cancel'); expect(html).toContain('aria-modal="true"');
});
it.each(['update','content',undefined])('never enables deletion for %s even if options are forged', kind => {
  const html = render({ kind }); expect(html).not.toContain('type="checkbox"'); expect(html).toContain('protect the installed game'); expect(html).toMatch(/<button class="secondary danger" disabled/);
});
it('keeps untracked folders and parent games safe and displays cleanup failures honestly', () => {
  const html = render({}, { deleteFilesAllowed: false }); expect(html).not.toContain('type="checkbox"'); expect(html).toMatch(/<button class="secondary danger" disabled/);
  expect(render({ gameId: 'existing' })).not.toContain('type="checkbox"');
  const failed = renderToStaticMarkup(<DownloadCancelDialog task={task} options={{deleteFilesAllowed:true}} loading={false} busy={false} error="Files were not deleted." close={() => {}} choose={() => {}} />);
  expect(failed).toContain('role="alert"'); expect(failed).toContain('Files were not deleted.');
});
