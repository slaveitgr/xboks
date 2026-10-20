import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DownloadTask, Game } from '../shared/types.js';
import { assertGameRemovalAvailable, validateGameDeleteTarget } from './game-removal.js';

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true }))); });

async function fixture(): Promise<Game> {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'xodus-delete-test-'));
  temporary.push(parent);
  const directory = path.join(parent, 'game');
  await fs.mkdir(directory);
  await fs.writeFile(path.join(directory, 'MicrosoftGame.config'), '<Game />');
  return { id: 'game', title: 'Test', path: directory, installState: 'ready', addedAt: new Date().toISOString() };
}

describe('game removal target', () => {
  it('accepts an isolated game directory with a manifest', async () => {
    const game = await fixture();
    expect(await validateGameDeleteTarget(game, [], [os.homedir()])).toMatchObject({ path: game.path });
  });

  it('rejects a directory containing another game', async () => {
    const game = await fixture();
    const nested = { ...game, id: 'nested', path: path.join(game.path, 'nested') };
    await expect(validateGameDeleteTarget(game, [nested], [])).rejects.toThrow('another library game');
  });

  it('rejects a protected directory and a missing manifest', async () => {
    const game = await fixture();
    await expect(validateGameDeleteTarget(game, [], [path.join(game.path, 'runtime')])).rejects.toThrow('protected');
    await fs.unlink(path.join(game.path, 'MicrosoftGame.config'));
    await expect(validateGameDeleteTarget(game, [], [])).rejects.toThrow('manifest');
  });
});

function download(destination: string, status: DownloadTask['status'] = 'running', extra: Partial<DownloadTask> = {}): DownloadTask {
  return { id: 'download', title: 'Synthetic installation', productId: '9AAAAAAAAAAA', destination,
    status, progress: null, phase: 'Test', log: [], startedAt: '2026-10-17T00:00:00Z', ...extra };
}
const inactive = () => false;

describe('target-specific removal locks', () => {
  it('allows another title to download, queue, pause or finish without changing any task', async () => {
    const game = await fixture();
    const tasks = (['queued', 'running', 'paused', 'complete', 'failed', 'cancelled'] as const)
      .map(status => download(`${game.path}-other`, status));
    const before = structuredClone(tasks);
    await expect(assertGameRemovalAvailable(game, tasks, () => true)).resolves.toBeUndefined();
    expect(tasks).toEqual(before);
    expect(await fs.readFile(path.join(game.path, 'MicrosoftGame.config'), 'utf8')).toBe('<Game />');
  });

  it.each(['queued', 'running', 'paused'] as const)('protects equal, parent and child folders of a %s installation', async status => {
    const game = await fixture();
    for (const destination of [game.path, path.dirname(game.path), path.join(game.path, 'not-created', 'dlc')]) {
      await expect(assertGameRemovalAvailable(game, [download(destination, status)], inactive)).rejects.toThrow('using this folder');
    }
  });

  it.each(['install', 'update', 'content'] as const)('protects the parent game ID even when a %s task writes elsewhere', async kind => {
    const game = await fixture();
    const task = download(`${game.path}-separate-content`, 'paused', { gameId: game.id, kind });
    await expect(assertGameRemovalAvailable(game, [task], inactive)).rejects.toThrow("this game's installation");
  });

  it.each(['complete', 'failed', 'cancelled'] as const)('protects a %s row until its process and metadata cleanup release it', async status => {
    const game = await fixture(), task = download(game.path, status);
    await expect(assertGameRemovalAvailable(game, [task], () => true)).rejects.toThrow('using this folder');
    await expect(assertGameRemovalAvailable(game, [task], inactive)).resolves.toBeUndefined();
  });

  it('protects aliases and newly created subdirectories through symbolic links', async () => {
    const game = await fixture(), alias = `${game.path}-alias`;
    await fs.symlink(game.path, alias);
    for (const destination of [alias, path.join(alias, 'future', 'content')]) {
      await expect(assertGameRemovalAvailable(game, [download(destination)], inactive)).rejects.toThrow('using this folder');
    }
    await expect(assertGameRemovalAvailable({ ...game, path: alias }, [download(game.path)], inactive)).rejects.toThrow('using this folder');
  });

  it('protects a dangling relative link into a game subfolder that the download will create', async () => {
    const game = await fixture(), alias = `${game.path}-future`;
    await fs.symlink(path.join(path.basename(game.path), 'not-created'), alias);
    await expect(assertGameRemovalAvailable(game, [download(path.join(alias, 'content'))], inactive)).rejects.toThrow('using this folder');
  });

  it('protects a running game by ID and overlapping canonical path, not an unrelated sibling', async () => {
    const game = await fixture();
    await expect(assertGameRemovalAvailable(game, [], inactive, game)).rejects.toThrow('Close this game');
    const alias = `${game.path}-alias`; await fs.symlink(game.path, alias);
    for (const location of [alias, path.dirname(game.path), path.join(game.path, 'bin')]) {
      await expect(assertGameRemovalAvailable(game, [], inactive, { ...game, id: 'other', path: location }))
        .rejects.toThrow('using this installation folder');
    }
    await expect(assertGameRemovalAvailable(game, [], inactive, { ...game, id: 'other', path: `${game.path}-other` })).resolves.toBeUndefined();
  });

  it('allows forgetting a missing installation but does not authorize deleting it', async () => {
    const game = await fixture(), missing = { ...game, path: `${game.path}-missing` };
    await expect(assertGameRemovalAvailable(missing, [], inactive)).resolves.toBeUndefined();
    await expect(validateGameDeleteTarget(missing, [], [])).rejects.toThrow();
  });

  it('retains deletion safeguards for symlinks and filesystem roots', async () => {
    const game = await fixture(), alias = `${game.path}-alias`; await fs.symlink(game.path, alias);
    await expect(validateGameDeleteTarget({ ...game, path: alias }, [], [])).rejects.toThrow('real directory');
    await expect(validateGameDeleteTarget({ ...game, path: path.parse(game.path).root }, [], [])).rejects.toThrow('filesystem root');
  });
});
