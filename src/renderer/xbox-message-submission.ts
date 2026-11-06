import type { XboxSocialResult } from '../shared/xbox-social';

type Submission = { self: string; peer: string; text: string; phase: 'sending' | 'uncertain' | 'awaiting-history'; messageId?: string };
export type SubmissionHistoryResult = { kind: 'unchanged' } | { kind: 'confirmed' | 'reviewed'; text: string };
const validId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\s\x00-\x1f\x7f]/.test(value);
const player = (value: string) => /^[1-9]\d{0,19}$/.test(value) && BigInt(value) <= 18446744073709551615n;

/** One account/peer view owns this in-memory guard. It never submits, retries,
 * persists a draft, or interprets a submission receipt as recipient delivery. */
export class XboxMessageSubmission {
  private pending?: Submission;
  get blocked(): boolean { return Boolean(this.pending); }
  begin(self: string, peer: string, text: string): boolean {
    if (this.pending || !player(self) || !player(peer) || self === peer || !text.trim()) return false;
    this.pending = { self, peer, text, phase: 'sending' };
    return true;
  }
  receive(result: XboxSocialResult): boolean {
    const pending = this.pending;
    if (!pending || pending.phase !== 'sending') return false;
    const id = result.sent?.messageId;
    if (result.status !== 'ready' || result.selfXuid !== pending.self || result.peerXuid !== pending.peer || !validId(id)) {
      pending.phase = 'uncertain'; return false;
    }
    pending.messageId = id; pending.phase = 'awaiting-history'; return true;
  }
  failed(): void { if (this.pending?.phase === 'sending') this.pending.phase = 'uncertain'; }
  history(result: XboxSocialResult, manualReview: boolean): SubmissionHistoryResult {
    const pending = this.pending;
    if (!pending || pending.phase === 'sending' || result.status !== 'ready' || result.peerXuid !== pending.peer
      || result.selfXuid !== pending.self || !Array.isArray(result.messages)
      || new Set(result.messages.map(message => message.id)).size !== result.messages.length
      || result.messages.some(message => message.senderXuid !== pending.self && message.senderXuid !== pending.peer)) return { kind: 'unchanged' };
    if (pending.messageId && result.messages.some(message => message.id === pending.messageId && message.senderXuid === pending.self)) {
      this.pending = undefined; return { kind: 'confirmed', text: pending.text };
    }
    // Only an explicit, successful refresh can let the user review an uncertain
    // submission and decide whether to try again. The draft remains intact.
    if (manualReview) { this.pending = undefined; return { kind: 'reviewed', text: pending.text }; }
    return { kind: 'unchanged' };
  }
  reset(): void { this.pending = undefined; }
}
