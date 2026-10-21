import { expect, it, vi } from 'vitest';
import { KeyringSupport } from './keyring.js';

function fixture({ collections = [] as string[], capability = true, owned = true } = {}) {
  let alias = '/', locked = false;
  const reply = (type: string, value: unknown) => JSON.stringify({ type, data: [value] });
  const execute = vi.fn(async (_command: string, args: string[]) => {
    if (args.includes('NameHasOwner')) return reply('b', owned);
    if (args.includes('ListActivatableNames')) return reply('as', []);
    if (args.includes('ReadAlias')) return reply('o', alias);
    if (args.includes('Collections')) return reply('v', { type: 'ao', data: collections });
    if (args.includes('Locked')) return reply('v', { type: 'b', data: locked });
    throw Error('Unexpected metadata request');
  });
  const create = vi.fn(async () => 'cancelled');
  const support = new KeyringSupport({ XDG_CURRENT_DESKTOP: 'gamescope' }, execute, 'linux', undefined, { canCreate: () => capability, create });
  return { support, create, execute, setWallet: (value: string, valueLocked = false) => { alias = value; locked = valueLocked; } };
}

it('offers explicit setup only for zero collections and never creates on check or startup', async () => {
  const f = fixture();
  expect(await f.support.check()).toMatchObject({ state: 'needs-setup', canCreate: true });
  expect(await f.support.startForStartup()).toMatchObject({ state: 'needs-setup', canCreate: true });
  expect(await f.support.start()).toMatchObject({ state: 'needs-setup', canCreate: true });
  expect(f.create).not.toHaveBeenCalled();
  expect(JSON.stringify(f.execute.mock.calls)).not.toMatch(/CreateCollection|SetAlias|Unlock|GetSecret|SetSecret/);
});
it.each([{ collections: ['/collection/existing'] }, { capability: false }, { owned: false }])('does not offer or invoke creation with %j', async options => {
  const f = fixture(options);
  expect((await f.support.check()).canCreate).not.toBe(true);
  await f.support.createCollection(); expect(f.create).not.toHaveBeenCalled();
});
it.each([false, true])('preserves an existing wallet that appeared before the click, locked=%s', async locked => {
  const f = fixture(); await f.support.check();
  f.setWallet('/collection/new', locked);
  expect((await f.support.createCollection()).state).toBe(locked ? 'locked' : 'ready');
  expect(f.create).not.toHaveBeenCalled();
});
it.each(['cancelled', 'timed-out', 'unavailable', 'ready'])('rechecks actual metadata and keeps setup result %s honest', async result => {
  const f = fixture();
  f.create.mockResolvedValue(result);
  const after = await f.support.createCollection();
  expect(after.state).toBe('needs-setup'); expect(after.canCreate).toBe(true);
  expect(f.create).toHaveBeenCalledOnce();
  if (result !== 'ready') expect(after.message).toMatch(/cancelled|timed out|could not be completed/);
});
it('returns ready only after the native provider exposes an unlocked default', async () => {
  const f = fixture();
  f.create.mockImplementation(async () => { f.setWallet('/collection/native'); return 'ready'; });
  expect((await f.support.createCollection()).state).toBe('ready');
});
it('serializes creation, activation and checks to one native dialog and supports retry', async () => {
  const f = fixture(); let done!: (value: string) => void;
  f.create.mockImplementation(() => new Promise(resolve => { done = resolve; }));
  const first = f.support.createCollection();
  expect(f.support.createCollection()).toBe(first); expect(f.support.start()).toBe(first); expect(f.support.check()).toBe(first);
  await vi.waitFor(() => expect(f.create).toHaveBeenCalledOnce());
  done('cancelled'); await first;
  expect(f.support.busy).toBe(false);
  f.create.mockResolvedValue('cancelled'); await f.support.createCollection();
  expect(f.create).toHaveBeenCalledTimes(2);
});
it('does not expose raw helper exceptions', async () => {
  const f = fixture(); f.create.mockRejectedValue(Error('private account detail'));
  expect((await f.support.createCollection()).message).not.toContain('private account');
});
