import {afterEach, expect, it, vi} from 'vitest';
import {ConsoleStreamService, consoleServiceOrigin, parseConsoleServers} from './console-stream';
const ACCOUNT = 'fixture@example.invalid', NOW = Date.parse('2026-10-22T01:00:00Z');
const HOME = 'https://uks.core.gssv-play-prodxhome.xboxlive.com';
const credential = () => JSON.stringify({schema: 1, account: ACCOUNT, token: 'private-fixture-gssv-ticket', expiresAt: '2026-10-22T02:00:00Z'});
const server = (id = 'provider-private-console') => ({serverId: id, deviceName: 'Sample Xbox', consoleType: 'XboxOneX', powerState: 'ConnectedStandby', outOfHomeWarning: false});
const offering = (baseUri = HOME) => ({gsToken: 'private-fixture-home-token', durationInSeconds: 3600, offeringSettings: {regions: [{isDefault: true, baseUri}]}});
const cleanups: (() => void)[] = [];
function fixture(handler?: (url: string, options: RequestInit) => unknown | Promise<unknown>) {
  let now = NOW;
  const requests: {url: string; options: RequestInit}[] = [], changed = vi.fn(), reader = vi.fn(async () => credential());
  const transferReader = vi.fn(async (): Promise<string> => {throw Error('Proof unavailable.');});
  const fetcher = vi.fn(async (url: any, options: RequestInit = {}) => {
    requests.push({url: String(url), options}); let result = handler ? await handler(String(url), options) : undefined;
    if (result === undefined) {
      if (String(url).endsWith('/login/user')) result = offering();
      else if (String(url).includes('/v6/servers/home?')) result = {results: [server()]};
      else if (String(url).endsWith('/play')) result = {sessionId: 'provider-private-session'};
      else if (String(url).endsWith('/state')) result = {state: 'Provisioned'};
      else result = {};
    }
    return result instanceof Response ? result : new Response(JSON.stringify(result), {status: 200});
  });
  const service = new ConsoleStreamService({reader, transferReader, fetcher: fetcher as typeof fetch, now: () => now, changed});
  service.select(ACCOUNT, '/fixture/xboks-engine'); cleanups.push(() => service.select());
  return {service, requests, changed, reader, transferReader, fetcher, advance: (milliseconds: number) => {now += milliseconds;},
    selected: async () => (await service.list()).consoles[0].id,
    play: async () => service.start((await service.list()).consoles[0].id)};
}
afterEach(() => {for (const cleanup of cleanups.splice(0)) cleanup(); vi.restoreAllMocks();});

it('restricts authenticated console regions to the home service zone with no paths, credentials, ports or redirects', () => {
  expect(consoleServiceOrigin(`${HOME}/`)).toBe(HOME);
  for (const url of [HOME.replace('https:', 'http:'), `${HOME}/session`, `${HOME}?secret=1`, `${HOME}#fragment`,
    'https://user:secret@uks.core.gssv-play-prodxhome.xboxlive.com', 'https://uks.core.gssv-play-prodxhome.xboxlive.com:8888',
    'https://uks.core.gssv-play-prodxhome.xboxlive.com.evil.invalid', 'https://uks.core.gssv-play-prod.xboxlive.com', 'https://localhost', 'file:///tmp/home']) expect(consoleServiceOrigin(url)).toBeUndefined();
});
it('normalizes only explicit known console power states and excludes ambiguous duplicate provider devices', () => {
  const rows = parseConsoleServers({results: [server(), server(), {...server('second'), powerState: 'Online'}, {...server('third'), powerState: 'On'}, {...server('fourth'), powerState: 'Off'}, {serverId: '../outside', deviceName: 'Untrusted'}]});
  expect(rows.map(r => r.provider)).toEqual(['second', 'third', 'fourth']); expect(rows.map(r => r.powerState)).toEqual(['unknown', 'on', 'off']);
  expect(() => parseConsoleServers({results: {}})).toThrow(); expect(() => parseConsoleServers({results: new Array(201).fill(server())})).toThrow();
});
it('does not derive online state, management rights or unknown device facts from list membership', async () => {
  const f = fixture(url => url.includes('/v6/servers/') ? {results: [{...server(), powerState: 1, isOnline: true, extra: 'private-fixture', outOfHomeWarning: 'yes'}]} : undefined);
  const result = await f.service.list(); expect(result.consoles[0]).toMatchObject({powerState: 'unknown', canWake: false, canStream: true});
  expect(result.consoles[0]).not.toHaveProperty('outOfHomeWarning'); expect(JSON.stringify(result)).not.toMatch(/private-fixture|isOnline/);
});
it('keeps signed-out and unsupported account states free of credential or network operations', async () => {
  const f = fixture(); f.service.select(); expect((await f.service.list()).status).toBe('signed-out');
  f.service.select(ACCOUNT); expect((await f.service.list()).status).toBe('unsupported');
  expect(f.reader).not.toHaveBeenCalled(); expect(f.requests).toEqual([]);
});
it('loads consoles using the existing account and xhome offering without a browser, country override, wake or stream action', async () => {
  const f = fixture(), result = await f.service.list(); expect(result.status).toBe('ready'); expect(result.consoles).toHaveLength(1);
  expect(result.consoles[0]).toMatchObject({name: 'Sample Xbox', consoleType: 'XboxOneX', powerState: 'standby', canWake: false}); expect(result.consoles[0].id).toMatch(/^[a-f0-9-]{36}$/);
  expect(f.requests).toHaveLength(2); expect(f.requests[0].url).toBe('https://xhome.gssv-play-prod.xboxlive.com/v2/login/user');
  expect(JSON.parse(f.requests[0].options.body as string)).toEqual({token: 'private-fixture-gssv-ticket', offeringId: 'xhome'});
  expect(f.requests[1].url).toBe(`${HOME}/v6/servers/home?mr=50`); expect(f.requests[1].options.headers).toMatchObject({Authorization: 'Bearer private-fixture-home-token'});
  for (const request of f.requests) {expect(request.options.redirect).toBe('error'); expect(request.options.credentials).toBe('omit'); expect(request.options.headers).not.toHaveProperty('X-Forwarded-For');}
  expect(JSON.stringify(result)).not.toMatch(/provider-private|private-fixture|gsToken|serverId|https:/);
});
it('deduplicates account list requests and preserves stable opaque console IDs across successful refreshes', async () => {
  const f = fixture(), [first, second] = await Promise.all([f.service.list(), f.service.list()]); expect(first).toEqual(second); expect(f.reader).toHaveBeenCalledOnce();
  first.consoles[0].name = 'Changed by a caller'; expect((await f.service.list()).consoles[0].name).toBe('Sample Xbox');
  const refreshed = await f.service.list(true); expect(refreshed.consoles[0].id).toBe(second.consoles[0].id); expect(f.reader).toHaveBeenCalledTimes(2);
});
it('rejects mismatched, expired or malformed credentials before contacting the home offering', async () => {
  for (const values of [{account: 'other@example.invalid'}, {expiresAt: 'bad-date'}, {expiresAt: '2026-10-21T01:00:00Z'}, {token: 'bad\ncredential'}]) {
    const f = fixture(); f.reader.mockResolvedValue(JSON.stringify({...JSON.parse(credential()), ...values})); expect((await f.service.list()).status).toBe('error'); expect(f.requests).toEqual([]);
  }
});
it('rejects an untrusted home region or malformed token expiry without forwarding bearer credentials', async () => {
  for (const value of [offering('https://attacker.invalid'), {...offering(), durationInSeconds: -1}, {...offering(), gsToken: ''}, {...offering(), offeringSettings: {regions: []}}]) {
    const f = fixture(url => url.endsWith('/login/user') ? value : undefined); expect((await f.service.list()).status).toBe('error'); expect(f.requests).toHaveLength(1);
  }
});
it('cancels pending account discovery on account switches and clears old opaque console IDs', async () => {
  const f = fixture(), first = await f.service.list(); f.service.select('other@example.invalid', '/fixture/xboks-engine');
  f.reader.mockResolvedValue(JSON.stringify({...JSON.parse(credential()), account: 'other@example.invalid'}));
  const second = await f.service.list(); expect(second.status).toBe('ready'); expect(second.consoles[0].id).not.toBe(first.consoles[0].id);
  expect((await f.service.start(first.consoles[0].id)).phase).toBe('error'); expect(f.requests.some(r => r.url.endsWith('/play'))).toBe(false);
});
it('does not let an old credential read publish consoles after sign-out', async () => {
  const f = fixture(); let done!: (value: string) => void; f.reader.mockImplementation(() => new Promise(resolve => {done = resolve;}));
  const result = f.service.list(); f.service.select(); done(credential()); expect((await result).status).toBe('signed-out'); expect(f.requests).toEqual([]);
});
it('does not invent console management support or send wake requests with a streaming token', async () => {
  const f = fixture(), id = await f.selected(), before = f.requests.length; expect(await f.service.wake(id)).toEqual({ok: false, reason: 'unsupported'});
  await expect(f.service.wake('not-a-console')).rejects.toThrow(); expect(f.requests).toHaveLength(before);
});
it('starts only an explicitly selected locally mapped console with a home session payload', async () => {
  const f = fixture(), id = await f.selected(); f.service.select(ACCOUNT, '/fixture/xboks-engine', 'el-GR'); const result = await f.service.start(id);
  expect(result).toMatchObject({phase: 'ready', consoleId: id}); expect(result.id).not.toBe(id);
  const call = f.requests.find(r => r.url.endsWith('/play'))!, data = JSON.parse(call.options.body as string);
  expect(call.url).toBe(`${HOME}/v5/sessions/home/play`); expect(data.titleId).toBe(''); expect(data.serverId).toBe('provider-private-console'); expect(data.settings.locale).toBe('el-GR'); expect(data.settings.osName).toBe('linux');
  expect(JSON.stringify(f.changed.mock.calls)).not.toMatch(/provider-private|private-fixture|gsToken/);
  await expect(f.service.start(id)).rejects.toThrow('Close the current'); await f.service.stop(result.id);
});
it('accepts the real relative Play sessionPath without requiring its optional sessionId field', async () => {
  const f = fixture(url => url.endsWith('/play') ? {sessionPath: 'v5/sessions/home/provider-private-session'} : undefined), state = await f.play();
  expect(state.phase).toBe('ready'); expect(f.requests.some(row => row.url.endsWith('/provider-private-session/state'))).toBe(true);
  expect(JSON.stringify(state)).not.toContain('provider-private'); await f.service.stop(state.id);
});
it('does not authorize arbitrary provider IDs, URLs or stale local IDs as a console selection', async () => {
  const f = fixture();
  for (const id of ['provider-private-console', 'https://attacker.invalid/console', '../../console']) await expect(f.service.start(id)).rejects.toThrow();
  const result = await f.service.start('b0f3b6a8-2420-45f1-a0e4-849c20aff611'); expect(result.phase).toBe('error'); expect(f.requests.some(r => r.url.endsWith('/play'))).toBe(false);
});
it('rejects incorrect session capabilities for polling, negotiation and stopping before network operations', async () => {
  const f = fixture(), result = await f.play(), before = f.requests.length;
  await expect(f.service.getSessionState('wrong')).rejects.toThrow(); await expect(f.service.exchangeSdp('wrong', 'v=0\r\n')).rejects.toThrow();
  await expect(f.service.exchangeIce('wrong', [])).rejects.toThrow(); await expect(f.service.stop('wrong')).rejects.toThrow(); expect(f.requests).toHaveLength(before); await f.service.stop(result.id);
});
it('cancels console startup during discovery without waking or provisioning the console', async () => {
  const f = fixture(), id = await f.selected(); f.advance(61_000);
  let done!: (value: string) => void; f.reader.mockImplementation(() => new Promise(resolve => {done = resolve;}));
  f.service.select(ACCOUNT, '/fixture/changed-engine');
  const pending = f.service.start(id); await vi.waitFor(() => expect(done).toBeTypeOf('function')); await f.service.stop(f.service.state.id); done(credential()); await pending;
  expect(f.service.state.phase).toBe('closed'); expect(f.requests.some(r => r.url.endsWith('/play'))).toBe(false);
});
it('cleans up a provider session returned after local startup cancellation', async () => {
  let done!: (value: unknown) => void; const f = fixture(url => url.endsWith('/play') ? new Promise(resolve => {done = resolve;}) : undefined), id = await f.selected();
  const pending = f.service.start(id); await vi.waitFor(() => expect(done).toBeTypeOf('function')); await f.service.stop(f.service.state.id); done({sessionId: 'provider-private-session'}); await pending;
  await vi.waitFor(() => expect(f.requests.some(r => r.options.method === 'DELETE')).toBe(true)); expect(f.service.state.phase).toBe('closed');
});
it.each([{sdp: 'v=0\r\nfixture'}, {type: 'answer', sdp: 'v=0\r\nfixture'}, {messageType: 'answer', sdp: 'v=0\r\nfixture'}])('accepts the pinned console SDP response variants without requiring an invented marker: %j', async answer => {
  const f = fixture((url, options) => url.endsWith('/sdp') && options.method !== 'POST' ? {exchangeResponse: JSON.stringify(answer)} : undefined), state = await f.play();
  expect(await f.service.exchangeSdp(state.id!, 'v=0\r\nfixture-offer')).toBe('v=0\r\nfixture'); await f.service.stop(state.id);
});
it('waits for HTTP200 signaling responses whose answer is still pending', async () => {
  vi.useFakeTimers();
  try {
    let polls = 0;
    const f = fixture((url, options) => url.endsWith('/sdp') && options.method !== 'POST' ? ++polls < 3 ? {} : {exchangeResponse: JSON.stringify({sdp: 'v=0\r\nfixture'})} : undefined), state = await f.play();
    const answer = f.service.exchangeSdp(state.id!, 'v=0\r\nfixture-offer'); await vi.advanceTimersByTimeAsync(1100);
    expect(await answer).toBe('v=0\r\nfixture'); expect(polls).toBe(3); await f.service.stop(state.id);
  } finally {vi.useRealTimers();}
});
it.each([{type: 'offer', sdp: 'v=0\r\nfixture'}, {type: 'answer', messageType: 'offer', sdp: 'v=0\r\nfixture'}, {sdp: 'not-an-answer'}])('rejects conflicting or malformed console SDP responses: %j', async answer => {
  const f = fixture((url, options) => url.endsWith('/sdp') && options.method !== 'POST' ? {exchangeResponse: JSON.stringify(answer)} : undefined), state = await f.play();
  await expect(f.service.exchangeSdp(state.id!, 'v=0\r\nfixture-offer')).rejects.toThrow('Invalid console session answer');
  expect(f.service.state).toEqual({phase: 'error', error: 'service'}); expect(f.requests.some(r => r.options.method === 'DELETE')).toBe(true);
});
it('exchanges ICE candidates using the known provider protocol and normalizes its end marker', async () => {
  const f = fixture((url, options) => url.endsWith('/ice') && options.method !== 'POST' ? {exchangeResponse: JSON.stringify([{candidate: 'a=end-of-candidates', sdpMid: '0', sdpMLineIndex: '0'}])} : undefined), state = await f.play();
  expect(await f.service.exchangeIce(state.id!, [{candidate: 'candidate:0 1 udp 1 192.0.2.10 30000 typ host', sdpMid: '0', sdpMLineIndex: 0}])).toEqual([{candidate: '', sdpMid: '0', sdpMLineIndex: 0}]);
  const request = f.requests.find(r => r.url.endsWith('/ice') && r.options.method === 'POST')!; expect(JSON.parse(request.options.body as string)).toEqual({messageType: 'iceCandidate', candidate: [{candidate: 'candidate:0 1 udp 1 192.0.2.10 30000 typ host', sdpMid: '0', sdpMLineIndex: 0}]}); await f.service.stop(state.id);
});
it('adds bounded IPv4 alternatives only to authenticated Home Teredo responses without rewriting outgoing ICE', async () => {
  const teredo = {candidate: 'candidate:1 1 UDP 2113937151 2001:0000:4136:e378:8000:63bf:3fff:fdd2 9002 typ host', sdpMid: '0', sdpMLineIndex: 0};
  const f = fixture((url, options) => url.endsWith('/ice') && options.method !== 'POST' ? {exchangeResponse: JSON.stringify([teredo, {candidate: 'a=end-of-candidates'}])} : undefined), state = await f.play();
  const result = await f.service.exchangeIce(state.id!, [teredo]);
  expect(result[0]).toEqual(teredo); expect(result).toHaveLength(4); expect(result.at(-1)).toEqual({candidate: ''});
  expect(result.slice(1, 3).map(row => row.candidate.split(' ').slice(1))).toEqual([
    ['1', 'UDP', '1', '192.0.2.45', '9002', 'typ', 'host'], ['1', 'UDP', '1', '192.0.2.45', '40000', 'typ', 'host'],
  ]);
  const sent = f.requests.find(r => r.url.endsWith('/ice') && r.options.method === 'POST')!;
  expect(JSON.parse(sent.options.body as string).candidate).toEqual([teredo]); await f.service.stop(state.id);
});
it('cleans up owned sessions after malformed authenticated ICE responses without leaking provider content', async () => {
  const f = fixture((url, options) => url.endsWith('/ice') && options.method !== 'POST' ? {exchangeResponse: JSON.stringify([{candidate: 'private-provider-secret'}])} : undefined), state = await f.play();
  await expect(f.service.exchangeIce(state.id!, [])).rejects.toThrow('Invalid console ICE response.');
  expect(f.service.state).toEqual({phase: 'error', error: 'service'}); expect(f.requests.some(r => r.options.method === 'DELETE')).toBe(true);
});
it('rejects malformed offers and ICE before transmitting caller-controlled data', async () => {
  const f = fixture(), state = await f.play(), before = f.requests.length;
  for (const sdp of ['unexpected', 'v=0\r\n\0private', 'v=0\r\n' + 'x'.repeat(256_000)]) await expect(f.service.exchangeSdp(state.id!, sdp)).rejects.toThrow();
  await expect(f.service.exchangeIce(state.id!, [{candidate: 'https://invalid.test'}])).rejects.toThrow(); expect(f.requests).toHaveLength(before); await f.service.stop(state.id);
});
it('stops ReadyToConnect sessions instead of sending another credential as an unsupported purpose ticket', async () => {
  const f = fixture(url => url.endsWith('/state') ? {state: 'ReadyToConnect'} : undefined), state = await f.play();
  expect(state).toEqual({phase: 'error', error: 'transfer-token-required'}); expect(f.requests.some(r => r.options.method === 'DELETE')).toBe(true); expect(f.requests.some(r => r.url.endsWith('/connect'))).toBe(false);
});
it('transfers only an explicitly owned console session with one fresh exact-purpose proof', async () => {
  let connected = false;
  const f = fixture(url => {if (url.endsWith('/connect')) {connected = true; return {};} if (url.endsWith('/state')) return {state: connected ? 'Provisioned' : 'ReadyToConnect'};});
  f.transferReader.mockResolvedValue(JSON.stringify({schema: 1, account: ACCOUNT, kind: 'loginprooftoken', token: 'private-purpose-proof', issuedAt: new Date(NOW).toISOString()}));
  const state = await f.play(); expect(state.phase).toBe('provisioning'); expect((await f.service.getSessionState(state.id)).phase).toBe('ready');
  expect(f.transferReader).toHaveBeenCalledOnce(); const connect = f.requests.find(row => row.url.endsWith('/connect'))!;
  expect(connect.url).toBe(`${HOME}/v5/sessions/home/provider-private-session/connect`); expect(JSON.parse(connect.options.body as string)).toEqual({userToken: 'private-purpose-proof'});
  expect(JSON.stringify(f.changed.mock.calls)).not.toContain('private-purpose-proof'); await f.service.stop(state.id);
});
it('enforces the existing console provisioning deadline without another renderer poll', async () => {
  vi.useFakeTimers();
  try {
    const f = fixture(url => url.endsWith('/state') ? {state: 'Provisioning'} : undefined); await f.play(); const polls = f.requests.filter(row => row.url.endsWith('/state')).length;
    f.advance(180_001); await vi.advanceTimersByTimeAsync(20_000); expect(f.service.state).toEqual({phase: 'error', error: 'timeout'});
    expect(f.requests.filter(row => row.url.endsWith('/state'))).toHaveLength(polls); expect(f.requests.some(row => row.options.method === 'DELETE')).toBe(true);
    expect(f.requests.some(row => row.url.endsWith('/keepalive'))).toBe(false);
  } finally {vi.useRealTimers();}
});
it.each([401, 403, 404, 410])('releases the owned console stream on terminal HTTP%s heartbeat', async status => {
  vi.useFakeTimers();
  try {
    const f = fixture(url => url.endsWith('/keepalive') ? new Response('private-provider-content', {status}) : undefined); await f.play(); await vi.advanceTimersByTimeAsync(20_000);
    expect(f.service.state).toEqual({phase: 'error', error: 'service'}); expect(f.requests.filter(row => row.options.method === 'DELETE')).toHaveLength(1);
    const count = f.requests.length; await vi.advanceTimersByTimeAsync(40_000); expect(f.requests).toHaveLength(count);
  } finally {vi.useRealTimers();}
});
it.each(['network', 500, 503])('does not terminate a ready console stream for transient heartbeat failure %s', async failure => {
  vi.useFakeTimers();
  try {
    const f = fixture(url => {if (url.endsWith('/keepalive')) {if (failure === 'network') throw Error('private-network-content'); return new Response(null, {status: failure});}}), state = await f.play();
    await vi.advanceTimersByTimeAsync(40_000); expect(f.service.state).toEqual(state); expect(f.requests.filter(row => row.url.endsWith('/keepalive'))).toHaveLength(2);
    expect(f.requests.some(row => row.options.method === 'DELETE')).toBe(false); await f.service.stop(state.id);
  } finally {vi.useRealTimers();}
});
it('bounds console heartbeat concurrency and ignores stale completion after a new session starts', async () => {
  vi.useFakeTimers();
  try {
    let complete!: (value: Response) => void;
    const f = fixture(url => url.endsWith('/keepalive') ? new Promise(resolve => {complete = resolve;}) : undefined), first = await f.play();
    await vi.advanceTimersByTimeAsync(60_000); expect(f.requests.filter(row => row.url.endsWith('/keepalive'))).toHaveLength(1);
    await f.service.stop(first.id); const next = await f.play(); complete(new Response(null, {status: 410})); await vi.advanceTimersByTimeAsync(0);
    expect(f.service.state).toEqual(next); expect(f.requests.filter(row => row.options.method === 'DELETE')).toHaveLength(1); await f.service.stop(next.id);
  } finally {vi.useRealTimers();}
});
it('joins a heartbeat-owned console deletion from repeated Stop and shutdown after closing the UI', async () => {
  vi.useFakeTimers();
  try {
    let deleted!: (value: unknown) => void;
    const f = fixture((url, options) => options.method === 'DELETE' ? new Promise(resolve => {deleted = resolve;}) : url.endsWith('/keepalive') ? new Response(null, {status: 410}) : undefined);
    const state = await f.play(); await vi.advanceTimersByTimeAsync(20_000); expect(f.service.state.phase).toBe('closed'); expect(f.service.cleanupPending).toBe(true);
    let repeatedDone = false, shutdownDone = false;
    const repeated = f.service.stop(state.id).then(() => {repeatedDone = true;}), shutdown = f.service.stop().then(() => {shutdownDone = true;});
    await vi.advanceTimersByTimeAsync(0); expect(repeatedDone).toBe(false); expect(shutdownDone).toBe(false); expect(f.requests.filter(row => row.options.method === 'DELETE')).toHaveLength(1);
    deleted({}); await Promise.all([repeated, shutdown]); await vi.advanceTimersByTimeAsync(0);
    expect(f.service.cleanupPending).toBe(false); expect(f.service.state).toEqual({phase: 'closed'});
  } finally {vi.useRealTimers();}
});
it('joining an old console deletion leaves its replacement session active', async () => {
  let deleted!: (value: unknown) => void, deletions = 0;
  const f = fixture((_url, options) => options.method === 'DELETE' && ++deletions === 1 ? new Promise(resolve => {deleted = resolve;}) : undefined);
  const first = await f.play(), stopping = f.service.stop(first.id), next = await f.play();
  let done = false; const repeated = f.service.stop(first.id).then(() => {done = true;}); await Promise.resolve(); expect(done).toBe(false);
  expect(f.service.state).toEqual(next); expect(f.requests.filter(row => row.options.method === 'DELETE')).toHaveLength(1);
  deleted({}); await Promise.all([stopping, repeated]); expect(f.service.state).toEqual(next); await f.service.stop(next.id); expect(f.service.cleanupPending).toBe(false);
});
it('joins account-change console cleanup during shutdown without restoring the old account state', async () => {
  let deleted!: (value: unknown) => void;
  const f = fixture((_url, options) => options.method === 'DELETE' ? new Promise(resolve => {deleted = resolve;}) : undefined);
  await f.play(); f.service.select('other@example.invalid', '/fixture/xboks-engine'); expect(f.service.cleanupPending).toBe(true);
  let done = false; const shutdown = f.service.stop().then(() => {done = true;}); await Promise.resolve(); expect(done).toBe(false);
  deleted({}); await shutdown; expect(f.service.cleanupPending).toBe(false); expect(f.service.state).toEqual({phase: 'closed'});
});
it('joins deletion of a console session returned after its launch was canceled', async () => {
  let played!: (value: unknown) => void, deleted!: (value: unknown) => void;
  const f = fixture((url, options) => url.endsWith('/play') ? new Promise(resolve => {played = resolve;}) : options.method === 'DELETE' ? new Promise(resolve => {deleted = resolve;}) : undefined);
  const launch = f.play(); await vi.waitFor(() => expect(played).toBeTypeOf('function')); await f.service.stop(); played({sessionId: 'provider-private-session'}); await launch;
  expect(f.service.cleanupPending).toBe(true); let done = false; const shutdown = f.service.stop().then(() => {done = true;}); await Promise.resolve(); expect(done).toBe(false);
  deleted({}); await shutdown; expect(f.requests.filter(row => row.options.method === 'DELETE')).toHaveLength(1); expect(f.service.cleanupPending).toBe(false);
});
it('releases known sessions and keepalive on terminal state errors or transport failures', async () => {
  const f = fixture(url => url.endsWith('/state') ? new Response('private-provider-error', {status: 503}) : undefined), state = await f.play();
  expect(state.phase).toBe('error'); expect(state.error).toBe('service'); expect(f.requests.some(r => r.options.method === 'DELETE')).toBe(true); expect(JSON.stringify(state)).not.toContain('private');
});
it('does not leak provider failures from negotiation and cleans up the unusable session', async () => {
  const f = fixture(url => {if (url.endsWith('/sdp')) throw Error('private-provider-token-fixture');}), state = await f.play();
  await expect(f.service.exchangeSdp(state.id!, 'v=0\r\nfixture')).rejects.toThrow('Console connection negotiation failed.'); expect(f.service.state.phase).toBe('error'); expect(f.requests.some(r => r.options.method === 'DELETE')).toBe(true);
});
it('does not publish an old terminal failure after an account change during remote cleanup', async () => {
  let deleted!: (value: unknown) => void;
  const f = fixture((url, options) => options.method === 'DELETE' ? new Promise(resolve => {deleted = resolve;}) : url.endsWith('/state') ? {state: 'ReadyToConnect'} : undefined), id = await f.selected();
  const pending = f.service.start(id); await vi.waitFor(() => expect(deleted).toBeTypeOf('function')); f.service.select('other@example.invalid', '/fixture/xboks-engine'); deleted({}); await pending;
  expect(f.service.state).toEqual({phase: 'closed'});
});
it('bounds provisioning time and deletes the timed-out console session', async () => {
  const f = fixture(url => url.endsWith('/state') ? {state: 'Provisioning'} : undefined), state = await f.play(); expect(state.phase).toBe('provisioning');
  f.advance(181_000); expect(await f.service.getSessionState(state.id)).toEqual({phase: 'error', error: 'timeout'}); expect(f.requests.some(r => r.options.method === 'DELETE')).toBe(true);
});
it('distinguishes a successful empty console list from provider failure and bounds response bodies', async () => {
  const empty = fixture(url => url.includes('/v6/servers/') ? {results: []} : undefined); expect((await empty.service.list()).status).toBe('ready'); expect((await empty.service.list()).consoles).toEqual([]);
  const oversized = fixture(url => url.includes('/v6/servers/') ? new Response('private-provider', {headers: {'content-length': '9000000'}}) : undefined), result = await oversized.service.list(); expect(result.status).toBe('error'); expect(result.consoles).toEqual([]); expect(JSON.stringify(result)).not.toContain('private');
});
