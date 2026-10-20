import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { constants, promises as fs } from 'node:fs';
import { randomBytes } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { AuthCdp, type CdpEvent } from './auth-cdp.js';
import { AUTH_HOSTS, trustedAuthUrl, type AuthFrame } from './auth-protocol.js';
import type { AuthView, AuthViewFactory } from './auth-transport.js';
import { externalLauncherEnvironment } from './launcher-environment.js';

type Open = Extract<AuthFrame, { type: 'open' }>;
export type AuthBrowser = { kind: 'native'; binary: string } | { kind: 'flatpak'; binary: string; installation: '--user' | '--system'; ref: string };
export class AuthBrowserNotFoundError extends Error {}

export async function findAuthBrowser(environment: NodeJS.ProcessEnv = process.env): Promise<AuthBrowser> {
  if (process.platform !== 'linux') throw Error('Browser sign-in is currently supported on Linux with Google Chrome.');
  // Prefer native Chrome. Never interpret a setting or desktop Exec as a command.
  const candidates = ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/opt/google/chrome/google-chrome'];
  for (const directory of (environment.PATH ?? '').split(path.delimiter).filter(value => path.isAbsolute(value))) {
    candidates.push(path.join(directory, 'google-chrome-stable'), path.join(directory, 'google-chrome'));
  }
  for (const file of new Set(candidates)) {
    try { if (!(await fs.stat(file)).isFile()) continue; await fs.access(file, constants.X_OK); return { kind: 'native', binary: file }; } catch { /* Try the next installed path. */ }
  }
  const flatpaks = ['/usr/bin/flatpak', '/bin/flatpak', ...(environment.PATH ?? '').split(path.delimiter).filter(path.isAbsolute).map(directory => path.join(directory, 'flatpak'))];
  for (const binary of new Set(flatpaks)) {
    try { if (!(await fs.stat(binary)).isFile()) continue; await fs.access(binary, constants.X_OK); } catch { continue; }
    for (const installation of ['--user', '--system'] as const) {
      try {
        const stdout = await new Promise<string>((resolve, reject) => execFile(binary, ['info', installation, '--show-ref', 'com.google.Chrome'], {
          env: externalLauncherEnvironment(environment), timeout: 3000, maxBuffer: 4096, encoding: 'utf8',
        }, (error, stdout) => error ? reject(error) : resolve(stdout)));
        const ref = stdout.trim();
        if (/^app\/com\.google\.Chrome\/(?:x86_64|aarch64)\/stable$/.test(ref)) return { kind: 'flatpak', binary, installation, ref };
      } catch { /* Absent installation, unavailable Flatpak or bounded lookup failure. */ }
    }
    break;
  }
  throw new AuthBrowserNotFoundError('Google Chrome was not found. Install Google Chrome (native or Flatpak from Discover), then try again.');
}

/** Flatpak preserves standard pipes; a constant inner command maps them to CDP.
 * Its run command does not support flatpak-spawn's --forward-fd option. */
export function browserLaunch(browser: AuthBrowser, profile: string, headless = false): { command: string; args: string[]; input: number; output: number } {
  const args = ['--user-data-dir=' + path.join(profile, 'profile'), '--incognito', '--no-first-run', '--no-default-browser-check', '--disable-sync', '--disable-extensions', '--remote-debugging-pipe', ...(headless ? ['--headless=new'] : []), 'about:blank'];
  if (browser.kind === 'native') return { command: browser.binary, args, input: 3, output: 4 };
  return { command: browser.binary, args: ['run', browser.installation, '--die-with-parent', '--filesystem=' + profile,
    '--env=XDG_CONFIG_HOME=' + path.join(profile, 'config'), '--env=XDG_CACHE_HOME=' + path.join(profile, 'cache'), '--env=XDG_DATA_HOME=' + path.join(profile, 'data'), '--env=TMPDIR=' + path.join(profile, 'tmp'),
    '--command=sh', browser.ref, '-c', 'exec /app/bin/chrome "$@" 3<&0 4>&1 </dev/null >/dev/null', 'nexus-browser-auth', ...args], input: 0, output: 1 };
}

// Main-world bridge on trusted Microsoft pages only. It never changes WebAuthn.
export function installBrowserAuthBridge(name: string, hosts: readonly string[]): void {
  if (window !== window.top || location.protocol !== 'https:' || location.port || !hosts.includes(location.hostname)) return;
  const channel = (globalThis as any)[name] as (payload: string) => void;
  const notify = (payload: unknown) => { if (typeof payload === 'string' && payload.length <= 65_536) channel(payload); };
  Object.defineProperty(window.external, 'notify', { value: notify, configurable: false, writable: false });
  window.addEventListener('DOMContentLoaded', () => {
    if (location.hostname === 'login.live.com' && location.pathname === '/ppsecure/post.srf') {
      const data = (window as any).ServerData;
      if (data && typeof data.sDAToken === 'string' && data.sDAToken) notify(JSON.stringify(data));
    }
  }, { once: true });
}

export function browserBindingAllowed(context: any, mainFrame: string | undefined, frame: Open | undefined): boolean {
  return !!frame && !!mainFrame && context?.auxData?.isDefault === true && context.auxData.frameId === mainFrame && typeof context.origin === 'string' && trustedAuthUrl(context.origin);
}

export function browserRequestHeaders(request: { frameId?: string; resourceType?: string; request?: { url?: string; headers?: Record<string, string> } }, mainFrame: string | undefined, frame?: Open): { name: string; value: string }[] | undefined {
  if (!frame || !mainFrame || request.frameId !== mainFrame || request.resourceType !== 'Document' || request.request?.url !== frame.url || !trustedAuthUrl(frame.url)) return;
  const names = new Set(Object.keys(frame.headers).map(name => name.toLowerCase()));
  return [...Object.entries(request.request.headers ?? {}).filter(([name]) => !names.has(name.toLowerCase())), ...Object.entries(frame.headers)].map(([name, value]) => ({ name, value }));
}

export async function browserAuthViewFactory(environment: NodeJS.ProcessEnv = process.env): Promise<AuthViewFactory> {
  const binary = await findAuthBrowser(environment);
  return createBrowserAuthViewFactory(binary, environment);
}

/** Dedicated disposable Chrome, controlled through inherited pipes, never default-profile debugging. */
export function createBrowserAuthViewFactory(browser: AuthBrowser | string, environment: NodeJS.ProcessEnv = process.env, options: { headless?: boolean } = {}): AuthViewFactory {
  return (send, cancel, fail): AuthView => {
    let chrome: ChildProcess | undefined, cdp: AuthCdp | undefined, profile: string | undefined;
    let sessionId: string | undefined, targetId: string | undefined, mainFrame: string | undefined, frame: Open | undefined;
    let disposed = false, failed = false, initialization: Promise<void> | undefined;
    const contexts = new Map<number, any>();
    const binding = 'nexusAuth' + randomBytes(24).toString('hex');
    const failure = () => { if (!disposed && !failed) { failed = true; fail(); } };
    const call = <T = any>(method: string, params: object = {}, target = sessionId): Promise<T> => {
      if (!cdp || disposed) return Promise.reject(Error('Browser sign-in is closed.'));
      return cdp.call<T>(method, params, target);
    };
    const evaluate = async (expression: string, contextId: number) => {
      const value = await call('Runtime.evaluate', { expression, contextId, returnByValue: true });
      if (value.exceptionDetails) throw Error('Browser sign-in page failed.'); return value.result?.value;
    };
    async function handle(event: CdpEvent): Promise<void> {
      const p = event.params;
      if (event.method === 'Target.targetDestroyed' && p.targetId === targetId) { if (frame) cancel(frame.session); else failure(); return; }
      if (event.sessionId !== sessionId || disposed) return;
      if (event.method === 'Runtime.executionContextCreated') { contexts.set(p.context.id, p.context); return; }
      if (event.method === 'Runtime.executionContextDestroyed') { contexts.delete(p.executionContextId); return; }
      if (event.method === 'Runtime.executionContextsCleared') { contexts.clear(); return; }
      if (event.method === 'Page.frameNavigated' && !p.frame.parentId) {
        mainFrame = p.frame.id;
        if (frame && !trustedAuthUrl(p.frame.url) && p.frame.url !== 'about:blank') failure();
        return;
      }
      if (event.method === 'Page.windowOpen') { failure(); return; }
      if (event.method === 'Fetch.requestPaused') {
        // Intercept only Microsoft login requests. Never forward host headers to a redirect or iframe.
        const headers = browserRequestHeaders(p, mainFrame, frame);
        await call('Fetch.continueRequest', { requestId: p.requestId, ...(headers ? { headers } : {}) }); return;
      }
      if (event.method !== 'Runtime.bindingCalled' || p.name !== binding || typeof p.payload !== 'string' || Buffer.byteLength(p.payload) > 65_536) return;
      const context = contexts.get(p.executionContextId);
      if (!browserBindingAllowed(context, mainFrame, frame)) return;
      const active = frame!;
      // Recheck this realm after the async command, not a new page's default realm.
      const origin = await call('Runtime.evaluate', { expression: 'location.origin', contextId: p.executionContextId, returnByValue: true });
      if (frame !== active || !trustedAuthUrl(origin.result?.value ?? '') || origin.result.value !== context.origin) return;
      send(active.session, p.payload);
    }
    async function initialize(): Promise<void> {
      profile = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-browser-auth-')); await fs.chmod(profile, 0o700);
      if (disposed) return;
      await Promise.all(['profile', 'config', 'cache', 'data', 'tmp'].map(name => fs.mkdir(path.join(profile!, name), { mode: 0o700 })));
      if (disposed) return;
      const launch = browserLaunch(typeof browser === 'string' ? { kind: 'native', binary: browser } : browser, profile, options.headless);
      chrome = spawn(launch.command, launch.args, {
        env: { ...externalLauncherEnvironment(environment), TMPDIR: path.join(profile, 'tmp') }, stdio: launch.input === 0 ? ['pipe', 'pipe', 'ignore'] : ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], shell: false, detached: true,
      });
      chrome.once('error', failure);
      chrome.once('exit', () => { if (!disposed) { if (frame) cancel(frame.session); else failure(); } });
      cdp = new AuthCdp(chrome.stdio[launch.input] as Writable, chrome.stdio[launch.output] as Readable, event => { void handle(event).catch(failure); }, failure);
      const targets = await call('Target.getTargets');
      const target = targets.targetInfos.find((item: any) => item.type === 'page' && item.url === 'about:blank');
      if (!target) throw Error('Browser sign-in window is unavailable.'); targetId = target.targetId;
      sessionId = (await call('Target.attachToTarget', { targetId, flatten: true })).sessionId;
      await call('Target.setDiscoverTargets', { discover: true }, undefined);
      await call('Page.enable'); mainFrame = (await call('Page.getFrameTree')).frameTree.frame.id;
      await call('Runtime.enable');
      await call('Runtime.addBinding', { name: binding });
      await call('Page.addScriptToEvaluateOnNewDocument', { source: `(${installBrowserAuthBridge.toString()})(${JSON.stringify(binding)},${JSON.stringify(AUTH_HOSTS)})` });
      await call('Browser.setDownloadBehavior', { behavior: 'deny' });
      await call('Fetch.enable', { patterns: [{ urlPattern: 'https://login.live.com/*', requestStage: 'Request' }] });
    }
    return {
      async open(value) {
        if (disposed || !trustedAuthUrl(value.url)) throw Error('Unsupported browser sign-in URL.');
        initialization ??= initialize(); await initialization;
        if (disposed) throw Error('Browser sign-in is closed.');
        frame = value;
        const result = await call('Page.navigate', { url: value.url });
        if (result.errorText) throw Error('Browser sign-in page did not load.');
      },
      close(id) { if (frame?.session === id) frame = undefined; },
      async context(id, context) {
        if (disposed || frame?.session !== id) return;
        const active = frame;
        const realm = [...contexts.values()].find(value => browserBindingAllowed(value, mainFrame, active));
        if (!realm) return;
        const origin = await evaluate('location.origin', realm.id);
        if (frame !== active || contexts.get(realm.id) !== realm || !trustedAuthUrl(origin ?? '') || origin !== realm.origin) return;
        const message = JSON.stringify({ type: 'callback', value: { name: 'CloudExperienceHost.getContext', args: ['CloudExperienceHost', 'TokenBroker', 'TokenBroker', '{"PrivatePropertyBag":1,"PasswordlessConnect":1,"PreferAssociate":1,"ChromelessUI":0}'], context } });
        await evaluate(`globalThis["CloudExperienceHost.Bridge.dispatchMessage"](${JSON.stringify(message)})`, realm.id);
      },
      async dispose() {
        if (disposed) return; disposed = true; frame = undefined;
        // Interrupt an in-flight initializer before waiting for it, including
        // disposal racing mkdtemp or a stalled browser command.
        try { await Promise.race([cdp?.call('Browser.close'), new Promise(resolve => setTimeout(resolve, 500))]); } catch { /* Scoped termination follows. */ }
        cdp?.close();
        await initialization?.catch(() => {});
        const current = chrome;
        if (current && current.exitCode === null && current.signalCode === null) {
          const exited = new Promise<void>(resolve => current.once('close', () => resolve()));
          const kill = (signal: NodeJS.Signals) => { if (current.pid && current.exitCode === null && current.signalCode === null) try { process.kill(-current.pid, signal); } catch { current.kill(signal); } };
          kill('SIGTERM');
          await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 1000))]);
          kill('SIGKILL');
          await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 500))]);
        }
        // mkdtemp-owned path only, never a browser profile supplied through settings or environment.
        if (profile && (!current || current.exitCode !== null || current.signalCode !== null)) await fs.rm(profile, { recursive: true, force: true });
      },
    };
  };
}
