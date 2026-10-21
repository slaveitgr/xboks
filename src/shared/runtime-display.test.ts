import { describe, expect, it } from 'vitest';
import { demoSnapshot } from './demo-data';
import { nexusRuntimeUpdateAvailable, runtimeDisplay } from './runtime-display';

describe('runtimeDisplay', () => {
  it('uses the same available archive comparison for the top notice and Settings', () => {
    const runtime = { ...demoSnapshot().runtime, nexusAvailable: true,
      nexusName: 'xodus-nexus-runtime-new-x86_64.tar.xz', name: 'xodus-nexus-runtime-old' };
    expect(nexusRuntimeUpdateAvailable(runtime)).toBe(true);
    expect(nexusRuntimeUpdateAvailable({ ...runtime, name: 'xodus-nexus-runtime-new' })).toBe(false);
    expect(nexusRuntimeUpdateAvailable({ ...runtime, nexusAvailable: false })).toBe(false);
    expect(nexusRuntimeUpdateAvailable({ ...runtime, nexusName: undefined })).toBe(false);
  });
  it('uses the installed Nexus version, not an available update', () => {
    const runtime = demoSnapshot().runtime;
    runtime.name = 'xodus-nexus-runtime-11.0-20261011-g3fd4ae10';
    runtime.nexusVersion = 'runtime-11.0-newer';
    expect(runtimeDisplay(runtime)).toEqual({ title: 'xboks Engine runtime', source: 'xboks Engine runtime', version: '11.0-20261011-g3fd4ae10' });
  });
  it('recognizes the owned runtime distribution name as managed', () => {
    expect(runtimeDisplay({ ...demoSnapshot().runtime, name: 'xboks-engine-runtime-11.0-20261021' })).toEqual({ title: 'xboks Engine runtime', source: 'xboks Engine runtime', version: '11.0-20261021' });
  });
  it.each(['proton-xodus-af521bf3-eac-bridge-v1', 'proton-xodus-af521bf3-xgamesave-pr28-0123456789-bridge-v1'])('identifies a legacy patched runtime: %s', name => {
    expect(runtimeDisplay({ ...demoSnapshot().runtime, name }).source).toBe('xboks Engine runtime');
  });
  it('does not rename an unmodified upstream runtime to Nexus', () => {
    expect(runtimeDisplay({ ...demoSnapshot().runtime, name: 'xodus-proton-af521bf3' }).source).toBe('Proton snapshot');
  });
  it('does not claim an unknown custom runtime is official', () => {
    expect(runtimeDisplay({ ...demoSnapshot().runtime, name: 'my-wine-build' }).source).toBe('Custom runtime');
  });
  it('keeps managed artifact identifiers out of runtime presentation', () => {
    for (const name of ['xodus-nexus-runtime-11.0', 'proton-xodus-af521bf3-eac-bridge-v1', 'xodus-proton-af521bf3']) {
      expect(JSON.stringify(runtimeDisplay({ ...demoSnapshot().runtime, name }))).not.toMatch(/xodus|nexus/i);
    }
  });
  it('does not show the update version as installed when no runtime is installed', () => {
    expect(runtimeDisplay({ ...demoSnapshot().runtime, installed: false }).version).toBe('Not installed');
  });
});
