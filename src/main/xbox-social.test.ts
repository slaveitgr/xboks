import { describe, expect, it, vi } from 'vitest';
import { parseXboxSocial, socialPeer, XboxSocialService, type SocialReader } from './xbox-social';

const capabilities = { friends:true,presence:true,inbox:true,conversation:true,send:true,search:true,partyVoice:true };
const envelope = (extra: object = {}, account = 'sample@example.test') => JSON.stringify({ schema:1, account, selfXuid:'100', status:'ready', capabilities, ...extra });
const friend = { xuid:'200',gamertag:'Friend',presence:'unknown',gamerpicUrl:'https://example.invalid/private.png' };
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };

describe('Xbox social response boundaries', () => {
  it('requires a real submission receipt and preserves its exact message identifier', () => {
    const result = parseXboxSocial(envelope({ peerXuid:'200',sent:{messageId:'submission-123',conversationId:'thread-1',privateToken:'discard'} }),'sample@example.test','send','200');
    expect(result.sent).toEqual({messageId:'submission-123',conversationId:'thread-1'});
    expect(JSON.stringify(result.sent)).not.toContain('privateToken');
    for (const sent of [{},{messageId:''},{messageId:' '},{messageId:'bad id'},{messageId:'id\nsecret'},{messageId:123},{messageId:'x'.repeat(257)},[],null]) {
      expect(() => parseXboxSocial(envelope({peerXuid:'200',sent}),'sample@example.test','send','200')).toThrow();
    }
    expect(() => parseXboxSocial(envelope({peerXuid:'300',sent:{messageId:'submission-123'}}),'sample@example.test','send','200')).toThrow('target');
  });
  it('matches the backend positive u64 identity bounds without number rounding', () => {
    for (const id of ['1','9007199254740993','18446744073709551615']) expect(socialPeer(id)).toBe(id);
    for (const id of ['0','01','18446744073709551616','99999999999999999999','184467440737095516150','1e3','+1',' 1',1,null]) expect(() => socialPeer(id)).toThrow('player ID');
    expect(() => parseXboxSocial(envelope({ selfXuid:'18446744073709551616',friends:[] }),'sample@example.test','friends')).toThrow('player ID');
  });
  it('binds the account and strips unknown/private fields and unsupported voice capability', () => {
    const raw = envelope({friends:[friend],privateToken:'must-not-leave-backend'});
    const result = parseXboxSocial(raw, 'sample@example.test', 'friends');
    expect(result.status).toBe('ready'); expect(result.friends?.[0].presence).toBe('unknown');
    expect(result.friends?.[0].gamerpicUrl).toBeUndefined(); expect(result.capabilities.partyVoice).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/must-not-leave|privateToken|sample@example/);
    expect(() => parseXboxSocial(raw, 'other@example.test', 'friends')).toThrow('mismatch');
  });
  it('rejects invalid and duplicate people instead of inventing online state', () => {
    expect(() => parseXboxSocial(envelope({friends:[friend,friend]}), 'sample@example.test','friends')).toThrow();
    expect(() => parseXboxSocial(envelope({friends:[{...friend,xuid:'200;command'}]}), 'sample@example.test','friends')).toThrow();
    expect(parseXboxSocial(envelope({friends:[{...friend,presence:'future-value'}]}),'sample@example.test','friends').friends?.[0].presence).toBe('unknown');
  });
  it('checks peer identity, keeps deleted/filtered states and rejects group messages', () => {
    const raw = envelope({peerXuid:'200',messages:[{id:'m1',senderXuid:'200',text:'deleted private text',deleted:true},{id:'m2',senderXuid:'100',deleted:false}]});
    const result = parseXboxSocial(raw,'sample@example.test','conversation','200');
    expect(result.messages?.map(item => item.text)).toEqual([undefined,undefined]);
    expect(() => parseXboxSocial(raw,'sample@example.test','conversation','300')).toThrow('target');
    expect(() => parseXboxSocial(envelope({peerXuid:'200',messages:[{id:'same',senderXuid:'100',deleted:false,text:'First'},{id:'same',senderXuid:'200',deleted:false,text:'Second'}]}),'sample@example.test','conversation','200')).toThrow('Duplicate');
    expect(() => parseXboxSocial(envelope({peerXuid:'200',messages:[{id:'m1',senderXuid:'300',deleted:false,text:'third party'}]}),'sample@example.test','conversation','200')).toThrow('participant');
  });
  it('requires two distinct bound inbox participants and a matching preview sender', () => {
    const conversation = { id:'c1',peerXuid:'200',participants:['100','200'],unread:true,lastMessage:{id:'m1',senderXuid:'200',text:'Hello',deleted:false} };
    expect(parseXboxSocial(envelope({conversations:[conversation]}),'sample@example.test','inbox').conversations).toHaveLength(1);
    for (const participants of [[],['100'],['200','200'],['100','300']]) expect(() => parseXboxSocial(envelope({conversations:[{...conversation,participants}]}),'sample@example.test','inbox')).toThrow();
    expect(() => parseXboxSocial(envelope({conversations:[{...conversation,lastMessage:{...conversation.lastMessage,senderXuid:'300'}}]}),'sample@example.test','inbox')).toThrow('participant');
    expect(() => parseXboxSocial(envelope({conversations:[{...conversation,peerXuid:'100'}]}),'sample@example.test','inbox')).toThrow();
  });
});
describe('account-bound social requests shared by both windows', () => {
  it('treats a malformed successful send as uncertain and invalidates pre-send cached history', async () => {
    const reader = vi.fn<SocialReader>(async (_binary, operation) => operation === 'send'
      ? envelope({peerXuid:'200',sent:{}})
      : envelope({peerXuid:'200',messages:[]}));
    const service = new XboxSocialService(reader);
    service.select('sample@example.test','/fixture/xodus-cli');
    await service.request('conversation',{peer:'200'}); await service.request('conversation',{peer:'200'});
    expect(reader).toHaveBeenCalledTimes(1);
    const sent = await service.request('send',{peer:'200',text:'Synthetic draft'});
    expect(sent.status).toBe('error'); expect(sent.sent).toBeUndefined(); expect(sent.reason).toContain('could not be confirmed');
    await service.request('conversation',{peer:'200'});
    expect(reader.mock.calls.filter(call => call[1] === 'send')).toHaveLength(1);
    expect(reader.mock.calls.filter(call => call[1] === 'conversation')).toHaveLength(2);
  });
  it('deduplicates reads and caches only the selected account in memory', async () => {
    const wait = deferred<string>(), reader = vi.fn<SocialReader>(() => wait.promise), service = new XboxSocialService(reader);
    service.select('sample@example.test','/fixture/xodus-cli');
    const app = service.request('friends'), guide = service.request('friends');
    expect(reader).toHaveBeenCalledTimes(1); wait.resolve(envelope({friends:[friend]}));
    expect((await app).friends).toEqual((await guide).friends);
    await service.request('friends'); expect(reader).toHaveBeenCalledTimes(1);
    await service.request('friends',{refresh:true}); expect(reader).toHaveBeenCalledTimes(2);
  });
  it('cancels and discards a late response after sign-out/account changes', async () => {
    const wait = deferred<string>(), reader = vi.fn<SocialReader>(() => wait.promise), service = new XboxSocialService(reader);
    service.select('sample@example.test','/fixture/xodus-cli'); const pending = service.request('friends');
    const signal = reader.mock.calls[0][4] as AbortSignal;
    service.select(); expect(signal.aborted).toBe(true); wait.resolve(envelope({friends:[friend]}));
    expect((await pending).friends).toBeUndefined(); expect((await service.request('friends')).status).toBe('signed-out');
    service.select('new@example.test'); expect((await service.request('friends')).status).toBe('unsupported');
  });
  it('sends text only as private body, rejects concurrent sends and never retries an uncertain delivery', async () => {
    const wait = deferred<string>(), reader = vi.fn<SocialReader>(() => wait.promise), service = new XboxSocialService(reader);
    service.select('sample@example.test','/fixture/xodus-cli');
    const pending = service.request('send',{peer:'200',text:'Hello $literal'});
    expect(reader.mock.calls[0].slice(0,4)).toEqual(['/fixture/xodus-cli','send','200',{text:'Hello $literal'}]);
    await expect(service.request('send',{peer:'200',text:'Second'})).rejects.toThrow('pending');
    wait.resolve('invalid or interrupted response'); const result = await pending;
    expect(result.status).toBe('error'); expect(result.reason).toContain('could not be confirmed'); expect(reader).toHaveBeenCalledTimes(1);
  });
  it('validates inputs before spawning any private operation', async () => {
    const reader = vi.fn<SocialReader>(), service = new XboxSocialService(reader);
    service.select('sample@example.test','/fixture/xodus-cli');
    await expect(service.request('send',{peer:'200',text:'🕹'.repeat(257)})).rejects.toThrow('256');
    await expect(service.request('conversation',{peer:'-1'})).rejects.toThrow('player');
    await expect(service.request('send',{peer:'18446744073709551616',text:'Synthetic message'})).rejects.toThrow('player');
    await expect(service.request('search',{query:'\0'})).rejects.toThrow('player name'); expect(reader).not.toHaveBeenCalled();
  });
});
