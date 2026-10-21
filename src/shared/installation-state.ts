import type { DownloadTask, Game } from './types.js';
/** Completion of the transport is never sufficient evidence of launch readiness. */
export function installationReadiness(task: DownloadTask, games: Game[]): { ready: boolean; label: string } {
  if (task.status === 'failed') return { ready:false,label:'Installation failed' };
  if (task.status === 'cancelled') return { ready:false,label:'Installation cancelled' };
  if (task.status === 'paused') return { ready:false,label:'Installation paused' };
  if (task.status === 'queued') return { ready:false,label:'Waiting to install' };
  if (task.status !== 'complete') return { ready:false,label:'Installation in progress' };
  if (task.kind === 'content') return { ready:false,label:'Content download complete' };
  const game = games.find(game => task.gameId ? game.id === task.gameId : game.storeId === task.productId && game.path === task.destination);
  return game?.installState === 'ready' ? { ready:true,label:'Ready to play' }
    : { ready:false,label:game ? 'Installation needs verification' : 'Download complete · installation not verified' };
}
