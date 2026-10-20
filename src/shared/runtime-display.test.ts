import { describe, expect, it } from 'vitest';
import { demoSnapshot } from './demo-data';
import { runtimeDisplay } from './runtime-display';

describe('runtimeDisplay', () => {
  it('uses the installed Nexus version, not an available update', () => {
    const runtime = demoSnapshot().runtime;
    runtime.name = 'xodus-nexus-runtime-11.0-20261011-g3fd4ae10';
    runtime.nexusVersion = 'runtime-11.0-newer';
    expect(runtimeDisplay(runtime)).toEqual({ title: 'Nexus runtime', source: 'Nexus runtime', version: '11.0-20261011-g3fd4ae10' });
  });
  it.each(['proton-xodus-af521bf3-eac-bridge-v1', 'proton-xodus-af521bf3-xgamesave-pr28-0123456789-bridge-v1'])('identifies a legacy patched runtime: %s', name => {
    expect(runtimeDisplay({ ...demoSnapshot().runtime, name }).source).toBe('Nexus runtime');
  });
  it('does not rename an unmodified upstream runtime to Nexus', () => {
    expect(runtimeDisplay({ ...demoSnapshot().runtime, name: 'xodus-proton-af521bf3' }).source).toBe('Upstream Xodus Proton snapshot');
  });
  it('does not claim an unknown custom runtime is official', () => {
    expect(runtimeDisplay({ ...demoSnapshot().runtime, name: 'my-wine-build' }).source).toBe('Custom runtime');
  });
  it('does not show the update version as installed when no runtime is installed', () => {
    expect(runtimeDisplay({ ...demoSnapshot().runtime, installed: false }).version).toBe('Not installed');
  });
});
