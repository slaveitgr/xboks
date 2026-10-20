import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Sidebar, SettingsPage } from './App';
import { demoSnapshot } from '../shared/demo-data';

it('shows the Xbox gamertag and cached avatar in sidebar and Settings, with email fallback', () => {
  const data = demoSnapshot();
  data.auth = { running: false, stored: true, username: 'one@example.test', note: '', gamertag: 'ExampleGamer', avatarDataUrl: 'data:image/png;base64,iVBORw0KGgo=' };
  const sidebar = () => renderToStaticMarkup(<Sidebar data={data} page="home" go={() => {}} />);
  expect(sidebar()).toContain('<strong>ExampleGamer</strong>');
  expect(sidebar()).toContain('alt="Xbox profile picture"');
  expect(sidebar()).not.toContain('Credentials stored');
  data.auth.subscription = { status: 'active', productIds: ['CFQ7TTC0KGQ8'], checkedAt: new Date().toISOString() };
  expect(sidebar()).toContain('GAME PASS');
  data.auth.subscription = { ...data.auth.subscription, status: 'unknown', productIds: [] };
  expect(sidebar()).not.toContain('account-membership');
  const settings = renderToStaticMarkup(<SettingsPage data={data} toast={() => {}} />);
  expect(settings).toContain('<h2>ExampleGamer</h2>'); expect(settings).toContain('alt="Xbox profile picture"');
  delete data.auth.gamertag; delete data.auth.avatarDataUrl;
  expect(sidebar()).toContain('one@example.test'); expect(sidebar()).not.toContain('Xbox profile picture');
});
