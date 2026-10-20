import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exceptionMetadata, asyncMetadata } from './wine-exception-metadata.mjs';

test('captures numeric context and parameters', () => {
  assert.match(exceptionMetadata('018c:trace:seh:dispatch_exception  info[1]=0000000000000088'), /info\[1\]=0000000000000088$/);
  assert.match(exceptionMetadata('018c:trace:seh:dispatch_exception rax=0000000000000000 rbx=0000000000000000 rcx=0000000000000040 rdx=00000001487b8208'), /rcx=0000000000000040/);
});
test('captures actual Wine unwind, not arbitrary stack words', () => {
  assert.match(exceptionMetadata('018c:warn:seh:virtual_unwind backtrace: 00006ffffd9cced5: L"MSVCP140.dll" + 000000000001ced5.'), /module=MSVCP140.dll rva=000000000001ced5$/);
  assert.match(exceptionMetadata('018c:warn:seh:virtual_unwind backtrace: 000000014423b5b4: unknown module.'), /module=unknown$/);
  assert.equal(exceptionMetadata('018c:trace:seh:virtual_unwind rsp+0x30: 0000000144ecf619'), null);
});
test('classifies known types and captures only validated compiler symbols, not messages', () => {
  const line = name => `03f4:trace:seh:cxx_frame_handler     0: flags 0 type 0000000141234567 {vtable=0000000141234500 name=${name} (PRIVATE_VALUE)} offsets 0,0,0 size 16 copy ctor 0000000141234500`;
  assert.match(exceptionMetadata(line('.?AVsystem_error@std@@')), /category=std-system_error rtti=\.\?AVsystem_error@std@@$/);
  const symbol = exceptionMetadata(line('.?AVtask_canceled@Concurrency@@'));
  assert.match(symbol, /category=unclassified rtti=\.\?AVtask_canceled@Concurrency@@$/);
  assert.ok(!symbol.includes('PRIVATE'));
  const unknown = exceptionMetadata(line('SENSITIVE_UNKNOWN_NAME'));
  assert.match(unknown, /category=unclassified$/);
  assert.ok(!unknown.includes('SENSITIVE') && !unknown.includes('PRIVATE'));
  assert.ok(!exceptionMetadata(line('.?AV' + 'a'.repeat(256) + '@@')).includes('rtti='));
});
test('captures numeric C++ handler metadata and rethrow marker', () => {
  assert.match(exceptionMetadata('03f0:trace:seh:cxx_frame_handler handling C++ exception rec 000000007a990000 frame 7a99c000 descr 0000000141234000'), /^\[exception-handler\]/);
  assert.match(exceptionMetadata('03f0:trace:seh:cxx_frame_handler4 rethrow detected.'), / rethrow$/);
  assert.equal(exceptionMetadata('03f0:trace:seh:cxx_frame_handler handling C++ exception rec secret frame secret descr secret'), null);
});
test('rejects raw messages, headers, paths and malformed numeric continuations', () => {
  for (const line of [
    '018c:warn:seh:dispatch_exception secret message',
    '018c:trace:seh:dispatch_exception  info[1]=SECRET',
    '018c:trace:seh:dispatch_exception rip=0000000141234567 TOKEN=secret',
    '018c:warn:seh:virtual_unwind backtrace: 000000014423b5b4: L"C:\\private\\game.exe" + 0000000000001000.',
    '018c:trace:winhttp:read_reply Authorization: secret',
    '018c:warn:seh:OutputDebugStringW secret',
    'Authorization: secret',
  ]) assert.equal(exceptionMetadata(line), null);
});
test('async lifecycle is numeric only and discards caller identityName text', () => {
  const begin = asyncMetadata('0194:trace:gdkc:x_threading_XAsyncBegin iface 0000000123456789, asyncBlock 0000000123456789, context 0000000123456789, identity 0000000123456789, identityName SECRET_TOKEN, provider 0000000123456789.');
  assert.match(begin, /op=Begin/);
  assert.ok(!begin.includes('SECRET'));
  assert.match(asyncMetadata('0194:trace:gdkc:x_threading_XAsyncComplete iface 0000000123456789, asyncBlock 0000000123456789, result 0x80004004, requiredBufferSize 0.'), /op=Complete/);
  assert.match(asyncMetadata('0194:trace:gdkc:x_threading_XAsyncCancel iface 0000000123456789, asyncBlock 0000000123456789.'), /op=Cancel/);
  assert.match(asyncMetadata('03f8:trace:gdkc:async_work_callback provider 0000000144ed3c20, op 1, asyncBlock 0000000052000000 -> result 0x80004001.'), /^\[async-provider\].*result=0x80004001$/);
  for (const value of [
    '0194:trace:gdkc:x_threading_XAsyncComplete iface SECRET, asyncBlock SECRET, result SECRET, requiredBufferSize SECRET.',
    '0194:trace:gdkc:parse_json Authorization: SECRET',
    '0194:trace:gdkc:x_threading_XAsyncGetStatus asyncBlock 0000000123456789 -> status 0 TOKEN.',
    '0194:trace:gdkc:x_threading_XAsyncBegin message SECRET',
  ]) assert.equal(asyncMetadata(value), null);
});
