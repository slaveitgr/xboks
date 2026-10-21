import { expect, it } from 'vitest';
import { desktopForegroundApp } from './desktop-shell.js';
it('accepts only bounded ephemeral desktop identity fields', () => {
  expect(desktopForegroundApp({ desktopId: '', name: 'Application', title: '' })).toEqual({ desktopId: '', name: 'Application', title: '' });
  for (const value of [null, [], { desktopId: 'id', name: '', title: '' }, { desktopId: 'id', name: 'App', title: 'private\nline' },
    { desktopId: 'id', name: 'App', title: '', executable: '/arbitrary/path' }, { desktopId: 'x'.repeat(257), name: 'App', title: '' }]) expect(desktopForegroundApp(value)).toBeUndefined();
});
