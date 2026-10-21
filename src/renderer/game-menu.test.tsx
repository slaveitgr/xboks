import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { demoSnapshot } from '../shared/demo-data';
import { GameContextMenu, GameMenuActions, LibraryPage, gameContextMenuItems } from './App';

describe('VC++ action placement', () => {
  it('keeps management actions out of the closed library grid', () => {
    const html = renderToStaticMarkup(<LibraryPage data={demoSnapshot()} toast={() => {}} />);
    expect(html).not.toContain('Install / update VC++');
  });
  it('offers it in the game menu for any title using a supported runtime', () => {
    for (const game of demoSnapshot().games) {
      const html = renderToStaticMarkup(<GameMenuActions game={{ ...game, installState: 'ready' }} options={{ cloudSaves: true, vcInstall: true }} busy={false}
        onBrowse={() => {}} onSettings={() => {}} onInstallVc={() => {}} onRemove={() => {}} onShortcut={() => {}} />);
      expect(html).toMatch(/<button role="menuitem"[^>]*>[\s\S]*?Install \/ update VC\+\+<\/button>/);
      expect(html).not.toContain('disabled');
    }
  });
  it('keeps unsupported prerequisites disabled with an actionable reason', () => {
    const html = renderToStaticMarkup(<GameMenuActions game={demoSnapshot().games[0]} options={{ cloudSaves: false, vcInstall: false, vcReason: 'Select a full Proton runtime.' }} busy={false}
      onBrowse={() => {}} onSettings={() => {}} onInstallVc={() => {}} onRemove={() => {}} />);
    expect(html).toContain('disabled');
    expect(html).toContain('Select a full Proton runtime.');
  });
});

it('keeps Nexus tools available in details without displacing original context actions', () => {
  const props = { game: demoSnapshot().games[0], options: { cloudSaves: true, vcInstall: true }, busy: false,
    onBrowse: () => {}, onSettings: () => {}, onInstallVc: () => {}, onRemove: () => {}, onShortcut: () => {},
    onUpdate: () => {}, onContent: () => {} };
  const shared = renderToStaticMarkup(<GameMenuActions {...props} />);
  const context = renderToStaticMarkup(<GameContextMenu x={0} y={0} {...props} />);
  expect(context).toContain('XBOKS Engine / Proton options');
  expect(context).not.toContain('Install / update VC++');
  expect(context).not.toContain('Add to Steam');
  for (const name of ['Install / update VC++', 'Remove game', 'Game settings', 'Manage content', 'Check for updates', 'Add to Steam']) expect(shared).toContain(name);
  const source = readFileSync('src/renderer/App.tsx', 'utf8');
  expect(source).toContain('manage={<GameMenuActions {...managementProps(selected)} />}');
  expect(source).toContain('items={gameContextMenuItems(actions, text)}');
});

it('offers both game shortcut destinations only for ready installations', () => {
  for (const installState of ['ready', 'imported'] as const) {
    const html = renderToStaticMarkup(<GameMenuActions game={{ ...demoSnapshot().games[0], installState }} busy={false}
      onBrowse={() => {}} onSettings={() => {}} onInstallVc={() => {}} onRemove={() => {}} onShortcut={() => {}} />);
    expect(html).toContain('Create desktop shortcut'); expect(html).toContain('Add to applications menu');
    expect(html).toContain('Add to Steam');
    expect(html).toMatch(installState === 'ready' ? /<button role="menuitem" title="Add a shortcut[^]*?Add to Steam/ : /<button role="menuitem" disabled="" title="Add a shortcut[^]*?Add to Steam/);
    expect(html).toMatch(installState === 'ready' ? /<button role="menuitem"><(?:svg|span)[^]*?Create desktop shortcut/ : /<button role="menuitem" disabled=""><(?:svg|span)[^]*?Create desktop shortcut/);
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

it('keeps the selected game callbacks, capability states and original context action order', () => {
  let action = '';
  const props = { game: demoSnapshot().games[0], busy: false, onBrowse: () => {}, onInstallVc: () => {},
    onSettings: () => { action = 'settings'; }, onRemove: () => { action = 'remove'; },
    onDetails: () => { action = 'details'; }, onPlay: () => { action = 'play'; }, playDisabled: true,
    onPlayLater: () => { action = 'later'; }, onContent: () => {}, contentDisabled: true };
  const items = gameContextMenuItems(props).filter(item => !item.hidden);
  expect(items.map(item => item.id)).toEqual(['details','play','later','content','shortcut','settings','remove']);
  expect(items.find(item => item.id === 'play')?.disabled).toBe(true);
  expect(items.find(item => item.id === 'content')?.disabled).toBe(true);
  items.find(item => item.id === 'details')!.onSelect(); expect(action).toBe('details');
});
