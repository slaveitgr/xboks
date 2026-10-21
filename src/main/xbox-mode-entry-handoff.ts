import { performance } from 'node:perf_hooks';

export interface XboxModeEntryRequest<Target> {
  /** The original Game Bar must still be focused before it is hidden. */
  authorized(): boolean;
  /** Capture the original source identity; include mode and shutdown guards. */
  valid(): boolean;
  hide(): void;
  show(): Promise<void>;
  /** Return the current main window, or undefined when it does not exist yet. */
  target(): Target | undefined;
  targetValid(target: Target): boolean;
  focused(target: Target): boolean;
  requested(target: Target): void;
}

/** A shared coordinator serializes Game Bar requests. Showing the launcher is
 * one activation request; compositor focus is observed before opening choices.
 * This class never enters Xbox mode or performs a power operation. */
export class XboxModeEntryHandoff {
  private busy = false;
  private readonly now: () => number;
  private readonly wait: () => Promise<void>;
  private readonly timeoutMs: number;
  constructor(options: { now?: () => number; wait?: () => Promise<void>; timeoutMs?: number } = {}) {
    this.now = options.now ?? (() => performance.now());
    this.wait = options.wait ?? (() => new Promise<void>(resolve => setTimeout(resolve, 50)));
    this.timeoutMs = options.timeoutMs ?? 2000;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs < 0 || this.timeoutMs > 2000)
      throw Error('Xbox mode entry focus wait must be between 0 and 2000 milliseconds.');
  }
  async request<Target>(request: XboxModeEntryRequest<Target>): Promise<void> {
    if (this.busy) throw Error('An Xbox mode entry request is already in progress.');
    if (!request.authorized()) throw Error('Open Xbox mode from the focused Game Bar.');
    this.busy = true;
    const assertSource = () => {
      if (!request.valid()) throw Error('Xbox mode entry is no longer available from this Game Bar.');
    };
    try {
      assertSource();
      const previousTarget = request.target();
      // A delayed hide must never act on a replaced or destroyed source.
      assertSource();
      request.hide();
      assertSource();
      await request.show();
      assertSource();
      const target = request.target();
      if (target === undefined || previousTarget !== undefined && target !== previousTarget)
        throw Error('The launcher window changed while opening Xbox mode.');
      const deadline = this.now() + this.timeoutMs;
      const assertTarget = () => {
        if (request.target() !== target || !request.targetValid(target))
          throw Error('The launcher window changed while opening Xbox mode.');
      };
      for (;;) {
        assertSource(); assertTarget();
        if (this.now() > deadline) throw Error('The desktop did not focus the launcher window.');
        if (request.focused(target)) {
          assertSource(); assertTarget();
          if (this.now() > deadline) throw Error('The desktop did not focus the launcher window.');
          request.requested(target);
          return;
        }
        if (this.now() >= deadline) throw Error('The desktop did not focus the launcher window.');
        await this.wait();
      }
    } finally { this.busy = false; }
  }
}
