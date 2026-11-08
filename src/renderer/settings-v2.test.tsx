import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SettingsFrame, settingsSections, handleSettingsBack } from './SettingsFrame';
import { OriginalSettings, XboxModeSettings, changeSettingsXboxMode } from './OriginalSettings';
import { SettingsV2RouteOnly, SettingsV2RouteProvider, settingsV2Groups, settingsV2Routes, settingsV2RouteForSection, settingsV2RouteParent, settingsV2CategoryRoutes, type SettingsV2Route } from './settings-v2';
import { demoSnapshot } from '../shared/demo-data';
import type { Appearance } from './appearance';
const appearance: Appearance = { compactMode: true, developerOptions: false, showBattery: true, reduceMotion: false, hideBackground: false };
function pane(route: SettingsV2Route) {
  const selected = settingsV2Routes.find(item => item.id === route)!;
  return renderToStaticMarkup(<SettingsV2RouteProvider value={route}><OriginalSettings section={selected.section} data={demoSnapshot()} appearance={appearance} changeAppearance={() => {}} gameBar={() => {}} notificationChange={() => {}} desktopChange={() => {}} changeLanguage={() => {}} /></SettingsV2RouteProvider>);
}
describe('Controller Settings V2 route structure', () => {
  it('uses the packaged six-category rail and renders Account inline in console mode', () => {
    const html = renderToStaticMarkup(<SettingsFrame consoleMode active="account" select={() => {}} close={() => {}} busy={false}>Private account content</SettingsFrame>);
    const tabs = [...html.matchAll(/role="tab"[^>]*>/g)];
    expect(tabs).toHaveLength(6);
    for (const group of settingsV2Groups) expect(html).toContain(`id="settings-v2-tab-${group.id}"`);
    expect(html).toContain('Devices &amp; connections'); expect(html).toContain('Play &amp; social');
    expect(html).toContain('settings-v2-dialog'); expect(html).toContain('data-settings-v2-open="subscriptions"');
    expect(html).toContain('Private account content');
    expect(html).not.toContain('data-settings-v2-open="profile"');
  });
  it('uses the same V2 hierarchy in a bounded desktop modal instead of the legacy nine categories', () => {
    const html = renderToStaticMarkup(<SettingsFrame active="install" select={() => {}} close={() => {}} busy={false}>Existing install controls</SettingsFrame>);
    expect([...html.matchAll(/role="tab"[^>]*>/g)]).toHaveLength(6);
    expect(html).toContain('settings-v2-tab-system'); expect(html).toContain('Existing install controls');
    expect(html).toContain('settings-v2-titlebar'); expect(html).toContain('settings-v2-desktop');
    expect(html).not.toContain('settings-tab-install');
  });
  it('keeps every existing functional settings pane reachable from the new groups', () => {
    for (const [section] of settingsSections) {
      const route = settingsV2RouteForSection(section);
      expect(route.section).toBe(section); expect(settingsV2Groups.some(group => group.id === route.group)).toBe(true);
    }
    expect(settingsV2Routes.find(route => route.id === 'subscriptions')?.group).toBe('account');
    expect(settingsV2Routes.find(route => route.id === 'storage')?.group).toBe('system');
    expect(settingsV2Routes.find(route => route.id === 'library')?.group).toBe('apps');
    expect(settingsV2Routes.find(route => route.id === 'audio')?.group).toBe('system');
    expect(settingsV2Routes.find(route => route.id === 'permissions')?.group).toBe('play-social');
    expect(settingsV2Routes.find(route => route.id === 'privacy')?.group).toBe('account');
    expect(settingsV2CategoryRoutes('system').map(route => route.id)).toEqual(['notifications','display','xbox-mode','storage','audio','languages','startup','developer','about']);
  });
  it('matches the observed signed-in Account action order without mounting unrelated credential forms', () => {
    const html = renderToStaticMarkup(<SettingsFrame signedIn profile={{gamertag:'Example player'}} canSignOut onSignOut={() => {}} onViewProfile={() => {}} active="account" select={() => {}} close={() => {}} busy={false}>Credential form</SettingsFrame>);
    const labels=['View profile','Redeem a code','Subscriptions','Privacy &amp; safety','Change gamerpic','Change gamertag','View order history','Request a refund','Manage Microsoft Store account','Sign out'];
    for(let index=1;index<labels.length;index++)expect(html.indexOf(labels[index-1])).toBeLessThan(html.indexOf(labels[index]));
    expect(html).toContain('Example player');expect(html).not.toContain('Credential form');expect(html).toContain('Help &amp; feedback');
    for(const route of ['subscriptions','privacy'])expect(html).toContain(`data-settings-v2-open="${route}"`);
  });
  it('opens a requested install deep link directly with working category Back instead of discarding it', () => {
    const html = renderToStaticMarkup(<SettingsFrame consoleMode active="install" select={() => {}} close={() => {}} busy={false}>Existing install controls</SettingsFrame>);
    expect(html).toContain('data-settings-v2-route="storage"'); expect(html).toContain('Existing install controls');
    expect(html).toContain('data-settings-category-back="true"');
    expect(html).toContain('aria-labelledby="settings-v2-tab-system"');
  });
  it.each(['library', 'accessibility'] as const)('opens %s directly at its observed inline category rather than an invented detail page', active => {
    const html = renderToStaticMarkup(<SettingsFrame active={active} select={() => {}} close={() => {}} busy={false}>Inline controls</SettingsFrame>);
    expect(html).toContain('Inline controls'); expect(html).not.toContain('settings-v2-breadcrumb'); expect(html).not.toContain('data-settings-category-back');
  });
  it('localizes category and detail navigation without translating product names', () => {
    const html = renderToStaticMarkup(<SettingsFrame consoleMode language="el" active="install" select={() => {}} close={() => {}} busy={false}>XBOKS Engine</SettingsFrame>);
    for (const label of ['Συσκευές και συνδέσεις', 'Παιχνίδι και κοινωνικά', 'Εφαρμογές', 'Εγκατάσταση και αποθήκευση', 'XBOKS Engine']) expect(html).toContain(label);
  });
});
describe('Controller settings details preserve only their intended controls', () => {
  it('keeps each notification child under Notifications and isolates the available download preference', () => {
    for (const route of ['notifications-general','notifications-social','notifications-achievements','notifications-promotions','notifications-store'] as const) expect(settingsV2RouteParent(route)).toBe('notifications');
    expect(pane('notifications-general')).toContain('Notify me when a game download finishes');
    expect(pane('notifications-general')).not.toContain('wishlist');
    expect(pane('notifications-store')).toContain('wishlist');
    expect(pane('notifications-store')).not.toContain('Notify me when a game download finishes');
    expect(pane('purchase-sign-in')).toContain('Skip sign-in for purchases');
    expect(pane('purchase-sign-in')).not.toContain('Redeem a code');
    expect(pane('input')).toContain('Controllers'); expect(pane('input')).not.toContain('Voice volume');
  });
  it('separates Display, Startup, Languages and Developer settings rather than reusing the whole old Application page', () => {
    const display = pane('display');
    expect(display).toContain('Compact mode'); expect(display).not.toContain('Show developer options'); expect(display).not.toContain('Launch Xbox when'); expect(display).not.toContain('Interface language');
    const startup = pane('startup');
    expect(startup).toContain('Launch Xbox when'); expect(startup).not.toContain('Compact mode'); expect(startup).not.toContain('Show developer options');
    const languages = pane('languages');
    expect(languages).toContain('Interface language'); expect(languages).not.toContain('<details'); expect(languages).not.toContain('Compact mode');
    const developer = pane('developer');
    expect(developer).toContain('Show developer options'); expect(developer).not.toContain('Compact mode'); expect(developer).not.toContain('Interface language');
  });
  it('separates profile and privacy routes without exposing the account session beneath Privacy', () => {
    expect(pane('privacy')).toContain('Privacy settings'); expect(pane('privacy')).not.toContain('Redeem a code');
    expect(pane('profile')).toContain('Redeem a code'); expect(pane('profile')).not.toContain('Privacy settings');
    const hidden = renderToStaticMarkup(<SettingsV2RouteProvider value="privacy"><SettingsV2RouteOnly routes={['profile']}>Account session controls</SettingsV2RouteOnly></SettingsV2RouteProvider>);
    expect(hidden).toBe('');
  });
  it('keeps streaming separate from desktop Application settings and preserves the desktop rendering wrapper', () => {
    expect(pane('streaming')).toBe('');
    const content = <SettingsV2RouteOnly routes={['streaming']}>Cloud region control</SettingsV2RouteOnly>;
    expect(renderToStaticMarkup(content)).toBe('Cloud region control');
    expect(renderToStaticMarkup(<SettingsV2RouteProvider value="streaming">{content}</SettingsV2RouteProvider>)).toBe('Cloud region control');
    expect(renderToStaticMarkup(<SettingsV2RouteProvider value="display">{content}</SettingsV2RouteProvider>)).toBe('');
  });
  it('does not infer integrated Xbox mode from fullscreen UI or start a native transition while rendering', () => {
    const data = demoSnapshot(); data.fullscreenExperience = { available: false, active: false, source: 'none' };
    data.desktopSettings = { canSetAutostart: false, fullscreenExperience: false, fullscreenExperienceSource: 'none' };
    const html = renderToStaticMarkup(<XboxModeSettings data={data} />);
    expect(html).toContain('XBOX mode is unavailable'); expect(html).toContain('role="switch"'); expect(html).not.toContain('Xbox mode is active');
    data.fullscreenExperience = { available: true, active: true, source: 'session' };
    const integrated = renderToStaticMarkup(<XboxModeSettings data={data} />);
    expect(integrated).toContain('Xbox mode is active'); expect(integrated).toContain('disabled=""'); expect(integrated).toContain('system session controls');
  });
  it('requires an acknowledged native mode state for either settings switch direction', async () => {
    const setFullscreenExperience = vi.fn(async (enabled: boolean) => ({ available: true, active: enabled, source: 'gnome-extension' as const }));
    await changeSettingsXboxMode({setFullscreenExperience}, true); await changeSettingsXboxMode({setFullscreenExperience}, false);
    expect(setFullscreenExperience.mock.calls).toEqual([[true],[false]]);
    await expect(changeSettingsXboxMode({setFullscreenExperience: async () => ({available:false,active:true,source:'none'})}, true)).rejects.toThrow('unconfirmed');
    await expect(changeSettingsXboxMode({setFullscreenExperience: async () => ({available:true,active:true,source:'gnome-extension'})}, false)).rejects.toThrow('unconfirmed');
  });
  it('gives a nested provider Back priority over category Back, then closes from the category root', () => {
    const nested = { disabled: false, click: vi.fn() }, category = { disabled: false, click: vi.fn() }, close = vi.fn();
    let nestedOpen = true, categoryOpen = true;
    const surface = { querySelector: vi.fn((selector: string) => selector.includes(':not') ? nestedOpen ? nested : null : categoryOpen ? category : null) } as unknown as Pick<HTMLElement, 'querySelector'>;
    handleSettingsBack(surface, true, close); expect(nested.click).not.toHaveBeenCalled();
    handleSettingsBack(surface, false, close); expect(nested.click).toHaveBeenCalledOnce(); expect(category.click).not.toHaveBeenCalled();
    nestedOpen = false; handleSettingsBack(surface, false, close); expect(category.click).toHaveBeenCalledOnce(); expect(close).not.toHaveBeenCalled();
    categoryOpen = false; handleSettingsBack(surface, false, close); expect(close).toHaveBeenCalledOnce();
  });
});
