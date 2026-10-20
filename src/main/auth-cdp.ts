import { StringDecoder } from 'node:string_decoder';
import type { Readable, Writable } from 'node:stream';

export interface CdpEvent { method: string; params: Record<string, any>; sessionId?: string }

/** Chrome's private fd3/fd4 protocol. No listening socket or protocol logging. */
export class AuthCdp {
  private next = 0;
  private pending = new Map<number, { resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  private decoder = new StringDecoder('utf8');
  private buffer = '';
  private stopped = false;
  constructor(private input: Writable, output: Readable, private event: (event: CdpEvent) => void, private failed: () => void, private timeout = 15_000) {
    output.on('data', (chunk: Buffer) => this.read(chunk));
    output.on('end', () => this.close());
    output.on('error', () => this.close());
    input.on('error', () => this.close());
  }
  call<T = any>(method: string, params: object = {}, sessionId?: string): Promise<T> {
    if (this.stopped || this.pending.size >= 128) return Promise.reject(Error('Browser sign-in connection is unavailable.'));
    return new Promise((resolve, reject) => {
      const id = ++this.next;
      const timer = setTimeout(() => { this.pending.delete(id); reject(Error('Browser sign-in did not respond.')); }, this.timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.input.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
    });
  }
  private read(chunk: Buffer): void {
    if (this.stopped) return;
    this.buffer += this.decoder.write(chunk);
    let end: number;
    while ((end = this.buffer.indexOf('\0')) >= 0) {
      const raw = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 1);
      if (Buffer.byteLength(raw) > 2 * 1024 * 1024) { this.close(); return; }
      let value: any;
      try { value = JSON.parse(raw); } catch { this.close(); return; }
      if (!value || typeof value !== 'object') { this.close(); return; }
      if (Number.isSafeInteger(value.id)) {
        const pending = this.pending.get(value.id); if (!pending) continue;
        this.pending.delete(value.id); clearTimeout(pending.timer);
        if (value.error) pending.reject(Error('Browser sign-in command failed.'));
        else pending.resolve(value.result);
      } else if (typeof value.method === 'string' && value.params && typeof value.params === 'object') this.event(value);
    }
    if (Buffer.byteLength(this.buffer) > 2 * 1024 * 1024) this.close();
  }
  close(): void {
    if (this.stopped) return; this.stopped = true; this.buffer = '';
    for (const { reject, timer } of this.pending.values()) { clearTimeout(timer); reject(Error('Browser sign-in connection closed.')); }
    this.pending.clear(); this.failed();
  }
}
