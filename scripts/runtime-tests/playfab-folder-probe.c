/* SPDX-License-Identifier: MIT
 * Synthetic SDK/COM fixtures only: no account, services, game or cloud.
 */
#include <windows.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
typedef struct { void *queue; uint64_t options; const char *saveFolder; } InitArgs;
#ifdef PROBE_SDK
HRESULT WINAPI probe_stub(void) { return E_ACCESSDENIED; }
HRESULT WINAPI PFGameSaveFilesInitialize(const InitArgs *args)
{
    if (!args) return E_INVALIDARG;
    if (args->queue != (void *)0x1234 || args->options != 0x88) return E_FAIL;
    if (args->saveFolder && !strcmp(args->saveFolder, "caller-path")) return E_ACCESSDENIED;
    if (!args->saveFolder || !strstr(args->saveFolder, "\\PlayFabGameSaves")) return E_POINTER;
    WCHAR path[32768];
    if (!MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, args->saveFolder, -1, path, 32768)) return E_FAIL;
    DWORD attributes = GetFileAttributesW(path);
    if (attributes == INVALID_FILE_ATTRIBUTES || !(attributes & FILE_ATTRIBUTE_DIRECTORY)) return E_FAIL;
    return E_ABORT; /* Genuine fixture failure must never be manufactured into S_OK. */
}
#elif defined(PROBE_RUNTIME)
typedef struct Storage Storage;
typedef struct {
    HRESULT (WINAPI *query)(Storage *, const GUID *, void **);
    ULONG (WINAPI *addref)(Storage *);
    ULONG (WINAPI *release)(Storage *);
    HRESULT (WINAPI *size)(Storage *, size_t *);
    HRESULT (WINAPI *path)(Storage *, size_t, char *, size_t *);
} Vtable;
struct Storage { const Vtable *vtable; };
static ULONG WINAPI reference(Storage *s) { (void)s; return 1; }
static HRESULT WINAPI size(Storage *s, size_t *length) {
    char buffer[32768]; (void)s;
    DWORD n = GetEnvironmentVariableA("NEXUS_PROBE_PATH", buffer, sizeof(buffer));
    if (!n || n >= sizeof(buffer)) return E_FAIL;
    *length = n + 1; return S_OK;
}
static HRESULT WINAPI path(Storage *s, size_t length, char *out, size_t *used) {
    (void)s;
    DWORD n = GetEnvironmentVariableA("NEXUS_PROBE_PATH", out, (DWORD)length);
    if (!n || n >= length) return E_FAIL;
    if (used) *used = n + 1;
    return S_OK;
}
static const Vtable vtable = {NULL, reference, reference, size, path};
static Storage storage = {&vtable};
__declspec(dllexport) HRESULT WINAPI QueryApiImpl(const GUID *clsid, const GUID *iid, void **out) {
    (void)clsid; (void)iid;
    if (GetEnvironmentVariableA("NEXUS_PROBE_FAIL", NULL, 0)) return E_ACCESSDENIED;
    *out = &storage; return S_OK;
}
#else
static unsigned checks, failures;
#define CHECK(test) do { ++checks; if (!(test)) { ++failures; printf("FAIL %d: %s\n", __LINE__, #test); } } while (0)
int main(void)
{
    HMODULE runtime = LoadLibraryW(L"xgameruntime.dll");
    HMODULE proxy = LoadLibraryW(L"PlayFabGameSave.dll");
    CHECK(runtime != NULL && proxy != NULL);
    if (!runtime || !proxy) return 1;
    HRESULT (WINAPI *initialize)(const InitArgs *) = (void *)GetProcAddress(proxy, "PFGameSaveFilesInitialize");
    HRESULT (WINAPI *forwarded)(void) = (void *)GetProcAddress(proxy, "PFGameSaveFilesGetRemainingQuota");
    CHECK(initialize && forwarded);
    if (!initialize || !forwarded) return 1;
    InitArgs args = {(void *)0x1234, 0x88, "caller-path"};
    CHECK(initialize(NULL) == E_INVALIDARG);
    CHECK(initialize(&args) == E_ACCESSDENIED);
    CHECK(forwarded() == E_ACCESSDENIED);
    args.saveFolder = NULL;
    SetEnvironmentVariableA("NEXUS_PROBE_FAIL", "1");
    CHECK(initialize(&args) == E_ACCESSDENIED);
    SetEnvironmentVariableA("NEXUS_PROBE_FAIL", NULL);
    WCHAR wide[32768]; char utf8[131072];
    CHECK(GetTempPathW(32768, wide) != 0);
    wcscat(wide, L"nexus-pgs-\x010d\x0065\x0161\x0074\x0069\x006e\x0061");
    CHECK(CreateDirectoryW(wide, NULL) || GetLastError() == ERROR_ALREADY_EXISTS);
    CHECK(WideCharToMultiByte(CP_UTF8, 0, wide, -1, utf8, sizeof(utf8), NULL, NULL) != 0);
    SetEnvironmentVariableA("NEXUS_PROBE_PATH", utf8);
    CHECK(initialize(&args) == E_ABORT);
    CHECK(args.saveFolder == NULL && args.queue == (void *)0x1234 && args.options == 0x88);
    args.saveFolder = "";
    CHECK(initialize(&args) == E_ABORT);
    CHECK(!strcmp(args.saveFolder, ""));
    HKEY key;
    DWORD value = 0, size = sizeof(value), type = 0;
    CHECK(RegOpenKeyExW(HKEY_LOCAL_MACHINE, L"SOFTWARE\\Microsoft\\GamingServices", 0, KEY_READ, &key) == ERROR_SUCCESS);
    CHECK(RegQueryValueExW(key, L"ForceUseInprocGameSaves", NULL, &type, (BYTE *)&value, &size) == ERROR_SUCCESS && type == REG_DWORD && value == 1);
    CHECK(RegQueryValueExW(key, L"CurrentVersion", NULL, NULL, NULL, NULL) == ERROR_FILE_NOT_FOUND);
    CHECK(RegQueryValueExW(key, L"AvailableVersion", NULL, NULL, NULL, NULL) == ERROR_FILE_NOT_FOUND);
    RegCloseKey(key);
    CHECK(RegOpenKeyExW(HKEY_LOCAL_MACHINE, L"SOFTWARE\\Microsoft\\GamingServices", 0, KEY_READ | KEY_WRITE, &key) == ERROR_SUCCESS);
    value = 0;
    CHECK(RegSetValueExW(key, L"ForceUseInprocGameSaves", 0, REG_DWORD, (BYTE *)&value, sizeof(value)) == ERROR_SUCCESS);
    CHECK(initialize(&args) == E_ABORT);
    size = sizeof(value); value = 99;
    CHECK(RegQueryValueExW(key, L"ForceUseInprocGameSaves", NULL, NULL, (BYTE *)&value, &size) == ERROR_SUCCESS && value == 0);
    RegCloseKey(key);
    printf("CHECKS %u FAILURES %u\n", checks, failures);
    return failures ? 1 : 0;
}
#endif
