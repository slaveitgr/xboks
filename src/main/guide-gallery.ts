import { promises as fs, constants, type Stats } from 'node:fs';
import path from 'node:path';
import type { GuideCapture, GuideGallery } from '../shared/guide-widgets.js';

const validName = (id: unknown): id is string => typeof id === 'string' && /^xboks-\d{13}-[a-f\d]{8}\.png$/.test(id);
/** Only captures created by this app, never the user's general photo library. */
export class GuideGalleryReader {
  constructor(private directory: string, private thumbnail: (bytes: Buffer) => Promise<string | undefined>) {}
  async checkDirectory(create = false): Promise<void> {
    if (create) await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const stat = await fs.lstat(this.directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.geteuid?.()) throw Error('The XBOKS capture folder must be an owned directory.');
  }
  private async item(id: string): Promise<{ file: string; stat: Stats }> {
    if (!validName(id)) throw Error('Invalid XBOKS capture.');
    await this.checkDirectory();
    const file = path.join(this.directory, id), stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== process.geteuid?.() || stat.size > 64 * 1024 * 1024) throw Error('The capture is not a regular owned XBOKS image.');
    return { file, stat };
  }
  private async image(file: string, expected: Stats): Promise<Buffer> {
    const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.ino !== expected.ino || before.dev !== expected.dev || before.uid !== process.geteuid?.()
          || before.nlink !== 1 || before.size !== expected.size || before.size > 64 * 1024 * 1024) throw Error('The capture changed.');
      const bytes = Buffer.alloc(before.size); let offset = 0;
      while (offset < bytes.length) {
        const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
        if (!bytesRead) throw Error('The capture changed.'); offset += bytesRead;
      }
      const after = await handle.stat();
      if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw Error('The capture changed.');
      return bytes;
    } finally { await handle.close(); }
  }
  async list(): Promise<GuideGallery> {
    try {
      await this.checkDirectory();
      const names = (await fs.readdir(this.directory)).filter(validName).sort().reverse();
      const items: GuideCapture[] = [];
      for (const id of names.slice(0, 100)) {
        try {
          const { file, stat } = await this.item(id);
          const thumbnailUrl = items.length < 24 ? await this.image(file, stat).then(bytes => this.thumbnail(bytes)).catch(() => undefined) : undefined;
          items.push({ id, name: id, createdAt: stat.mtime.toISOString(), sizeBytes: stat.size, thumbnailUrl });
        } catch { /* Ignore foreign/unsafe entries without opening them. */ }
      }
      return { status: 'available', items };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'available', items: [] };
      return { status: 'unavailable', items: [], reason: 'The XBOKS capture gallery could not be read.' };
    }
  }
  async file(id: string): Promise<string> { return (await this.item(id)).file; }
  async remove(id: string): Promise<void> {
    const { file, stat } = await this.item(id);
    const current = await fs.lstat(file);
    if (current.ino !== stat.ino || current.dev !== stat.dev || !current.isFile() || current.isSymbolicLink()) throw Error('The capture changed; refresh the gallery.');
    await fs.unlink(file);
  }
}
