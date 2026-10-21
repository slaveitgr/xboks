import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { externalLauncherEnvironment } from './launcher-environment.js';
import { cloudLoginHeaders, normalizeCloudLoginCountry, type CloudLoginCountry } from './cloud-region.js';
import {CLOUD_PROVIDER_CODES, safeCloudDiagnostic, type CloudDiagnosticEvent, type CloudDiagnosticStage} from './cloud-diagnostics.js';
import {cloudTransferProof, readCloudTransferCredential, type CloudTransferReader} from './cloud-transfer.js';
import type { CloudAccountCatalog, CloudIceCandidate, CloudSessionState, CloudStreamTitle } from '../shared/cloud-stream.js';

const LOGIN = 'https://xgpuweb.gssv-play-prod.xboxlive.com/v2/login/user';
const MAX_JSON = 8 * 1024 * 1024;
const text = (v: unknown, max = 256): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\x00-\x1f\x7f]/.test(v);
const record = (v: unknown): Record<string, any> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : {};
const product = (v: unknown): v is string => typeof v === 'string' && /^[A-Z0-9]{12}$/.test(v);
const providerId = (v: unknown): v is string => text(v, 256) && /^[A-Za-z0-9._-]+$/.test(v);
export type CloudCredentialReader = (binary: string, signal: AbortSignal) => Promise<string>;

/** A separate pipe, not the diagnostic-observed process helper: stdout contains a credential. */
const readCredential: CloudCredentialReader = (binary, signal) => new Promise((resolve, reject) => {
  execFile(binary, ['cloud-token', '--json'], { signal, timeout: 50_000, killSignal: 'SIGKILL', maxBuffer: 128 * 1024,
    encoding: 'utf8', env: { ...externalLauncherEnvironment(process.env), NO_COLOR: '1', TERM: 'dumb', RUST_LOG: 'off' } },
  (error, stdout) => { if (error) reject(Error('Cloud account credentials are unavailable.')); else resolve(stdout); });
});

/** Region URLs originate in the authenticated offering response and remain on the service's HTTPS zone. */
export function cloudServiceOrigin(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 1024) return;
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.username || u.password || u.port || u.search || u.hash || !['', '/'].includes(u.pathname)
      || !/^(?:[a-z0-9-]+\.){1,3}gssv-play-prod\.xboxlive\.com$/.test(u.hostname)) return;
    return u.origin;
  } catch { return; }
}

export function parseCloudTitles(value: unknown): CloudStreamTitle[] {
  const rows = record(value).results;
  if (!Array.isArray(rows) || rows.length > 20_000) throw Error('Cloud titles are unavailable.');
  const seen = new Set<string>(), result: CloudStreamTitle[] = [];
  for (const entry of rows) {
    const row = record(entry), d = record(row.details);
    if (!product(d.productId) || !providerId(row.titleId) || seen.has(d.productId)) continue;
    const strings = (v: unknown) => Array.isArray(v) ? [...new Set(v.filter(s => text(s, 128)))].slice(0, 64) as string[] : [];
    seen.add(d.productId);
    result.push({ productId: d.productId, titleId: row.titleId,
      ...(providerId(d.xboxTitleId) ? { xboxTitleId: d.xboxTitleId } : {}),
      ...(typeof d.hasEntitlement === 'boolean' ? { hasEntitlement: d.hasEntitlement } : {}),
      supportedInputTypes: strings(d.supportedInputTypes), programs: strings(d.programs) });
  }
  return result;
}

/** v5 Play normally returns sessionPath; sessionId is an optional compatibility field. */
export function cloudProviderSessionId(value: unknown, type: 'cloud' | 'home' = 'cloud'): string | undefined {
  const response = record(value), id = response.sessionId;
  if (response.sessionPath !== undefined) {
    if (typeof response.sessionPath !== 'string' || response.sessionPath.length > 320) return;
    const match = new RegExp(`^/?(?:v5/)?sessions/${type}/([A-Za-z0-9._-]{1,256})$`).exec(response.sessionPath);
    if (!match || !providerId(match[1]) || ['.', '..'].includes(match[1]) || (id !== undefined && id !== match[1])) return;
    return match[1];
  }
  return providerId(id) && !['.', '..'].includes(id) ? id : undefined;
}

export function cloudIceCandidates(value: unknown): CloudIceCandidate[] {
  if (!Array.isArray(value) || value.length > 256) throw Error('Invalid cloud ICE candidates.');
  return value.map(entry => {
    const row = record(entry);
    if (typeof row.candidate !== 'string' || row.candidate.length > 4096 || /[\x00\r\n]/.test(row.candidate)
      || row.candidate !== '' && row.candidate !== 'a=end-of-candidates' && !/^(?:a=)?candidate:/.test(row.candidate)) throw Error('Invalid cloud ICE candidate.');
    const index = typeof row.sdpMLineIndex === 'string' && /^\d{1,3}$/.test(row.sdpMLineIndex) ? Number(row.sdpMLineIndex) : row.sdpMLineIndex;
    if (index !== undefined && index !== null && (!Number.isSafeInteger(index) || index < 0 || index > 256)) throw Error('Invalid cloud ICE index.');
    if (row.sdpMid !== undefined && row.sdpMid !== null && !text(row.sdpMid, 128)) throw Error('Invalid cloud ICE mid.');
    return { candidate: row.candidate === 'a=end-of-candidates' ? '' : row.candidate, ...(index === undefined ? {} : { sdpMLineIndex: index }), ...(row.sdpMid === undefined ? {} : { sdpMid: row.sdpMid }) };
  });
}

async function jsonBody(response: Response, limit = MAX_JSON): Promise<unknown> {
  if (Number(response.headers.get('content-length') ?? 0) > limit) { await response.body?.cancel(); throw Error('Cloud response is too large.'); }
  const reader = response.body?.getReader();
  if (!reader) return {};
  let size = 0; const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength; if (size > limit) throw Error('Cloud response is too large.'); chunks.push(next.value);
    }
    return size ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
class CloudHttpError extends Error { constructor(readonly status: number, readonly providerCode?: CloudDiagnosticEvent['providerCode']) { super('Cloud service request failed.'); } }
interface Offering { origin: string; token: string; until: number }
interface ActiveSession { id: string; provider: string; productId: string; offering: Offering; generation: number; created: number; transferAt?: number }

/** Same-account SSO and signaling. Neither bearer credentials nor service URLs cross the launcher boundary. */
export class CloudAccountService {
  private account?: string;
  private binary?: string;
  private locale = 'en-US';
  private country: CloudLoginCountry = 'auto';
  private generation = 0;
  private controller = new AbortController();
  private offering?: Offering;
  private authentication?: Promise<Offering>;
  private catalogJob?: Promise<CloudAccountCatalog>;
  private cached?: { until: number; value: CloudAccountCatalog };
  private active?: ActiveSession;
  private starting = false;
  private launchRevision = 0;
  private pollSession?: ActiveSession;
  private keepalive?: ReturnType<typeof setInterval>;
  private value: CloudSessionState = { phase: 'closed' };
  private history: CloudDiagnosticEvent[] = [];
  constructor(private options: { changed?: (state: CloudSessionState) => void; diagnostic?: (event: CloudDiagnosticEvent) => void; reader?: CloudCredentialReader; transferReader?: CloudTransferReader; fetcher?: typeof fetch; now?: () => number } = {}) {}
  private now() { return this.options.now?.() ?? Date.now(); }
  get state(): CloudSessionState { return { ...this.value }; }
  get diagnostics(): CloudDiagnosticEvent[] {return this.history.map(row => ({...row}));}
  private diagnostic(value: CloudDiagnosticEvent): void {
    const safe = safeCloudDiagnostic(value); if (!safe) return;
    this.history.push(safe); if (this.history.length > 64) this.history.shift();
    try {this.options.diagnostic?.({...safe});} catch { /* Diagnostic storage cannot prevent service cleanup. */ }
  }
  private failureDetails(): Pick<CloudSessionState, 'errorStage' | 'httpStatus'> {
    const event = [...this.history].reverse().find(row => !['ok', 'pending'].includes(row.outcome) && !['keepalive', 'stop'].includes(row.stage));
    return event ? {errorStage: event.stage, ...(event.httpStatus === undefined ? {} : {httpStatus: event.httpStatus})} : {};
  }
  private publish(value: CloudSessionState) { this.value = { ...value }; this.options.changed?.(this.state); return this.state; }
  select(account?: string, binary?: string, locale = 'en-US', rawCountry: unknown = 'auto'): void {
    const country = normalizeCloudLoginCountry(rawCountry);
    this.locale = /^[a-z]{2}-[A-Z]{2}$/.test(locale) ? locale : 'en-US';
    if (account === this.account && binary === this.binary && country === this.country) return;
    this.country = country;
    const old = this.active;
    this.generation++; this.launchRevision++; this.controller.abort(); this.controller = new AbortController();
    this.active = undefined; this.offering = undefined; this.authentication = undefined; this.catalogJob = undefined; this.cached = undefined;
    this.history = [];
    this.starting = false; this.pollSession = undefined; clearInterval(this.keepalive); this.keepalive = undefined;
    this.account = account; this.binary = binary;
    this.publish({ phase: 'closed' });
    if (old) void this.deleteSession(old);
  }
  private valid(generation: number) { if (generation !== this.generation || this.controller.signal.aborted) throw Error('Cloud account changed.'); }
  private async request(url: string, options: { method?: string; body?: unknown; token?: string; signal?: AbortSignal; headers?: Record<string, string> } = {}): Promise<{ status: number; value: unknown }> {
    // Only callers constructing paths from a verified offering or the fixed login endpoint can reach this method.
    const stage: CloudDiagnosticStage = url.includes('/login/user') ? 'login' : url.includes('/titles/mru?') ? 'recent' : url.endsWith('/titles') ? 'catalog'
      : url.endsWith('/play') ? 'play' : url.endsWith('/state') ? 'state' : url.endsWith('/connect') ? 'connect' : url.endsWith('/keepalive') ? 'keepalive'
      : url.endsWith('/sdp') ? (options.method === 'POST' ? 'sdp-send' : 'sdp-receive') : url.endsWith('/ice') ? (options.method === 'POST' ? 'ice-send' : 'ice-receive') : 'stop';
    let response: Response;
    try {response = await (this.options.fetcher ?? fetch)(url, { method: options.method ?? 'GET', redirect: 'error', credentials: 'omit',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}), ...options.headers },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      signal: AbortSignal.any([options.signal ?? this.controller.signal, AbortSignal.timeout(20_000)]) });}
    catch {this.diagnostic({stage, outcome: 'network-error'}); throw Error('Cloud service could not be reached.');}
    if (!response.ok) {
      let code: CloudDiagnosticEvent['providerCode'];
      try {const value = record(await jsonBody(response, 64 * 1024)); const candidate = value.code ?? record(value.error).code ?? record(value.errorDetails).code;
        if ((CLOUD_PROVIDER_CODES as readonly unknown[]).includes(candidate)) code = candidate;} catch { /* Ignore all unrecognized provider content. */ }
      this.diagnostic({stage, outcome: 'http-error', httpStatus: response.status, ...(code ? {providerCode: code} : {})});
      throw new CloudHttpError(response.status, code);
    }
    let value: unknown;
    try {value = await jsonBody(response);} catch {this.diagnostic({stage, outcome: 'invalid-response', httpStatus: response.status}); throw Error('Cloud response is invalid.');}
    this.diagnostic({stage, outcome: 'ok', httpStatus: response.status});
    return { status: response.status, value };
  }
  private async login(): Promise<Offering> {
    if (!this.account || !this.binary) throw Error('Cloud account is unavailable.');
    if (this.offering && this.offering.until > this.now() + 30_000) return this.offering;
    if (this.authentication) return this.authentication;
    const account = this.account, binary = this.binary, generation = this.generation;
    const job = (async () => {
      let raw: string;
      try {raw = await (this.options.reader ?? readCredential)(binary, this.controller.signal); this.valid(generation);}
      catch {this.diagnostic({stage: 'credential', outcome: 'unsupported'}); throw Error('Cloud account credentials are unavailable.');}
      if (Buffer.byteLength(raw) > 128 * 1024) throw Error('Cloud credential response is invalid.');
      const credential = record(JSON.parse(raw));
      if (credential.schema !== 1 || credential.account !== account || !text(credential.token, 100_000)
        || !text(credential.expiresAt, 64) || !Number.isFinite(Date.parse(credential.expiresAt)) || Date.parse(credential.expiresAt) < this.now() + 30_000) throw Error('Cloud credential response is invalid.');
      this.diagnostic({stage: 'credential', outcome: 'ok'});
      let value: unknown;
      try { ({ value } = await this.request(LOGIN, { method: 'POST', body: { token: credential.token, offeringId: 'xgpuweb' }, headers: cloudLoginHeaders(this.country, LOGIN) })); }
      catch (error) {
        // The free-to-play offering has its own service entitlement. A denied paid offering does not grant access.
        if (!(error instanceof CloudHttpError) || error.status !== 403 || error.providerCode === 'InvalidCountry') throw error;
        this.valid(generation);
        ({ value } = await this.request('https://xgpuwebf2p.gssv-play-prod.xboxlive.com/v2/login/user', { method: 'POST',
          body: { token: credential.token, offeringId: 'xgpuwebf2p' }, headers: cloudLoginHeaders(this.country, 'https://xgpuwebf2p.gssv-play-prod.xboxlive.com/v2/login/user') }));
      }
      this.valid(generation);
      const response = record(value), regions = record(response.offeringSettings).regions;
      if (!text(response.gsToken, 100_000) || !Array.isArray(regions) || regions.length > 100) throw Error('Cloud offering response is invalid.');
      const region = regions.find(r => record(r).isDefault === true && cloudServiceOrigin(record(r).baseUri));
      const origin = cloudServiceOrigin(record(region).baseUri);
      if (!origin) throw Error('Cloud region is unavailable.');
      const seconds = response.durationInSeconds;
      if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 7 * 24 * 3600) throw Error('Cloud offering expiry is invalid.');
      const result = { origin, token: response.gsToken, until: this.now() + seconds * 1000 };
      this.offering = result; return result;
    })();
    this.authentication = job;
    try { return await job; } finally { if (generation === this.generation) this.authentication = undefined; }
  }
  async catalog(refresh = false): Promise<CloudAccountCatalog> {
    const empty = (status: CloudAccountCatalog['status'], reason: string, reasonCode?: CloudAccountCatalog['reasonCode']): CloudAccountCatalog => ({ status, titles: [], recentProductIds: [], checkedAt: new Date(this.now()).toISOString(), reason, ...(reasonCode ? { reasonCode } : {}) });
    if (!this.account) return empty('signed-out', 'Sign in to XBOKS to load your cloud library.');
    if (!this.binary) return empty('unsupported', 'Update XBOKS Engine for account-backed cloud streaming.');
    if (!refresh && this.cached && this.cached.until > this.now()) return structuredClone(this.cached.value);
    if (this.catalogJob) return this.catalogJob;
    if (refresh) this.offering = undefined;
    const generation = this.generation;
    const job = (async (): Promise<CloudAccountCatalog> => {
      try {
        const offering = await this.login(); this.valid(generation);
        const [all, recent] = await Promise.all([
          this.request(`${offering.origin}/v2/titles`, { token: offering.token }),
          this.request(`${offering.origin}/v2/titles/mru?mr=25`, { token: offering.token }).catch(() => undefined),
        ]); this.valid(generation);
        const titles = parseCloudTitles(all.value), ids = new Set(titles.map(t => t.productId));
        const recentProductIds = recent ? parseCloudTitles(recent.value).map(t => t.productId).filter(id => ids.has(id)).slice(0, 25) : [];
        const value: CloudAccountCatalog = { status: 'ready', titles, recentProductIds, checkedAt: new Date(this.now()).toISOString() };
        this.cached = { until: this.now() + 120_000, value }; return structuredClone(value);
      } catch (error) {
        if (generation === this.generation && error instanceof CloudHttpError && error.providerCode === 'InvalidCountry') return empty('error', 'Xbox Cloud Gaming is not available in your current country.', 'region-not-supported');
        return empty(generation === this.generation ? 'error' : 'signed-out', generation === this.generation ? 'Cloud gaming could not load with the current account. Refresh the account in Settings and try again.' : 'The Xbox account changed.');
      }
    })();
    this.catalogJob = job;
    try { return await job; } finally { if (generation === this.generation) this.catalogJob = undefined; }
  }
  private session(id?: string): ActiveSession {
    if (!this.active || this.active.generation !== this.generation || id !== this.active.id) throw Error('Cloud session is unavailable.');
    return this.active;
  }
  async start(productId: string): Promise<CloudSessionState> {
    if (!product(productId)) throw Error('Invalid cloud product ID.');
    if (!this.account) return this.publish({ phase: 'error', error: 'signed-out' });
    if (!this.binary) return this.publish({ phase: 'error', error: 'unsupported' });
    if (this.starting || this.active) throw Error('Close the current cloud session before starting another game.');
    const generation = this.generation, revision = ++this.launchRevision; this.starting = true;
    const current = () => { this.valid(generation); if (revision !== this.launchRevision) throw Error('Cloud launch canceled.'); };
    const id = randomUUID(); this.publish({ phase: 'starting', id, productId });
    try {
      const catalog = await this.catalog(); current();
      if (catalog.reasonCode === 'region-not-supported') return this.publish({ phase: 'error', id, productId, error: 'region-not-supported' });
      const title = catalog.titles.find(t => t.productId === productId);
      if (catalog.status !== 'ready' || !title || title.hasEntitlement === false) {this.diagnostic({stage: 'catalog', outcome: 'invalid-response'}); throw Error('Cloud title is unavailable.');}
      const offering = await this.login(); current();
      const { value } = await this.request(`${offering.origin}/v5/sessions/cloud/play`, { token: offering.token, method: 'POST', body: {
        titleId: title.titleId, systemUpdateGroup: '', clientSessionId: id, serverId: '', fallbackRegionNames: [],
        settings: { nanoVersion: 'V3;WebrtcTransport.dll', enableTextToSpeech: false, highContrast: 0, locale: this.locale,
          useIceConnection: false, timezoneOffsetMinutes: -new Date(this.now()).getTimezoneOffset(), sdkType: 'web', osName: 'linux' },
      }, headers: { 'X-MS-Device-Info': JSON.stringify({ appInfo: { env: { clientAppId: 'XBOKS', clientAppType: 'web', httpEnvironment: 'prod' } },
        dev: { hw: { make: 'Generic', model: 'Linux PC', sdktype: 'web' }, os: { name: 'Linux', platform: 'desktop' } } }) } });
      const provider = cloudProviderSessionId(value);
      if (!provider) {this.diagnostic({stage: 'play', outcome: 'invalid-response'}); throw Error('Cloud session response is invalid.');}
      const active: ActiveSession = { id, provider, productId, offering, generation, created: this.now() };
      if (generation !== this.generation || revision !== this.launchRevision) { void this.deleteSession(active); throw Error('Cloud launch canceled.'); }
      this.active = active;
      this.keepalive = setInterval(() => { if (this.active === active) void this.request(`${offering.origin}/v5/sessions/cloud/${provider}/keepalive`, { token: offering.token, method: 'POST', body: {} }).catch(() => {}); }, 20_000);
      this.keepalive.unref();
      this.publish({ phase: 'provisioning', id, productId }); return this.getSessionState(id);
    } catch { if (generation === this.generation && revision === this.launchRevision) return this.publish({ phase: 'error', id, productId, error: 'service', ...this.failureDetails() }); return this.state; }
    finally { if (generation === this.generation && revision === this.launchRevision) this.starting = false; }
  }
  async getSessionState(id?: string): Promise<CloudSessionState> {
    if (!this.active) return this.state;
    const active = this.session(id);
    if (this.pollSession === active) return this.state;
    this.pollSession = active;
    try {
      if (this.now() - active.created > 15 * 60_000 && this.value.phase !== 'ready') { return this.failSession(active, 'timeout'); }
      const { value } = await this.request(`${active.offering.origin}/v5/sessions/cloud/${active.provider}/state`, { token: active.offering.token });
      this.session(id); const result = record(value);
      const stateEvent = safeCloudDiagnostic({stage: 'state', outcome: 'ok', serviceState: result.state});
      if (stateEvent?.serviceState) this.diagnostic(stateEvent);
      if (result.state === 'ReadyToConnect') {
        if (active.transferAt !== undefined) {
          if (this.now() - active.transferAt > 30_000) {this.diagnostic({stage: 'connect', outcome: 'timeout'}); return this.failSession(active, 'timeout');}
          return this.publish({phase: 'provisioning', id, productId: active.productId});
        }
        let proof: string;
        try {const raw = await (this.options.transferReader ?? readCloudTransferCredential)(this.binary!, this.controller.signal); this.session(id); proof = cloudTransferProof(raw, this.account!, this.now());}
        catch {if (this.active !== active) return this.state; this.diagnostic({stage: 'transfer-credential', outcome: 'unsupported'}); return this.failSession(active, 'transfer-token-required');}
        this.diagnostic({stage: 'transfer-credential', outcome: 'ok'});
        await this.request(`${active.offering.origin}/v5/sessions/cloud/${active.provider}/connect`, {method: 'POST', token: active.offering.token, body: {userToken: proof}});
        this.session(id); active.transferAt = this.now();
        return this.publish({phase: 'provisioning', id, productId: active.productId});
      }
      if (result.state === 'Provisioned') return this.publish({ phase: 'ready', id, productId: active.productId });
      if (['Failed', 'Terminated', 'Canceled', 'Disconnected', 'Error'].includes(result.state)) { return this.failSession(active, 'service'); }
      const seconds = result.estimatedWaitTimeSeconds ?? record(result.waitTime).estimatedTotalWaitTimeInSeconds;
      return this.publish({ phase: result.state === 'Queued' || result.state === 'WaitingForResources' ? 'queued' : 'provisioning', id, productId: active.productId,
        ...(Number.isFinite(seconds) && seconds >= 0 && seconds <= 86400 ? { waitSeconds: seconds } : {}) });
    } catch { if (this.active === active) return this.failSession(active, 'service'); return this.state; }
    finally { if (this.pollSession === active) this.pollSession = undefined; }
  }
  private async failSession(active: ActiveSession, error: CloudSessionState['error']): Promise<CloudSessionState> {
    const details = this.failureDetails();
    await this.stop(active.id);
    if (active.generation !== this.generation || this.value.phase !== 'closed') return this.state;
    return this.publish({ phase: 'error', error, ...details });
  }
  private async exchange(active: ActiveSession, endpoint: 'sdp' | 'ice', body: unknown): Promise<unknown> {
    try {return await this.exchangeTransaction(active, endpoint, body);}
    catch {if (this.active === active) await this.failSession(active, 'service'); throw Error('Cloud connection negotiation failed.');}
  }
  private async exchangeTransaction(active: ActiveSession, endpoint: 'sdp' | 'ice', body: unknown): Promise<unknown> {
    const url = `${active.offering.origin}/v5/sessions/cloud/${active.provider}/${endpoint}`;
    await this.request(url, { token: active.offering.token, method: 'POST', body }); this.session(active.id);
    for (let attempt = 0; attempt < 40; attempt++) {
      const { status, value } = await this.request(url, { token: active.offering.token }); this.session(active.id);
      if (status !== 204) {
        const response = record(value).exchangeResponse;
        if (response !== undefined && response !== null && response !== '') {
          if (typeof response !== 'string' || response.length > 512_000) {this.diagnostic({stage: `${endpoint}-receive`, outcome: 'invalid-response'}); throw Error('Cloud exchange response is invalid.');}
          try {return JSON.parse(response);} catch {this.diagnostic({stage: `${endpoint}-receive`, outcome: 'invalid-response'}); throw Error('Cloud exchange response is invalid.');}
        }
        if (Object.keys(record(record(value).errorDetails)).length) {this.diagnostic({stage: `${endpoint}-receive`, outcome: 'invalid-response'}); throw Error('Cloud exchange was rejected.');}
      }
      this.diagnostic({stage: `${endpoint}-receive`, outcome: 'pending', httpStatus: status});
      await new Promise<void>((resolve, reject) => {
        const signal = this.controller.signal;
        const timer = setTimeout(() => { signal.removeEventListener('abort', stop); resolve(); }, 500);
        const stop = () => { clearTimeout(timer); reject(Error('Cloud account changed.')); };
        signal.addEventListener('abort', stop, { once: true }); if (signal.aborted) stop();
      });
    }
    this.diagnostic({stage: `${endpoint}-receive`, outcome: 'timeout'});
    throw Error('Cloud exchange timed out.');
  }
  async exchangeSdp(id: string, offer: string): Promise<string> {
    const active = this.session(id);
    if (this.value.phase !== 'ready' || typeof offer !== 'string' || offer.length > 256_000 || !offer.startsWith('v=0\r\n') || offer.includes('\0')) throw Error('Invalid cloud session offer.');
    const result = record(await this.exchange(active, 'sdp', { messageType: 'offer', sdp: offer,
      configuration: { chatConfiguration: { bytesPerSample: 2, expectedClipDurationMs: 20, format: { codec: 'opus', container: 'webm' }, numChannels: 1, sampleFrequencyHz: 24000 },
        chat: { minVersion: 1, maxVersion: 1 }, control: { minVersion: 1, maxVersion: 3 }, input: { minVersion: 1, maxVersion: 8 }, message: { minVersion: 1, maxVersion: 1 } } }));
    if ((result.type !== undefined && result.type !== 'answer') || (result.messageType !== undefined && result.messageType !== 'answer')
      || typeof result.sdp !== 'string' || !result.sdp.startsWith('v=0') || result.sdp.length > 256_000 || result.sdp.includes('\0')) {
      this.diagnostic({stage: 'sdp-receive', outcome: 'invalid-response'}); if (this.active === active) await this.failSession(active, 'service'); throw Error('Invalid cloud session answer.');
    }
    return result.sdp;
  }
  async exchangeIce(id: string, candidates: CloudIceCandidate[]): Promise<CloudIceCandidate[]> {
    const active = this.session(id);
    if (this.value.phase !== 'ready') throw Error('Cloud session is not ready.');
    const result = await this.exchange(active, 'ice', { messageType: 'iceCandidate', candidate: cloudIceCandidates(candidates) });
    try {return cloudIceCandidates(result);} catch {this.diagnostic({stage: 'ice-receive', outcome: 'invalid-response'}); if (this.active === active) await this.failSession(active, 'service'); throw Error('Invalid cloud ICE response.');}
  }
  private async deleteSession(active: ActiveSession): Promise<void> {
    try { await this.request(`${active.offering.origin}/v5/sessions/cloud/${active.provider}`, { token: active.offering.token, method: 'DELETE', signal: AbortSignal.timeout(5_000) }); } catch { /* Best-effort service cleanup, never log private responses. */ }
  }
  async stop(id?: string): Promise<void> {
    const active = this.active;
    if (id !== undefined && id !== (active?.id ?? this.value.id)) throw Error('Cloud session is unavailable.');
    this.launchRevision++; this.starting = false; this.pollSession = undefined; this.active = undefined; clearInterval(this.keepalive); this.keepalive = undefined;
    this.publish({ phase: 'closed' }); if (active) await this.deleteSession(active);
  }
}
