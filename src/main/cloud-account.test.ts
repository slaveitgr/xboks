import { afterEach, expect, it, vi } from 'vitest';
import { CloudAccountService, cloudIceCandidates, cloudServiceOrigin, parseCloudTitles } from './cloud-account';
const ACCOUNT = 'fixture@example.invalid', PRODUCT = '9N26X2PMTWBT', SECOND = '9NBLGGH4R315';
const NOW = Date.parse('2026-10-22T00:00:00Z'), ORIGIN = 'https://uks.core.gssv-play-prod.xboxlive.com';
const credential = () => JSON.stringify({ schema: 1, account: ACCOUNT, token: 'private-fixture-xsts', expiresAt: '2026-10-22T01:00:00Z' });
const title = (productId = PRODUCT) => ({ titleId: `TITLE_${productId}`, details: { productId, xboxTitleId: '1234', hasEntitlement: true, supportedInputTypes: ['gamepad'], programs: ['gamepass'] } });
const login = (baseUri = ORIGIN) => ({ gsToken: 'private-fixture-gs-token', durationInSeconds: 3600, offeringSettings: { regions: [{ name: 'UK South', baseUri, isDefault: true }] } });
type Call = { url: string; options: RequestInit };
function fixture(handler?: (url: string, options: RequestInit) => unknown | Promise<unknown>) {
  const calls: Call[] = [], changed = vi.fn(), reader = vi.fn(async () => credential());
  const fetcher = vi.fn(async (url: any, options: RequestInit = {}) => {
    calls.push({ url: String(url), options });
    let result = handler ? await handler(String(url), options) : undefined;
    if (result === undefined) {
      if (String(url).endsWith('/v2/login/user')) result = login();
      else if (String(url).endsWith('/v2/titles')) result = { results: [title(), title(SECOND)] };
      else if (String(url).includes('/v2/titles/mru?')) result = { results: [title()] };
      else if (String(url).endsWith('/play')) result = { sessionId: 'provider-private-session' };
      else if (String(url).endsWith('/state')) result = { state: 'Provisioned' };
      else result = {};
    }
    return result instanceof Response ? result : new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  const service = new CloudAccountService({ reader, fetcher: fetcher as typeof fetch, now: () => NOW, changed });
  service.select(ACCOUNT, '/fixture/xboks-engine');
  return { service, calls, changed, reader, fetcher };
}
afterEach(() => vi.restoreAllMocks());
it('permits only authenticated HTTPS cloud region origins without path, credentials or lookalike hosts', () => {
  expect(cloudServiceOrigin(`${ORIGIN}/`)).toBe(ORIGIN);
  for (const url of [ORIGIN.replace('https:', 'http:'), `${ORIGIN}/session`, `${ORIGIN}?secret=x`, `${ORIGIN}#x`, 'https://user:pass@uks.core.gssv-play-prod.xboxlive.com', 'https://uks.core.gssv-play-prod.xboxlive.com.evil.test', 'https://localhost', 'https://127.0.0.1', 'https://gssv-play-prod.xboxlive.com', 'file:///tmp/cloud']) expect(cloudServiceOrigin(url)).toBeUndefined();
});
it('normalizes only valid unique exact product IDs and provider fields without treating catalog listing as ownership', () => {
  const parsed = parseCloudTitles({ results: [title(), title(), { titleId: 'bad/path', details: { productId: SECOND } }, { titleId: 'another', details: { productId: SECOND, extra: 'private', supportedInputTypes: ['touch', 'touch'] } }] });
  expect(parsed).toHaveLength(2); expect(parsed[1]).toEqual({ productId: SECOND, titleId: 'another', supportedInputTypes: ['touch'], programs: [] });
  expect(JSON.stringify(parsed)).not.toContain('private'); expect(parsed[1]).not.toHaveProperty('hasEntitlement');
  expect(() => parseCloudTitles({ results: {} })).toThrow();
});
it('returns signed-out/unsupported states before any credential or network request', async () => {
  const { service, calls, reader } = fixture(); service.select();
  expect((await service.catalog()).status).toBe('signed-out'); expect((await service.start(PRODUCT)).error).toBe('signed-out');
  service.select(ACCOUNT); expect((await service.catalog()).status).toBe('unsupported');
  expect(reader).not.toHaveBeenCalled(); expect(calls).toEqual([]);
});
it('performs current-account SSO once and serves an account-bound native catalog without starting a game', async () => {
  const { service, calls, reader } = fixture();
  const result = await service.catalog(); expect(result.status).toBe('ready'); expect(result.recentProductIds).toEqual([PRODUCT]); expect(result.titles).toHaveLength(2);
  await service.catalog(); expect(reader).toHaveBeenCalledOnce(); expect(calls).toHaveLength(3);
  expect(JSON.parse(calls[0].options.body as string)).toEqual({ token: 'private-fixture-xsts', offeringId: 'xgpuweb' });
  expect(calls[1].options.headers).toMatchObject({ Authorization: 'Bearer private-fixture-gs-token' });
  for (const { options } of calls) { expect(options.redirect).toBe('error'); expect(options.credentials).toBe('omit'); }
  expect(calls.some(c => c.url.endsWith('/play'))).toBe(false);
  expect(JSON.stringify(result)).not.toMatch(/private-fixture|provider-private|gsToken|https:/);
  service.select();
});
it('rejects credential account mismatch and invalid expiry before contacting cloud services', async () => {
  for (const values of [{ account: 'other@example.invalid' }, { expiresAt: 'not-a-date' }, { expiresAt: '2026-10-21T01:00:00Z' }, { token: 'bad\ncredential' }]) {
    const f = fixture(); f.reader.mockResolvedValue(JSON.stringify({ ...JSON.parse(credential()), ...values }));
    expect((await f.service.catalog()).status).toBe('error'); expect(f.calls).toEqual([]); f.service.select();
  }
});
it('rejects an untrusted authenticated region without transmitting bearer credentials to it', async () => {
  const f = fixture(url => url.endsWith('/v2/login/user') ? login('https://attacker.invalid') : undefined);
  expect((await f.service.catalog()).status).toBe('error'); expect(f.calls).toHaveLength(1); f.service.select();
});
it('does not mistake default-region absence or malformed token duration for a valid offering', async () => {
  for (const response of [{ ...login(), durationInSeconds: -1 }, { ...login(), offeringSettings: { regions: [] } }, { ...login(), gsToken: '' }]) {
    const f = fixture(url => url.endsWith('/v2/login/user') ? response : undefined);
    expect((await f.service.catalog()).status).toBe('error'); expect(f.calls).toHaveLength(1); f.service.select();
  }
});
it('deduplicates concurrent catalog reads and tolerates unavailable optional recent titles', async () => {
  const f = fixture(url => url.includes('/mru?') ? new Response(null, { status: 503 }) : undefined);
  const [one, two] = await Promise.all([f.service.catalog(), f.service.catalog()]);
  expect(one.status).toBe('ready'); expect(one).toEqual(two); expect(one.recentProductIds).toEqual([]); expect(f.reader).toHaveBeenCalledOnce(); f.service.select();
});
it('discards credentials and catalog results when the selected account changes during exchange', async () => {
  let done!: (raw: string) => void;
  const f = fixture(); f.reader.mockImplementation(() => new Promise(resolve => { done = resolve; }));
  const pending = f.service.catalog(); f.service.select('another@example.invalid', '/fixture/xboks-engine'); done(credential());
  const result = await pending; expect(result.status).toBe('signed-out'); expect(result.titles).toEqual([]); expect(f.calls).toEqual([]); f.service.select();
});
it('rejects launching an arbitrary product not in the authenticated cloud title list', async () => {
  const f = fixture(); expect((await f.service.start('9AAAAAAAAAAA')).phase).toBe('error');
  expect(f.calls.some(c => c.url.endsWith('/play'))).toBe(false); f.service.select();
});
it('starts only the exact selected catalog title and exports a local capability instead of service session identity', async () => {
  const f = fixture(); f.service.select(ACCOUNT, '/fixture/xboks-engine', 'el-GR');
  const result = await f.service.start(PRODUCT); expect(result.phase).toBe('ready'); expect(result.productId).toBe(PRODUCT); expect(result.id).toMatch(/^[0-9a-f-]{36}$/);
  const call = f.calls.find(c => c.url.endsWith('/play'))!, body = JSON.parse(call.options.body as string);
  expect(body.titleId).toBe(`TITLE_${PRODUCT}`); expect(body.settings.locale).toBe('el-GR'); expect(body.settings.osName).toBe('linux');
  expect(call.options.headers).toHaveProperty('X-MS-Device-Info');
  expect(JSON.stringify(f.changed.mock.calls)).not.toMatch(/private-fixture|provider-private|gsToken|gssv/);
  await expect(f.service.start(SECOND)).rejects.toThrow('Close the current');
  await f.service.stop(result.id); expect(f.calls.at(-1)?.options.method).toBe('DELETE'); expect(f.service.state).toEqual({ phase: 'closed' });
});
it('does not accept another local session capability for state, SDP, ICE or stopping', async () => {
  const f = fixture(), result = await f.service.start(PRODUCT), before = f.calls.length;
  await expect(f.service.getSessionState('wrong')).rejects.toThrow(); await expect(f.service.exchangeSdp('wrong', 'v=0\r\n')).rejects.toThrow();
  await expect(f.service.exchangeIce('wrong', [])).rejects.toThrow(); await expect(f.service.stop('wrong')).rejects.toThrow(); expect(f.calls).toHaveLength(before);
  await f.service.stop(result.id);
});
it('canceling a launch while catalog loads never starts the selected game', async () => {
  let done!: (raw: string) => void;
  const f = fixture(); f.reader.mockImplementation(() => new Promise(resolve => { done = resolve; }));
  const pending = f.service.start(PRODUCT), id = f.service.state.id; await f.service.stop(id); done(credential()); await pending;
  expect(f.calls.some(c => c.url.endsWith('/play'))).toBe(false); expect(f.service.state.phase).toBe('closed'); f.service.select();
});
it('removes a provisioned server session if cancellation races the play response', async () => {
  let reply!: (value: unknown) => void;
  const f = fixture((url) => url.endsWith('/play') ? new Promise(resolve => { reply = resolve; }) : undefined);
  const pending = f.service.start(PRODUCT);
  await vi.waitFor(() => expect(reply).toBeTypeOf('function'));
  await f.service.stop(f.service.state.id); reply({ sessionId: 'provider-private-session' }); await pending;
  await vi.waitFor(() => expect(f.calls.some(c => c.options.method === 'DELETE')).toBe(true));
  expect(f.service.state.phase).toBe('closed'); f.service.select();
});
it('returns queue state and only provider-supplied bounded wait time without claiming a connected stream', async () => {
  const f = fixture(url => url.endsWith('/state') ? { state: 'Queued', estimatedWaitTimeSeconds: 80 } : undefined);
  const state = await f.service.start(PRODUCT); expect(state).toMatchObject({ phase: 'queued', waitSeconds: 80 });
  expect(JSON.stringify(state)).not.toMatch(/connected|streaming/i); await f.service.stop(state.id);
});
it('exchanges offer/answer and ICE through guarded account-bound session paths', async () => {
  const f = fixture((url, options) => url.endsWith('/sdp') && options.method !== 'POST' ? { exchangeResponse: JSON.stringify({ type: 'answer', sdp: 'v=0\r\nanswer-fixture' }) }
    : url.endsWith('/ice') && options.method !== 'POST' ? { exchangeResponse: JSON.stringify([{ candidate: 'candidate:0 1 udp 1 192.0.2.1 30000 typ host', sdpMid: '0', sdpMLineIndex: '0' }]) } : undefined);
  const state = await f.service.start(PRODUCT);
  expect(await f.service.exchangeSdp(state.id!, 'v=0\r\nfixture')).toBe('v=0\r\nanswer-fixture');
  expect(await f.service.exchangeIce(state.id!, [{ candidate: 'candidate:0 1 udp 1 192.0.2.2 30000 typ host', sdpMid: '0', sdpMLineIndex: 0 }])).toEqual([{ candidate: 'candidate:0 1 udp 1 192.0.2.1 30000 typ host', sdpMid: '0', sdpMLineIndex: 0 }]);
  expect(f.calls.filter(c => c.url.endsWith('/sdp') || c.url.endsWith('/ice')).every(c => c.url.startsWith(`${ORIGIN}/v5/sessions/cloud/provider-private-session/`))).toBe(true);
  await f.service.stop(state.id);
});
it.each([{}, {type: 'answer'}, {messageType: 'answer'}, {type: 'answer', messageType: 'answer'}])('accepts the provider SDP answer contract with optional discriminator %j', async discriminator => {
  const f = fixture((url, options) => url.endsWith('/sdp') && options.method !== 'POST'
    ? {exchangeResponse: JSON.stringify({...discriminator, sdp: 'v=0\r\nanswer-fixture'})} : undefined);
  const state = await f.service.start(PRODUCT);
  expect(await f.service.exchangeSdp(state.id!, 'v=0\r\nfixture')).toBe('v=0\r\nanswer-fixture');
  await f.service.stop(state.id);
});
it.each([{type: 'offer'}, {messageType: 'offer'}, {type: 'answer', messageType: 'offer'}])('rejects a contradictory SDP answer discriminator %j', async discriminator => {
  const f = fixture((url, options) => url.endsWith('/sdp') && options.method !== 'POST'
    ? {exchangeResponse: JSON.stringify({...discriminator, sdp: 'v=0\r\nanswer-fixture'})} : undefined);
  const state = await f.service.start(PRODUCT);
  await expect(f.service.exchangeSdp(state.id!, 'v=0\r\nfixture')).rejects.toThrow('Invalid cloud session answer');
  await f.service.stop(state.id);
});
it('rejects oversized or malformed offers and ICE before transmitting them', async () => {
  const f = fixture(), state = await f.service.start(PRODUCT), before = f.calls.length;
  for (const offer of ['arbitrary', 'v=0\r\n\0secret', 'v=0\r\n' + 'a'.repeat(256_000)]) await expect(f.service.exchangeSdp(state.id!, offer)).rejects.toThrow();
  for (const candidates of [[{ candidate: 'https://invalid.test' }], [{ candidate: 'candidate:a\nheader' }], [{ candidate: '', sdpMLineIndex: -1 }], new Array(257).fill({ candidate: '' })]) expect(() => cloudIceCandidates(candidates)).toThrow();
  expect(f.calls).toHaveLength(before); await f.service.stop(state.id);
});
it('provider errors and response contents remain absent from account/status results', async () => {
  const f = fixture(() => { throw Error('private-fixture-xsts provider-secret-message'); });
  const result = await f.service.catalog(); expect(result.status).toBe('error'); expect(JSON.stringify(result)).not.toMatch(/private-fixture|provider-secret/); f.service.select();
});
it('response body bounds apply before parsing provider-controlled catalog data', async () => {
  const f = fixture(url => url.endsWith('/v2/titles') ? new Response('private-fixture-oversize', { headers: { 'content-length': '9000000' } }) : undefined);
  const result = await f.service.catalog(); expect(result.status).toBe('error'); expect(JSON.stringify(result)).not.toContain('private-fixture'); f.service.select();
});
it('uses only the fixed free-to-play offering after an explicit paid-offering denial', async () => {
  const f = fixture(url => url.startsWith('https://xgpuweb.gssv-') ? new Response(null, { status: 403 }) : undefined);
  expect((await f.service.catalog()).status).toBe('ready');
  expect(f.calls[1].url).toBe('https://xgpuwebf2p.gssv-play-prod.xboxlive.com/v2/login/user');
  expect(JSON.parse(f.calls[1].options.body as string).offeringId).toBe('xgpuwebf2p'); f.service.select();
});
it('explicit refresh exchanges the same account again while ordinary reads reuse the short-lived offering', async () => {
  const f = fixture(); await f.service.catalog(); await f.service.catalog(true); expect(f.reader).toHaveBeenCalledTimes(2); f.service.select();
});
it('reports the exact unsupported-country service code without retrying another offering or requiring a new sign-in', async () => {
  const f = fixture(url => url.endsWith('/v2/login/user') ? new Response(JSON.stringify({ code: 'InvalidCountry', message: 'provider-private-value' }), { status: 403 }) : undefined);
  const result = await f.service.catalog(); expect(result.status).toBe('error'); expect(result.reasonCode).toBe('region-not-supported');
  expect(result.reason).toContain('current country'); expect(result.reason).not.toContain('sign'); expect(JSON.stringify(result)).not.toContain('provider-private'); expect(f.calls).toHaveLength(1); f.service.select();
});
it('normalizes the provider end-of-candidates marker and string line indices', () => {
  expect(cloudIceCandidates([{ candidate: 'a=end-of-candidates', sdpMid: '0', sdpMLineIndex: '0' }])).toEqual([{ candidate: '', sdpMid: '0', sdpMLineIndex: 0 }]);
});
it('does not provision a title explicitly reported as unentitled by the cloud provider', async () => {
  const f = fixture(url => url.endsWith('/v2/titles') ? { results: [{ ...title(), details: { ...title().details, hasEntitlement: false } }] } : undefined);
  expect((await f.service.start(PRODUCT)).phase).toBe('error'); expect(f.calls.some(c => c.url.endsWith('/play'))).toBe(false); f.service.select();
});
it('stops unsupported purpose-ticket handshakes instead of reusing credentials or polling indefinitely', async () => {
  const f = fixture(url => url.endsWith('/state') ? { state: 'ReadyToConnect' } : undefined);
  const state = await f.service.start(PRODUCT); expect(state.phase).toBe('error'); expect(state.error).toBe('transfer-token-required');
  expect(f.calls.some(c => c.options.method === 'DELETE')).toBe(true); expect(f.calls.some(c => c.url.endsWith('/connect'))).toBe(false);
  expect(f.service.state.id).toBeUndefined(); f.service.select();
});
it('does not publish an old handshake failure after switching accounts during remote cleanup', async () => {
  let deleted!: (value: unknown) => void;
  const f = fixture((url, options) => options.method === 'DELETE' ? new Promise(resolve => { deleted = resolve; }) : url.endsWith('/state') ? { state: 'ReadyToConnect' } : undefined);
  const pending = f.service.start(PRODUCT); await vi.waitFor(() => expect(deleted).toBeTypeOf('function'));
  f.service.select('other@example.invalid', '/fixture/xboks-engine'); deleted({}); await pending;
  expect(f.service.state).toEqual({ phase: 'closed' }); f.service.select();
});
it('adds a user-selected fixed country header only to the offering login, preserving default automatic behavior', async () => {
  const f = fixture(); f.service.select(ACCOUNT, '/fixture/xboks-engine', 'en-US', 'pl'); await f.service.catalog();
  expect(f.calls[0].options.headers).toMatchObject({ 'X-Forwarded-For': '45.134.212.66' });
  for (const request of f.calls.slice(1)) expect(request.options.headers).not.toHaveProperty('X-Forwarded-For');
  f.service.select(ACCOUNT, '/fixture/xboks-engine', 'en-US', 'auto'); await f.service.catalog();
  expect(f.reader).toHaveBeenCalledTimes(2); expect(f.calls[3].options.headers).not.toHaveProperty('X-Forwarded-For'); f.service.select();
});
it('invalid country settings cannot inject an arbitrary forwarded IP or retain another country offering', async () => {
  const f = fixture(); f.service.select(ACCOUNT, '/fixture/xboks-engine', 'en-US', '198.51.100.9\r\nExtra: value'); await f.service.catalog();
  expect(f.calls[0].options.headers).not.toHaveProperty('X-Forwarded-For'); f.service.select();
});
