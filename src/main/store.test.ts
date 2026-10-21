import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { promises as fileSystem } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { inspectGameDirectory, StateStore } from './store.js';
import type { DownloadTask } from '../shared/types.js';
import { managedPaths, migrateManagedPaths } from './managed-paths.js';

const created: string[] = [];

describe('managed runtime path migration', () => {
  it('defaults new profiles to the XDG xboks Engine runtime root', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'xboks-runtime-default-')); created.push(home);
    const dataHome = path.join(home, 'data');
    const store = new StateStore(path.join(home, 'profile'), { home, dataHome }); await store.load();
    expect(store.settings.runtimeRoot).toBe(managedPaths({ home, dataHome }).runtimeRoot);
  });
  it('rebases only validated managed runtime paths while retaining game paths, downloads, custom settings and saved bytes', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'xboks-state-migration-')); created.push(home);
    const configHome = path.join(home, 'config'); const dataHome = path.join(home, 'data');
    const profile = path.join(configHome, 'xodus-nexus'); const oldData = path.join(dataHome, 'xodus-nexus');
    await mkdir(profile, { recursive: true, mode: 0o700 }); await mkdir(path.join(oldData, 'runtimes/release/bin'), { recursive: true, mode: 0o700 });
    const winePath = path.join(oldData, 'runtimes/release/bin/wine'); await writeFile(winePath, 'fixture wine');
    const gamePath = path.join(oldData, 'unusual-imported-game'); const destination = path.join(oldData, 'custom-download');
    const persisted = JSON.stringify({ settings: { runtimeRoot: path.join(oldData, 'runtimes'), winePath, externalXodusRoot: '/mnt/custom-backend' }, games: [{ id: 'g', path: gamePath }], downloads: [{ id: 'd', status: 'paused', destination, checkpoint: 'unchanged' }] });
    await writeFile(path.join(profile, 'launcher-state.json'), persisted);
    const migration = await migrateManagedPaths({ home, configHome, dataHome });
    expect(migration.moves).toHaveLength(2);
    const store = new StateStore(migration.profile, { pathMoves: migration.moves, home, dataHome }); await store.load();
    expect(store.settings.runtimeRoot).toBe(migration.runtimeRoot);
    expect(store.settings.winePath).toBe(path.join(migration.runtimeRoot, 'release/bin/wine'));
    expect(store.settings.externalXodusRoot).toBe('/mnt/custom-backend');
    expect(store.games[0].path).toBe(gamePath); expect(store.downloads[0].destination).toBe(destination);
    expect(await readFile(path.join(migration.profile, 'launcher-state.json'), 'utf8')).toBe(persisted);
    await store.setSettings({ runtimeRoot: '/mnt/custom-runtimes', winePath: '/mnt/custom-runtimes/bin/wine' });
    const reopened = new StateStore(migration.profile, { pathMoves: migration.moves, home, dataHome }); await reopened.load();
    expect(reopened.settings.runtimeRoot).toBe('/mnt/custom-runtimes'); expect(reopened.settings.winePath).toBe('/mnt/custom-runtimes/bin/wine');
  });
});

describe('install root migration', () => {
  it('changes only the exact legacy default for future installs while preserving existing game and download paths', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'xboks-install-root-migrate-')); created.push(directory);
    const legacyRoot = path.join(homedir(), 'Games', 'Xodus Nexus');
    const gamePaths = [path.join(legacyRoot, 'Existing game'), '/mnt/custom-games/Another game'];
    const downloadPaths = [path.join(legacyRoot, 'Partial download'), '/mnt/downloads/Custom destination'];
    const persisted = JSON.stringify({
      settings: { installRoot: legacyRoot, market: 'GR' },
      games: gamePaths.map((gamePath, index) => ({ id: `game-${index}`, path: gamePath, title: 'Existing game', installState: 'ready', addedAt: '2026-01-01T00:00:00Z' })),
      downloads: downloadPaths.map((destination, index) => ({ id: `download-${index}`, destination, status: 'paused' })),
    });
    const file = path.join(directory, 'launcher-state.json'); await writeFile(file, persisted);
    const store = new StateStore(directory); await store.load();
    expect(store.settings.installRoot).toBe(path.join(homedir(), 'Games', 'Xboks'));
    expect(store.settings.market).toBe('GR');
    expect(store.games.map(game => game.path)).toEqual(gamePaths);
    expect(store.downloads.map(task => task.destination)).toEqual(downloadPaths);
    expect(await readFile(file, 'utf8')).toBe(persisted); // Loading does not rewrite or move any files.
    await store.save();
    const reopened = new StateStore(directory); await reopened.load();
    expect(reopened.settings.installRoot).toBe(path.join(homedir(), 'Games', 'Xboks'));
    expect(reopened.games.map(game => game.path)).toEqual(gamePaths);
    expect(reopened.downloads.map(task => task.destination)).toEqual(downloadPaths);
  });

  it('preserves every custom install root, including paths merely resembling the old default', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'xboks-custom-install-root-')); created.push(directory);
    const legacyRoot = path.join(homedir(), 'Games', 'Xodus Nexus');
    for (const installRoot of [path.join(legacyRoot, 'Custom'), legacyRoot + '/', path.join(homedir(), 'Games', 'My Games'), '/mnt/games/Xodus Nexus']) {
      await writeFile(path.join(directory, 'launcher-state.json'), JSON.stringify({ settings: { installRoot } }));
      const store = new StateStore(directory); await store.load();
      expect(store.settings.installRoot).toBe(installRoot);
    }
  });
});

describe('download bandwidth settings', () => {
  it('defaults to unlimited and persists fractional MiB/s without changing parallelism', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'nexus-bandwidth-state-')); created.push(directory);
    const store = new StateStore(directory); await store.load();
    expect(store.settings.downloadLimitMiB).toBe(0);
    const parallel = store.settings.parallelDownloads;
    await store.setSettings({ downloadLimitMiB: 0.5 });
    const reopened = new StateStore(directory); await reopened.load();
    expect(reopened.settings.downloadLimitMiB).toBe(0.5);
    expect(reopened.settings.parallelDownloads).toBe(parallel);
    await expect(reopened.setSettings({ downloadLimitMiB: -1 })).rejects.toThrow('Download speed limit');
    expect(reopened.settings.downloadLimitMiB).toBe(0.5);
    const final = new StateStore(directory); await final.load();
    expect(final.settings.downloadLimitMiB).toBe(0.5);
  });
  it('migrates old profiles and rejects invalid persisted rate values', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'nexus-bandwidth-migrate-')); created.push(directory);
    for (const value of [undefined, -1, null, '2', 2048, 0.000001]) {
      await writeFile(path.join(directory, 'launcher-state.json'), JSON.stringify({ settings: { downloadLimitMiB: value } }));
      const store = new StateStore(directory); await store.load();
      expect(store.settings.downloadLimitMiB).toBe(0);
    }
  });
});

describe('desktop preferences', () => {
  it('defaults background launch off independently of autostart and normalizes old profiles', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'xboks-desktop-state-')); created.push(directory);
    await writeFile(path.join(directory, 'launcher-state.json'), JSON.stringify({ settings: {
      launchOnLogin: true, launchInBackground: 'true', minimizeToTray: 1,
      createDesktopShortcut: 'true', downloadSpeedUnit: 'megabytes',
    } }));
    const store = new StateStore(directory); await store.load();
    expect(store.settings).toMatchObject({ launchOnLogin: true, launchInBackground: false, minimizeToTray: false, createDesktopShortcut: false, downloadSpeedUnit: 'bytes' });
    await store.setSettings({ launchInBackground: true, minimizeToTray: true, createDesktopShortcut: true, downloadSpeedUnit: 'bits' });
    const reopened = new StateStore(directory); await reopened.load();
    expect(reopened.settings).toMatchObject({ launchOnLogin: true, launchInBackground: true, minimizeToTray: true, createDesktopShortcut: true, downloadSpeedUnit: 'bits', downloadLimitMiB: 0 });
    await expect(reopened.setSettings({ downloadSpeedUnit: 'MiB' as 'bytes' })).rejects.toThrow('display unit');
    await expect(reopened.setSettings({ launchInBackground: 'false' as unknown as boolean })).rejects.toThrow('launchInBackground');
  });

  it('restores the live preference after a save failure and permits a later successful update', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'xboks-desktop-failure-')); created.push(directory);
    const store = new StateStore(directory); await store.load();
    await store.setSettings({ launchOnLogin: true });
    // A synthetic conflicting temporary path fails the atomic write without touching the desktop.
    await mkdir(path.join(directory, 'launcher-state.json.tmp'));
    await expect(store.setSettings({ launchInBackground: true })).rejects.toThrow();
    expect(store.settings.launchInBackground).toBe(false);
    expect(JSON.parse(await readFile(path.join(directory, 'launcher-state.json'), 'utf8')).settings.launchInBackground).toBe(false);
    await rm(path.join(directory, 'launcher-state.json.tmp'), { recursive: true });
    await store.setSettings({ launchInBackground: true });
    expect(store.settings.launchInBackground).toBe(true);
  });

  it('does not leak a failed preference into a concurrently queued unrelated state save', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'xboks-desktop-queued-save-')); created.push(directory);
    const store = new StateStore(directory); await store.load(); await store.save();
    const rename = vi.spyOn(fileSystem, 'rename').mockRejectedValueOnce(new Error('synthetic rename failure'));
    try {
      const update = store.setSettings({ launchOnLogin: true, launchInBackground: true });
      await Promise.resolve(); // The settings transaction has started while a second state save is queued.
      const unrelatedSave = store.save();
      await expect(update).rejects.toThrow('synthetic rename failure');
      await unrelatedSave;
      expect(store.settings.launchOnLogin).toBe(false);
      const reopened = new StateStore(directory); await reopened.load();
      expect(reopened.settings).toMatchObject({ launchOnLogin: false, launchInBackground: false });
    } finally { rename.mockRestore(); }
  });
});

describe('manifest XML comments', () => {
  it('imports only active metadata and never changes the manifest', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'nexus-xml-comments-'));
    created.push(directory);
    const xml = `<?xml version="1.0"?>
      <!-- examples -> \x1b[32m <Identity Name="Example" Version="0.0.0.0"/>
        <ShellVisuals DefaultDisplayName="Example" Square480x480Logo="wrong.png"/>
        <Executable Name="Wrong.exe"/><StoreId>000000000000</StoreId>
        <KnownDependency Name="VC14"/> -->
      <Game><Identity Name='Actual.Package' Version='1.2.3.4'/>
        <ShellVisuals DefaultDisplayName="Actual &amp; Game" PublisherDisplayName="Publisher"
          Square480x480Logo="actual.png"/>
        <ExecutableList><Executable Name='Game.exe'/></ExecutableList>
        <StoreId>9AAAAA<!-- annotation -->AAAAAA</StoreId></Game>`;
    await writeFile(path.join(directory, 'MicrosoftGame.config'), xml);
    await writeFile(path.join(directory, 'Game.exe'), 'MZ fixture');
    await writeFile(path.join(directory, '.xodus-streaming.msixvc'), 'fixture');
    await writeFile(path.join(directory, 'actual.png'), 'actual image');
    await mkdir(path.join(directory, 'Engine/Extras/Redist/en-us'), { recursive: true });
    await writeFile(path.join(directory, 'Engine/Extras/Redist/en-us/vc_redist.x64.exe'), 'encrypted fixture');
    expect(await inspectGameDirectory(directory)).toMatchObject({
      title: 'Actual & Game', storeId: '9AAAAAAAAAAA', packageName: 'Actual.Package',
      installedVersion: '1.2.3.4', executable: 'Game.exe', publisher: 'Publisher',
      coverDataUrl: `data:image/png;base64,${Buffer.from('actual image').toString('base64')}`,
      vcRedistEncrypted: false, installState: 'ready',
    });
    expect(await readFile(path.join(directory, 'MicrosoftGame.config'), 'utf8')).toBe(xml);
  });

  it('does not invent missing metadata from comments or CDATA', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'nexus-xml-absent-'));
    created.push(directory);
    await writeFile(path.join(directory, 'MicrosoftGame.config'), `<Game>
      <!-- <StoreId>000000000000</StoreId><Executable Name="Wrong.exe"/> -->
      <Description><![CDATA[<StoreId>111111111111</StoreId>]]></Description></Game>`);
    const game = await inspectGameDirectory(directory);
    expect(game.storeId).toBeUndefined();
    expect(game.executable).toBeUndefined();
    expect(game.installState).toBe('imported');
  });

  it('reads appx metadata without commented examples, preserving namespaces and quotes', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'nexus-appx-comments-'));
    created.push(directory);
    await writeFile(path.join(directory, 'appxmanifest.xml'), `<Package xmlns:uap="urn:test">
      <!-- <Identity Name="Wrong"/><DisplayName>Wrong</DisplayName>
        <Application Executable="Wrong.exe"/><uap:VisualElements Square150x150Logo="wrong.png"/> -->
      <Identity Name="Actual.Appx" Version="2.0.0.0"/>
      <Properties><DisplayName>Actual &gt; Example</DisplayName><PublisherDisplayName>Actual</PublisherDisplayName></Properties>
      <Applications><Application Executable='Actual.exe'><uap:VisualElements Description="a > b"
        Square150x150Logo='actual.png'/></Application></Applications></Package>`);
    await writeFile(path.join(directory, 'actual.png'), 'actual');
    expect(await inspectGameDirectory(directory)).toMatchObject({
      title: 'Actual > Example', packageName: 'Actual.Appx', executable: 'Actual.exe',
      publisher: 'Actual', installedVersion: '2.0.0.0',
      coverDataUrl: `data:image/png;base64,${Buffer.from('actual').toString('base64')}`,
    });
  });

  it('rejects an unterminated comment rather than importing example tags', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'nexus-xml-malformed-'));
    created.push(directory);
    await writeFile(path.join(directory, 'MicrosoftGame.config'), '<Game><!-- <StoreId>000000000000</StoreId></Game>');
    await expect(inspectGameDirectory(directory)).rejects.toThrow();
  });
});

afterEach(async () => {
  await Promise.all(created.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function makeEacGame(targetHeader: Buffer, eacDirectory = 'EasyAntiCheat') {
  const directory = await mkdtemp(path.join(tmpdir(), 'xodus-nexus-game-'));
  created.push(directory);
  await mkdir(path.join(directory, eacDirectory), { recursive: true });
  await mkdir(path.join(directory, 'Game', 'Binaries'), { recursive: true });
  await writeFile(path.join(directory, 'MicrosoftGame.config'), '<Game><ExecutableList><Executable Name="start_protected_game.exe" /></ExecutableList><StoreId>TEST123</StoreId></Game>');
  await writeFile(path.join(directory, '.xodus-streaming.msixvc'), 'container');
  await writeFile(path.join(directory, 'start_protected_game.exe'), 'encrypted launcher');
  await writeFile(path.join(directory, eacDirectory, 'Settings.json'), JSON.stringify({ executable: 'Game\\Binaries\\Game.exe' }));
  await writeFile(path.join(directory, 'Game', 'Binaries', 'Game.exe'), targetHeader);
  return directory;
}

describe('inspectGameDirectory anti-cheat support', () => {
  it('keeps per-game launch tools after saving, reopening and refreshing installed metadata', async () => {
    const root=await mkdtemp(path.join(tmpdir(),'nexus-game-tool-state-')); created.push(root);
    const store=new StateStore(root);
    const game={id:'test-tools',title:'Synthetic game',path:'/sample/game',installState:'ready' as const,addedAt:'2026-10-16T00:00:00Z'};
    const launchTools={dualSenseCompatibility:true,mangoHud:true,gamescope:false,gamescopeArgs:'',launchOptions:'DXVK_HUD=fps %command% --launcher-skip'};
    await store.upsertGame(game); await store.patchGame(game.id,{launchTools});
    const reopened=new StateStore(root); await reopened.load();
    expect(reopened.games[0].launchTools).toEqual(launchTools);
    await reopened.upsertGame({...game,publisher:'Updated metadata'});
    expect(reopened.games[0].launchTools).toEqual(launchTools);
  });
  it('detects an encrypted EAC chain without declaring online play unsupported', async () => {
    const game = await inspectGameDirectory(await makeEacGame(Buffer.from([0x01, 0x02, 0x03])));
    expect(game.installState).toBe('ready');
    expect(game.executable).toBe('start_protected_game.exe');
    expect(game.antiCheat).toEqual({
      provider: 'Easy Anti-Cheat',
      executable: 'Game\\Binaries\\Game.exe',
      encryptedTarget: true,
    });
    expect(game).not.toHaveProperty('launchSupport');
  });

  it('keeps the manifest launcher even when the EAC target is an ordinary PE file', async () => {
    const game = await inspectGameDirectory(await makeEacGame(Buffer.from('MZ executable')));
    expect(game.executable).toBe('start_protected_game.exe');
    expect(game.antiCheat?.encryptedTarget).toBe(false);
  });

  it('detects the EasyAntiCheat_EOS metadata layout', async () => {
    const game = await inspectGameDirectory(await makeEacGame(Buffer.from('MZ executable'), 'EasyAntiCheat_EOS'));
    expect(game.antiCheat?.provider).toBe('Easy Anti-Cheat');
    expect(game.executable).toBe('start_protected_game.exe');
  });

  it('does not show an EAC warning without EAC metadata', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'xodus-nexus-no-eac-'));
    created.push(directory);
    await writeFile(path.join(directory, 'MicrosoftGame.config'), '<Game><ExecutableList><Executable Name="Game.exe" /></ExecutableList></Game>');
    await writeFile(path.join(directory, '.xodus-streaming.msixvc'), 'container');
    await writeFile(path.join(directory, 'Game.exe'), 'MZ executable');
    const game = await inspectGameDirectory(directory);
    expect(game.antiCheat).toBeUndefined();
    expect(game).not.toHaveProperty('launchBlockReason');
  });
});

describe('inspectGameDirectory prerequisites', () => {
  it('detects a declared VC14 dependency with an encrypted redistributable', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'xodus-nexus-vc-game-'));
    created.push(directory);
    await mkdir(path.join(directory, 'Engine', 'Extras', 'Redist', 'en-us'), { recursive: true });
    await writeFile(path.join(directory, 'MicrosoftGame.config'), '<Game><ExecutableList><Executable Name="Game.exe" /></ExecutableList><KnownDependency Name="VC14" /></Game>');
    await writeFile(path.join(directory, 'Game.exe'), 'encrypted executable');
    await writeFile(path.join(directory, '.xodus-streaming.msixvc'), 'container');
    await writeFile(path.join(directory, 'Engine', 'Extras', 'Redist', 'en-us', 'vc_redist.x64.exe'), Buffer.from([0, 1, 2]));
    expect((await inspectGameDirectory(directory)).vcRedistEncrypted).toBe(true);
  });
});

describe('new profile defaults', () => {
  it('discards legacy EAC-free route fields without losing the installation', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'xodus-nexus-legacy-'));
    created.push(directory);
    await writeFile(path.join(directory, 'launcher-state.json'), JSON.stringify({ games: [{
      id: 'game', title: 'Any title', path: '/package', executable: 'Launcher.exe',
      launchSupport: 'offline-only-eac', launchBlockReason: 'Old warning', installState: 'ready',
    }] }));
    const store = new StateStore(directory);
    await store.load();
    expect(store.games[0].executable).toBe('Launcher.exe');
    expect(store.games[0]).not.toHaveProperty('launchSupport');
    expect(store.games[0]).not.toHaveProperty('launchBlockReason');
  });
  it('does not assume a particular disk or Xodus checkout', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'xodus-nexus-settings-'));
    created.push(directory);
    const store = new StateStore(directory);
    await store.load();
    expect(store.settings.installRoot).toContain(path.join('Games', 'Xboks'));
    expect(store.settings.installRoot).not.toContain('/mnt/data2');
    expect(store.settings.externalXodusRoot).toBe('');
    expect(store.settings.verboseLogs).toBe(false);
  });
});

describe('install queue history', () => {
  it('keeps all pending rows beyond the history limit and serializes concurrent saves', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'xodus-queue-persist-')); created.push(directory);
    const store = new StateStore(directory);
    const base: DownloadTask = { id: '', title: 'Sample', productId: '9AAAAAAAAAAA', destination: '/sample', status: 'queued', progress: null, phase: 'Waiting', log: [], startedAt: new Date().toISOString() };
    await Promise.all(Array.from({ length: 40 }, (_, index) => store.addDownload({ ...base, id: `pending-${index}` })));
    await Promise.all(Array.from({ length: 35 }, (_, index) => store.addDownload({ ...base, id: `done-${index}`, status: 'complete' })));
    expect(store.downloads.filter(task => task.status === 'queued')).toHaveLength(40);
    expect(store.downloads.filter(task => task.status === 'complete')).toHaveLength(30);
    const loaded = new StateStore(directory); await loaded.load();
    expect(loaded.downloads).toHaveLength(70);
    expect(loaded.downloads.filter(task => task.status === 'paused')).toHaveLength(40);
    expect(loaded.downloads.find(task => task.id === 'pending-0')?.canPause).toBe(true);
  });
  it('removes only finished entries and never deletes install files', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'xodus-nexus-queue-'));
    created.push(directory);
    const store = new StateStore(directory);
    await store.load();
    const destination = path.join(directory, 'game');
    await mkdir(destination);
    await writeFile(path.join(destination, 'keep.txt'), 'game data');
    const base = { title: 'Game', productId: 'TEST', destination, progress: null, phase: '', log: [], startedAt: new Date().toISOString() };
    await store.addDownload({ ...base, id: 'running', status: 'running' });
    await store.addDownload({ ...base, id: 'paused', status: 'paused' });
    await store.addDownload({ ...base, id: 'failed', status: 'failed' });
    await expect(store.removeDownload('running')).rejects.toThrow('Stop the installation');
    await expect(store.removeDownload('paused')).rejects.toThrow('Stop the installation');
    await store.removeDownload('failed');
    expect(store.downloads.map((task) => task.id)).toEqual(['paused', 'running']);
    await store.clearFinishedDownloads();
    expect(store.downloads.map((task) => task.id)).toEqual(['paused', 'running']);
    const restored = new StateStore(directory);
    await restored.load();
    expect(restored.downloads.every(task => task.status === 'paused' && task.canPause && !task.controlPending)).toBe(true);
    expect(await readFile(path.join(destination, 'keep.txt'), 'utf8')).toBe('game data');
  });
});

describe('inspectGameDirectory artwork', () => {
  it('reads a case-variant MicrosoftGame.Config and its cover', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'xodus-nexus-art-case-'));
    created.push(directory);
    await writeFile(path.join(directory, 'MicrosoftGame.Config'), '<Game><ShellVisuals DefaultDisplayName="Forza Horizon 6" Square150x150Logo="Logo.png" /><ExecutableList><Executable Name="Game.exe" /></ExecutableList></Game>');
    await writeFile(path.join(directory, '.xodus-streaming.msixvc'), 'container');
    await writeFile(path.join(directory, 'Game.exe'), 'MZ executable');
    await writeFile(path.join(directory, 'Logo.png'), 'PNGDATA');
    const game = await inspectGameDirectory(directory);
    expect(game.title).toBe('Forza Horizon 6');
    expect(game.coverDataUrl).toBe('data:image/png;base64,UE5HREFUQQ==');
  });

  it('falls back to the appxmanifest visual elements for the cover', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'xodus-nexus-art-appx-'));
    created.push(directory);
    await writeFile(path.join(directory, 'MicrosoftGame.config'), '<Game><ExecutableList><Executable Name="Game.exe" /></ExecutableList></Game>');
    await writeFile(path.join(directory, 'appxmanifest.xml'), '<Package><Applications><Application Id="App" Executable="Game.exe"><uap:VisualElements DisplayName="Forza Horizon 6" Square44x44Logo="Small.png" Square150x150Logo="Logo.png" /></Application></Applications></Package>');
    await writeFile(path.join(directory, '.xodus-streaming.msixvc'), 'container');
    await writeFile(path.join(directory, 'Game.exe'), 'MZ executable');
    await writeFile(path.join(directory, 'Logo.png'), 'PNGDATA');
    const game = await inspectGameDirectory(directory);
    expect(game.coverDataUrl).toBe('data:image/png;base64,UE5HREFUQQ==');
  });
});

describe('inspectGameDirectory titles containing quotes', () => {
  it('keeps the full title when the display name contains an apostrophe', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'xodus-nexus-title-'));
    created.push(directory);
    await writeFile(path.join(directory, 'MicrosoftGame.config'),
      '<Game><ExecutableList><Executable Name="Game.exe" /></ExecutableList><ShellVisuals DefaultDisplayName="No Man\'s Sky" PublisherDisplayName="Hello Games" /><StoreId>TEST123</StoreId></Game>');
    await writeFile(path.join(directory, '.xodus-streaming.msixvc'), 'container');
    await writeFile(path.join(directory, 'Game.exe'), 'MZ executable');
    const game = await inspectGameDirectory(directory);
    expect(game.title).toBe("No Man's Sky");
    expect(game.publisher).toBe('Hello Games');
  });

  it('keeps single-quoted attribute values containing a double quote', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'xodus-nexus-title-dq-'));
    created.push(directory);
    await writeFile(path.join(directory, 'MicrosoftGame.config'),
      "<Game><ExecutableList><Executable Name='Game.exe' /></ExecutableList><ShellVisuals DefaultDisplayName='A \"quoted\" Game' /></Game>");
    await writeFile(path.join(directory, '.xodus-streaming.msixvc'), 'container');
    await writeFile(path.join(directory, 'Game.exe'), 'MZ executable');
    const game = await inspectGameDirectory(directory);
    expect(game.title).toBe('A "quoted" Game');
  });
});
