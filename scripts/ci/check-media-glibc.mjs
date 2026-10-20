import fs from 'node:fs/promises';
const file = process.argv[2];
if (!file) throw new Error('Usage: check-media-glibc.mjs MEDIA_MANIFEST');
const manifest = JSON.parse(await fs.readFile(file, 'utf8'));
const match = /^(\d+)\.(\d+)$/.exec(manifest.maxGlibc ?? '');
if (!match) throw new Error('Media manifest has no glibc version.');
const [major, minor] = [Number(match[1]), Number(match[2])];
if (major > 2 || (major === 2 && minor > 35))
  throw new Error(`Media libraries require GLIBC_${manifest.maxGlibc}; the portable CI ceiling is 2.35.`);
console.log(`Media libraries require at most GLIBC_${manifest.maxGlibc}.`);
