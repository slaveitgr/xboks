/** Serialize launch preparation, coalesce duplicate shortcuts, never queue games. */
export class ShortcutLaunch {
  private starting?: string;
  constructor(private active: () => string | undefined, private launch: (id: string) => Promise<void>) {}
  async request(id: string): Promise<void> {
    if (this.starting === id || this.active() === id) return;
    if (this.starting || this.active()) throw new Error('Another game is already starting or running.');
    this.starting = id;
    try { await this.launch(id); } finally { this.starting = undefined; }
  }
  get preparing(): boolean { return Boolean(this.starting); }
}

/** The home-screen request is distinct from game shortcuts and background startup. */
export function fullscreenHomeRequested(argv: readonly string[]): boolean {
  const count = argv.filter(argument => argument === '--fullscreen-experience').length;
  if (count > 1 || argv.some(argument => argument.startsWith('--fullscreen-experience=')))
    throw Error('Invalid fullscreen home request.');
  if (count && argv.some(argument => ['--launch-game', '--game-bar', '--gamebar-service'].includes(argument)))
    throw Error('Fullscreen home cannot be combined with a game or background-service request.');
  return count === 1;
}

export function fullscreenHomeInstanceData(requested: boolean): Record<string, unknown> {
  return { xboksFullscreenHome: { schema: 1, requested } };
}

/** Electron may reorder argv; transfer the already parsed intent through JSON. */
export function fullscreenHomeInstanceRequested(data: unknown): boolean {
  if (!data || typeof data !== 'object' || Array.isArray(data) || !Object.hasOwn(data, 'xboksFullscreenHome')) return false;
  const message = (data as Record<string, unknown>).xboksFullscreenHome;
  if (!message || typeof message !== 'object' || Array.isArray(message)) throw Error('Invalid fullscreen home handoff.');
  const request = message as Record<string, unknown>;
  if (request.schema !== 1 || typeof request.requested !== 'boolean' || Object.keys(request).some(key => !['schema', 'requested'].includes(key)))
    throw Error('Invalid fullscreen home handoff.');
  return request.requested;
}

/** One explicit launch attempt, coalesced while the launcher and Shell become ready. */
export class FullscreenHomeLaunch {
  private pending?: Promise<void>;
  constructor(private options: {
    show(): Promise<void>; valid(): boolean; focused(): boolean; active(): boolean;
    integration(): Promise<boolean>; enter(): Promise<void>;
    now?: () => number; wait?: () => Promise<void>; timeoutMs?: number;
  }) {}
  request(): Promise<void> {
    return this.pending ??= this.start().finally(() => { this.pending = undefined; });
  }
  private async start(): Promise<void> {
    await this.options.show();
    const now = this.options.now ?? Date.now, deadline = now() + (this.options.timeoutMs ?? 10_000);
    const wait = this.options.wait ?? (() => new Promise<void>(resolve => setTimeout(resolve, 250)));
    do {
      if (!this.options.valid()) throw Error('Fullscreen home launch was cancelled.');
      if (this.options.focused()) {
        if (this.options.active()) return;
        const available = await this.options.integration().catch(() => false);
        if (now() > deadline || !this.options.valid() || !this.options.focused())
          throw Error('Fullscreen home launch was interrupted.');
        if (available) {
          await this.options.enter();
          if (!this.options.valid() || !this.options.active()) throw Error('Linux Gaming Mode was not acknowledged.');
          return;
        }
      }
      if (now() >= deadline) break;
      await wait();
    } while (now() <= deadline);
    throw Error('Linux Gaming Mode is unavailable. Enable its GNOME extension and try again.');
  }
}
