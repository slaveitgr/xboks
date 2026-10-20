import { describe, expect, it } from 'vitest';
import { AUTH_PREFIX, AUTH_FRAME_LIMIT, authFrame, trustedAuthUrl } from './auth-protocol.js';
const frame = (value: object) => AUTH_PREFIX + JSON.stringify(value);
describe('external sign-in protocol', () => {
  it.each(['https://login.live.com/ppsecure/InlineLogin.srf', 'https://account.live.com/consent'])('accepts explicit Microsoft destinations: %s', url => expect(trustedAuthUrl(url)).toBe(true));
  it.each(['http://login.live.com/', 'https://login.live.com.evil.invalid/', 'https://user:secret@login.live.com/', 'file:///tmp/test', 'https://localhost/', 'https://login.live.com:9443/', 'javascript:alert(1)'])('blocks unsupported navigation: %s', url => expect(trustedAuthUrl(url)).toBe(false));
  it('allows only known printable initial headers, never cookies or CRLF', () => {
    const open = { type: 'open', session: 1, url: 'https://login.live.com/', headers: { hostapp: 'CloudExperienceHost' } };
    expect(authFrame(frame(open))?.type).toBe('open');
    for (const headers of [{ cookie: 'secret' }, { hostapp: 'a\r\nCookie: secret' }, { HostApp: 'one', hostapp: 'two' }]) expect(() => authFrame(frame({ ...open, headers }))).toThrow('headers');
  });
  it('rejects malformed, oversized and unknown frames without echoing secrets', () => {
    expect(authFrame('ordinary backend output')).toBeUndefined();
    for (const line of [AUTH_PREFIX + 'secret-not-json', frame({ type: 'ready', version: 9, secret: 'private' }), frame({ type: 'close', session: -1 }), frame({ type: 'execute', session: 1, code: 'secret' }), AUTH_PREFIX + 'x'.repeat(AUTH_FRAME_LIMIT)]) {
      try { authFrame(line); throw Error('Expected rejection'); } catch (error) { expect(String(error)).not.toContain('secret'); expect(String(error)).not.toContain('private'); }
    }
  });
});
