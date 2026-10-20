import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { DownloadTask, Game } from '../shared/types.js';
import { canonicalInstallPath, installPathsOverlap } from './install-queue.js';

/** Includes queued/resumable writes and terminal rows whose process or metadata
 * cleanup still holds its queue slot. Canonical paths also protect aliases and
 * not-yet-created destinations through symlinked ancestors. */
export async function assertGameRemovalAvailable(game: Game, downloads: readonly DownloadTask[],
  isActive: (task: DownloadTask) => boolean, runningGame?: Game): Promise<void> {
  const pending = downloads.filter(task => ['queued', 'running', 'paused'].includes(task.status) || isActive(task));
  if (runningGame?.id === game.id) throw Error('Close this game before removing it.');
  if (pending.some(task => task.gameId === game.id)) throw Error('Finish or cancel this game\'s installation before removing it.');
  const target = await canonicalInstallPath(game.path);
  if (runningGame && installPathsOverlap(target, await canonicalInstallPath(runningGame.path))) {
    throw Error('Close the game using this installation folder before removing it.');
  }
  for (const task of pending) {
    if (installPathsOverlap(target, await canonicalInstallPath(task.destination))) {
      throw Error('Finish or cancel the installation using this folder before removing the game.');
    }
  }
}

function contains(parent: string, child: string): boolean {
  return child === parent || child.startsWith(`${parent}${path.sep}`);
}

export type GameDeleteTarget = Readonly<{ path: string; device: bigint; inode: bigint }>;

export async function validateGameDeleteTarget(game: Game, otherGames: Game[], protectedPaths: string[]): Promise<GameDeleteTarget> {
  const target = path.resolve(game.path);
  const root = path.parse(target).root;
  if (target === root) throw new Error('Refusing to remove a filesystem root.');
  const stat = await fs.lstat(target, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('The game location must be a real directory.');
  if (await fs.realpath(target) !== target) throw new Error('The game location contains a symbolic link.');
  const protectedLocations = await Promise.all(protectedPaths.map(canonicalInstallPath));
  if (protectedLocations.some((entry) => contains(target, entry))) {
    throw new Error('The game location contains a protected launcher or system directory.');
  }
  const otherLocations = await Promise.all(otherGames.map(entry => canonicalInstallPath(entry.path)));
  if (otherLocations.some((entry) => installPathsOverlap(target, entry))) {
    throw new Error('The game location overlaps another library game.');
  }
  const files = await fs.readdir(target);
  const manifest = files.find((name) => /^(MicrosoftGame\.config|AppxManifest\.xml)$/i.test(name));
  if (!manifest || !(await fs.lstat(path.join(target, manifest))).isFile()) {
    throw new Error('The game manifest is missing; remove this entry from the library instead.');
  }
  return { path: target, device: stat.dev, inode: stat.ino };
}
