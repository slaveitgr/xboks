import { expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
const mock = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('./process.js', () => ({ spawnTracked: mock.spawn }));
import { WalletUnlocker } from './keyring-unlock.js';
it('runs collection creation as a distinct password-free helper operation', async () => {
  mock.spawn.mockReturnValue({ child: {}, result: Promise.resolve({ code: 0, output: '{"schema":1,"state":"ready"}' }) });
  expect(await new WalletUnlocker().create('/backend','12345')).toBe('ready');
  expect(mock.spawn).toHaveBeenLastCalledWith('/backend',['keyring-create','--window-id','12345'],expect.objectContaining({stdoutOnly:true,maxOutput:4096}));
});
it.each(['ready','locked','stopped','needs-setup','cancelled','timed-out','unavailable'])('accepts only the fixed helper state %s', async state => {
  const child = Object.assign(new EventEmitter(), { kill: vi.fn() });
  mock.spawn.mockReturnValue({ child, result: Promise.resolve({ code: 0, output: JSON.stringify({schema:1,state}) }) });
  expect(await new WalletUnlocker().unlock('/backend', '12345')).toBe(state);
  expect(mock.spawn).toHaveBeenLastCalledWith('/backend', ['keyring-unlock','--window-id','12345'], expect.objectContaining({stdoutOnly:true,maxOutput:4096}));
});
it.each(['private provider text', '{"schema":1,"state":"private-secret"}', '{"schema":2,"state":"ready"}', '{"state":"ready"}'])('rejects malformed or unknown helper output without exposing it', async output => {
  mock.spawn.mockReturnValue({child:{},result:Promise.resolve({code:0,output})});
  expect(await new WalletUnlocker().unlock('/backend')).toBe('unavailable');
});
it('rejects unsafe window IDs and overlapping requests, and cancels only its own helper', async () => {
  mock.spawn.mockClear();
  const unlocker = new WalletUnlocker();
  expect(await unlocker.unlock('/backend','1\n--bad')).toBe('unavailable');
  expect(mock.spawn).not.toHaveBeenCalled();
  let finish!: (value: unknown) => void;
  const kill=vi.fn(), child={kill,exitCode:null,signalCode:null};
  mock.spawn.mockReturnValue({child,result:new Promise(resolve=>{finish=resolve;})});
  const task=unlocker.unlock('/backend');
  expect(unlocker.busy).toBe(true);
  expect(await unlocker.unlock('/backend')).toBe('unavailable');
  expect(await unlocker.create('/backend')).toBe('unavailable');
  unlocker.cancel(); expect(kill).toHaveBeenCalledWith('SIGINT');
  child.signalCode='SIGINT' as any;
  finish({code:0,output:'{"schema":1,"state":"cancelled"}'});
  expect(await task).toBe('cancelled'); expect(unlocker.busy).toBe(false);
});
