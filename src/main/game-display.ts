interface PowerBlocker {
  start(type: 'prevent-display-sleep'): number;
  stop(id: number): boolean;
}

/** Hold only while a game runs. No fake input or persistent power-policy changes. */
export class GameDisplayBlocker {
  private readonly releases = new Set<() => void>();
  constructor(private readonly blocker: PowerBlocker, private readonly warn: (message: string) => void = console.warn) {}

  acquire(): () => void {
    let id: number;
    try { id = this.blocker.start('prevent-display-sleep'); }
    catch { this.warn('Could not inhibit display sleep for the running game.'); return () => {}; }
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      this.releases.delete(release);
      try { this.blocker.stop(id); }
      catch { this.warn('Could not release the game display-sleep inhibitor.'); }
    };
    this.releases.add(release);
    return release;
  }

  stop(): void { for (const release of [...this.releases]) release(); }
}
