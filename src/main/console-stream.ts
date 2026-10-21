import {execFile} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {externalLauncherEnvironment} from './launcher-environment.js';
import {cloudIceCandidates, cloudProviderSessionId, type CloudCredentialReader} from './cloud-account.js';
import {consoleIceCandidates} from './console-ice.js';
import {cloudTransferProof, readCloudTransferCredential, type CloudTransferReader} from './cloud-transfer.js';
import type {ConsoleStreamDevice, ConsoleStreamIceCandidate, ConsoleStreamList, ConsoleStreamState, ConsoleWakeResult} from '../shared/console-stream.js';

const LOGIN = 'https://xhome.gssv-play-prod.xboxlive.com/v2/login/user';
const MAX_JSON = 2 * 1024 * 1024;
const object = (value: unknown): Record<string, any> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
const text = (value: unknown, max = 256): value is string => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/.test(value);
const providerId = (value: unknown): value is string => text(value) && /^[A-Za-z0-9._-]+$/.test(value);
const localId = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);

/** Reuse the account's gssv ticket over a private pipe. Never use diagnostic-observed stdout. */
const privateCredential: CloudCredentialReader = (binary, signal) => new Promise((resolve, reject) => {
  execFile(binary, ['cloud-token', '--json'], {signal, timeout: 50_000, killSignal: 'SIGKILL', maxBuffer: 128 * 1024, encoding: 'utf8',
    env: {...externalLauncherEnvironment(process.env), NO_COLOR: '1', TERM: 'dumb', RUST_LOG: 'off'}},
  (error, stdout) => error ? reject(Error('Console account credentials are unavailable.')) : resolve(stdout));
});

/** Home-stream regions have a separate service zone from cloud gaming. */
export function consoleServiceOrigin(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 1024) return;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || !['', '/'].includes(url.pathname)
      || !/^(?:[a-z0-9-]+\.){1,3}gssv-play-prodxhome\.xboxlive\.com$/.test(url.hostname)) return;
    return url.origin;
  } catch { return; }
}
interface ConsoleRow {provider: string; name: string; consoleType?: string; powerState: ConsoleStreamDevice['powerState']; outOfHomeWarning?: boolean}
export function parseConsoleServers(value: unknown): ConsoleRow[] {
  const rows = object(value).results;
  if (!Array.isArray(rows) || rows.length > 200) throw Error('Console list is unavailable.');
  const seen = new Set<string>(), duplicates = new Set<string>(), normalized: ConsoleRow[] = [];
  for (const entry of rows) {
    const row = object(entry);
    if (!providerId(row.serverId)) continue;
    if (seen.has(row.serverId)) {duplicates.add(row.serverId); continue;} seen.add(row.serverId);
    const power = typeof row.powerState === 'string' ? row.powerState.toLowerCase() : '';
    normalized.push({provider: row.serverId, name: text(row.deviceName, 256) ? row.deviceName.trim() || 'Xbox console' : 'Xbox console',
      ...(text(row.consoleType, 128) ? {consoleType: row.consoleType} : {}),
      powerState: power === 'on' ? 'on' : ['standby', 'connectedstandby'].includes(power) ? 'standby' : power === 'off' ? 'off' : 'unknown',
      ...(typeof row.outOfHomeWarning === 'boolean' ? {outOfHomeWarning: row.outOfHomeWarning} : {})});
  }
  return normalized.filter(row => !duplicates.has(row.provider));
}
async function body(response: Response, limit = MAX_JSON): Promise<unknown> {
  if (Number(response.headers.get('content-length') ?? 0) > limit) {await response.body?.cancel(); throw Error('Console response is too large.');}
  const reader = response.body?.getReader(); if (!reader) return {};
  const parts: Uint8Array[] = []; let length = 0;
  try {
    while (true) {const part = await reader.read(); if (part.done) break; length += part.value.byteLength; if (length > limit) throw Error('Console response is too large.'); parts.push(part.value);}
    return length ? JSON.parse(Buffer.concat(parts, length).toString('utf8')) : {};
  } finally {await reader.cancel().catch(() => {}); reader.releaseLock();}
}
const deviceInfo = () => JSON.stringify({appInfo: {env: {clientAppId: 'XBOKS', clientAppType: 'web', httpEnvironment: 'prod'}},
  dev: {hw: {make: 'Generic', model: 'Linux PC', sdktype: 'web'}, os: {name: 'Linux', platform: 'desktop'}}});
interface Offering {origin: string; token: string; until: number}
interface Active {id: string; provider: string; consoleId: string; offering: Offering; generation: number; created: number; transferAt?: number}
interface ConsoleEntry {provider: string; device: ConsoleStreamDevice}

/** Native console discovery and session signaling, bound to the selected account. */
export class ConsoleStreamService {
  private account?: string;
  private binary?: string;
  private locale = 'en-US';
  private generation = 0;
  private controller = new AbortController();
  private offering?: Offering;
  private authentication?: Promise<Offering>;
  private listJob?: Promise<ConsoleStreamList>;
  private cache?: {until: number; value: ConsoleStreamList};
  private consoles = new Map<string, ConsoleEntry>();
  private active?: Active;
  private starting = false;
  private revision = 0;
  private poll?: Active;
  private keepalive?: ReturnType<typeof setInterval>;
  private current: ConsoleStreamState = {phase: 'closed'};
  constructor(private options: {changed?: (state: ConsoleStreamState) => void; reader?: CloudCredentialReader; transferReader?: CloudTransferReader; fetcher?: typeof fetch; now?: () => number} = {}) {}
  private now() {return this.options.now?.() ?? Date.now();}
  get state(): ConsoleStreamState {return {...this.current};}
  private publish(value: ConsoleStreamState) {this.current = {...value}; this.options.changed?.(this.state); return this.state;}
  select(account?: string, binary?: string, locale = 'en-US'): void {
    this.locale = /^[a-z]{2}-[A-Z]{2}$/.test(locale) ? locale : 'en-US';
    if (account === this.account && binary === this.binary) return;
    const active = this.active;
    this.generation++; this.revision++; this.controller.abort(); this.controller = new AbortController();
    this.offering = undefined; this.authentication = undefined; this.listJob = undefined; this.cache = undefined; this.consoles.clear();
    this.active = undefined; this.starting = false; this.poll = undefined; clearInterval(this.keepalive); this.keepalive = undefined;
    this.account = account; this.binary = binary; this.publish({phase: 'closed'});
    if (active) void this.remove(active);
  }
  private valid(generation: number) {if (generation !== this.generation || this.controller.signal.aborted) throw Error('Console account changed.');}
  private async request(url: string, options: {method?: string; token?: string; data?: unknown; headers?: Record<string, string>; signal?: AbortSignal} = {}) {
    const response = await (this.options.fetcher ?? fetch)(url, {method: options.method ?? 'GET', redirect: 'error', credentials: 'omit',
      headers: {Accept: 'application/json', 'Content-Type': 'application/json', ...(options.token ? {Authorization: `Bearer ${options.token}`} : {}), ...options.headers},
      ...(options.data === undefined ? {} : {body: JSON.stringify(options.data)}),
      signal: AbortSignal.any([options.signal ?? this.controller.signal, AbortSignal.timeout(20_000)])});
    if (!response.ok) {await response.body?.cancel(); throw Error('Console service request failed.');}
    return {status: response.status, value: await body(response)};
  }
  private async login(): Promise<Offering> {
    if (!this.account || !this.binary) throw Error('Console account is unavailable.');
    if (this.offering && this.offering.until > this.now() + 30_000) return this.offering;
    if (this.authentication) return this.authentication;
    const account = this.account, binary = this.binary, generation = this.generation;
    const job = (async () => {
      const raw = await (this.options.reader ?? privateCredential)(binary, this.controller.signal); this.valid(generation);
      if (Buffer.byteLength(raw) > 128 * 1024) throw Error('Console credential response is invalid.');
      const credential = object(JSON.parse(raw));
      if (credential.schema !== 1 || credential.account !== account || !text(credential.token, 100_000) || !text(credential.expiresAt, 64)
        || !Number.isFinite(Date.parse(credential.expiresAt)) || Date.parse(credential.expiresAt) < this.now() + 30_000) throw Error('Console credential response is invalid.');
      const {value} = await this.request(LOGIN, {method: 'POST', data: {token: credential.token, offeringId: 'xhome'}, headers: {'x-gssv-client': 'XboxComBrowser'}});
      this.valid(generation); const result = object(value), regions = object(result.offeringSettings).regions;
      if (!text(result.gsToken, 100_000) || !Array.isArray(regions) || regions.length > 100 || !Number.isFinite(result.durationInSeconds)
        || result.durationInSeconds <= 0 || result.durationInSeconds > 7 * 86400) throw Error('Console offering response is invalid.');
      const region = regions.find(row => object(row).isDefault === true && consoleServiceOrigin(object(row).baseUri));
      const origin = consoleServiceOrigin(object(region).baseUri); if (!origin) throw Error('Console region is unavailable.');
      const offering = {origin, token: result.gsToken, until: this.now() + result.durationInSeconds * 1000}; this.offering = offering; return offering;
    })();
    this.authentication = job;
    try {return await job;} finally {if (generation === this.generation) this.authentication = undefined;}
  }
  async list(refresh = false): Promise<ConsoleStreamList> {
    const empty = (status: ConsoleStreamList['status'], reason?: ConsoleStreamList['reason']): ConsoleStreamList => ({status, consoles: [], checkedAt: new Date(this.now()).toISOString(), ...(reason ? {reason} : {})});
    if (!this.account) return empty('signed-out'); if (!this.binary) return empty('unsupported');
    if (!refresh && this.cache && this.cache.until > this.now()) return structuredClone(this.cache.value);
    if (this.listJob) return structuredClone(await this.listJob);
    if (refresh && !this.active) this.offering = undefined;
    const generation = this.generation;
    const job = (async (): Promise<ConsoleStreamList> => {
      try {
        const offering = await this.login(); this.valid(generation);
        const {value} = await this.request(`${offering.origin}/v6/servers/home?mr=50`, {token: offering.token, headers: {'X-MS-Device-Info': deviceInfo()}});
        this.valid(generation); const rows = parseConsoleServers(value), next = new Map<string, ConsoleEntry>();
        for (const row of rows) {
          const previous = [...this.consoles].find(([, value]) => value.provider === row.provider)?.[0], id = previous ?? randomUUID();
          next.set(id, {provider: row.provider, device: {id, name: row.name, ...(row.consoleType ? {consoleType: row.consoleType} : {}), powerState: row.powerState,
            ...(row.outOfHomeWarning === undefined ? {} : {outOfHomeWarning: row.outOfHomeWarning}), canStream: true, canWake: false}});
        }
        this.consoles = next;
        const result: ConsoleStreamList = {status: 'ready', consoles: [...next.values()].map(row => row.device), checkedAt: new Date(this.now()).toISOString()};
        this.cache = {until: this.now() + 60_000, value: result}; return structuredClone(result);
      } catch {return empty(generation === this.generation ? 'error' : 'signed-out', generation === this.generation ? 'service-unavailable' : 'account-unavailable');}
    })();
    this.listJob = job;
    try {return await job;} finally {if (generation === this.generation) this.listJob = undefined;}
  }
  async wake(id: string): Promise<ConsoleWakeResult> {
    if (!localId(id) || !this.consoles.has(id)) throw Error('Console is unavailable.');
    // WakeUp belongs to XCCS remote management and needs a separate Xbox web
    // ticket. Do not send a gssv or refresh credential to that service.
    return {ok: false, reason: 'unsupported'};
  }
  private session(id?: string): Active {
    if (!this.active || id !== this.active.id || this.active.generation !== this.generation) throw Error('Console session is unavailable.'); return this.active;
  }
  async start(id: string): Promise<ConsoleStreamState> {
    if (!localId(id)) throw Error('Invalid console selection.');
    if (!this.account) return this.publish({phase: 'error', error: 'signed-out'});
    if (!this.binary) return this.publish({phase: 'error', error: 'unsupported'});
    if (this.starting || this.active) throw Error('Close the current console session before starting another.');
    const generation = this.generation, revision = ++this.revision, sessionId = randomUUID(); this.starting = true;
    const valid = () => {this.valid(generation); if (revision !== this.revision) throw Error('Console launch canceled.');};
    this.publish({phase: 'starting', id: sessionId, consoleId: id});
    try {
      const list = await this.list(); valid(); const console = this.consoles.get(id);
      if (list.status !== 'ready' || !console || !console.device.canStream) throw Error('Console is unavailable.');
      const offering = await this.login(); valid();
      const {value} = await this.request(`${offering.origin}/v5/sessions/home/play`, {token: offering.token, method: 'POST', data: {
        titleId: '', serverId: console.provider, systemUpdateGroup: '', clientSessionId: sessionId, fallbackRegionNames: [],
        settings: {nanoVersion: 'V3;WebrtcTransport.dll', enableTextToSpeech: false, highContrast: 0, locale: this.locale, useIceConnection: false,
          timezoneOffsetMinutes: -new Date(this.now()).getTimezoneOffset(), sdkType: 'web', osName: 'linux'},
      }, headers: {'X-MS-Device-Info': deviceInfo()}});
      const provider = cloudProviderSessionId(value, 'home'); if (!provider) throw Error('Console session response is invalid.');
      const active: Active = {id: sessionId, provider, consoleId: id, offering, generation, created: this.now()};
      if (generation !== this.generation || revision !== this.revision) {void this.remove(active); throw Error('Console launch canceled.');}
      this.active = active;
      this.keepalive = setInterval(() => {if (this.active === active) void this.request(`${offering.origin}/v5/sessions/home/${provider}/keepalive`, {token: offering.token, method: 'POST', data: {}}).catch(() => {});}, 20_000); this.keepalive.unref();
      this.publish({phase: 'provisioning', id: sessionId, consoleId: id}); return this.getSessionState(sessionId);
    } catch {return generation === this.generation && revision === this.revision ? this.publish({phase: 'error', id: sessionId, consoleId: id, error: 'service'}) : this.state;}
    finally {if (generation === this.generation && revision === this.revision) this.starting = false;}
  }
  async getSessionState(id?: string): Promise<ConsoleStreamState> {
    if (!this.active) return this.state; const active = this.session(id); if (this.poll === active) return this.state; this.poll = active;
    try {
      if (this.current.phase !== 'ready' && this.now() - active.created > 180_000) return this.fail(active, 'timeout');
      const {value} = await this.request(`${active.offering.origin}/v5/sessions/home/${active.provider}/state`, {token: active.offering.token}); this.session(id); const row = object(value);
      if (row.state === 'Provisioned') return this.publish({phase: 'ready', id, consoleId: active.consoleId});
      if (row.state === 'ReadyToConnect') {
        if (active.transferAt !== undefined) return this.now() - active.transferAt > 30_000 ? this.fail(active, 'timeout') : this.publish({phase: 'provisioning', id, consoleId: active.consoleId});
        let proof: string;
        try {const raw = await (this.options.transferReader ?? readCloudTransferCredential)(this.binary!, this.controller.signal); this.session(id); proof = cloudTransferProof(raw, this.account!, this.now());}
        catch {return this.active === active ? this.fail(active, 'transfer-token-required') : this.state;}
        await this.request(`${active.offering.origin}/v5/sessions/home/${active.provider}/connect`, {method: 'POST', token: active.offering.token, data: {userToken: proof}});
        this.session(id); active.transferAt = this.now(); return this.publish({phase: 'provisioning', id, consoleId: active.consoleId});
      }
      if (['Failed', 'Terminated', 'Canceled', 'Disconnected', 'Error'].includes(row.state)) return this.fail(active, 'service');
      return this.publish({phase: 'provisioning', id, consoleId: active.consoleId});
    } catch {return this.active === active ? this.fail(active, 'service') : this.state;}
    finally {if (this.poll === active) this.poll = undefined;}
  }
  private async fail(active: Active, error: ConsoleStreamState['error']) {
    await this.stop(active.id); if (active.generation !== this.generation || this.current.phase !== 'closed') return this.state; return this.publish({phase: 'error', error});
  }
  private async exchange(active: Active, endpoint: 'sdp' | 'ice', data: unknown): Promise<unknown> {
    try {return await this.exchangeTransaction(active, endpoint, data);}
    catch {if (this.active === active) await this.fail(active, 'service'); throw Error('Console connection negotiation failed.');}
  }
  private async exchangeTransaction(active: Active, endpoint: 'sdp' | 'ice', data: unknown): Promise<unknown> {
    const url = `${active.offering.origin}/v5/sessions/home/${active.provider}/${endpoint}`;
    await this.request(url, {token: active.offering.token, method: 'POST', data}); this.session(active.id);
    for (let attempt = 0; attempt < 40; attempt++) {
      const {status, value} = await this.request(url, {token: active.offering.token}); this.session(active.id);
      if (status !== 204) {
        const result = object(value).exchangeResponse;
        if (result !== undefined && result !== null && result !== '') {if (typeof result !== 'string' || result.length > 512_000) throw Error('Invalid console exchange response.'); return JSON.parse(result);}
        if (Object.keys(object(object(value).errorDetails)).length) throw Error('Console exchange was rejected.');
      }
      await new Promise<void>((resolve, reject) => {
        const signal = this.controller.signal; const timer = setTimeout(() => {signal.removeEventListener('abort', cancel); resolve();}, 500);
        const cancel = () => {clearTimeout(timer); reject(Error('Console account changed.'));}; signal.addEventListener('abort', cancel, {once: true}); if (signal.aborted) cancel();
      });
    }
    throw Error('Console exchange timed out.');
  }
  async exchangeSdp(id: string, offer: string): Promise<string> {
    const active = this.session(id);
    if (this.current.phase !== 'ready' || typeof offer !== 'string' || offer.length > 256_000 || !offer.startsWith('v=0\r\n') || offer.includes('\0')) throw Error('Invalid console session offer.');
    const result = object(await this.exchange(active, 'sdp', {messageType: 'offer', sdp: offer, configuration: {
      chatConfiguration: {bytesPerSample: 2, expectedClipDurationMs: 20, format: {codec: 'opus', container: 'webm'}, numChannels: 1, sampleFrequencyHz: 24000},
      chat: {minVersion: 1, maxVersion: 1}, control: {minVersion: 1, maxVersion: 3}, input: {minVersion: 1, maxVersion: 8}, message: {minVersion: 1, maxVersion: 1},
    }}));
    if ((result.type !== undefined && result.type !== 'answer') || (result.messageType !== undefined && result.messageType !== 'answer')
      || typeof result.sdp !== 'string' || !result.sdp.startsWith('v=0') || result.sdp.length > 256_000 || result.sdp.includes('\0')) {
      if (this.active === active) await this.fail(active, 'service');
      throw Error('Invalid console session answer.');
    }
    return result.sdp;
  }
  async exchangeIce(id: string, candidates: ConsoleStreamIceCandidate[]): Promise<ConsoleStreamIceCandidate[]> {
    const active = this.session(id); if (this.current.phase !== 'ready') throw Error('Console session is not ready.');
    const result = await this.exchange(active, 'ice', {messageType: 'iceCandidate', candidate: cloudIceCandidates(candidates)});
    try {return consoleIceCandidates(result);}
    catch {if (this.active === active) await this.fail(active, 'service'); throw Error('Invalid console ICE response.');}
  }
  private async remove(active: Active) {
    try {await this.request(`${active.offering.origin}/v5/sessions/home/${active.provider}`, {token: active.offering.token, method: 'DELETE', signal: AbortSignal.timeout(5_000)});} catch { /* Best-effort cleanup; no provider/account contents are logged. */ }
  }
  async stop(id?: string): Promise<void> {
    const active = this.active; if (id !== undefined && id !== (active?.id ?? this.current.id)) throw Error('Console session is unavailable.');
    this.revision++; this.starting = false; this.active = undefined; this.poll = undefined; clearInterval(this.keepalive); this.keepalive = undefined; this.publish({phase: 'closed'}); if (active) await this.remove(active);
  }
}
