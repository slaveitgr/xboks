import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStoreProbes, storeProbeBuilds, verifyStoreProbeCrt } from './build-store-probes.mjs';

const options = { build: '/tmp/build with spaces', source: '/tmp/source', tests: '/tmp/tests', project: '/tmp/project' };
test('XML helper probes use pinned Wine headers, driver and UCRT startup', () => {
  const probes = storeProbeBuilds(options);
  assert.equal(probes.length, 2);
  for (const probe of probes) {
    assert.equal(probe.command, `${options.build}/tools/winegcc/winegcc`);
    assert.deepEqual(probe.args.slice(0, 4), ['-b', 'x86_64-w64-mingw32', '--wine-objdir', options.build]);
    for (const arg of ['-D_UCRT', '/tmp/source/include/msvcrt', '-lwinecrt0', '-lucrtbase', '-lkernel32', '-lntdll'])
      assert.ok(probe.args.includes(arg), arg);
    assert.ok(probe.args.includes(`${options.build}/libs/xml2/x86_64-windows/libxml2.a`));
    assert.equal(probe.args[probe.args.indexOf('/tmp/source/include/msvcrt') - 1], '-isystem');
    assert.ok(!probe.args.includes('-lucrt'));
  }
});
test('PE inspection rejects the CI mixed-CRT crash and missing UCRT', () => {
  assert.doesNotThrow(() => verifyStoreProbeCrt('DLL Name: kernel32.dll\nDLL Name: UCRTBASE.dll\n'));
  for (const text of ['', 'DLL Name: msvcrt.dll', 'DLL Name: ucrtbase.dll\nDLL Name: msvcrt.dll',
    'DLL Name: ucrtbase.dll\nDLL Name: MSVCR120.dll']) assert.throws(() => verifyStoreProbeCrt(text), /Wine UCRT/);
});
test('builder checks both compiled executables and fails closed on mixed imports', () => {
  const calls = [];
  buildStoreProbes(options, (...args) => { calls.push(args); return 'DLL Name: ucrtbase.dll'; });
  assert.equal(calls.length, 5);
  assert.equal(calls[0][0], 'make');
  assert.equal(calls.filter(call => call[0].endsWith('/winegcc')).length, 2);
  assert.equal(calls.filter(call => call[0].endsWith('objdump') && call[3] === true).length, 2);
  assert.throws(() => buildStoreProbes(options, () => 'DLL Name: msvcrt.dll'), /Wine UCRT/);
});
