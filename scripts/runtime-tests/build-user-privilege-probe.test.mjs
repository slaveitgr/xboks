import { test } from 'node:test';
import assert from 'node:assert/strict';
import { privilegeProbeSource } from './build-user-privilege-probe.mjs';

const xuser = [
  'static char *hstring_to_utf8( HSTRING value );',
  'static HRESULT xsts_authorize( void );',
  'static HRESULT parse_json( void ) { PARSE_BODY; }',
  'struct policy { OUTSIDE_PARSE; };',
  'static HRESULT user_verify_privilege( void ) { VERIFY_BODY; }',
  'static HRESULT WINAPI x_user_XUserResolvePrivilegeWithUiAsync( void ) { OUTSIDE_VERIFY; }',
  'static char *hstring_to_utf8( HSTRING value ) { UTF8_BODY; }',
  'static WCHAR *utf8_to_wide( void ) { OUTSIDE_UTF8; }',
  'static HRESULT xsts_authorize( void ) { REQUEST_BODY; }',
  'HRESULT xuser_device_authorization( void ) { OUTSIDE_REQUEST; }',
].join('\n');
const util = '#define get_json_(a,b,c) JSON_HELPER_BODY\nget_json_(string,String,HSTRING*)\nget_json_(number,Number,DOUBLE*)\nOUTSIDE_HELPERS';

test('privilege probe compiles production adapter bodies, excluding declarations and unrelated code', () => {
  const source = privilegeProbeSource(xuser, util);
  for (const body of ['PARSE_BODY', 'VERIFY_BODY', 'UTF8_BODY', 'REQUEST_BODY', 'JSON_HELPER_BODY'])
    assert.ok(source.includes(body), body);
  assert.ok(!source.includes('OUTSIDE_'));
  assert.ok(!source.includes('xsts_authorize( void );'));
  assert.equal(source.match(/get_json_\(number,Number,DOUBLE\*\)/g).length, 1);
});

test('source extraction fails closed when a required production boundary is missing', () => {
  for (const marker of ['static HRESULT parse_json(', '\nstruct policy',
    'static HRESULT user_verify_privilege(', '\nstatic HRESULT WINAPI x_user_XUserResolvePrivilegeWithUiAsync',
    '\nHRESULT xuser_device_authorization'])
    assert.throws(() => privilegeProbeSource(xuser.replaceAll(marker, 'missing-boundary'), util), /Unknown privilege adapter/);
  assert.throws(() => privilegeProbeSource(xuser, util.replace('get_json_(number,Number,DOUBLE*)', 'missing-boundary')), /Unknown privilege adapter/);
});
