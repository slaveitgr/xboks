import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { demoSnapshot } from '../shared/demo-data';
import { GameContextMenu, LibraryPage } from './App';

describe('VC++ action placement', () => {
  it('does not show the prerequisite button in the game detail panel', () => {
    const html = renderToStaticMarkup(<LibraryPage data={demoSnapshot()} toast={() => {}} />);
    expect(html).not.toContain('Install / update VC++');
  });
  it('offers it in the game menu for any title using a supported runtime', () => {
    for (const game of demoSnapshot().games) {
      const html = renderToStaticMarkup(<GameContextMenu x={0} y={0} game={{ ...game, installState: 'ready' }} options={{ cloudSaves: true, vcInstall: true }} busy={false}
        onBrowse={() => {}} onSettings={() => {}} onInstallVc={() => {}} onRemove={() => {}} onShortcut={() => {}} />);
      expect(html).toMatch(/<button role="menuitem"[^>]*>[\s\S]*?Install \/ update VC\+\+<\/button>/);
      expect(html).not.toContain('disabled');
    }
  });
  it('keeps unsupported prerequisites disabled with an actionable reason', () => {
    const html = renderToStaticMarkup(<GameContextMenu x={0} y={0} game={demoSnapshot().games[0]} options={{ cloudSaves: false, vcInstall: false, vcReason: 'Select a full Proton runtime.' }} busy={false}
      onBrowse={() => {}} onSettings={() => {}} onInstallVc={() => {}} onRemove={() => {}} />);
    expect(html).toContain('disabled');
    expect(html).toContain('Select a full Proton runtime.');
  });
});

it('offers both game shortcut destinations only for ready installations', () => {
  for (const installState of ['ready', 'imported'] as const) {
    const html = renderToStaticMarkup(<GameContextMenu x={0} y={0} game={{ ...demoSnapshot().games[0], installState }} busy={false}
      onBrowse={() => {}} onSettings={() => {}} onInstallVc={() => {}} onRemove={() => {}} onShortcut={() => {}} />);
    expect(html).toContain('Create desktop shortcut'); expect(html).toContain('Add to applications menu');
    expect(html).toContain('Add to Steam');
    expect(html).toMatch(installState === 'ready' ? /<button role="menuitem" title="Add a shortcut[^]*?Add to Steam/ : /<button role="menuitem" disabled="" title="Add a shortcut[^]*?Add to Steam/);
    expect(html).toMatch(installState === 'ready' ? /<button role="menuitem"><svg[^]*?Create desktop shortcut/ : /<button role="menuitem" disabled=""><svg[^]*?Create desktop shortcut/);
  }
});

it('marks single-click menu triggers and menu boundaries for outside-pointer dismissal', () => {
  const data = demoSnapshot();
  const library = renderToStaticMarkup(<LibraryPage data={data} toast={() => {}} />);
  expect(library).toContain('data-game-menu-trigger');
  expect(library).toContain('aria-haspopup="menu"');
  const menu = renderToStaticMarkup(<GameContextMenu x={0} y={0} game={data.games[0]} busy={false}
    onBrowse={() => {}} onSettings={() => {}} onInstallVc={() => {}} onRemove={() => {}} />);
  expect(menu).toContain('data-game-menu'); expect(menu).toContain('role="menu"');
});
