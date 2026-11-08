import {describe, expect, it, vi} from 'vitest';
import {DesktopApps, DESKTOP_APPS_MAX_BYTES, parseDesktopApps, validDesktopAppId} from './desktop-apps.js';

const result = {available: true, apps: [{id: 'org.example.Sample.desktop', name: 'Sample app', description: 'Installed application'}]};
const manager = (run = vi.fn(async () => JSON.stringify(result))) => ({apps: new DesktopApps({helper: '/fixture/apps-client.js', platform: 'linux', run}), run});

describe('installed Linux applications', () => {
  it('accepts exact desktop IDs and rejects paths, options, shell text and oversized identifiers before spawning', async () => {
    for (const id of ['steam.desktop', 'org.gnome.Nautilus.desktop', 'app+variant@local.desktop']) expect(validDesktopAppId(id)).toBe(true);
    const {apps, run} = manager();
    for (const id of ['../app.desktop', '/usr/share/applications/app.desktop', '--launch', 'app.desktop;touch file', 'app.desktop\n', null, {}, 'x'.repeat(256) + '.desktop']) {
      expect(validDesktopAppId(id)).toBe(false); await expect(apps.launch(id)).rejects.toThrow('Invalid desktop application ID');
    }
    expect(run).not.toHaveBeenCalled();
  });
  it('returns only bounded presentation metadata, stripping execution and arbitrary path fields', async () => {
    const raw = {available: true, apps: [{...result.apps[0], exec: 'not forwarded', path: '/private/not-forwarded'}]};
    const {apps} = manager(vi.fn(async () => JSON.stringify(raw)));
    expect(await apps.list()).toEqual(result);
    expect(parseDesktopApps({available: true, apps: []})).toEqual({available: true, apps: []});
  });
  it.each([
    {available: false, apps: []}, {available: true, apps: [...result.apps, ...result.apps]},
    {available: true, apps: Array(513).fill(result.apps[0])}, {available: true, apps: [{...result.apps[0], name: 'x'.repeat(257)}]},
    {available: true, apps: [{...result.apps[0], description: 'private\nnewline'}]}, {available: true, apps: [{...result.apps[0], iconDataUrl: 'https://example.test/icon.png'}]},
    {available: true, apps: [{...result.apps[0], iconDataUrl: 'data:image/svg+xml;base64,PHN2Zy8+'}]},
  ])('fails closed for malformed helper metadata', raw => { expect(() => parseDesktopApps(raw)).toThrow(); });
  it('accepts bounded PNG icon data and rejects huge dimensions, nonimages and oversized output', async () => {
    const icon = Buffer.alloc(24); Buffer.from([137,80,78,71,13,10,26,10]).copy(icon); icon.writeUInt32BE(48, 16); icon.writeUInt32BE(48, 20);
    const iconDataUrl = 'data:image/png;base64,' + icon.toString('base64');
    expect(parseDesktopApps({available: true, apps: [{...result.apps[0], iconDataUrl}]}).apps[0].iconDataUrl).toBe(iconDataUrl);
    icon.writeUInt32BE(100_000, 16);
    expect(() => parseDesktopApps({available: true, apps: [{...result.apps[0], iconDataUrl: 'data:image/png;base64,' + icon.toString('base64')}]})).toThrow();
    const {apps} = manager(vi.fn(async () => 'x'.repeat(DESKTOP_APPS_MAX_BYTES + 1)));
    expect(await apps.list()).toMatchObject({available: false, apps: []});
  });
  it('fails discovery honestly without propagating helper diagnostics or claiming an empty successful inventory', async () => {
    const {apps} = manager(vi.fn(async () => { throw Error('private desktop details'); }));
    const response = await apps.list(); expect(response.available).toBe(false); expect(response.apps).toEqual([]); expect(response.reason).not.toContain('private');
    const unsupported = new DesktopApps({helper: '/fixture/apps.js', platform: 'darwin', run: vi.fn()});
    expect((await unsupported.list()).available).toBe(false);
  });
  it('requires an explicit authorized launch and interprets only the fresh helper acknowledgment', async () => {
    const run = vi.fn(async () => JSON.stringify({ok: true})), {apps} = manager(run);
    await expect(apps.launch('org.example.Sample.desktop', () => false)).rejects.toThrow('focused XBOKS'); expect(run).not.toHaveBeenCalled();
    await apps.launch('org.example.Sample.desktop'); expect(run).toHaveBeenCalledOnce(); expect(run).toHaveBeenCalledWith('launch', 'org.example.Sample.desktop');
    run.mockResolvedValueOnce(JSON.stringify({ok: false, error: 'not-available'}));
    await expect(apps.launch('org.example.Sample.desktop')).rejects.toThrow('no longer available');
    run.mockResolvedValueOnce(JSON.stringify({ok: false, error: 'untrusted private details'}));
    await expect(apps.launch('org.example.Sample.desktop')).rejects.toThrow('could not be started');
    run.mockRejectedValueOnce(Error('private helper diagnostics'));
    await expect(apps.launch('org.example.Sample.desktop')).rejects.toThrow('Check the desktop session');
  });
});
