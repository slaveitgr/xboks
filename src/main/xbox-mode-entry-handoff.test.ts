import { describe, expect, it, vi } from 'vitest';
import { XboxModeEntryHandoff, type XboxModeEntryRequest } from './xbox-mode-entry-handoff.js';

interface Target { focused: boolean; destroyed: boolean; visible: boolean }
const window = (focused = false): Target => ({ focused, destroyed: false, visible: true });
function fixture(existing: Target | undefined = window()) {
  const source = {}, state = { source, originalSource: source, sourceAlive: true, authorized: true, shutdown: false, active: false,
    target: existing, time: 0, afterShow: () => {}, afterWait: () => {}, afterHide: () => {} };
  const show = vi.fn(async () => { state.target ??= window(); state.afterShow(); });
  const hide = vi.fn(() => state.afterHide());
  const requested = vi.fn();
  const wait = vi.fn(async () => { state.time += 50; state.afterWait(); });
  const handoff = new XboxModeEntryHandoff({ now: () => state.time, wait });
  const request: XboxModeEntryRequest<Target> = {
    authorized: () => state.authorized,
    valid: () => state.source === state.originalSource && state.sourceAlive && !state.shutdown && !state.active,
    hide, show, target: () => state.target, targetValid: target => !target.destroyed && target.visible,
    focused: target => target.focused, requested,
  };
  return { state, handoff, request, hide, show, wait, requested };
}

describe('Game Bar Xbox mode dialog handoff', () => {
  it('shows once and opens choices only after the same launcher gains compositor focus', async () => {
    const f=fixture(),original=f.state.target;
    f.state.afterWait=()=>{if(f.state.time===150)f.state.target!.focused=true;};
    await f.handoff.request(f.request);
    expect(f.hide).toHaveBeenCalledOnce();expect(f.show).toHaveBeenCalledOnce();expect(f.wait).toHaveBeenCalledTimes(3);
    expect(f.requested.mock.calls).toEqual([[original]]);
  });
  it('accepts a lazily created main window and does not wait when it is already focused', async () => {
    const f=fixture();
    f.state.target=undefined;f.state.afterShow=()=>{f.state.target!.focused=true;};
    await f.handoff.request(f.request);
    expect(f.requested.mock.calls).toEqual([[f.state.target]]);expect(f.wait).not.toHaveBeenCalled();
  });
  it('bounds the focus wait at two seconds without repeating show or activation', async () => {
    const f=fixture();
    await expect(f.handoff.request(f.request)).rejects.toThrow('did not focus');
    expect(f.state.time).toBe(2000);expect(f.show).toHaveBeenCalledOnce();expect(f.hide).toHaveBeenCalledOnce();
    expect(f.requested).not.toHaveBeenCalled();
  });
  it('rejects late focus even if it appears during a delayed timer', async () => {
    const f=fixture();f.state.afterWait=()=>{f.state.time=2001;f.state.target!.focused=true;};
    await expect(f.handoff.request(f.request)).rejects.toThrow('did not focus');expect(f.requested).not.toHaveBeenCalled();
  });
  it('rejects duplicate requests while showing and becomes available again after completion', async () => {
    const f=fixture(window(true));let finishShow!:()=>void;
    f.show.mockImplementationOnce(()=>new Promise<void>(resolve=>{finishShow=resolve;}));
    const pending=f.handoff.request(f.request);
    await expect(f.handoff.request(f.request)).rejects.toThrow('already in progress');
    expect(f.show).toHaveBeenCalledOnce();finishShow();await pending;
    await f.handoff.request(f.request);expect(f.requested).toHaveBeenCalledTimes(2);expect(f.show).toHaveBeenCalledTimes(2);
  });
  it('does not hide or show for an unfocused or invalid original Guide', async () => {
    const f=fixture();f.state.authorized=false;
    await expect(f.handoff.request(f.request)).rejects.toThrow('focused Game Bar');
    f.state.authorized=true;f.state.sourceAlive=false;
    await expect(f.handoff.request(f.request)).rejects.toThrow('no longer available');
    expect(f.hide).not.toHaveBeenCalled();expect(f.show).not.toHaveBeenCalled();expect(f.requested).not.toHaveBeenCalled();
  });
  it('rechecks the original source after hide before issuing the one show request', async () => {
    const f=fixture();f.state.afterHide=()=>{f.state.source={};};
    await expect(f.handoff.request(f.request)).rejects.toThrow('no longer available');
    expect(f.hide).toHaveBeenCalledOnce();expect(f.show).not.toHaveBeenCalled();expect(f.requested).not.toHaveBeenCalled();
  });
  for (const phase of ['show','wait'] as const) {
    it.each(['source destroyed','source replaced','shutdown','active mode'] as const)(`cancels when %s occurs during ${phase}`,async reason=>{
      const f=fixture(),invalidate=()=>{
        if(reason==='source destroyed')f.state.sourceAlive=false;
        else if(reason==='source replaced')f.state.source={};
        else if(reason==='shutdown')f.state.shutdown=true;
        else f.state.active=true;
      };
      if(phase==='show')f.state.afterShow=invalidate;else f.state.afterWait=invalidate;
      await expect(f.handoff.request(f.request)).rejects.toThrow('no longer available');expect(f.requested).not.toHaveBeenCalled();
    });
    it.each(['destroyed','replaced','hidden','missing'] as const)(`cancels when the original launcher is %s during ${phase}`,async reason=>{
      const f=fixture(),invalidate=()=>{
        if(reason==='destroyed')f.state.target!.destroyed=true;
        else if(reason==='hidden')f.state.target!.visible=false;
        else f.state.target=reason==='replaced'?window(true):undefined;
      };
      if(phase==='show')f.state.afterShow=invalidate;else f.state.afterWait=invalidate;
      await expect(f.handoff.request(f.request)).rejects.toThrow('launcher window changed');expect(f.requested).not.toHaveBeenCalled();
    });
  }
  it('clears the shared busy guard after show failure so a later explicit request can succeed', async () => {
    const f=fixture(window(true));f.show.mockRejectedValueOnce(Error('Renderer failed to load'));
    await expect(f.handoff.request(f.request)).rejects.toThrow('Renderer failed to load');
    expect(f.requested).not.toHaveBeenCalled();await f.handoff.request(f.request);expect(f.requested).toHaveBeenCalledOnce();
  });
  it('rechecks source and target after focus is observed, immediately before dispatch', async () => {
    const f=fixture(window(true));f.request.focused=()=>{f.state.shutdown=true;return true;};
    await expect(f.handoff.request(f.request)).rejects.toThrow('no longer available');expect(f.requested).not.toHaveBeenCalled();
  });
});
