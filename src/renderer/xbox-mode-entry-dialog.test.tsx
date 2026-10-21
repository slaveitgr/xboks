import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { confirmXboxModeRestart, XboxModeEntryDialog } from './XboxModeEntryDialog';

afterEach(() => vi.unstubAllGlobals());
function bridge() {
  return { getXboxModeRestartStatus: vi.fn(async () => ({ available:true })), prepareXboxModeRestart: vi.fn(async () => ({ token:'fresh-fixture-token', expiresAt:new Date(Date.now() + 60000).toISOString() })), restartIntoXboxMode: vi.fn(async (_token:string) => {}) };
}
describe('Xbox mode restart choice', () => {
  it('prepares a fresh token before each explicit restart and passes only that token', async () => {
    const api=bridge();
    await expect(confirmXboxModeRestart(api)).resolves.toBe(true);
    expect(api.prepareXboxModeRestart).toHaveBeenCalledOnce(); expect(api.restartIntoXboxMode).toHaveBeenCalledOnce(); expect(api.restartIntoXboxMode).toHaveBeenCalledWith('fresh-fixture-token');
    api.prepareXboxModeRestart.mockResolvedValueOnce({token:'next-fixture-token',expiresAt:new Date(Date.now()+60000).toISOString()});
    await confirmXboxModeRestart(api);
    expect(api.prepareXboxModeRestart).toHaveBeenCalledTimes(2); expect(api.restartIntoXboxMode).toHaveBeenLastCalledWith('next-fixture-token');
    expect(api.getXboxModeRestartStatus).not.toHaveBeenCalled();
  });
  it.each([{token:'expired',expiresAt:new Date(0).toISOString()},{token:'bad-date',expiresAt:'not-a-date'},{token:' ',expiresAt:new Date(Date.now()+60000).toISOString()}])('blocks invalid or expired preparation %j', async prepared => {
    const api=bridge(); api.prepareXboxModeRestart.mockResolvedValueOnce(prepared);
    await expect(confirmXboxModeRestart(api)).rejects.toThrow('expired'); expect(api.restartIntoXboxMode).not.toHaveBeenCalled();
  });
  it('does not restart after the dialog is dismissed during preparation', async () => {
    const api=bridge(); let open=true;
    api.prepareXboxModeRestart.mockImplementationOnce(async()=>{open=false;return{token:'cancelled',expiresAt:new Date(Date.now()+60000).toISOString()};});
    await expect(confirmXboxModeRestart(api,()=>open)).resolves.toBe(false); expect(api.restartIntoXboxMode).not.toHaveBeenCalled();
  });
  it('locks cancellation only after validating preparation and immediately before dispatch', async () => {
    const api=bridge(),order:string[]=[];
    api.prepareXboxModeRestart.mockImplementationOnce(async()=>{order.push('prepare');return{token:'valid',expiresAt:new Date(Date.now()+60000).toISOString()};});
    api.restartIntoXboxMode.mockImplementationOnce(async()=>{order.push('restart');});
    await confirmXboxModeRestart(api,()=>true,()=>{order.push('lock');});
    expect(order).toEqual(['prepare','lock','restart']);
    const lock=vi.fn();api.prepareXboxModeRestart.mockResolvedValueOnce({token:'expired',expiresAt:new Date(0).toISOString()});
    await expect(confirmXboxModeRestart(api,()=>true,lock)).rejects.toThrow('expired');expect(lock).not.toHaveBeenCalled();
    await expect(confirmXboxModeRestart(api,()=>false,lock)).resolves.toBe(false);expect(lock).not.toHaveBeenCalled();
  });
  it('requires both restart methods and propagates preparation or dispatch failures', async () => {
    const api=bridge(); await expect(confirmXboxModeRestart({prepareXboxModeRestart:api.prepareXboxModeRestart})).rejects.toThrow('unavailable'); expect(api.prepareXboxModeRestart).not.toHaveBeenCalled();
    api.prepareXboxModeRestart.mockRejectedValueOnce(new Error('blocked')); await expect(confirmXboxModeRestart(api)).rejects.toThrow('blocked'); expect(api.restartIntoXboxMode).not.toHaveBeenCalled();
    api.restartIntoXboxMode.mockRejectedValueOnce(new Error('restart refused')); await expect(confirmXboxModeRestart(api)).rejects.toThrow('restart refused');
  });
});
it.each(['en','el'])('renders the %s modal with three explicit choices and truthful performance copy, without touching the bridge', language => {
  vi.stubGlobal('localStorage',{getItem:()=>language}); const api=bridge(),startNow=vi.fn(async()=>{}),close=vi.fn();
  const html=renderToStaticMarkup(<XboxModeEntryDialog bridge={api} startNow={startNow} close={close}/>);
  expect(html).toContain('role="dialog"'); expect(html).toContain('aria-modal="true"'); expect(html.match(/data-xbox-mode-action=/g)).toHaveLength(3);
  expect(html).toContain(language==='el'?'Επανεκκίνηση σε λειτουργία Xbox':'Restart into Xbox mode');
  expect(html).toContain(language==='el'?'Έναρξη τώρα (δεν υπάρχουν αλλαγές επιδόσεων)':'Start now (no performance changes)');
  expect(html).toContain(language==='el'?'Παραμείνετε στην επιφάνεια εργασίας':'Remain on desktop'); expect(html).toContain('GNOME');
  expect(html).toMatch(/data-xbox-mode-action="restart"[^>]*disabled/); expect(html).toMatch(/data-xbox-mode-action="remain"[^>]*data-gamepad-initial/);
  for(const call of [api.getXboxModeRestartStatus,api.prepareXboxModeRestart,api.restartIntoXboxMode,startNow,close])expect(call).not.toHaveBeenCalled();
});
