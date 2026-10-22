// Offline package inspection. Does not extract, install, register or run apps.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath, pathToFileURL} from 'node:url';
import path from 'node:path';

const execute = promisify(execFile);
const architectures = new Set(['x64', 'x86', 'arm64']);
const helper = fileURLToPath(new URL('./archive_inspect.py', import.meta.url));
async function readArchive(file, architecture) {
  const {stdout} = await execute('python3', [helper, file, '--arch', architecture], {
    timeout: 30_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true,
  });
  return JSON.parse(stdout);
}
async function readManifest(xml) {
  let reader;
  try { reader = await import('../../dist-electron/main/appx-manifest.js'); }
  catch { throw Error('Build the launcher first with npm run build to generate the manifest reader.'); }
  return reader.parseAppxManifest(xml);
}
function archiveSummary(value) {
  if (!value || !['package', 'bundle'].includes(value.kind) || !Number.isSafeInteger(value.entryCount) ||
      value.entryCount < 1 || value.entryCount > 20_000 || !Number.isSafeInteger(value.declaredUncompressedBytes) ||
      value.declaredUncompressedBytes < 0 || value.declaredUncompressedBytes > 16 * 1024 ** 3 ||
      typeof value.signaturePresent !== 'boolean' || typeof value.blockMapPresent !== 'boolean' ||
      value.signatureValidated !== false || value.blockMapValidated !== false) throw Error('Invalid archive inspection response.');
  return value;
}
export async function inspectMsix(file, architecture = 'x64', {scan = readArchive, parseManifest = readManifest} = {}) {
  if (typeof file !== 'string' || !file || file.includes('\0') || !architectures.has(architecture))
    throw Error('Choose a local package and x64, x86 or arm64 architecture.');
  // Preserve the original path components for the helper's no-symlink walk.
  // Lexically resolving link/../file could silently inspect a different file.
  const absoluteFile = path.isAbsolute(file) ? file : `${process.cwd()}${path.sep}${file}`;
  const input = await scan(absoluteFile, architecture);
  if (input?.schemaVersion !== 1 || input.inspectionOnly !== true || input.requestedArchitecture !== architecture ||
      !/^[a-f0-9]{64}$/.test(input.source?.sha256 ?? '') || !Number.isSafeInteger(input.source?.sizeBytes) ||
      input.source.sizeBytes < 1 || input.source.sizeBytes > 8 * 1024 ** 3 ||
      !input.selectedPackage?.manifest || typeof input.selectedPackage.manifest.xml !== 'string' ||
      !Array.isArray(input.limitations) || input.limitations.length > 32 ||
      input.limitations.some(value => typeof value !== 'string' || value.length > 1000)) throw Error('Invalid archive inspection response.');
  const archive = archiveSummary(input.archive), selectedArchive = archiveSummary(input.selectedPackage.archive);
  if (selectedArchive.kind !== 'package') throw Error('Expected an application package inside the bundle.');
  const manifest = await parseManifest(input.selectedPackage.manifest.xml);
  if (manifest.identity.architecture && ![architecture, 'neutral'].includes(manifest.identity.architecture))
    throw Error('The package architecture does not match the requested architecture.');
  let bundle = null;
  if (archive.kind === 'bundle') {
    const value = input.bundle;
    if (!value || !Array.isArray(value.packages) || value.packages.length > 20_000 || typeof value.selectedMember !== 'string') throw Error('Invalid bundle selection.');
    const members = value.packages.filter(item => item.fileName === value.selectedMember);
    if (members.length !== 1 || members[0].archivePath !== input.selectedPackage.memberPath ||
        members[0].type !== 'application' || ![architecture, 'neutral'].includes(members[0].architecture) ||
        manifest.identity.name !== value.identity?.name || manifest.identity.publisher !== value.identity?.publisher ||
        manifest.identity.architecture !== members[0].architecture ||
        members[0].version && manifest.identity.version !== members[0].version) throw Error('Bundle and application package identities do not match.');
    bundle = {identity: value.identity, selectedMember: value.selectedMember, packages: value.packages};
  } else if (input.bundle !== null || input.selectedPackage.memberPath !== null) throw Error('Invalid standalone package response.');
  return {
    schemaVersion: 1, inspectionOnly: true, gameCompatibilityProven: false,
    requestedArchitecture: architecture, source: input.source, archive, bundle,
    selectedPackage: {memberPath: input.selectedPackage.memberPath, sizeBytes: input.selectedPackage.sizeBytes, archive: selectedArchive, manifest},
    limitations: input.limitations,
  };
}
export async function main(args = process.argv.slice(2)) {
  let file, architecture = 'x64';
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--package' && file === undefined) file = args[++index];
    else if (args[index] === '--arch' && args[index + 1]) architecture = args[++index];
    else throw Error('Usage: npm run inspect:msix -- --package FILE [--arch x64|x86|arm64]');
  }
  return inspectMsix(file, architecture);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then(report => process.stdout.write(JSON.stringify(report, null, 2) + '\n')).catch(error => {
    // Helper errors contain a short local diagnostic, never account data.
    const message = error.stderr?.trim() || error.message;
    process.stderr.write(String(message).slice(0, 2000) + '\n'); process.exitCode = 1;
  });
}
