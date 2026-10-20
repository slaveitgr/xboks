import { expect, it, vi } from 'vitest';
import type { DownloadTask } from '../shared/types.js';
import { DownloadCompletionNotifications } from './download-notifications.js';

const task = (patch: Partial<DownloadTask> = {}): DownloadTask => ({ id: 'synthetic', title: 'Sample game',
  productId: '9AAAAAAAAAAA', destination: '/synthetic', status: 'complete', progress: 100,
  phase: 'Complete', log: [], startedAt: '2026-10-17', ...patch });

it.each(['queued', 'running', 'paused', 'failed', 'cancelled'] as const)('does not notify for %s jobs', status => {
  const port = { isSupported: vi.fn(() => true), show: vi.fn() };
  expect(new DownloadCompletionNotifications(port).complete(task({ status }))).toBe(false);
  expect(port.isSupported).not.toHaveBeenCalled(); expect(port.show).not.toHaveBeenCalled();
});

it.each([['install', 'Download complete'], ['update', 'Game update complete'], ['content', 'Content download complete']] as const)
('notifies once per successful %s, without touching task state', (kind, title) => {
  const port = { isSupported: () => true, show: vi.fn() }, notifications = new DownloadCompletionNotifications(port);
  const value = task({ kind }), before = structuredClone(value);
  expect(notifications.complete(value)).toBe(true); expect(notifications.complete(value)).toBe(false);
  expect(port.show).toHaveBeenCalledOnce();
  expect(port.show).toHaveBeenCalledWith({ title, body: 'Sample game has finished downloading.' });
  expect(value).toEqual(before);
});

it('does not replay history on creation and handles unsupported desktops gracefully', () => {
  const port = { isSupported: () => false, show: vi.fn() };
  const notifications = new DownloadCompletionNotifications(port);
  expect(port.show).not.toHaveBeenCalled(); expect(notifications.complete(task())).toBe(false);
  expect(port.show).not.toHaveBeenCalled();
});

it('keeps notification service failures out of installation results', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    for (const port of [
      { isSupported: () => { throw Error('Unsupported session'); }, show: vi.fn() },
      { isSupported: () => true, show: () => { throw Error('Notification service failed'); } },
    ]) {
      const value = task(); expect(new DownloadCompletionNotifications(port).complete(value)).toBe(false);
      expect(value.status).toBe('complete');
    }
    expect(warn).toHaveBeenCalledTimes(2);
  } finally { warn.mockRestore(); }
});
