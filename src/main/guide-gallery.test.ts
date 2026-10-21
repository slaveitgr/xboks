import { mkdtemp, mkdir, writeFile, rm, symlink, link, stat, readFile, truncate } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { GuideGalleryReader } from './guide-gallery.js';
const directories: string[] = [], valid = 'xboks-1792526400000-aabbccdd.png';
afterEach(async () => { await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'xboks-gallery-')); directories.push(root);
  const captures = path.join(root, 'xboks'), thumbnail = vi.fn(async () => 'data:image/png;base64,synthetic');
  const gallery = new GuideGalleryReader(captures, thumbnail);
  return { root, captures, thumbnail, gallery };
}
it('opens no general pictures, treats a missing capture folder as empty, and accepts existing capture filenames', async () => {
  const f = await fixture(); expect(await f.gallery.list()).toEqual({ status: 'available', items: [] });
  await f.gallery.checkDirectory(true); await writeFile(path.join(f.captures, valid), 'synthetic image');
  await writeFile(path.join(f.captures, 'family.png'), 'private photo');
  const value = await f.gallery.list(); expect(value.items).toHaveLength(1); expect(value.items[0]).toMatchObject({ id: valid, sizeBytes: 15 });
  expect(f.thumbnail).toHaveBeenCalledOnce(); expect(await f.gallery.file(valid)).toBe(path.join(f.captures, valid));
});
it('refuses traversal, symlinks, hardlinks, oversized files and foreign directory entries before thumbnailing', async () => {
  const f = await fixture(); await f.gallery.checkDirectory(true); const outside = path.join(f.root, 'outside.png'); await writeFile(outside, 'retained');
  await symlink(outside, path.join(f.captures, valid));
  expect((await f.gallery.list()).items).toHaveLength(0); expect(f.thumbnail).not.toHaveBeenCalled();
  await expect(f.gallery.remove('../outside.png')).rejects.toThrow('Invalid');
  await expect(f.gallery.file(valid)).rejects.toThrow('regular owned');
  await rm(path.join(f.captures, valid)); await link(outside, path.join(f.captures, valid));
  expect((await f.gallery.list()).items).toHaveLength(0);
  await rm(path.join(f.captures, valid)); await writeFile(path.join(f.captures, valid), ''); await truncate(path.join(f.captures, valid), 64 * 1024 * 1024 + 1);
  expect((await f.gallery.list()).items).toHaveLength(0); expect(await readFile(outside, 'utf8')).toBe('retained');
});
it('rejects a capture folder redirected to another location', async () => {
  const f = await fixture(), elsewhere = path.join(f.root, 'elsewhere'); await mkdir(elsewhere); await symlink(elsewhere, f.captures);
  await writeFile(path.join(elsewhere, valid), 'retained');
  expect((await f.gallery.list()).status).toBe('unavailable'); await expect(f.gallery.remove(valid)).rejects.toThrow('owned directory');
  expect(await readFile(path.join(elsewhere, valid), 'utf8')).toBe('retained');
});
it('deletes only the explicitly selected owned capture and survives a broken thumbnail', async () => {
  const f = await fixture(); await f.gallery.checkDirectory(true); const file = path.join(f.captures, valid); await writeFile(file, 'synthetic image');
  f.thumbnail.mockRejectedValueOnce(Error('invalid PNG'));
  expect((await f.gallery.list()).items[0].thumbnailUrl).toBeUndefined();
  await f.gallery.remove(valid); await expect(stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
});
