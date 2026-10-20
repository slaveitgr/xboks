import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { installedVcRuntimeVersion, VC_REDIST_VERSION, versionAtLeast } from './vc-runtime.js';

const created: string[] = [];

afterEach(async () => {
  await Promise.all(created.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('VC++ runtime detection', () => {
  it('reads the installed x64 version from Wine system.reg with its section timestamp', async () => {
    const prefix = await mkdtemp(path.join(tmpdir(), 'xodus-nexus-vc-'));
    created.push(prefix);
    await writeFile(path.join(prefix, 'system.reg'), [
      'WINE REGISTRY Version 2',
      '[Software\\\\Microsoft\\\\VisualStudio\\\\14.0\\\\VC\\\\Runtimes\\\\x64] 1786134203',
      '"Installed"=dword:00000001',
      '"Version"="14.42.34433.0"',
      '',
      '[Software\\\\Other] 1',
    ].join('\n'));
    expect(await installedVcRuntimeVersion(prefix)).toBe('14.42.34433.0');
    expect(versionAtLeast('14.42.34433.0', VC_REDIST_VERSION)).toBe(false);
    expect(versionAtLeast('14.44.35211.0', VC_REDIST_VERSION)).toBe(true);
  });

  it('does not accept an uninstalled or missing registry entry', async () => {
    const prefix = await mkdtemp(path.join(tmpdir(), 'xodus-nexus-vc-'));
    created.push(prefix);
    expect(await installedVcRuntimeVersion(prefix)).toBeUndefined();
    await mkdir(path.join(prefix, 'drive_c'));
    await writeFile(path.join(prefix, 'system.reg'), [
      '[Software\\\\Microsoft\\\\VisualStudio\\\\14.0\\\\VC\\\\Runtimes\\\\x64] 123',
      '"Installed"=dword:00000000',
      '"Version"="14.44.35211.0"',
    ].join('\n'));
    expect(await installedVcRuntimeVersion(prefix)).toBeUndefined();
  });

  it('accepts the v-prefixed version written by the Microsoft installer', async () => {
    const prefix = await mkdtemp(path.join(tmpdir(), 'xodus-nexus-vc-'));
    created.push(prefix);
    await writeFile(path.join(prefix, 'system.reg'), [
      '[Software\\\\Microsoft\\\\VisualStudio\\\\14.0\\\\VC\\\\Runtimes\\\\x64] 1791621974',
      '"Bld"=dword:0000898b',
      '"Installed"=dword:00000001',
      '"Version"="v14.44.35211.00"',
    ].join('\n'));
    const installed = await installedVcRuntimeVersion(prefix);
    expect(installed).toBe('14.44.35211.00');
    expect(versionAtLeast(installed!, VC_REDIST_VERSION)).toBe(true);
  });
});
