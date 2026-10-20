#!/usr/bin/env node
// Keep XUser/Wine patches intact. Install only bounded Mono discovery and
// restore the Mono distribution already shipped with the original Proton.
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const [dllArg, rootArg, monoArg] = process.argv.slice(2);
if (process.argv.length !== 5) throw new Error('Usage: install-mono-path-fix.mjs MSCOREE_DLL RUNTIME_ROOT MONO_DIRECTORY');
const root = await fs.realpath(rootArg);
const source = await fs.realpath(dllArg);
const mono = await fs.realpath(monoArg);
const oldHash = '75b0a23e882c1b31ecbc15449e46d70d5e536e4cce3290b0227ad13a6a6de927';
const newHash = '95b84b28930891ca7127b1aab2e6d23b0cf4321a4f284d9a1a043b1a8470be4c';
const xuserHash = 'd794d2fb17b40d091cd2d89ea30dd9f732a4f4d92076d135b5d62d909cd288d4';
const sha = async (file) => createHash('sha256').update(await fs.readFile(file)).digest('hex');
const pointerFile = path.join(root, 'current.json');
const lockFile = path.join(root, '.xuser-contract-update.lock');
const lock = await fs.open(lockFile, 'wx', 0o600);
function idle() {
  for (const name of ['xodus-cli', 'xodus-service', 'wine', 'wine64', 'wineserver', 'wineserver64']) {
    try { execFileSync('pgrep', ['-x', name], { stdio: 'ignore' }); throw new Error(`${name} active; activation refused.`); }
    catch (error) { if (error.status !== 1) throw error; }
  }
}
async function replace(directory, relative, file) {
  const target = path.join(directory, relative);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.mono-${process.pid}`;
  // Atomic replacement avoids writing through old-prefix symlinks.
  await fs.copyFile(file, temporary, constants.COPYFILE_EXCL);
  await fs.chmod(temporary, 0o644);
  await fs.rename(temporary, target);
}
try {
  idle();
  const original = await fs.readFile(pointerFile);
  const current = JSON.parse(original);
  if (!/^proton-xodus-[A-Za-z0-9._-]+$/.test(current.name)) throw new Error('Invalid release name.');
  const previous = path.join(root, 'releases', current.name);
  if (current.winePath !== path.join(previous, 'files/bin/wine')) throw new Error('Not a managed release.');
  const relative = 'files/lib/wine/x86_64-windows/mscoree.dll';
  if (await sha(source) !== newHash || await sha(path.join(previous, relative)) !== oldHash) throw new Error('Unexpected mscoree SHA-256; unchanged.');
  if (await sha(path.join(previous, 'files/lib/wine/x86_64-windows/xgameruntime.dll')) !== xuserHash) throw new Error('XUser baseline differs.');
  const metadata = JSON.parse(await fs.readFile(path.join(previous, 'XODUS_NEXUS_PATCH.json'), 'utf8'));
  if (!metadata.features?.includes('xuser-contract-v1')) throw new Error('Missing XUser contract.');
  const monoEntry = path.join(mono, 'wine-mono');
  const monoReal = await fs.realpath(monoEntry);
  const monoRelative = path.relative(mono, monoReal);
  if (!monoRelative || monoRelative.startsWith('..') || path.isAbsolute(monoRelative)) throw new Error('Mono symlink escapes its distribution.');
  const monoDll = path.join(monoReal, 'bin/libmono-2.0-x86_64.dll');
  const monoSha = await sha(monoDll);
  // Bound directory names instead of appending every historical patch name.
  const name = `proton-xodus-${current.commit.slice(0, 8)}-xuser-mono-${newHash.slice(0, 8)}`;
  const target = path.join(root, 'releases', name);
  const monoWindowsPath = `\\??\\Z:${path.join(target, 'files/share/wine/mono/wine-mono/bin/libmono-2.0-x86_64.dll').replaceAll('/', '\\')}`;
  if (monoWindowsPath.length >= 260) throw new Error('Runtime root too long for Wine Mono MAX_PATH. Use a shorter runtime root.');
  try { await fs.lstat(target); throw new Error('Target exists; no overwrite.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const staging = await fs.mkdtemp(path.join(root, 'releases/.staging-mono-'));
  await fs.cp(previous, staging, { recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE });
  await replace(staging, relative, source);
  await replace(staging, 'files/share/default_pfx/drive_c/windows/system32/mscoree.dll', source);
  const monoTarget = path.join(staging, 'files/share/wine/mono');
  try { await fs.lstat(monoTarget); throw new Error('Baseline already includes Mono; inspect before replacing it.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await fs.cp(mono, monoTarget, { recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE });
  if (await sha(path.join(monoTarget, monoRelative, 'bin/libmono-2.0-x86_64.dll')) !== monoSha) throw new Error('Mono copy verification failed.');
  for (const entry of ['files/bin/wine', 'files/bin/wineserver', 'files/lib/wine/x86_64-unix/ntdll.so', 'files/lib/wine/x86_64-windows/xgameruntime.dll', 'proton']) {
    if (await sha(path.join(staging, entry)) !== await sha(path.join(previous, entry))) throw new Error(`Unexpected module change: ${entry}`);
  }
  if (await sha(path.join(staging, relative)) !== newHash || await sha(path.join(previous, relative)) !== oldHash) throw new Error('mscoree verification failed.');
  const installedAt = new Date().toISOString();
  await fs.writeFile(path.join(staging, 'XODUS_NEXUS_PATCH.json'), JSON.stringify({
    ...metadata, name, installedAt,
    features: [...new Set([...metadata.features, 'wine-mscoree-mono-path-bounds-v1', 'bundled-mono-v1'])],
    monoPathFix: { previousPointer: current, patch: 'assets/wine-mscoree-mono-path-bounds.patch', previousMscoreeSha256: oldHash, mscoreeSha256: newHash, monoVersion: path.basename(monoReal), monoDllSha256: monoSha, monoSource: mono },
  }, null, 2) + '\n');
  idle();
  if (!(await fs.readFile(pointerFile)).equals(original)) throw new Error('Pointer changed; activation refused.');
  await fs.rename(staging, target);
  const backup = `${pointerFile}.before-mono-fix-${Date.now()}`;
  await fs.copyFile(pointerFile, backup, constants.COPYFILE_EXCL);
  const temporary = `${pointerFile}.mono-${process.pid}`;
  await fs.writeFile(temporary, JSON.stringify({ ...current, name, winePath: path.join(target, 'files/bin/wine'), installedAt }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  idle();
  if (!(await fs.readFile(pointerFile)).equals(original)) throw new Error('Pointer changed; activation refused.');
  await fs.rename(temporary, pointerFile);
  console.log(JSON.stringify({ name, backup, mscoreeSha256: newHash, xuserSha256: xuserHash, monoDllSha256: monoSha }));
} finally {
  await lock.close();
  await fs.unlink(lockFile);
}
