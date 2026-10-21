import type {CloudProduct} from '../shared/cloud-library';

type Client = {resolve: (value: CloudProduct[]) => void; reject: (error: Error) => void; cleanup: () => void};
type Job = {key: string; ids: string[]; clients: Set<Client>; running: boolean};
/** Shared per-page pool. Route changes cancel queued work; already-running
 * public metadata reads stay coalesced and never exceed the same three slots. */
export class CloudProductLoader {
  private jobs = new Map<string, Job>();
  private queue: Job[] = [];
  private active = 0;
  constructor(private read: (ids: string[]) => Promise<CloudProduct[]>, private parallel = 3) {}
  describe(ids: string[], signal: AbortSignal): Promise<CloudProduct[]> {
    if (signal.aborted) return Promise.reject(Error('Cloud metadata read cancelled.'));
    const key = ids.join(',');
    let job = this.jobs.get(key);
    if (!job) {job = {key, ids: [...ids], clients: new Set(), running: false}; this.jobs.set(key, job); this.queue.push(job);}
    const current = job;
    const result = new Promise<CloudProduct[]>((resolve, reject) => {
      const client: Client = {resolve, reject, cleanup: () => signal.removeEventListener('abort', cancel)};
      const cancel = () => {
        current.clients.delete(client); client.cleanup(); reject(Error('Cloud metadata read cancelled.'));
        if (!current.running && !current.clients.size) {this.queue = this.queue.filter(item => item !== current); if (this.jobs.get(key) === current) this.jobs.delete(key);}
      };
      current.clients.add(client); signal.addEventListener('abort', cancel, {once: true});
    });
    this.pump(); return result;
  }
  private pump() {
    while (this.active < this.parallel && this.queue.length) {
      const job = this.queue.shift()!;
      if (!job.clients.size) continue;
      job.running = true; this.active++;
      void Promise.resolve().then(() => this.read(job.ids)).then(value => {
        if (this.jobs.get(job.key) === job) this.jobs.delete(job.key);
        for (const client of job.clients) {client.cleanup(); client.resolve(value);}
      }, () => {if (this.jobs.get(job.key) === job) this.jobs.delete(job.key); for (const client of job.clients) {client.cleanup(); client.reject(Error('Cloud metadata is unavailable.'));}}).finally(() => {
        job.clients.clear(); if (this.jobs.get(job.key) === job) this.jobs.delete(job.key); this.active--; this.pump();
      });
    }
  }
}

const pools = new WeakMap<object, CloudProductLoader>();
/** Returning to Cloud while an uncancellable IPC read finishes must reuse the
 * same bounded pool rather than briefly opening a second set of three slots. */
export function sharedCloudProductLoader(owner: object, read: (ids: string[]) => Promise<CloudProduct[]>) {
  let pool = pools.get(owner);
  if (!pool) {pool = new CloudProductLoader(read); pools.set(owner, pool);}
  return pool;
}
