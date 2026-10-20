import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeEacTrace } from './eac-trace-summary.mjs';

test('reports module loading and export resolution, never session success', () => {
  const result = summarizeEacTrace([
    '014c:trace:loaddll:build_module Loaded L"Z:\\private-account\\EOSSDK-Win64-Shipping.dll" at 123: native',
    '014c:Call KERNEL32.GetProcAddress(123,456 "EOS_Platform_GetAntiCheatClientInterface") ret=789',
    '014c:Ret  KERNEL32.GetProcAddress() retval=123 ret=789',
    'Private credential: TEST_SECRET; xuid=1234567890; Authorization: JWT.secret',
  ].join('\n'), "Launcher finished with: 301, 'success'");
  assert.equal(result.eosSdkMapped, true);
  assert.deepEqual(result.bootstrapperCodes, [301]);
  assert.deepEqual(result.exportLookups, [{ name: 'EOS_Platform_GetAntiCheatClientInterface', calls: 1, found: 1, missing: 0 }]);
  assert.match(result.onlineAttestation, /not established/);
  assert.doesNotMatch(JSON.stringify(result), /TEST_SECRET|1234567890|JWT\.secret|private-account/);
});

test('tracks nested lookups and missing exports without exposing unknown names', () => {
  const result = summarizeEacTrace([
    '01aa:Call KERNEL32.GetProcAddress(123,456 "EOS_Initialize") ret=789',
    '01aa:Call kernelbase.GetProcAddress(123,456 "PRIVATE_UNKNOWN_NAME") ret=789',
    '01aa:Ret  kernelbase.GetProcAddress() retval=456 ret=789',
    '01aa:Ret  KERNEL32.GetProcAddress() retval=0 ret=789',
    '01bb:Call KERNEL32.GetProcAddress(123,456 "EOS_AntiCheatClient_BeginSession") ret=789',
  ].join('\n'));
  assert.deepEqual(result.exportLookups, [
    { name: 'EOS_AntiCheatClient_BeginSession', calls: 1, found: 0, missing: 0 },
    { name: 'EOS_Initialize', calls: 1, found: 0, missing: 1 },
  ]);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_UNKNOWN_NAME/);
});
