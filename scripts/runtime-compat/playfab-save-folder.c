/* SPDX-License-Identifier: MIT
 * Preserve the owner's PlayFab SDK; supply only an omitted local save root.
 * x64 PFGameSaveInitArgs ABI: PlayFabCSdk PFGameSaveFilesTypes.h.
 */
#include <windows.h>
#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include <wchar.h>
#include "playfab-session.h"
typedef struct { void *queue; uint64_t options; const char *saveFolder; } InitArgs;
_Static_assert(sizeof(InitArgs) == 24 && offsetof(InitArgs, saveFolder) == 16, "Unsupported SDK ABI");
typedef struct Storage Storage;
typedef struct {
    HRESULT (WINAPI *query)(Storage *, const GUID *, void **);
    ULONG (WINAPI *addref)(Storage *);
    ULONG (WINAPI *release)(Storage *);
    HRESULT (WINAPI *size)(Storage *, size_t *);
    HRESULT (WINAPI *path)(Storage *, size_t, char *, size_t *);
} StorageVtable;
struct Storage { const StorageVtable *vtable; };
static const GUID storageId = {0xf4faf4d4,0x2d04,0x4fce,{0xb3,0xe0,0x47,0x4a,0x71,0x3a,0x3e,0x84}};
static INIT_ONCE sdkOnce = INIT_ONCE_STATIC_INIT;
static HRESULT (WINAPI *nativeInitialize)(const InitArgs *);
static HRESULT sdkResult = E_FAIL;
static SRWLOCK folderLock = SRWLOCK_INIT;
static char *defaultFolder;
HRESULT nexus_session_initialized(HMODULE);
HRESULT nexus_session_callbacks(HMODULE,SaveCallbacks *);
HRESULT nexus_session_add_user(HMODULE,void *,unsigned,NexusAsync *);
HRESULT nexus_session_cleanup(HMODULE,NexusAsync *);
static HMODULE nativeSdk;

static HRESULT select_local_provider(void)
{
    HKEY key;
    DWORD type, value, size = sizeof(value), local = 1;
    LONG error = RegCreateKeyExW(HKEY_LOCAL_MACHINE, L"SOFTWARE\\Microsoft\\GamingServices",
        0, NULL, 0, KEY_QUERY_VALUE | KEY_SET_VALUE, NULL, &key, NULL);
    if (error) return HRESULT_FROM_WIN32(error);
    /* Upstream PlayFab recognizes this provider switch. It is NOT an installed
     * Microsoft service/version claim. Preserve any explicit existing policy. */
    error = RegQueryValueExW(key, L"ForceUseInprocGameSaves", NULL, &type, (BYTE *)&value, &size);
    if (error == ERROR_FILE_NOT_FOUND)
        error = RegSetValueExW(key, L"ForceUseInprocGameSaves", 0, REG_DWORD, (BYTE *)&local, sizeof(local));
    RegCloseKey(key);
    return error ? HRESULT_FROM_WIN32(error) : S_OK;
}

static BOOL CALLBACK load_sdk(INIT_ONCE *once, void *parameter, void **context)
{
    HMODULE self, sdk;
    WCHAR path[32768], *slash;
    DWORD length;
    (void)once; (void)parameter; (void)context;
    if (!GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS |
            GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT, (LPCWSTR)&load_sdk, &self)) {
        sdkResult = HRESULT_FROM_WIN32(GetLastError()); return TRUE;
    }
    length = GetModuleFileNameW(self, path, 32768);
    if (!length || length >= 32768) { sdkResult = HRESULT_FROM_WIN32(ERROR_INSUFFICIENT_BUFFER); return TRUE; }
    slash = wcsrchr(path, L'\\');
    if (!slash || (size_t)(slash - path) + 1 + wcslen(L"nexus_pgs_native.dll") >= 32768) {
        sdkResult = E_INVALIDARG; return TRUE;
    }
    wcscpy(slash + 1, L"nexus_pgs_native.dll");
    /* Keep SDK loaded for async operations throughout this module's lifetime. */
    sdk = LoadLibraryExW(path, NULL, LOAD_WITH_ALTERED_SEARCH_PATH);
    if (!sdk) { sdkResult = HRESULT_FROM_WIN32(GetLastError()); return TRUE; }
    nativeSdk = sdk;
    nativeInitialize = (void *)GetProcAddress(sdk, "PFGameSaveFilesInitialize");
    sdkResult = nativeInitialize ? S_OK : HRESULT_FROM_WIN32(ERROR_PROC_NOT_FOUND);
    return TRUE;
}
static HRESULT prepare_folder(void)
{
    HMODULE runtime = GetModuleHandleW(L"xgameruntime.dll");
    HRESULT (WINAPI *query)(const GUID *, const GUID *, void **);
    Storage *storage = NULL;
    char *path = NULL;
    WCHAR *wide = NULL;
    size_t length = 0;
    HRESULT hr;
    int wideLength;
    DWORD attributes, error;
    if (defaultFolder) return S_OK;
    if (!runtime) return HRESULT_FROM_WIN32(ERROR_MOD_NOT_FOUND);
    query = (void *)GetProcAddress(runtime, "QueryApiImpl");
    if (!query) return HRESULT_FROM_WIN32(ERROR_PROC_NOT_FOUND);
    hr = query(&storageId, &storageId, (void **)&storage);
    if (FAILED(hr)) return hr;
    if (!storage) return E_POINTER;
    hr = storage->vtable->size(storage, &length);
    if (SUCCEEDED(hr) && (!length || length > 131072)) hr = E_INVALIDARG;
    if (SUCCEEDED(hr)) {
        path = HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, length + sizeof("\\PlayFabGameSaves"));
        if (!path) hr = E_OUTOFMEMORY;
        else hr = storage->vtable->path(storage, length, path, NULL);
    }
    storage->vtable->release(storage);
    if (FAILED(hr)) goto done;
    if (!memchr(path, 0, length) || !path[0]) { hr = E_INVALIDARG; goto done; }
    strcat(path, "\\PlayFabGameSaves");
    wideLength = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, path, -1, NULL, 0);
    if (!wideLength) { hr = HRESULT_FROM_WIN32(GetLastError()); goto done; }
    wide = HeapAlloc(GetProcessHeap(), 0, (size_t)wideLength * sizeof(WCHAR));
    if (!wide) { hr = E_OUTOFMEMORY; goto done; }
    if (!MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, path, -1, wide, wideLength)) {
        hr = HRESULT_FROM_WIN32(GetLastError()); goto done;
    }
    if (!CreateDirectoryW(wide, NULL)) {
        error = GetLastError();
        if (error != ERROR_ALREADY_EXISTS) { hr = HRESULT_FROM_WIN32(error); goto done; }
    }
    attributes = GetFileAttributesW(wide);
    if (attributes == INVALID_FILE_ATTRIBUTES || !(attributes & FILE_ATTRIBUTE_DIRECTORY)) {
        hr = HRESULT_FROM_WIN32(ERROR_DIRECTORY); goto done;
    }
    defaultFolder = path; path = NULL;
done:
    if (wide) HeapFree(GetProcessHeap(), 0, wide);
    if (path) HeapFree(GetProcessHeap(), 0, path);
    return hr;
}
HRESULT WINAPI PFGameSaveFilesInitialize(const InitArgs *args)
{
    InitArgs adjusted;
    HRESULT hr;
    InitOnceExecuteOnce(&sdkOnce, load_sdk, NULL, NULL);
    if (FAILED(sdkResult)) return sdkResult;
    if (!args || (args->saveFolder && args->saveFolder[0])) {
        hr = nativeInitialize(args);
        if (SUCCEEDED(hr)) hr = nexus_session_initialized(nativeSdk);
        return hr;
    }
    /* Failed discovery is retryable: runtime/package setup can happen later. */
    AcquireSRWLockExclusive(&folderLock);
    hr = select_local_provider();
    if (SUCCEEDED(hr)) hr = prepare_folder();
    ReleaseSRWLockExclusive(&folderLock);
    if (FAILED(hr)) return hr;
    adjusted = *args; adjusted.saveFolder = defaultFolder;
    hr = nativeInitialize(&adjusted);
    if (SUCCEEDED(hr)) hr = nexus_session_initialized(nativeSdk);
    return hr;
}
HRESULT WINAPI PFGameSaveFilesSetUiCallbacks(SaveCallbacks *callbacks)
{
    InitOnceExecuteOnce(&sdkOnce,load_sdk,NULL,NULL);
    return FAILED(sdkResult)?sdkResult:nexus_session_callbacks(nativeSdk,callbacks);
}
HRESULT WINAPI PFGameSaveFilesAddUserWithUiAsync(void *user,unsigned options,NexusAsync *async)
{
    InitOnceExecuteOnce(&sdkOnce,load_sdk,NULL,NULL);
    return FAILED(sdkResult)?sdkResult:nexus_session_add_user(nativeSdk,user,options,async);
}
HRESULT WINAPI PFGameSaveFilesUninitializeAsync(NexusAsync *async)
{
    InitOnceExecuteOnce(&sdkOnce,load_sdk,NULL,NULL);
    return FAILED(sdkResult)?sdkResult:nexus_session_cleanup(nativeSdk,async);
}
