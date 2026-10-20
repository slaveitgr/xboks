import fs from 'node:fs/promises';
import path from 'node:path';

// Compile the actual patched request/parser/adapter, not a hand-copied model.
// Only the transport is synthetic; this generated include is never packaged.
export function privilegeProbeSource(xuser, util) {
  function section(text, start, end, last = false) {
    const a = last ? text.lastIndexOf(start) : text.indexOf(start);
    const b = text.indexOf(end, a + start.length);
    if (a < 0 || b <= a) throw new Error('Unknown privilege adapter source layout');
    return text.slice(a, b);
  }
  return section(util, '#define get_json_', '\nget_json_(number,Number,DOUBLE*)') + '\nget_json_(number,Number,DOUBLE*)\n' +
    section(xuser, 'static HRESULT parse_json(', '\nstruct policy') + '\n' +
    section(xuser, 'static char *hstring_to_utf8(', '\nstatic WCHAR *utf8_to_wide', true) + '\n' +
    section(xuser, 'static HRESULT xsts_authorize(', '\nHRESULT xuser_device_authorization', true) + '\n' +
    section(xuser, 'static HRESULT user_verify_privilege(', '\nstatic HRESULT WINAPI x_user_XUserResolvePrivilegeWithUiAsync');
}

export async function buildUserPrivilegeProbe({ source, build, tests, project }, run) {
  const directory = path.join(source, 'dlls/xgameruntime');
  const generated = privilegeProbeSource(await fs.readFile(path.join(directory, 'xuser.c'), 'utf8'),
    await fs.readFile(path.join(directory, 'util.c'), 'utf8'));
  await fs.writeFile(path.join(tests, 'user-privilege-adapter.inc'), generated);
  run('x86_64-w64-mingw32-gcc', ['-D__WINESRC__', '-O2', '-Wall', '-Wextra', '-Werror',
    '-I', tests, '-I', path.join(build, 'dlls/xgameruntime'), '-I', directory,
    '-I', path.join(build, 'include'), '-I', path.join(source, 'include'),
    path.join(project, 'scripts/runtime-tests/user-privilege-probe.c'),
    '-o', path.join(tests, 'user-privilege-probe.exe'), '-lole32', '-lruntimeobject'], project);
}
