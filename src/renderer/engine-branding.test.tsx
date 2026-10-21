import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { demoSnapshot } from '../shared/demo-data';
import { FirstRunWizard, SettingsPage } from './App';
import type { SettingsSection } from './SettingsFrame';

const text = (html: string) => html.replace(/<[^>]*>/g, ' ');
const settings = (section: SettingsSection) => renderToStaticMarkup(<SettingsPage data={demoSnapshot()} toast={() => {}} initialSection={section} />);

it.each<SettingsSection>(['account', 'application', 'subscriptions', 'notifications', 'install', 'library', 'audio', 'accessibility'])('keeps upstream branding out of the %s settings copy', section => {
  expect(text(settings(section))).not.toMatch(/xodus|nexus/i);
});

it('keeps upstream credits, copyright and license links in About', () => {
  const html = settings('about');
  expect(text(html)).toContain('xboks Engine builds on Xodus and Xodus Nexus.');
  expect(text(html)).toContain('Copyright © 2026 Xodus Nexus contributors.');
  expect(text(html)).toContain('The launcher retains its MIT license.');
  for (const href of ['https://github.com/xodus-gaming/xodus', 'https://github.com/domsvoboda/xodus-nexus', 'https://github.com/slaveitgr/xboks/blob/HEAD/LICENSE']) expect(html).toContain(`href="${href}"`);
  expect(text(html)).not.toContain('xodus-nexus-runtime-demo');
});

it('preserves exact user-selected paths while labeling engine settings', () => {
  const data = demoSnapshot();
  data.settings.externalXodusRoot = '/home/mike/projects/xodus-custom';
  data.settings.runtimeRoot = '/mnt/Nexus custom/runtime';
  data.settings.winePath = '/mnt/Nexus custom/runtime/wine';
  const html = renderToStaticMarkup(<SettingsPage data={data} toast={() => {}} initialSection="install" />);
  expect(text(html)).toContain('xboks Engine / Proton settings');
  for (const value of [data.settings.externalXodusRoot, data.settings.runtimeRoot, data.settings.winePath]) expect(html).toContain(`value="${value}"`);
});

it('uses xboks identity during first-run setup', () => {
  const html = renderToStaticMarkup(<FirstRunWizard data={demoSnapshot()} toast={() => {}} />);
  expect(text(html)).not.toMatch(/xodus|nexus/i);
  expect(text(html)).toContain('Upstream credits and licenses are available in Settings → About.');
});

it('allows owned runtime installation without gh or a GitHub sign-in and requires archive tools', () => {
  const data = demoSnapshot();
  data.runtime.nexusAvailable = true;
  data.runtime.nexusName = 'xboks-engine-runtime-new-x86_64.tar.xz';
  data.runtime.prerequisites = { gh: false, authenticated: false, tar: true, sha512sum: true };
  const render = () => renderToStaticMarkup(<SettingsPage data={data} toast={() => {}} initialSection="install" />);
  const installButton = (html: string) => [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].find(match => text(match[0]).includes('Install xboks Engine runtime'))?.[0];
  expect(installButton(render())).toBeDefined();
  expect(installButton(render())).not.toContain('disabled=""');
  expect(text(render())).not.toMatch(/GitHub Actions|Install gh|Authenticate gh/);
  data.runtime.prerequisites.tar = false;
  expect(installButton(render())).toContain('disabled=""');
  expect(text(render())).toContain('Install tar and sha512sum to install runtime archives.');
});
