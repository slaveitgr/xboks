import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Game } from '../shared/types.js';
import { validateGameDeleteTarget } from './game-removal.js';
import { deleteGameDirectory } from './game-delete.js';

let root: string, game: Game;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-delete-test-'));
  const directory = path.join(root, 'Game with spaces; literal');
  await fs.mkdir(directory); await fs.writeFile(path.join(directory, 'MicrosoftGame.config'), '<Game/>');
  await fs.writeFile(path.join(directory, 'data.bin'), 'fixture');
  game = { id: 'fixture', title: 'Fixture', path: directory, installState: 'ready', addedAt: '' };
});
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

it('permanently deletes only the validated game folder, preserving outside saves and linked targets', async () => {
  const saves = path.join(root, 'outside-saves'); await fs.mkdir(saves);
  await fs.writeFile(path.join(saves, 'save.txt'), 'keep');
  await fs.symlink(saves, path.join(game.path, 'linked-saves'));
  await fs.mkdir(path.join(game.path, 'nested')); await fs.writeFile(path.join(game.path, 'nested', 'save.txt'), 'inside');
  await deleteGameDirectory(await validateGameDeleteTarget(game, [], [os.homedir()]));
  await expect(fs.access(game.path)).rejects.toThrow();
  expect(await fs.readFile(path.join(saves, 'save.txt'), 'utf8')).toBe('keep');
});

it.each(['directory', 'symlink', 'file', 'missing'] as const)('rejects a %s replacement after confirmation/validation', async kind => {
  const target = await validateGameDeleteTarget(game, [], []), remove = vi.fn();
  const old = path.join(root, 'original'); await fs.rename(game.path, old);
  if (kind === 'directory') await fs.mkdir(game.path);
  if (kind === 'symlink') await fs.symlink(old, game.path);
  if (kind === 'file') await fs.writeFile(game.path, 'replacement');
  await expect(deleteGameDirectory(target, remove)).rejects.toThrow();
  expect(remove).not.toHaveBeenCalled();
  expect(await fs.readFile(path.join(old, 'data.bin'), 'utf8')).toBe('fixture');
});

it('rejects an ancestor replaced by a symbolic link even if the folder identity remains the same', async () => {
  const target = await validateGameDeleteTarget(game, [], []), remove = vi.fn();
  const parent = path.join(root, 'parent'); await fs.mkdir(parent);
  const moved = path.join(parent, path.basename(game.path)); await fs.rename(game.path, moved);
  const altered = { ...target, path: moved };
  const renamed = path.join(root, 'renamed'); await fs.rename(parent, renamed); await fs.symlink(renamed, parent);
  await expect(deleteGameDirectory(altered, remove)).rejects.toThrow('folder changed');
  expect(remove).not.toHaveBeenCalled();
  expect(await fs.readFile(path.join(renamed, path.basename(game.path), 'data.bin'), 'utf8')).toBe('fixture');
});

it('reports partial failure honestly without retrying or pretending the files were kept', async () => {
  const target = await validateGameDeleteTarget(game, [], []);
  const remove = vi.fn(async (directory: string) => { await fs.unlink(path.join(directory, 'data.bin')); throw Error('Permission denied'); });
  await expect(deleteGameDirectory(target, remove)).rejects.toThrow('some files may already have been deleted');
  expect(remove).toHaveBeenCalledOnce();
  expect(await fs.readFile(path.join(game.path, 'MicrosoftGame.config'), 'utf8')).toBe('<Game/>');
});

it('rejects overlapping parent games and aliases, not just literal nested paths', async () => {
  const parent = { ...game, id: 'parent', path: root };
  await expect(validateGameDeleteTarget(game, [parent], [])).rejects.toThrow('another library game');
  const alias = path.join(root, 'alias'); await fs.symlink(game.path, alias);
  await expect(validateGameDeleteTarget(game, [{ ...game, id: 'alias', path: alias }], [])).rejects.toThrow('another library game');
  await expect(validateGameDeleteTarget(game, [], [alias])).rejects.toThrow('protected');
});

it.each(['symlink', 'directory'] as const)('rejects a %s masquerading as the game manifest', async kind => {
  const manifest = path.join(game.path, 'MicrosoftGame.config'); await fs.unlink(manifest);
  if (kind === 'directory') await fs.mkdir(manifest);
  else { const outside = path.join(root, 'outside.xml'); await fs.writeFile(outside, '<Game/>'); await fs.symlink(outside, manifest); }
  await expect(validateGameDeleteTarget(game, [], [])).rejects.toThrow('manifest');
});
