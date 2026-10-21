import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { demoSnapshot } from '../shared/demo-data';
import { SettingsPage } from './App';

/** Read one named disclosure including nested details; never rely on DOM order. */
function disclosure(html: string, opening: RegExp): string {
  const start = [...html.matchAll(/<details\b[^>]*>/g)].find(match => opening.test(match[0]));
  if (!start || start.index === undefined) throw new Error(`Disclosure not found: ${opening}`);
  const tail = html.slice(start.index); let depth = 0;
  for (const tag of tail.matchAll(/<\/?details\b[^>]*>/g)) {
    depth += tag[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return tail.slice(0,tag.index!+tag[0].length);
  }
  throw new Error('Unclosed settings disclosure');
}
const diagnostics = (html: string) => disclosure(html,/class="[^"]*\bsettings-diagnostics\b/);
const nexus = (html: string) => disclosure(html,/class="nexus-settings-extra"/);
const account = (html: string) => disclosure(html,/id="account-session-controls"/);
const openingTag = (html: string) => html.slice(0,html.indexOf('>')+1);

describe('Settings diagnostics and Nexus disclosure integration', () => {
  it('does not call an unpublished development build the latest published release', () => {
    const html = renderToStaticMarkup(<SettingsPage data={demoSnapshot()} toast={() => {}} />);
    expect(html).toContain(`<h2>${demoSnapshot().launcherUpdate?.currentVersion}</h2>`);
    expect(html).not.toContain('latest published release');
    expect(html).toContain('Check GitHub for launcher updates.');
  });
  it('keeps diagnostics closed inside the closed Nexus / Proton settings disclosure, without a CLI command list', () => {
    const html = renderToStaticMarkup(<SettingsPage data={demoSnapshot()} toast={() => {}} initialSection="install" />);
    const details = diagnostics(html), extra = nexus(html);
    expect(openingTag(details)).not.toMatch(/\bopen(?:[\s=>])/);
    expect(openingTag(extra)).not.toMatch(/\bopen(?:[\s=>])/);
    expect(openingTag(extra)).not.toContain('hidden');
    expect(extra).toContain(details);
    expect(extra).toContain('Nexus / Proton settings');
    for(const text of ['Build dependencies','COMMIT','Verbose game logs','Save diagnostics','Build backend from source']) expect(details).toContain(text);
    for(const text of ['Install upstream snapshot','Check upstream snapshot','Advertised commands']) expect(html).not.toContain(text);
    const withoutDiagnostics = html.replace(details,'');
    for(const text of ['Build dependencies','Verbose game logs','PROTON HEAD','Official GitHub Actions snapshot','Build backend from source','Rebuild backend','Install / update backend']) expect(withoutDiagnostics).not.toContain(text);
    for(const text of ['Nexus runtime','Open backend diagnostic log','No passwords, tokens or account contents']) expect(extra.replace(details,'')).toContain(text);
    expect(extra).not.toContain('Install Nexus runtime');
    const originalPane = html.replace(extra,'');
    expect(originalPane).toContain('Game installation options');
    expect(originalPane).toContain('Download speed unit');
    expect(originalPane).not.toContain('Wine / Xodus Proton binary');
    expect(originalPane).not.toContain('Managed Proton compatibility runtime');
  });
  it('shows an installed upstream runtime separately from an unpublished Nexus release', () => {
    const data = demoSnapshot();
    data.runtime.name = 'xodus-proton-7c0b4354'; data.runtime.nexusAvailable = false;
    data.runtime.nexusError = 'No Nexus runtime release has been published yet.';
    data.backend.releaseAvailable = false; data.backend.blockReason = 'No compatible Nexus backend release has been published yet.';
    const extra = nexus(renderToStaticMarkup(<SettingsPage data={data} toast={() => {}} initialSection="install" />));
    expect(extra).toContain('Active: Xodus Proton runtime'); expect(extra).toContain('OTHER RUNTIME');
    expect(extra).toContain(data.runtime.nexusError); expect(extra).toContain(data.backend.blockReason);
    expect(extra).not.toContain('Install / update backend'); expect(extra).not.toContain('Install upstream snapshot');
  });
  it('keeps actionable setup errors outside nested diagnostics and unsupported account sign-in disabled', () => {
    const data = demoSnapshot(); data.backend.capabilities.login = false;
    data.backend.blockReason = 'Cargo is missing. Install it before building.'; data.runtime.error = 'SHA-512 verification failed.';
    const html = renderToStaticMarkup(<SettingsPage data={data} toast={() => {}} />);
    const session = account(html), extra=nexus(html), visibleSetup = extra.replace(diagnostics(extra),'');
    expect(openingTag(session)).not.toMatch(/\bopen(?:[\s=>])/);
    expect(visibleSetup).toContain(data.backend.blockReason); expect(visibleSetup).toContain(data.runtime.error);
    const signInButton = [...session.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].find(match=>match[0].includes('Sign in again'))?.[0];
    expect(signInButton).toBeDefined(); expect(openingTag(signInButton!)).toContain('disabled=""');
  });
  it('keeps account session controls separate from provider settings and Proton controls accessible under Nexus', () => {
    const html = renderToStaticMarkup(<SettingsPage data={demoSnapshot()} toast={() => {}} initialSection="install" />);
    expect(html).toContain('role="dialog" aria-modal="true" aria-label="Settings"');
    expect(html).toContain('aria-orientation="vertical"'); expect(html).toContain('Install options');
    const extra=nexus(html);
    expect(extra).toContain('Managed Proton compatibility runtime'); expect(extra).toContain('Wine / Xodus Proton binary');
    expect(extra).not.toContain('Sign in again'); expect(account(html)).toContain('Sign in again');
    expect(html).toContain('data-gamepad-cancel'); expect(html).toContain('id="settings-tab-install"');
  });
});
