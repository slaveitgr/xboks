#!/usr/bin/env node
import { constants, promises as fs, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const limits = { binary: 300 * 1024 * 1024, license: 2 * 1024 * 1024, sourceArchive: 2 * 1024 * 1024 * 1024 };
async function checkedFile(file, limit, executable = false) {
  const absolute = path.resolve(file), stat = await fs.lstat(absolute);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > limit || executable && !(stat.mode & 0o111)) throw new Error('Input must be a regular bounded' + (executable ? ' executable' : '') + ' file: ' + absolute);
  if (executable) await fs.access(absolute, constants.X_OK);
  return { file: await fs.realpath(absolute), size: stat.size };
}
async function sha256(file, limit) {
  const hash = createHash('sha256'); let bytes = 0;
  for await (const chunk of createReadStream(file)) { bytes += chunk.length; if (bytes > limit) throw new Error('Input exceeded its size limit.'); hash.update(chunk); }
  return hash.digest('hex');
}

/** Only copies caller-supplied files. Does not execute the companion, extract its
 * source, install it or modify the user's selected backend/profile. */
export async function bundleSocialBackend({ binary, license, sourceArchive, output = 'assets/social-backend' }) {
  if (![binary, license, sourceArchive].every(value => typeof value === 'string' && value)) throw new Error('--binary, --license and --source-archive are required.');
  const destination = path.resolve(output);
  try { await fs.lstat(destination); throw new Error('Output already exists; choose a new --output directory.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const inputs = await Promise.all([checkedFile(binary, limits.binary, true), checkedFile(license, limits.license), checkedFile(sourceArchive, limits.sourceArchive)]);
  const names = ['xodus-cli', 'LICENSE', 'source.tar.xz'];
  const bounds = [limits.binary, limits.license, limits.sourceArchive];
  const digests = await Promise.all(inputs.map((input, index) => sha256(input.file, bounds[index])));
  const parent = path.dirname(destination); await fs.mkdir(parent, { recursive: true });
  const staging = await fs.mkdtemp(path.join(parent, '.social-backend-build-'));
  try {
    for (let index = 0; index < inputs.length; index++) {
      const target = path.join(staging, names[index]);
      await fs.copyFile(inputs[index].file, target, constants.COPYFILE_EXCL);
      await fs.chmod(target, index === 0 ? 0o755 : 0o644);
      if ((await fs.stat(target)).size !== inputs[index].size || await sha256(target, bounds[index]) !== digests[index]) throw new Error('Input changed while copying: ' + names[index]);
    }
    const manifest = { schema: 1, version: '0.3.0', sha256: digests[0], binary: 'xodus-cli',
      license: 'LICENSE', licenseSha256: digests[1], sourceArchive: 'source.tar.xz', sourceArchiveSha256: digests[2] };
    await fs.writeFile(path.join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o644 });
    await fs.writeFile(path.join(staging, 'README.txt'), 'Optional Xodus social companion 0.3.0.\nThe supplied license is LICENSE; the supplied corresponding-source archive is source.tar.xz.\nTheir exact SHA-256 hashes are recorded in manifest.json. The bundler copies these inputs; it does not certify their source completeness or licensing compliance.\nThis companion does not replace your installed backend or user profile.\n', { flag: 'wx', mode: 0o644 });
    await fs.chmod(staging, 0o755);
    // Recheck just before publication; existing generated or user files are never replaced.
    try { await fs.lstat(destination); throw new Error('Output already exists; choose a new --output directory.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await fs.rename(staging, destination);
    return { output: destination, ...manifest };
  } finally { await fs.rm(staging, { recursive: true, force: true }); }
}

function argumentsFrom(argv) {
  const options = {};
  const names = { '--binary': 'binary', '--license': 'license', '--source-archive': 'sourceArchive', '--output': 'output' };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index], name = names[flag];
    if (!name || Object.hasOwn(options, name) || !argv[index + 1] || argv[index + 1].startsWith('--')) throw new Error('Invalid or duplicate option: ' + flag);
    options[name] = argv[++index];
  }
  return options;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).includes('--help')) process.stdout.write('Usage: node scripts/bundle-social-backend.mjs --binary FILE --license FILE --source-archive FILE [--output assets/social-backend]\nOutput must not already exist. No executable or source archive is run/extracted.\n');
  else Promise.resolve().then(() => bundleSocialBackend(argumentsFrom(process.argv.slice(2)))).then(result => process.stdout.write(JSON.stringify(result, null, 2) + '\n')).catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
}
