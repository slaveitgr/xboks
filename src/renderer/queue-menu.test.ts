import { expect, it } from 'vitest';
import { downloadMenuItems } from './queue-menu';
import type { DownloadTask } from '../shared/types';

const task: DownloadTask = { id: 'operation-1', productId: 'product-A', title: 'Game', destination: '/tmp/game', status: 'paused', canPause: true, progress: 4, phase: 'Paused', log: [], startedAt: 'now' };
it('keeps navigation on product identity and mutations on the selected operation', () => {
  const calls: string[] = [];
  const items = downloadMenuItems(task, { details: value => calls.push(value.productId), pauseOrResume: value => calls.push(value.id), retry: () => {}, cancel: id => calls.push(id), log: () => {}, remove: () => {} });
  items.find(item => item.id === 'details')!.onSelect();
  items.find(item => item.id === 'resume')!.onSelect();
  items.find(item => item.id === 'cancel')!.onSelect();
  expect(calls).toEqual(['product-A', 'operation-1', 'operation-1']);
});
it('does not hide Cancel when the current transfer phase cannot Pause', () => {
  const items = downloadMenuItems({ ...task, status: 'running', canPause: false }, { pauseOrResume: () => {}, retry: () => {}, cancel: () => {}, log: () => {}, remove: () => {} });
  expect(items.find(item => item.id === 'pause')?.disabled).toBe(true);
  expect(items.find(item => item.id === 'cancel')?.hidden).toBe(false);
  expect(items.find(item => item.id === 'cancel')?.disabled).toBeFalsy();
});
it('keeps pending or cancelling operations disabled, and does not offer fake prioritization', () => {
  const actions = { pauseOrResume: () => {}, retry: () => {}, cancel: () => {}, log: () => {}, remove: () => {} };
  const pending = downloadMenuItems({ ...task, controlPending: true }, actions);
  expect(pending.find(item => item.id === 'resume')?.disabled).toBe(true);
  const queued = downloadMenuItems({ ...task, status: 'queued' }, actions);
  expect(queued.find(item => item.id === 'prioritize')?.hidden).toBe(false);
  expect(queued.find(item => item.id === 'prioritize')?.disabled).toBe(true);
});
