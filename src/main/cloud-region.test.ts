import {describe, expect, it} from 'vitest';
import {CLOUD_LOGIN_COUNTRIES, cloudLoginHeaders, normalizeCloudLoginCountry} from './cloud-region';

const paid = 'https://xgpuweb.gssv-play-prod.xboxlive.com/v2/login/user';
const free = 'https://xgpuwebf2p.gssv-play-prod.xboxlive.com/v2/login/user';

describe('explicit cloud offering login country', () => {
  it.each([paid, free])('does not add a country hint in automatic mode for %s', destination => {
    expect(cloudLoginHeaders('auto', destination)).toEqual({'x-gssv-client': 'XboxComBrowser'});
  });
  it.each([
    ['pl', '45.134.212.66'], ['us', '143.244.47.65'], ['br', '169.150.198.66'],
    ['jp', '138.199.21.239'], ['kr', '121.125.60.151'],
  ])('uses the fixed %s country hint without changing the destination', (country, ip) => {
    expect(cloudLoginHeaders(country, paid)).toEqual({'x-gssv-client': 'XboxComBrowser', 'X-Forwarded-For': ip});
    expect(cloudLoginHeaders(country, free)['X-Forwarded-For']).toBe(ip);
  });
  it.each([undefined, null, {}, ['pl'], 1, 'PL', 'de', '', '127.0.0.1', 'pl\r\nAuthorization: secret', '__proto__', 'constructor'])('rejects unrecognized preference %j without forwarding it', value => {
    expect(normalizeCloudLoginCountry(value)).toBe('auto');
    expect(cloudLoginHeaders(value, paid)).toEqual({'x-gssv-client': 'XboxComBrowser'});
  });
  it.each([
    'https://xgpuweb.gssv-play-prod.xboxlive.com/v2/titles',
    'https://uks.core.gssv-play-prod.xboxlive.com/v5/sessions/cloud/play',
    'https://login.live.com/',
    'https://xsts.auth.xboxlive.com/xsts/authorize',
    'https://example.org/v2/login/user',
    'https://xgpuweb.gssv-play-prod.xboxlive.com.evil.test/v2/login/user',
    'https://user:secret@xgpuweb.gssv-play-prod.xboxlive.com/v2/login/user',
    'http://xgpuweb.gssv-play-prod.xboxlive.com/v2/login/user',
    `${paid}?next=third-party`, `${paid}#fragment`, `${paid}/`,
  ])('never creates compatibility headers for another endpoint %s', destination => {
    expect(() => cloudLoginHeaders('pl', destination)).toThrow('Invalid cloud login destination.');
  });
  it('does not let a caller mutate later headers or expand the allowed country list', () => {
    const first = cloudLoginHeaders('pl', paid); first['X-Forwarded-For'] = '127.0.0.1'; first.Authorization = 'not-a-real-secret';
    expect(cloudLoginHeaders('pl', paid)).toEqual({'x-gssv-client': 'XboxComBrowser', 'X-Forwarded-For': '45.134.212.66'});
    expect(CLOUD_LOGIN_COUNTRIES).toEqual(['auto', 'pl', 'us', 'br', 'jp', 'kr']);
    expect(Object.isFrozen(CLOUD_LOGIN_COUNTRIES)).toBe(true);
  });
});
