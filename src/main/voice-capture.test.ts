import { afterEach, describe, expect, it, vi } from 'vitest';
import { VoiceCapturePermissions, voiceDocumentAllowed } from './voice-capture';

const appUrl = 'file:///opt/xboks/dist/index.html';
const frame = { isMainFrame: true, requestingUrl: appUrl };
const owner = (id: number) => ({ id, getURL: () => appUrl, isDestroyed: () => false, send: vi.fn() });
afterEach(() => vi.useRealTimers());

describe('explicit local voice capture permission', () => {
  it('trusts only the exact packaged document or configured local development document', () => {
    expect(voiceDocumentAllowed(appUrl + '#desktop-guide', appUrl)).toBe(true);
    expect(voiceDocumentAllowed('http://localhost:5173/#settings', appUrl, 'http://localhost:5173')).toBe(true);
    for (const url of ['file:///tmp/untrusted.html', appUrl + '?other=1', 'https://www.xbox.com/play', 'http://localhost:5173/other', 'http://localhost.evil:5173/']) expect(voiceDocumentAllowed(url, appUrl, 'http://localhost:5173')).toBe(false);
    expect(voiceDocumentAllowed('https://example.com/', appUrl, 'https://example.com/')).toBe(false);
  });
  it('never grants capture just because a renderer or account exists', () => {
    const a = owner(1), broker = new VoiceCapturePermissions(() => true, url => url === appUrl);
    expect(broker.check(a, 'media', { ...frame, mediaType: 'audio' })).toBe(false);
    expect(broker.accept(a, 'media', { ...frame, mediaTypes: ['audio'] })).toBe(false);
  });
  it('requires a visible trusted owner and prevents simultaneous windows', () => {
    const a = owner(1), b = owner(2);
    let visible = false;
    const broker = new VoiceCapturePermissions(() => visible, url => url === appUrl);
    expect(() => broker.request(a)).toThrow('active'); visible = true;
    broker.request(a); expect(() => broker.request(b)).toThrow('other panel');
    broker.release(2); expect(broker.check(a, 'media', { ...frame, mediaType: 'audio' })).toBe(true);
    broker.release(1); expect(a.send).toHaveBeenCalledWith('voice-capture-stop');
  });
  it('grants audio only and denies camera, screen, subframes and remote origins', () => {
    const a = owner(1), broker = new VoiceCapturePermissions(() => true, url => url === appUrl);
    broker.request(a);
    for (const permission of ['display-capture', 'geolocation', 'notifications', 'unknown']) expect(broker.accept(a, permission, frame)).toBe(false);
    for (const mediaTypes of [undefined, [], ['video'], ['audio','video']]) expect(broker.accept(a, 'media', { ...frame, mediaTypes })).toBe(false);
    expect(broker.check(a, 'media', { ...frame, mediaType: 'video' })).toBe(false);
    expect(broker.check(a, 'media', { ...frame, mediaType: 'unknown' })).toBe(false);
    expect(broker.accept(a, 'media', { ...frame, isMainFrame: false, mediaTypes: ['audio'] })).toBe(false);
    expect(broker.accept(a, 'media', { ...frame, embeddingOrigin: 'https://example.com', mediaTypes: ['audio'] })).toBe(false);
    expect(broker.accept(a, 'media', { ...frame, requestingUrl: 'https://example.com/', mediaTypes: ['audio'] })).toBe(false);
    expect(broker.accept(a, 'media', { ...frame, mediaTypes: ['audio'] })).toBe(true);
    expect(broker.accept(a, 'media', { ...frame, mediaTypes: ['audio'] })).toBe(false);
    broker.release();
  });
  it('ties output selection to the same active local test owner', () => {
    const a = owner(1), b = owner(2), broker = new VoiceCapturePermissions(() => true, url => url === appUrl);
    broker.request(a);
    expect(broker.check(a, 'speaker-selection', frame)).toBe(true);
    expect(broker.accept(b, 'speaker-selection', frame)).toBe(false);
    broker.release(); expect(broker.check(a, 'speaker-selection', frame)).toBe(false);
  });
  it('expires pending permission and accepted capture, notifying the renderer to stop tracks', () => {
    vi.useFakeTimers(); const a = owner(1);
    const broker = new VoiceCapturePermissions(() => true, url => url === appUrl);
    broker.request(a); vi.advanceTimersByTime(15_000);
    expect(broker.accept(a, 'media', { ...frame, mediaTypes: ['audio'] })).toBe(false);
    expect(a.send).toHaveBeenCalledTimes(1);
    broker.request(a); expect(broker.accept(a, 'media', { ...frame, mediaTypes: ['audio'] })).toBe(true);
    vi.advanceTimersByTime(74_999); expect(a.send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1); expect(a.send).toHaveBeenCalledTimes(2);
    expect(broker.check(a, 'media', { ...frame, mediaType: 'audio' })).toBe(false);
  });
  it('rejects stale revoked requests and rechecks document/window trust', () => {
    const a = owner(1), b = owner(2); let trusted = true;
    const broker = new VoiceCapturePermissions(() => trusted, url => url === appUrl);
    broker.request(a); broker.release(1); broker.request(b);
    expect(broker.accept(a, 'media', { ...frame, mediaTypes: ['audio'] })).toBe(false);
    trusted = false; expect(broker.accept(b, 'media', { ...frame, mediaTypes: ['audio'] })).toBe(false);
    broker.release();
  });
  it('installs both session handlers without allowing null or worker owners', () => {
    const broker = new VoiceCapturePermissions(() => true, url => url === appUrl);
    const session = { setPermissionCheckHandler: vi.fn(), setPermissionRequestHandler: vi.fn() };
    broker.install(session as any);
    const check = session.setPermissionCheckHandler.mock.calls[0][0];
    expect(check(null, 'media', '', { ...frame, mediaType: 'audio' })).toBe(false);
    const callback = vi.fn(); session.setPermissionRequestHandler.mock.calls[0][0](owner(1), 'media', callback, { ...frame, mediaTypes: ['audio'] });
    expect(callback).toHaveBeenCalledWith(false);
  });
});
