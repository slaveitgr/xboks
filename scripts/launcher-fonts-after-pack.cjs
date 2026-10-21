const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'linux') return;
  const root = context.appOutDir;
  // LinuxPackager resolves configured/sanitized names before running this hook.
  // Keep the wrapper aligned with that actual executable, including older builds.
  const executableName = context.packager.executableName;
  if (typeof executableName !== 'string' || !executableName || executableName === '.' || executableName === '..' || path.basename(executableName) !== executableName || /[\0\r\n]/.test(executableName)) {
    throw new Error('Invalid packaged Linux executable name.');
  }
  const executable = path.join(root, executableName);
  const bootstrap = path.join(root, 'resources', 'font-bootstrap');
  await fs.rename(executable, executable + '.bin');
  await fs.mkdir(bootstrap, { recursive: true });
  await fs.copyFile(path.join(__dirname, 'launcher-font-wrapper.sh'), executable);
  await fs.chmod(executable, 0o755);
  await fs.copyFile(path.join(__dirname, 'launcher-font-bootstrap.mjs'), path.join(bootstrap, 'bootstrap.mjs'));
  await fs.copyFile(path.join(__dirname, '..', 'dist-electron', 'main', 'launcher-fonts.js'), path.join(bootstrap, 'launcher-fonts.mjs'));
  // DEB postinst validates this exact Electron/helper pair before configuring
  // the root-owned SUID helper. AppImages never acquire elevated permissions.
  const nativeFiles = [executableName + '.bin', 'chrome-sandbox'];
  const checksums = [];
  await fs.chmod(root, 0o755);
  await fs.chmod(path.join(root, 'resources'), 0o755);
  for (const name of nativeFiles) {
    const file = path.join(root, name), stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Sandbox package inputs must be regular files.');
    await fs.chmod(file, 0o755);
    checksums.push(`${createHash('sha256').update(await fs.readFile(file)).digest('hex')}  ${name}\n`);
  }
  await fs.writeFile(path.join(root, 'resources', 'xboks-sandbox.sha256'), checksums.join(''), { mode: 0o644 });
  await fs.chmod(path.join(root, 'resources', 'xboks-sandbox.sha256'), 0o644);
};
