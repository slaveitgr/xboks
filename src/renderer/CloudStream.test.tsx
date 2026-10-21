import {expect, it, vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {CloudFailureDetails, CloudStreamHost, observeCloudSession, ownCloudVideo, type CloudVideoStatus} from './CloudStream';
import {CloudPlayerError, type CloudPlayerHandle, type connectCloudPlayer} from './cloud-player';
import type {CloudSessionState} from '../shared/cloud-stream';

function fixture() {
  let resolve!: (handle: CloudPlayerHandle) => void, reject!: (reason: unknown) => void;
  let callbacks!: Parameters<typeof connectCloudPlayer>[0];
  const connect = vi.fn((options: Parameters<typeof connectCloudPlayer>[0]) => {callbacks = options; return new Promise<CloudPlayerHandle>((yes, no) => {resolve = yes; reject = no;});});
  const changed = vi.fn(), message = vi.fn(), ready = vi.fn(), handle = {close: vi.fn(), pause: vi.fn(), guide: vi.fn(), mute: vi.fn()};
  const bridge = {exchangeCloudSdp: vi.fn(), exchangeCloudIce: vi.fn()};
  const owned = ownCloudVideo({id: 'owned-session', bridge, changed, message, ready, connect});
  return {owned, changed, message, ready, handle, resolve, reject, bridge, get callbacks() {return callbacks;}};
}
it('surfaces a safe renderer-stage failure rather than swallowing the player error', async () => {
  const f = fixture(); f.callbacks.diagnostic?.('apply-answer'); f.reject(new CloudPlayerError('apply-answer', 'failed')); await f.owned.pending;
  expect(f.changed).toHaveBeenLastCalledWith({connection: 'error', stage: 'apply-answer', failure: {stage: 'apply-answer', code: 'failed'}});
  const html = renderToStaticMarkup(<CloudFailureDetails state={{phase: 'ready'}} transport={f.changed.mock.calls.at(-1)![0]}/>);
  expect(html).toContain('apply-answer'); expect(html).toContain('failed'); expect(html).toContain('Connection details'); f.owned.close();
});
it('does not expose arbitrary exception messages when an unexpected adapter failure occurs', async () => {
  const f = fixture(); f.callbacks.diagnostic?.('local-description'); f.reject(Error('secret-ticket and raw SDP private-fixture')); await f.owned.pending;
  const result = f.changed.mock.calls.at(-1)![0] as CloudVideoStatus;
  expect(result.failure).toEqual({stage: 'local-description', code: 'failed'});
  expect(JSON.stringify(result)).not.toMatch(/secret-ticket|SDP|private-fixture/); f.owned.close();
});
it('closes a player completed after host replacement and ignores all stale session callbacks', async () => {
  const f = fixture(), calls = f.changed.mock.calls.length; f.owned.close(); expect(f.callbacks.signal.aborted).toBe(true);
  f.callbacks.changed('connected'); f.callbacks.diagnostic?.('connected'); f.callbacks.message(undefined); f.resolve(f.handle); await f.owned.pending;
  expect(f.handle.close).toHaveBeenCalledOnce(); expect(f.ready).not.toHaveBeenCalled(); expect(f.message).not.toHaveBeenCalled(); expect(f.changed).toHaveBeenCalledTimes(calls);
});
it('ignores a late cancelled rejection and resets every diagnostic field for the next session', async () => {
  const first = fixture(); first.callbacks.diagnostic?.('exchange-sdp'); first.owned.close(); first.reject(new CloudPlayerError('exchange-sdp', 'cancelled')); await first.owned.pending;
  expect(first.changed.mock.calls.some(([value]) => value.connection === 'error')).toBe(false);
  const second = fixture(); expect(second.changed).toHaveBeenCalledWith({connection: 'connecting'});
  expect(second.changed.mock.calls[0][0]).not.toHaveProperty('stage'); expect(second.changed.mock.calls[0][0]).not.toHaveProperty('failure');
  second.resolve(second.handle); await second.owned.pending; expect(second.ready).toHaveBeenCalledWith(second.handle); second.owned.close(); second.owned.close(); expect(second.handle.close).toHaveBeenCalledOnce();
});
it('renders only allowlisted service stage and bounded HTTP diagnostics', () => {
  const html = renderToStaticMarkup(<CloudFailureDetails state={{phase: 'error', error: 'service', errorStage: 'sdp-receive', httpStatus: 502}} transport={{connection: 'connecting'}}/>);
  expect(html).toContain('sdp-receive'); expect(html).toContain('HTTP 502');
  expect(renderToStaticMarkup(<CloudFailureDetails state={{phase: 'error', errorStage: 'private-provider-response', httpStatus: 9999} as unknown as CloudSessionState} transport={{connection: 'error'}}/>)).toBe('');
});
it.each(['transfer-credential', 'connect'] as const)('preserves the exact %s service stage in failure details', errorStage => {
  const html = renderToStaticMarkup(<CloudFailureDetails state={{phase: 'error', error: 'transfer-token-required', errorStage}} transport={{connection: 'connecting'}}/>);
  expect(html).toContain(errorStage); expect(html).toContain('Cloud service stage');
});
it('preserves a newer session push and ignores initial snapshots or updates after disposal', async () => {
  let deliver!: (state: CloudSessionState) => void, initial!: (state: CloudSessionState) => void;
  const changed = vi.fn(), remove = vi.fn(), dispose = observeCloudSession({onCloudStreamState: callback => {deliver = callback; return remove;}, getCloudStreamState: () => new Promise(resolve => {initial = resolve;})}, changed);
  deliver({phase: 'starting', id: 'new'}); initial({phase: 'error', id: 'old', errorStage: 'play'}); await Promise.resolve();
  expect(changed).toHaveBeenCalledOnce(); expect(changed).toHaveBeenCalledWith({phase: 'starting', id: 'new'});
  dispose(); deliver({phase: 'error', id: 'new'}); expect(changed).toHaveBeenCalledOnce(); expect(remove).toHaveBeenCalledOnce();
});
it('does not create a player, sign in or read diagnostics merely by rendering a closed host', () => {
  const bridge = {readBackendDiagnosticLog: vi.fn(), getCloudStreamState: vi.fn(), startCloudStream: vi.fn()};
  expect(renderToStaticMarkup(<CloudStreamHost bridge={bridge}/>)).toBe('');
  for (const call of Object.values(bridge)) expect(call).not.toHaveBeenCalled();
});
