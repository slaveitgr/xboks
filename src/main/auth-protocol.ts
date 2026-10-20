// Private child-process transport. Never send frames to logs or the renderer UI.
export const AUTH_PREFIX = 'NEXUS_AUTH_V1 ';
export const AUTH_FRAME_LIMIT = 128 * 1024;
export const AUTH_HOSTS = ['login.live.com', 'account.live.com', 'login.microsoftonline.com', 'login.microsoft.com', 'account.microsoft.com', 'sisu.xboxlive.com'] as const;
const HEADER_NAMES = new Set(['cxh-capabilities', 'cxh-correlationid', 'cxh-msabinaryversion', 'cxh-identityclientbinaryversion', 'cxh-osversioninfo', 'cxh-platform', 'cxh-protocol', 'cxh-source', 'hostapp']);
export type AuthFrame = { type: 'ready'; version: 1 } | { type: 'open'; session: number; url: string; headers: Record<string, string> } |
  { type: 'close'; session: number } | { type: 'context'; session: number; context: string };
export function trustedAuthUrl(value: string): boolean {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.port && AUTH_HOSTS.some(host => host === url.hostname); }
  catch { return false; }
}
export function authFrame(line: string): AuthFrame | undefined {
  if (!line.startsWith(AUTH_PREFIX)) return undefined;
  if (Buffer.byteLength(line) > AUTH_FRAME_LIMIT) throw Error('Sign-in response exceeds the protocol limit.');
  let value: unknown;
  try { value = JSON.parse(line.slice(AUTH_PREFIX.length)); } catch { throw Error('Invalid sign-in protocol response.'); }
  if (!value || typeof value !== 'object') throw Error('Invalid sign-in protocol response.');
  const frame = value as Record<string, unknown>;
  if (frame.type === 'ready' && frame.version === 1) return { type: 'ready', version: 1 };
  if (!Number.isSafeInteger(frame.session) || (frame.session as number) < 1) throw Error('Invalid sign-in session.');
  const id = frame.session as number;
  if (frame.type === 'close') return { type: 'close', session: id };
  if (frame.type === 'context' && typeof frame.context === 'string' && frame.context.length <= 4096) return { type: 'context', session: id, context: frame.context };
  if (frame.type === 'open' && typeof frame.url === 'string' && trustedAuthUrl(frame.url) && frame.url.length <= 32_768 && frame.headers && typeof frame.headers === 'object' && !Array.isArray(frame.headers)) {
    const headers: Record<string, string> = Object.create(null);
    const entries = Object.entries(frame.headers);
    if (entries.length > HEADER_NAMES.size) throw Error('Invalid sign-in request headers.');
    for (const [name, value] of entries) {
      if (!HEADER_NAMES.has(name.toLowerCase()) || typeof value !== 'string' || value.length > 4096 || /[^\x20-\x7e]/.test(value) || Object.hasOwn(headers, name.toLowerCase())) throw Error('Invalid sign-in request headers.');
      headers[name.toLowerCase()] = value;
    }
    return { type: 'open', session: id, url: frame.url, headers };
  }
  throw Error('Unsupported sign-in protocol response.');
}
