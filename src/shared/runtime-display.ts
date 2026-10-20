import type { RuntimeStatus } from './types.js';

// Describe the active runtime, not the available update. Older Nexus builds
// used upstream-looking folder names with explicit local patch suffixes.
export function runtimeDisplay(runtime: RuntimeStatus): { title: string; source: string; version: string } {
  if (!runtime.installed) return { title: 'Nexus runtime', source: 'Not installed', version: 'Not installed' };
  const name = runtime.name ?? '';
  const nexus = name.startsWith('xodus-nexus-runtime-') ||
    (/^(?:proton-xodus-|xodus-proton-)/.test(name) && /-(?:xgamesave-pr28-|eac-bridge-v\d)/.test(name));
  const upstream = !nexus && (/^xodus-proton-[a-f0-9]{8}$/.test(name) || /^proton-xodus-[a-f0-9]{8,40}$/.test(name));
  const title = nexus ? 'Nexus runtime' : upstream ? 'Xodus Proton runtime' : 'Custom runtime';
  return {
    title,
    source: nexus ? 'Nexus runtime' : upstream ? 'Upstream Xodus Proton snapshot' : 'Custom runtime',
    version: name.startsWith('xodus-nexus-runtime-') ? name.slice('xodus-nexus-runtime-'.length)
      : runtime.commit ? `Build ${runtime.commit.slice(0, 12)}` : name || 'Version unavailable',
  };
}
