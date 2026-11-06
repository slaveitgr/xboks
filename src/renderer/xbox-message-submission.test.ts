import { describe, expect, it } from 'vitest';
import { XboxMessageSubmission } from './xbox-message-submission';
import { noXboxSocialCapabilities, type XboxSocialResult } from '../shared/xbox-social';

const ready = (extra: Partial<XboxSocialResult> = {}): XboxSocialResult => ({
  status: 'ready', checkedAt: '2026-11-06T12:00:00Z', selfXuid: '100', peerXuid: '200',
  capabilities: { ...noXboxSocialCapabilities, conversation: true, send: true }, ...extra,
});
const history = (extra: Partial<XboxSocialResult> = {}) => ready({ messages: [{ id: 'receipt-1', senderXuid: '100', text: 'Draft', deleted: false }], ...extra });
const start = () => { const state = new XboxMessageSubmission(); expect(state.begin('100', '200', 'Draft')).toBe(true); return state; };

describe('Xbox message submission reconciliation', () => {
  it('locks synchronously before the POST and refuses another submission', () => {
    const state = start(); expect(state.blocked).toBe(true);
    expect(state.begin('100', '200', 'Second')).toBe(false);
    expect(state.history(history(), true)).toEqual({ kind: 'unchanged' });
    expect(state.blocked).toBe(true);
  });
  it.each([undefined, '', ' ', 'contains space', '\0private', 'm'.repeat(257)])('retains an uncertain submission for invalid receipt %j', messageId => {
    const state = start(); expect(state.receive(ready({ sent: { messageId } }))).toBe(false);
    expect(state.history(history(), false)).toEqual({ kind: 'unchanged' });
    expect(state.blocked).toBe(true); expect(state.begin('100', '200', 'Draft')).toBe(false);
  });
  it('clears only after its exact ID and self sender appear in the same conversation', () => {
    const state = start(); expect(state.receive(ready({ sent: { messageId: 'receipt-1' } }))).toBe(true);
    for (const result of [history({ peerXuid: '300' }), history({ selfXuid: '300' }), history({ messages: [{ id: 'receipt-1', senderXuid: '200', deleted: false }] }), history({ messages: [{ id: 'other-id', senderXuid: '100', deleted: false }] })]) {
      expect(state.history(result, false)).toEqual({ kind: 'unchanged' }); expect(state.blocked).toBe(true);
    }
    expect(state.history(history(), false)).toEqual({ kind: 'confirmed', text: 'Draft' });
    expect(state.blocked).toBe(false);
    expect(state.history(history(), false)).toEqual({ kind: 'unchanged' });
  });
  it('does not clear a draft from ambiguous duplicate message IDs', () => {
    const state = start(); state.receive(ready({ sent: { messageId: 'receipt-1' } }));
    const messages = [{id:'receipt-1',senderXuid:'100',deleted:false},{id:'receipt-1',senderXuid:'200',deleted:false}];
    expect(state.history(history({messages}), false)).toEqual({kind:'unchanged'});
    expect(state.history(history({messages}), true)).toEqual({kind:'unchanged'});
    expect(state.blocked).toBe(true);
  });
  it('keeps the draft for a delayed history response and does not invent confirmation', () => {
    const state = start(); state.receive(ready({ sent: { messageId: 'receipt-1' } }));
    expect(state.history(history({ messages: [] }), false)).toEqual({ kind: 'unchanged' });
    expect(state.blocked).toBe(true);
    expect(state.history(history(), false)).toEqual({ kind: 'confirmed', text: 'Draft' });
  });
  it.each([{ status: 'error' as const }, { selfXuid: '300' }, { peerXuid: '300' }])('does not accept mismatched send metadata %j', patch => {
    const state = start(); expect(state.receive(ready({ sent: { messageId: 'receipt-1' }, ...patch }))).toBe(false);
    expect(state.history(history(), false)).toEqual({ kind: 'unchanged' }); expect(state.blocked).toBe(true);
  });
  it('never unlocks a failed POST from automatic empty or matching-text history', () => {
    const state = start(); state.failed();
    for (const result of [history({ messages: [] }), history()]) expect(state.history(result, false)).toEqual({ kind: 'unchanged' });
    expect(state.blocked).toBe(true);
  });
  it('allows explicit review only after a successful account/peer-bound manual refresh, with draft retained', () => {
    const state = start(); state.failed();
    for (const result of [history({ status: 'error' }), history({ selfXuid: '300' }), history({ peerXuid: '300' }), history({ messages: undefined }), history({ messages: [{ id: 'other', senderXuid: '300', deleted: false }] })]) {
      expect(state.history(result, true)).toEqual({ kind: 'unchanged' }); expect(state.blocked).toBe(true);
    }
    expect(state.history(history({ messages: [] }), true)).toEqual({ kind: 'reviewed', text: 'Draft' });
    expect(state.blocked).toBe(false); expect(state.begin('100', '200', 'Reviewed draft')).toBe(true);
  });
  it('does not let duplicate receipts or old history clear a later edited submission', () => {
    const state = start(); state.receive(ready({ sent: { messageId: 'receipt-1' } }));
    expect(state.history(history({ messages: [] }), true).kind).toBe('reviewed');
    state.begin('100', '200', 'Edited draft'); state.receive(ready({ sent: { messageId: 'receipt-2' } }));
    expect(state.receive(ready({ sent: { messageId: 'receipt-1' } }))).toBe(false);
    expect(state.history(history(), false)).toEqual({ kind: 'unchanged' }); expect(state.blocked).toBe(true);
  });
  it('drops its account/peer state on reset and discards a late receipt', () => {
    const state = start(); state.reset(); expect(state.blocked).toBe(false);
    expect(state.receive(ready({ sent: { messageId: 'receipt-1' } }))).toBe(false);
    expect(state.history(history(), true)).toEqual({ kind: 'unchanged' });
    expect(state.begin('300', '400', 'New account draft')).toBe(true);
    expect(state.receive(ready({ sent: { messageId: 'receipt-1' } }))).toBe(false);
  });
  it('rejects invalid player identities without beginning a submission', () => {
    const state = new XboxMessageSubmission();
    for (const [self, peer] of [['100', '100'], ['100', '0'], ['100', '18446744073709551616'], ['bad', '200']]) expect(state.begin(self, peer, 'Draft')).toBe(false);
    expect(state.blocked).toBe(false);
  });
});
