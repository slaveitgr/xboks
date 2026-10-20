import { spawnTracked, type RunOptions } from './process.js';
import { execFile } from 'node:child_process';
import { externalLauncherEnvironment } from './launcher-environment.js';

export interface GameLifecycle {
  /** Generated Proton runner control; its environment targets one game prefix. */
  stopPrefix?: { command: string; args: string[] };
}

export interface GameProcess {
  child: ReturnType<typeof spawnTracked>['child'];
  result: ReturnType<typeof spawnTracked>['result'];
  stop(): Promise<void>;
  forceStop(): Promise<void>;
  cleanup(): Promise<void>;
}

export async function spawnGameProcess(
  command: string,
  args: string[],
  options: RunOptions,
  lifecycle: GameLifecycle = {},
): Promise<GameProcess> {
  const grouped = process.platform === 'linux';
  const tracked = spawnTracked(command, args, {
    ...options, detached: grouped,
    // The managed runner waits for this prefix's Wine processes. Only then is
    // it safe to stop waiting for pipes inherited by non-Wine helpers. Legacy
    // direct-Wine launches retain their previous output/lifetime behavior.
    outputDrainMs: lifecycle.stopPrefix ? 1_000 : options.outputDrainMs,
  });
  let prefixStop: Promise<void> | undefined;
  const signal = (kind: NodeJS.Signals) => {
    if (grouped && tracked.child.pid) {
      try { process.kill(-tracked.child.pid, kind); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
    } else if (tracked.child.exitCode === null && tracked.child.signalCode === null) tracked.child.kill(kind);
  };
  const drainGroup = async () => {
    signal('SIGTERM');
    if (!grouped || !tracked.child.pid) return;
    const until = Date.now() + 1_000;
    while (Date.now() < until) {
      try { process.kill(-tracked.child.pid, 0); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return; throw error; }
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
    }
    signal('SIGKILL');
  };
  const stopPrefix = () => prefixStop ??= new Promise<void>((resolve, reject) => {
    if (!lifecycle.stopPrefix) { resolve(); return; }
    execFile(lifecycle.stopPrefix.command, lifecycle.stopPrefix.args, {
      env: externalLauncherEnvironment(options.env), timeout: 5_000, maxBuffer: 16_384,
    }, (error) => error ? reject(new Error(`Could not stop the game's Wine prefix: ${error.message}`)) : resolve());
  });
  return {
    ...tracked,
    stop: async () => { signal('SIGINT'); },
    forceStop: async () => {
      // Wine services detach from the launch process group. Stop only the
      // managed game prefix, never the user's default/global wineserver.
      try { await stopPrefix(); }
      finally { await drainGroup(); }
    },
    cleanup: drainGroup,
  };
}
