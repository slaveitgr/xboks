import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { DownloadTask } from '../shared/types';
import { demoSnapshot } from '../shared/demo-data';
import { InstallQueueShortcut, previewTasks, QueuePreview } from './InstallQueueShortcut';

const task = (patch: Partial<DownloadTask> = {}): DownloadTask => ({ id: 'synthetic', title: 'Sample game',
  productId: '9AAAAAAAAAAA', destination: '/synthetic', status: 'running', progress: 34,
  phase: 'Downloading', log: [], startedAt: '2026-10-17', ...patch });

it('puts current downloads first and waiting jobs in FIFO order without mutating the snapshot', () => {
  const downloads = [task({ id: 'newest', status: 'queued' }), task({ id: 'oldest', status: 'queued' }),
    task({ id: 'finished', status: 'complete' }), task({ id: 'current' }), task({ id: 'failed', status: 'failed' }),
    task({ id: 'paused', status: 'paused' }), task({ id: 'cancelled', status: 'cancelled' })];
  const before = structuredClone(downloads);
  expect(previewTasks(downloads).map(task => task.id)).toEqual(['current', 'paused', 'oldest', 'newest']);
  expect(downloads).toEqual(before);
});

it('renders actual bytes, percentage, artwork and accessible progress', () => {
  const html = renderToStaticMarkup(<QueuePreview tasks={[task({ downloadedBytes: 50.5 * 1024 ** 3, totalBytes: 147.7 * 1024 ** 3,
    coverUrl: 'data:image/png;base64,fixture' })]} games={[]} />);
  expect(html).toContain('50.5 GiB / 147.7 GiB'); expect(html).toContain('34%');
  expect(html).toContain('aria-valuenow="34"'); expect(html).toContain('role="progressbar"');
  expect(html).toContain('data:image/png;base64,fixture'); expect(html).not.toContain('View full queue');
});

it('does not invent percentages or total size when progress has not been reported', () => {
  const html = renderToStaticMarkup(<QueuePreview tasks={[task({ progress: null }), task({ id: 'waiting', status: 'queued', progress: null })]} games={[]} />);
  expect(html).toContain('Size not reported yet'); expect(html).toContain('Waiting to start');
  expect(html).toContain('indeterminate'); expect(html).not.toContain('aria-valuenow'); expect(html).not.toContain('0%');
});

it('shows resumable progress, zero bytes and local artwork fallback', () => {
  const game = demoSnapshot().games[0];
  const html = renderToStaticMarkup(<QueuePreview tasks={[task({ status: 'paused', gameId: game.id, downloadedBytes: 0, totalBytes: 1024 ** 3, progress: 0 })]}
    games={[{ ...game, coverDataUrl: 'data:image/png;base64,local' }]} />);
  expect(html).toContain('Paused'); expect(html).toContain('0 B / 1.0 GiB'); expect(html).toContain('0%');
  expect(html).toContain('data:image/png;base64,local');
});

it('clamps invalid percentages, ignores invalid byte counts and escapes titles', () => {
  const html = renderToStaticMarkup(<QueuePreview tasks={[task({ title: '<script>bad()</script>', progress: 200, downloadedBytes: NaN, totalBytes: -1 })]} games={[]} />);
  expect(html).toContain('aria-valuenow="100"'); expect(html).not.toContain('width:200%');
  expect(html).not.toContain('NaN'); expect(html).not.toContain('<script>'); expect(html).toContain('&lt;script&gt;');
});

it('keeps the existing navigation button and starts with no visible hover panel', () => {
  const html = renderToStaticMarkup(<InstallQueueShortcut downloads={[task()]} games={[]} active openQueue={() => {}} />);
  expect(html).toContain('Downloading (1/1)'); expect(html).toContain('Sample game');
  expect(html).toContain('34%'); expect(html).toContain('aria-current="page"');
  expect(html).toContain('aria-expanded="false"'); expect(html).not.toContain('role="region"');
  const empty = renderToStaticMarkup(<InstallQueueShortcut downloads={[]} games={[]} active={false} openQueue={() => {}} />);
  expect(empty).toContain('Manage installations'); expect(empty).not.toContain('aria-expanded');
});

it('shows waiting artwork before its download starts and keeps the current game in the sidebar', () => {
  const waiting = task({ id: 'waiting', title: 'Waiting game', status: 'queued', progress: null, coverUrl: 'data:image/png;base64,waiting' });
  const current = task({ coverUrl: 'data:image/png;base64,current' });
  const html = renderToStaticMarkup(<QueuePreview tasks={previewTasks([waiting, current])} games={[]} />);
  expect(html).toContain('data:image/png;base64,waiting'); expect(html).toContain('data:image/png;base64,current');
  const summary = renderToStaticMarkup(<InstallQueueShortcut downloads={[waiting, current]} games={[]} active={false} openQueue={() => {}} />);
  expect(summary).toContain('Downloading (1/2)'); expect(summary).toContain('title="Sample game"');
  expect(summary).toContain('data:image/png;base64,current'); expect(summary).not.toContain('title="Waiting game"');
});

it('keeps unknown and paused progress honest in the sidebar', () => {
  const render = (patch: Partial<DownloadTask>) => renderToStaticMarkup(<InstallQueueShortcut downloads={[task(patch)]} games={[]} active={false} openQueue={() => {}} />);
  expect(render({ progress: null })).toContain('indeterminate');
  expect(render({ progress: null })).not.toContain('0%');
  expect(render({ status: 'paused', progress: 12 })).toContain('Paused (1/1)');
  expect(render({ status: 'paused', progress: 12 })).toContain('12%');
});
