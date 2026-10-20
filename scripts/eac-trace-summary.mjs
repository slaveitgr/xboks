// Read-only, allowlisted summary. Never print raw traces, paths or arguments.
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const exports = new Set([
  'EOS_Initialize', 'EOS_Platform_Create', 'EOS_Platform_GetAntiCheatClientInterface',
  'EOS_AntiCheatClient_BeginSession', 'EOS_AntiCheatClient_EndSession',
  'EOS_AntiCheatClient_GetModuleBuildId', 'EOS_AntiCheatClient_PollStatus',
  'EOS_AntiCheatClient_AddNotifyClientIntegrityViolated',
  'EOS_AntiCheatClient_ReceiveMessageFromServer',
]);

export function summarizeEacTrace(trace, bootstrapper = '') {
  const pending = new Map();
  const lookups = new Map();
  let eosSdkMapped = false;
  let legacyBridgeMapped = false;
  for (const line of trace.split('\n')) {
    if (/:trace:loaddll:build_module Loaded /i.test(line)) {
      if (/\\EOSSDK-Win64-Shipping\.dll"/i.test(line)) eosSdkMapped = true;
      if (/\\easyanticheat(?:_x64)?\.dll"/i.test(line)) legacyBridgeMapped = true;
    }
    const call = /^([a-f\d]+):Call (?:kernel32|kernelbase)\.GetProcAddress\(/i.exec(line);
    if (call) {
      const name = /"(EOS_[A-Za-z0-9_]+)"/.exec(line)?.[1];
      const allowed = exports.has(name) ? name : undefined;
      const stack = pending.get(call[1]) ?? [];
      stack.push(allowed);
      pending.set(call[1], stack);
      if (allowed) {
        const entry = lookups.get(allowed) ?? { name: allowed, calls: 0, found: 0, missing: 0 };
        entry.calls++;
        lookups.set(allowed, entry);
      }
    }
    const returned = /^([a-f\d]+):Ret\s+(?:kernel32|kernelbase)\.GetProcAddress\(\) retval=([a-f\d]{1,16})\b/i.exec(line);
    if (returned) {
      const name = pending.get(returned[1])?.pop();
      if (name) lookups.get(name)[BigInt(`0x${returned[2]}`) ? 'found' : 'missing']++;
    }
  }
  const bootstrapperCodes = [...new Set([...bootstrapper.matchAll(/Launcher finished with:\s*(\d{1,4})\b/g)].map((match) => Number(match[1])))];
  return {
    eosSdkMapped, legacyBridgeMapped, bootstrapperCodes,
    exportLookups: [...lookups.values()].sort((a, b) => a.name.localeCompare(b.name)),
    clientSessionResult: 'not established by export lookup or module loading',
    onlineAttestation: 'not established by this summary',
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [trace, bootstrapper, extra] = process.argv.slice(2);
  if (!trace || extra) throw new Error('Usage: node scripts/eac-trace-summary.mjs WINE_TRACE [BOOTSTRAPPER_LOG]');
  async function read(file) {
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > 16 * 1024 * 1024) throw new Error('Input must be a regular trace file of at most 16 MiB.');
    return fs.readFile(file, 'utf8');
  }
  console.log(JSON.stringify(summarizeEacTrace(await read(trace), bootstrapper ? await read(bootstrapper) : ''), null, 2));
}
