import type { Session, WebContents } from 'electron';

type VoiceContents = Pick<WebContents, 'id' | 'getURL' | 'isDestroyed' | 'send'>;
type FrameDetails = { isMainFrame: boolean; requestingUrl?: string; embeddingOrigin?: string };

export function voiceDocumentAllowed(value: string, appUrl: string, devUrl?: string): boolean {
  try {
    const actual = new URL(value), local = new URL(appUrl);
    actual.hash = ''; local.hash = '';
    if (actual.protocol === 'file:' && actual.href === local.href) return true;
    if (!devUrl) return false;
    const dev = new URL(devUrl); dev.hash = '';
    return dev.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(dev.hostname)
      && !dev.username && !dev.password && actual.href === dev.href;
  } catch { return false; }
}

/** Explicit local-test permission, independent of account/party connectivity.
 * One visible trusted owner, one audio request, bounded lifetime. No camera,
 * screen, remote origin, subframe or background capture permission. */
export class VoiceCapturePermissions {
  private lease?: { owner: VoiceContents; until: number; accepted: boolean };
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private readonly trusted: (contents: VoiceContents) => boolean,
    private readonly documentAllowed: (url: string) => boolean,
    private readonly now: () => number = Date.now) {}

  request(owner: VoiceContents): void {
    if (!this.trusted(owner) || !this.documentAllowed(owner.getURL())) throw Error('Open the microphone test in the active launcher window.');
    if (this.lease && this.lease.until <= this.now()) this.release();
    if (this.lease) throw Error('Stop the microphone test in the other panel first.');
    this.lease = { owner, until: this.now() + 15_000, accepted: false };
    this.expireAfter(15_000);
  }

  release(ownerId?: number): void {
    if (ownerId !== undefined && this.lease?.owner.id !== ownerId) return;
    const previous = this.lease; this.lease = undefined;
    if (this.timer) clearTimeout(this.timer); this.timer = undefined;
    if (previous && !previous.owner.isDestroyed()) {
      try { previous.owner.send('voice-capture-stop'); } catch { /* Renderer may have exited during native window teardown. */ }
    }
  }

  private expireAfter(ms: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.release(), ms); this.timer.unref();
  }

  private valid(owner: VoiceContents | null, details: FrameDetails): boolean {
    if (this.lease && this.lease.until <= this.now()) this.release();
    return Boolean(owner && this.lease?.owner === owner && !owner.isDestroyed() && this.trusted(owner)
      && details.isMainFrame === true && !details.embeddingOrigin && typeof details.requestingUrl === 'string'
      && this.documentAllowed(details.requestingUrl) && this.documentAllowed(owner.getURL()));
  }

  check(owner: VoiceContents | null, permission: string, details: FrameDetails & { mediaType?: string }): boolean {
    if (!this.valid(owner, details)) return false;
    return permission === 'media' ? details.mediaType === 'audio' : permission === 'speaker-selection';
  }

  accept(owner: VoiceContents, permission: string, details: FrameDetails & { mediaTypes?: string[] }): boolean {
    if (!this.valid(owner, details)) return false;
    if (permission === 'speaker-selection') return true;
    if (permission !== 'media' || this.lease!.accepted || details.mediaTypes?.length !== 1 || details.mediaTypes[0] !== 'audio') return false;
    this.lease!.accepted = true; this.lease!.until = this.now() + 75_000;
    this.expireAfter(75_000);
    return true;
  }

  install(session: Session): void {
    session.setPermissionCheckHandler((contents, permission, _origin, details) => this.check(contents, permission, details));
    session.setPermissionRequestHandler((contents, permission, callback, details) => callback(this.accept(contents, permission, details)));
  }
}
