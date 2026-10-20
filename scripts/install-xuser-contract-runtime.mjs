#!/usr/bin/env node
// Opt-in, single shared runtime experiment. Never edit a previous release,
// game files, prefix saves, credentials, or the external backend.
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const [mode, ...args] = process.argv.slice(2);
if ((mode !== 'install' || args.length !== 3) && (mode !== 'rollback' || args.length !== 1)) {
  throw new Error('Usage: install-xuser-contract-runtime.mjs install DLL RUNTIME_ROOT EXPECTED_SHA256 | rollback RUNTIME_ROOT');
}
const root = await fs.realpath(mode === 'install' ? args[1] : args[0]);
const releases = path.join(root, 'releases');
const pointerFile = path.join(root, 'current.json');
const dllRelative = 'files/lib/wine/x86_64-windows/xgameruntime.dll';
const knownBaseHash = '9d0b69b2249daed807cd83a84c17154c95dd0b0ad3f574caac703854ffb96028';
const lockFile = path.join(root, '.xuser-contract-update.lock');
const lock = await fs.open(lockFile, 'wx', 0o600);
const sha = async (file) => createHash('sha256').update(await fs.readFile(file)).digest('hex');
function idle() {
  for (const name of ['xodus-cli', 'xodus-service', 'wine', 'wine64', 'wineserver', 'wineserver64']) {
    try { execFileSync('pgrep', ['-x', name], { stdio: 'ignore' }); throw new Error(`${name} is active; runtime unchanged.`); }
    catch (error) { if (error.status !== 1) throw error; }
  }
}
function releaseFor(pointer) {
  if (!/^proton-xodus-[A-Za-z0-9._-]+$/.test(pointer.name)) throw new Error('Unrecognized managed runtime name.');
  const release = path.join(releases, pointer.name);
  if (pointer.winePath !== path.join(release, 'files/bin/wine')) throw new Error('Runtime pointer does not match its managed release.');
  return release;
}
async function replaceDll(directory, relative, source) {
  const target = path.join(directory, relative);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.xuser-${process.pid}`;
  // Do not follow default-prefix DLL symlinks back into an old release.
  await fs.copyFile(source, temporary, constants.COPYFILE_EXCL);
  await fs.chmod(temporary, 0o644);
  await fs.rename(temporary, target);
}
try {
  idle();
  const original = await fs.readFile(pointerFile);
  const current = JSON.parse(original);
  const currentRelease = releaseFor(current);
  const metadata = JSON.parse(await fs.readFile(path.join(currentRelease, 'XODUS_NEXUS_PATCH.json'), 'utf8'));
  let next;
  if (mode === 'rollback') {
    if (!metadata.features?.includes('xuser-contract-v1') || !metadata.xuserContract?.previousPointer) throw new Error('No XUser rollback metadata in the active runtime.');
    next = metadata.xuserContract.previousPointer;
    const oldRelease = releaseFor(next);
    if (await sha(path.join(oldRelease, dllRelative)) !== metadata.xuserContract.previousDllSha256) throw new Error('Rollback DLL changed; pointer unchanged.');
    await fs.access(next.winePath, constants.X_OK);
  } else {
    const source = await fs.realpath(args[0]);
    const expected = args[2];
    if (!/^[0-9a-f]{64}$/.test(expected) || await sha(source) !== expected) throw new Error('Source DLL SHA-256 mismatch.');
    if (await sha(path.join(currentRelease, dllRelative)) !== knownBaseHash) throw new Error('This patch requires the preserved PR#28/TCP/locale baseline DLL.');
    for (const feature of ['cloud-saves-pr28', 'xodus-tcp-bridge-v1', 'package-locale', 'wine-memfd-filename-v1', 'wine-host-libraries-v1']) {
      if (!metadata.features?.includes(feature)) throw new Error(`Missing baseline feature ${feature}.`);
    }
    // Wine's Mono discovery still contains MAX_PATH-sized buffers. Keep
    // filesystem names bounded; full provenance lives in metadata instead.
    const name = `proton-xodus-${current.commit.slice(0, 8)}-xuser-${expected.slice(0, 12)}`;
    const target = path.join(releases, name);
    try { await fs.lstat(target); throw new Error('Target release already exists; no overwrite.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const staging = await fs.mkdtemp(path.join(releases, '.staging-xuser-contract-'));
    await fs.cp(currentRelease, staging, { recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE });
    await replaceDll(staging, dllRelative, source);
    await replaceDll(staging, 'files/share/default_pfx/drive_c/windows/system32/xgameruntime.dll', source);
    const installedAt = new Date().toISOString();
    const nextMetadata = {
      ...metadata,
      name: `${metadata.name}-xuser-contract-v1`,
      description: `${metadata.description} Experimental PR#28-compatible XUser state/guest/subscription contract. Account-change delivery and other unimplemented XUser APIs remain unsupported.`,
      features: [...new Set([...metadata.features, 'xuser-contract-v1'])],
      patchedDllSha256: expected,
      installedAt,
      xuserContract: { previousPointer: current, previousDllSha256: knownBaseHash, patch: 'assets/xgameruntime-xuser-contract.patch', changeEventDelivery: false },
    };
    await fs.writeFile(path.join(staging, 'XODUS_NEXUS_PATCH.json'), JSON.stringify(nextMetadata, null, 2) + '\n');
    if (await sha(path.join(staging, dllRelative)) !== expected || await sha(path.join(currentRelease, dllRelative)) !== knownBaseHash) throw new Error('DLL verification failed.');
    for (const relative of ['files/bin/wine', 'files/bin/wineserver', 'files/lib/wine/x86_64-unix/ntdll.so', 'proton']) {
      if (await sha(path.join(staging, relative)) !== await sha(path.join(currentRelease, relative))) throw new Error(`Unexpected change: ${relative}`);
    }
    idle();
    if (!(await fs.readFile(pointerFile)).equals(original)) throw new Error('Runtime pointer changed during preparation.');
    await fs.rename(staging, target);
    next = { ...current, name, winePath: path.join(target, 'files/bin/wine'), installedAt };
  }
  const stamp = Date.now();
  const backup = `${pointerFile}.before-xuser-${mode}-${stamp}`;
  const temporary = `${pointerFile}.xuser-${process.pid}`;
  await fs.copyFile(pointerFile, backup, constants.COPYFILE_EXCL);
  await fs.writeFile(temporary, JSON.stringify(next, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  idle();
  if (!(await fs.readFile(pointerFile)).equals(original)) throw new Error('Runtime pointer changed; activation refused.');
  await fs.rename(temporary, pointerFile);
  console.log(`Activated shared runtime: ${next.name}\nPrevious pointer: ${backup}\nGame files, saves, previous runtime and backend unchanged.`);
} finally {
  await lock.close();
  await fs.unlink(lockFile);
}
