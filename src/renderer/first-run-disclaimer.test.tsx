import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { demoSnapshot } from '../shared/demo-data';
import { FirstRunWizard } from './App';

it('shows independent client status and xboks reporting before setup and sign-in', () => {
  const html = renderToStaticMarkup(<FirstRunWizard data={demoSnapshot()} toast={() => {}} />);
  const notice = html.match(/<section class="wizard-disclaimer"[^>]*>[\s\S]*?<\/section>/)?.[0];
  expect(notice).toContain('role="note"');
  expect(notice).toContain('Independent, unofficial project');
  expect(notice).toContain('independent, unofficial Linux client');
  expect(notice).toContain('not affiliated with or endorsed by Microsoft or Xbox');
  expect(notice).toContain('https://github.com/slaveitgr/xboks/issues');
  expect(notice).toContain('target="_blank" rel="noopener noreferrer"');
  expect(notice).toContain('Upstream credits and licenses are available in Settings → About.');
  expect(notice).not.toMatch(/xodus|nexus/i);
  expect(html.indexOf('wizard-disclaimer')).toBeLessThan(html.indexOf('Games folder'));
  expect(html).toMatch(/<input[^>]*data-gamepad-initial/);
  expect(html).toContain('Start using xboks');
});
