import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

async function digest(file, algorithm) {
  const hash = createHash(algorithm);
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest('hex');
}
function safeName(name) {
  return typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9 ._-]*$/.test(name) && path.basename(name) === name;
}
function validateContext(kind, context) {
  if (!['launcher', 'runtime', 'backend'].includes(kind) || !/^[a-f0-9]{40}$/.test(context.commit ?? '') ||
      !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(context.repository ?? '') || !/^\d+$/.test(String(context.runId)))
    throw Error('Invalid candidate identity');
}
export async function writeManifest(kind, directory, context) {
  validateContext(kind, context);
  const entries = await fs.readdir(directory);
  const binaries = entries.filter(name => kind === 'launcher' ? name.endsWith('.AppImage') :
    new RegExp(`^xodus-nexus-${kind}-[A-Za-z0-9._-]+-x86_64\\.tar\\.xz$`).test(name));
  const sources = entries.filter(name => new RegExp(`^xodus-nexus-${kind}-[A-Za-z0-9._-]+-source\\.tar\\.xz$`).test(name));
  const sourceName = name => kind === 'backend' ? name.replace('.tar.xz', '-source.tar.xz') : name.replace('-x86_64.tar.xz', '-source.tar.xz');
  if (kind === 'backend') {
    const exactSources = entries.filter(name => /^xodus-nexus-backend-[A-Za-z0-9._-]+-x86_64-source\.tar\.xz$/.test(name));
    sources.splice(0, sources.length, ...exactSources);
  }
  if (binaries.length !== 1 || (kind !== 'launcher' && (sources.length !== 1 ||
      sources[0] !== sourceName(binaries[0])))) throw Error('Expected one complete candidate');
  const files = [];
  for (const name of [...binaries, ...(kind !== 'launcher' ? sources : [])]) {
    if (!safeName(name) || !(await fs.lstat(path.join(directory, name))).isFile()) throw Error('Unsafe candidate file');
    const sha512 = await digest(path.join(directory, name), 'sha512');
    const checksumName = name.endsWith('.tar.xz') ? name.replace(/\.tar\.xz$/, '.sha512sum') : `${name}.sha512sum`;
    const checksum = `${sha512}  ${name}\n`;
    try {
      const existing = await fs.readFile(path.join(directory, checksumName), 'utf8');
      if (existing.trim() !== checksum.trim()) throw Error('Existing checksum differs');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await fs.writeFile(path.join(directory, checksumName), checksum, { flag: 'wx' });
    }
    for (const item of [name, checksumName]) files.push({ name: item, sha256: await digest(path.join(directory, item), 'sha256') });
  }
  if (kind === 'backend') {
    const metadata = binaries[0].replace('.tar.xz', '.manifest.json');
    if (!(await fs.lstat(path.join(directory, metadata))).isFile()) throw Error('Unsafe backend metadata');
    files.push({ name: metadata, sha256: await digest(path.join(directory, metadata), 'sha256') });
  }
  const manifest = { schema: 1, kind, ...context, files };
  await fs.writeFile(path.join(directory, 'candidate.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  return manifest;
}
export async function verifyManifest(directory, expected = {}) {
  const manifest = JSON.parse(await fs.readFile(path.join(directory, 'candidate.json'), 'utf8'));
  validateContext(manifest.kind, manifest);
  if (manifest.schema !== 1 || !Array.isArray(manifest.files) || manifest.files.length !== ({ launcher: 2, runtime: 4, backend: 5 }[manifest.kind])) throw Error('Invalid candidate manifest');
  for (const [key, value] of Object.entries(expected)) if (manifest[key] !== value) throw Error(`Candidate ${key} mismatch`);
  const names = new Set();
  for (const file of manifest.files) {
    if (!safeName(file.name) || names.has(file.name) || !/^[a-f0-9]{64}$/.test(file.sha256 ?? '') ||
        !(await fs.lstat(path.join(directory, file.name))).isFile()) throw Error('Unsafe candidate file');
    names.add(file.name);
    if (await digest(path.join(directory, file.name), 'sha256') !== file.sha256) throw Error(`Candidate checksum mismatch: ${file.name}`);
  }
  const binaries = [...names].filter(name => manifest.kind === 'launcher' ? name.endsWith('.AppImage') : new RegExp(`^xodus-nexus-${manifest.kind}-[A-Za-z0-9._-]+-x86_64\\.tar\\.xz$`).test(name));
  if (binaries.length !== 1) throw Error('Candidate binary missing');
  const expectedFiles = [binaries[0], manifest.kind === 'launcher' ? `${binaries[0]}.sha512sum` : binaries[0].replace(/\.tar\.xz$/, '.sha512sum')];
  if (manifest.kind !== 'launcher') {
    const source = manifest.kind === 'backend' ? binaries[0].replace('.tar.xz', '-source.tar.xz') : binaries[0].replace('-x86_64.tar.xz', '-source.tar.xz');
    expectedFiles.push(source, source.replace(/\.tar\.xz$/, '.sha512sum'));
  }
  if (expectedFiles.some(name => !names.has(name))) throw Error('Candidate assets are incomplete');
  for (let i = 0; i < expectedFiles.length; i += 2) {
    const data = await fs.readFile(path.join(directory, expectedFiles[i + 1]), 'utf8');
    if (data.trim() !== `${await digest(path.join(directory, expectedFiles[i]), 'sha512')}  ${expectedFiles[i]}`) throw Error('Candidate SHA-512 mismatch');
  }
  if (manifest.kind === 'backend' && !names.has(binaries[0].replace('.tar.xz', '.manifest.json'))) throw Error('Backend metadata missing');
  return manifest;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, kind, directory] = process.argv.slice(2);
  if (mode !== 'write' || !directory) throw Error('Usage: artifact-manifest.mjs write launcher|runtime|backend DIRECTORY');
  await writeManifest(kind, directory, { commit: process.env.GITHUB_SHA, repository: process.env.GITHUB_REPOSITORY,
    ref: process.env.GITHUB_REF, runId: process.env.GITHUB_RUN_ID });
}
