#!/usr/bin/env node
// A single shared runtime, with previous releases preserved and no save writes.
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const [dllArg, rootArg] = process.argv.slice(2);
if (process.argv.length !== 4) throw new Error('Usage: install-async-lifetime-fix.mjs XGAMERUNTIME_DLL RUNTIME_ROOT');
const root = await fs.realpath(rootArg), source = await fs.realpath(dllArg);
const baseline = 'd794d2fb17b40d091cd2d89ea30dd9f732a4f4d92076d135b5d62d909cd288d4';
const expected = '7454ab5ee625313f304dd6cf9fe7046537ed4a03f34c1151bc0a76e0627ea89c';
const relative = 'files/lib/wine/x86_64-windows/xgameruntime.dll';
const pointerFile = path.join(root, 'current.json');
const lockFile = path.join(root, '.xuser-contract-update.lock');
const lock = await fs.open(lockFile, 'wx', 0o600);
const sha = async (file) => createHash('sha256').update(await fs.readFile(file)).digest('hex');
function idle() {
  for (const name of ['xodus-cli', 'xodus-service', 'wine', 'wine64', 'wineserver', 'wineserver64']) {
    try { execFileSync('pgrep', ['-x', name], { stdio: 'ignore' }); throw new Error(`${name} active; runtime unchanged.`); }
    catch (error) { if (error.status !== 1) throw error; }
  }
}
async function replace(directory, relative) {
  const target = path.join(directory, relative), temporary = `${target}.async-${process.pid}`;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(source, temporary, constants.COPYFILE_EXCL);
  await fs.chmod(temporary, 0o644);
  await fs.rename(temporary, target); // Never follow old default-prefix symlinks.
}
try {
  idle();
  const original = await fs.readFile(pointerFile), current = JSON.parse(original);
  if (!/^proton-xodus-[A-Za-z0-9._-]+$/.test(current.name)) throw new Error('Invalid managed release.');
  const previous = path.join(root, 'releases', current.name);
  if (current.winePath !== path.join(previous, 'files/bin/wine')) throw new Error('Invalid Wine pointer.');
  if (await sha(source) !== expected || await sha(path.join(previous, relative)) !== baseline) throw new Error('DLL SHA-256 differs; unchanged.');
  const metadata = JSON.parse(await fs.readFile(path.join(previous, 'XODUS_NEXUS_PATCH.json'), 'utf8'));
  for (const feature of ['xuser-contract-v1', 'cloud-saves-pr28', 'xodus-tcp-bridge-v1', 'wine-mscoree-mono-path-bounds-v1', 'bundled-mono-v1']) {
    if (!metadata.features?.includes(feature)) throw new Error(`Missing baseline ${feature}.`);
  }
  const name = `proton-xodus-${current.commit.slice(0, 8)}-xuser-async-${expected.slice(0, 8)}`;
  const target = path.join(root, 'releases', name);
  try { await fs.lstat(target); throw new Error('Target exists; no overwrite.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const staging = await fs.mkdtemp(path.join(root, 'releases/.staging-async-'));
  await fs.cp(previous, staging, { recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE });
  await replace(staging, relative);
  await replace(staging, 'files/share/default_pfx/drive_c/windows/system32/xgameruntime.dll');
  for (const file of ['files/bin/wine', 'files/bin/wineserver', 'files/lib/wine/x86_64-unix/ntdll.so', 'files/lib/wine/x86_64-windows/mscoree.dll', 'files/share/wine/mono/wine-mono/bin/libmono-2.0-x86_64.dll', 'proton']) {
    if (await sha(path.join(staging, file)) !== await sha(path.join(previous, file))) throw new Error(`Unexpected module change: ${file}`);
  }
  if (await sha(path.join(staging, relative)) !== expected || await sha(path.join(previous, relative)) !== baseline) throw new Error('DLL copy verification failed.');
  const installedAt = new Date().toISOString();
  await fs.writeFile(path.join(staging, 'XODUS_NEXUS_PATCH.json'), JSON.stringify({
    ...metadata, name, installedAt, patchedDllSha256: expected,
    features: [...new Set([...metadata.features, 'async-completion-lifetime-v1'])],
    asyncLifetime: { previousPointer: current, previousDllSha256: baseline, patch: 'assets/xgameruntime-async-completion-lifetime.patch', patchSha256: '9966b72a4df44b62c9fb660c500aa08012d7f372e1f9f909accf56a3a3524609' },
  }, null, 2) + '\n');
  idle();
  if (!(await fs.readFile(pointerFile)).equals(original)) throw new Error('Runtime pointer changed.');
  await fs.rename(staging, target);
  const backup = `${pointerFile}.before-async-lifetime-${Date.now()}`;
  await fs.copyFile(pointerFile, backup, constants.COPYFILE_EXCL);
  const temporary = `${pointerFile}.async-${process.pid}`;
  await fs.writeFile(temporary, JSON.stringify({ ...current, name, winePath: path.join(target, 'files/bin/wine'), installedAt }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  idle();
  if (!(await fs.readFile(pointerFile)).equals(original)) throw new Error('Runtime pointer changed.');
  await fs.rename(temporary, pointerFile);
  console.log(JSON.stringify({ name, backup, sha256: expected, previousSha256: baseline }));
} finally {
  await lock.close();
  await fs.unlink(lockFile);
}
