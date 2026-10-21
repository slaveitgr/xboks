import type { XboxChatMessage, XboxConversation, XboxFriend, XboxSocialResult } from '../shared/xbox-social.js';
import { noXboxSocialCapabilities } from '../shared/xbox-social.js';
import { spawnTracked } from './process.js';

export type SocialOperation = 'friends' | 'inbox' | 'conversation' | 'search' | 'send';
export type SocialReader = (binary: string, operation: SocialOperation, peer: string | undefined, body: object | undefined, signal: AbortSignal) => Promise<string>;
const MAX_BODY = 3_000_000;
export function socialPeer(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9]\d{0,19}$/.test(value) || BigInt(value) > 18_446_744_073_709_551_615n) throw Error('Invalid Xbox player ID.');
  return value;
}
const optionalText = (value: unknown, limit: number): string | undefined => typeof value === 'string' && value.length <= limit && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value) ? value : undefined;
const identifier = (value: unknown): string => {
  const result = optionalText(value, 256);
  if (!result || /\s/.test(result)) throw Error('Invalid Xbox response identifier.');
  return result;
};
const date = (value: unknown): string | undefined => typeof value === 'string' && value.length <= 40 && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : undefined;
function picture(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 4096) return;
  try { const url = new URL(value); if (url.protocol === 'https:' && !url.username && !url.password && !url.port && ['gamerpic.xboxlive.com', 'images-eds-ssl.xboxlive.com', 'avatar-ssl.xboxlive.com', 'xboxavatargamerpic.azureedge.net'].includes(url.hostname)) return url.href; } catch { /* No untrusted image host. */ }
}
function message(value: any): XboxChatMessage {
  if (!value || typeof value.deleted !== 'boolean') throw Error('Invalid Xbox message.');
  return { id: identifier(value.id), senderXuid: socialPeer(value.senderXuid), deleted: value.deleted,
    text: value.deleted ? undefined : optionalText(value.text, 16_384), sentAt: date(value.sentAt) };
}
export function parseXboxSocial(raw: string, account: string, operation: SocialOperation, peer?: string): XboxSocialResult {
  if (Buffer.byteLength(raw) > MAX_BODY) throw Error('Xbox response exceeds the size limit.');
  const value = JSON.parse(raw);
  if (!value || value.schema !== 1 || value.account !== account || value.status !== 'ready' || !value.capabilities) throw Error('Xbox account response mismatch.');
  const result: XboxSocialResult = { status: 'ready', checkedAt: new Date().toISOString(), selfXuid: socialPeer(value.selfXuid),
    capabilities: { ...noXboxSocialCapabilities } };
  if (operation === 'conversation' || operation === 'send') {
    if (socialPeer(value.peerXuid) !== socialPeer(peer)) throw Error('Xbox conversation target mismatch.');
    if (peer === result.selfXuid) throw Error('Unsupported conversation target.');
    result.peerXuid = peer;
  }
  for (const key of ['friends','presence','inbox','conversation','send','search'] as const) {
    if (typeof value.capabilities[key] !== 'boolean') throw Error('Invalid Xbox capabilities.');
    result.capabilities[key] = value.capabilities[key];
  }
  // Voice needs its own signaling/media implementation; a REST token is insufficient.
  if (operation === 'friends' || operation === 'search') {
    if (!Array.isArray(value.friends) || value.friends.length > 2000) throw Error('Invalid Xbox people list.');
    const seen = new Set<string>();
    result.friends = value.friends.map((item: any): XboxFriend => {
      const xuid = socialPeer(item?.xuid), gamertag = optionalText(item.gamertag, 256)?.trim();
      if (!gamertag || /[\r\n\t]/.test(gamertag) || seen.has(xuid)) throw Error('Invalid Xbox player.'); seen.add(xuid);
      return { xuid, gamertag, gamerpicUrl: picture(item.gamerpicUrl), presence: ['online','away','offline','unknown'].includes(item.presence) ? item.presence : 'unknown', activity: optionalText(item.activity, 512), lastSeenAt: date(item.lastSeenAt) };
    });
  }
  if (operation === 'inbox') {
    if (!Array.isArray(value.conversations) || value.conversations.length > 500) throw Error('Invalid Xbox inbox.');
    result.conversations = value.conversations.map((item: any): XboxConversation => {
      if (!Array.isArray(item.participants) || item.participants.length > 2 || typeof item.unread !== 'boolean') throw Error('Invalid Xbox conversation.');
      const peerXuid = socialPeer(item.peerXuid), participants: string[] = item.participants.map(socialPeer);
      if (peerXuid === result.selfXuid || participants.length !== 2 || new Set(participants).size !== 2 || !participants.includes(result.selfXuid!) || !participants.includes(peerXuid)) throw Error('Unsupported group conversation.');
      const lastMessage = item.lastMessage ? message(item.lastMessage) : undefined;
      if (lastMessage && !participants.includes(lastMessage.senderXuid)) throw Error('Unsupported conversation participant.');
      return { id: identifier(item.id), peerXuid, participants, unread: item.unread, updatedAt: date(item.updatedAt), lastMessage };
    });
    if (Number.isSafeInteger(value.omittedConversations) && value.omittedConversations > 0 && value.omittedConversations <= 10_000) result.omittedConversations = value.omittedConversations;
  }
  if (operation === 'conversation') {
    if (!Array.isArray(value.messages) || value.messages.length > 500) throw Error('Invalid Xbox messages.');
    result.messages = value.messages.map(message);
    if (result.messages!.some(item => item.senderXuid !== result.selfXuid && item.senderXuid !== peer)) throw Error('Unsupported conversation participant.');
  }
  if (operation === 'send') {
    if (!value.sent || typeof value.sent !== 'object') throw Error('Message delivery could not be confirmed.');
    result.sent = { messageId: value.sent.messageId ? identifier(value.sent.messageId) : undefined, conversationId: value.sent.conversationId ? identifier(value.sent.conversationId) : undefined };
  }
  result.continuationToken = optionalText(value.continuationToken, 8192);
  return result;
}

async function readSocial(binary: string, operation: SocialOperation, peer: string | undefined, body: object | undefined, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  const tracked = spawnTracked(binary, ['social', operation, ...(peer ? [peer] : []), '--json'], { maxOutput: MAX_BODY, stdoutOnly: true });
  const stop = () => { tracked.child.kill('SIGKILL'); };
  signal.addEventListener('abort', stop, { once: true });
  if (signal.aborted) stop();
  tracked.child.stdin.on('error', () => {});
  tracked.child.stdin.end(body ? JSON.stringify(body) : undefined);
  const timer = setTimeout(stop, 40_000); timer.unref();
  try { const result = await tracked.result; signal.throwIfAborted(); if (result.code !== 0) throw Error('Xbox request failed.'); return result.output; }
  finally { clearTimeout(timer); signal.removeEventListener('abort', stop); }
}

/** No private social data is persisted or logged. Both windows share this
 * account-bound cache; sign-out/backend changes cancel reads and discard it. */
export class XboxSocialService {
  private account?: string;
  private binary?: string;
  private generation = 0;
  private pending = new Map<string, { controller: AbortController; job: Promise<XboxSocialResult> }>();
  private cache = new Map<string, { until: number; value: XboxSocialResult }>();
  constructor(private reader: SocialReader = readSocial) {}
  select(account?: string, binary?: string): void {
    if (account === this.account && binary === this.binary) return;
    this.generation++; for (const request of this.pending.values()) request.controller.abort();
    this.pending.clear(); this.cache.clear(); this.account = account; this.binary = binary;
  }
  private state(status: XboxSocialResult['status'], reason: string): XboxSocialResult { return { status, reason, checkedAt: new Date().toISOString(), capabilities: { ...noXboxSocialCapabilities } }; }
  async request(operation: SocialOperation, options: { peer?: string; text?: string; query?: string; refresh?: boolean } = {}): Promise<XboxSocialResult> {
    if (operation === 'conversation' || operation === 'send') socialPeer(options.peer);
    if (operation === 'send' && (typeof options.text !== 'string' || !options.text.trim() || [...options.text].length > 256 || optionalText(options.text, 2048) === undefined)) throw Error('Messages must contain 1–256 characters.');
    if (operation === 'search' && (typeof options.query !== 'string' || !options.query.trim() || [...options.query].length > 64 || optionalText(options.query, 256) === undefined)) throw Error('Enter a player name of 1–64 characters.');
    const account = this.account, binary = this.binary, generation = this.generation;
    if (!account) return this.state('signed-out', 'Sign in to your Xbox account to load friends and chats.');
    if (!binary) return this.state('unsupported', 'This Nexus backend does not include Xbox social support. Update the backend in Settings.');
    const key = `${operation}:${options.peer ?? options.query ?? ''}`;
    if (this.pending.has(key)) {
      if (operation === 'send') throw Error('Wait for the pending message to finish.');
      return this.pending.get(key)!.job;
    }
    if (this.pending.size >= 6) return this.state('error', 'Wait for the current Xbox requests to finish.');
    const cached = this.cache.get(key);
    if (!options.refresh && operation !== 'send' && cached && cached.until > Date.now()) return structuredClone(cached.value);
    const controller = new AbortController();
    const job = (async () => {
      try {
        const raw = await this.reader(binary, operation, options.peer, operation === 'send' ? { text: options.text } : operation === 'search' ? { query: options.query?.trim() } : undefined, controller.signal);
        if (generation !== this.generation || controller.signal.aborted) throw Error('Account changed.');
        const value = parseXboxSocial(raw, account, operation, options.peer);
        if (operation === 'send') this.cache.clear();
        else { if (this.cache.size >= 64) this.cache.delete(this.cache.keys().next().value!); this.cache.set(key, { until: Date.now() + 20_000, value }); }
        return structuredClone(value);
      } catch {
        return this.state('error', operation === 'send' ? 'Message delivery could not be confirmed. Check the conversation before sending again.' : 'Xbox social could not load. Refresh your Xbox account in Settings, then check your connection and account permissions.');
      } finally { if (generation === this.generation) this.pending.delete(key); }
    })();
    this.pending.set(key, { controller, job });
    return job;
  }
}
