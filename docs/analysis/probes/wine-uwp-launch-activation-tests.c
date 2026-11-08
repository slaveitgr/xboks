#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdio.h>
#include <wchar.h>

static int check_env(const WCHAR *name, const WCHAR *expected)
{
    WCHAR buffer[4096];
    DWORD length = GetEnvironmentVariableW(name, buffer, 4096);
    if (!wcscmp(expected, L"--absent")) return !length && GetLastError() == ERROR_ENVVAR_NOT_FOUND;
    return length && length < 4096 && !wcscmp(buffer, expected);
}

int wmain(int argc, WCHAR **argv)
{
    int identity_ok, uri_ok;
    if (argc != 3) { int i; printf("unexpected_argc=%d\n",argc); for(i=0;i<argc;i++) wprintf(L"arg_%d=%ls\n",i,argv[i]); return 64; }
    identity_ok = check_env(L"WINE_UWP_AUMID", argv[1]);
    uri_ok = check_env(L"WINE_UWP_ACTIVATE_URI", argv[2]);
    printf("identity_matches=%d; activation_uri_matches=%d\n", identity_ok, uri_ok);
    return identity_ok && uri_ok ? 0 : 1;
}
