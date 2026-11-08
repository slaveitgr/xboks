#include <windows.h>
#include <stdio.h>
#include <string.h>
#include <wchar.h>

#ifndef APPMODEL_ERROR_NO_APPLICATION
#define APPMODEL_ERROR_NO_APPLICATION 15703L
#endif

typedef LONG (WINAPI *query_fn)(HANDLE, UINT32 *, WCHAR *);
static LONG failures;
#define CHECK(x) do { if (!(x)) { ++failures; printf("FAIL line %d: %s (last error %lu)\n", __LINE__, #x, GetLastError()); } } while (0)

int main(void)
{
    HMODULE base = GetModuleHandleW(L"kernelbase.dll"), kernel = GetModuleHandleW(L"kernel32.dll");
    HMODULE contract = LoadLibraryW(L"api-ms-win-appmodel-runtime-l1-1-0.dll");
    query_fn query, via_kernel, via_contract;
    const WCHAR value[] = L"XBOKS.IdentityProbe_8wekyb3d8bbwe!Probe";
    WCHAR saved[2048], image[MAX_PATH], command[MAX_PATH + 32];
    DWORD saved_len, pid = GetCurrentProcessId();
    UINT32 length, expected = sizeof(value) / sizeof(value[0]);
    struct { WCHAR before; WCHAR text[512]; WCHAR after; } guarded;
    HANDLE handle;
    STARTUPINFOW startup = {.cb = sizeof(startup)};
    PROCESS_INFORMATION child;

    query = (query_fn)GetProcAddress(base, "GetApplicationUserModelId");
    via_kernel = (query_fn)GetProcAddress(kernel, "GetApplicationUserModelId");
    via_contract = contract ? (query_fn)GetProcAddress(contract, "GetApplicationUserModelId") : NULL;
    CHECK(query && via_kernel && via_contract);
    if (!query || !via_kernel || !via_contract) return 2;
    CHECK(query == via_kernel && query == via_contract);
    saved_len = GetEnvironmentVariableW(L"WINE_UWP_AUMID", saved, sizeof(saved) / sizeof(saved[0]));
    CHECK(saved_len < sizeof(saved) / sizeof(saved[0]));
    SetEnvironmentVariableW(L"WINE_UWP_AUMID", NULL);
    length = 0;
    CHECK(query(GetCurrentProcess(), &length, NULL) == APPMODEL_ERROR_NO_APPLICATION);
    SetEnvironmentVariableW(L"WINE_UWP_AUMID", value);
    CHECK(query(GetCurrentProcess(), NULL, NULL) == ERROR_INVALID_PARAMETER);

    length = 0;
    CHECK(query(GetCurrentProcess(), &length, NULL) == ERROR_INSUFFICIENT_BUFFER && length == expected);
    memset(&guarded, 0xcc, sizeof(guarded));
    guarded.before = 0xa55a; guarded.after = 0x5aa5;
    length = expected - 1;
    CHECK(query(GetCurrentProcess(), &length, guarded.text) == ERROR_INSUFFICIENT_BUFFER && length == expected);
    CHECK(guarded.text[0] == 0xcccc && guarded.before == 0xa55a && guarded.after == 0x5aa5);
    length = expected;
    CHECK(query(GetCurrentProcess(), &length, guarded.text) == ERROR_SUCCESS && length == expected);
    CHECK(!wcscmp(guarded.text, value));
    CHECK(guarded.text[expected] == 0xcccc && guarded.before == 0xa55a && guarded.after == 0x5aa5);

    handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
    CHECK(handle != NULL);
    if (handle)
    {
        length = 512;
        CHECK(via_contract(handle, &length, guarded.text) == ERROR_SUCCESS && !wcscmp(guarded.text, value));
        CloseHandle(handle);
    }
    length = 512; guarded.text[0] = 0xcccc;
    CHECK(query(NULL, &length, guarded.text) == ERROR_INVALID_HANDLE);
    CHECK(guarded.text[0] == 0xcccc);
    handle = OpenProcess(SYNCHRONIZE, FALSE, pid);
    CHECK(handle != NULL);
    if (handle)
    {
        length = 512;
        CHECK(query(handle, &length, guarded.text) == ERROR_ACCESS_DENIED);
        CloseHandle(handle);
    }

    GetModuleFileNameW(NULL, image, MAX_PATH);
    swprintf(command, sizeof(command) / sizeof(command[0]), L"\"%ls\" --owned-child", image);
    memset(&child, 0, sizeof(child));
    CHECK(CreateProcessW(image, command, NULL, NULL, FALSE, CREATE_SUSPENDED, NULL, NULL, &startup, &child));
    if (child.hProcess)
    {
        length = 512; guarded.text[0] = 0xcccc;
        CHECK(query(child.hProcess, &length, guarded.text) == ERROR_NOT_SUPPORTED);
        CHECK(guarded.text[0] == 0xcccc && length == 512);
        CHECK(TerminateProcess(child.hProcess, 0));
        CHECK(WaitForSingleObject(child.hProcess, 5000) == WAIT_OBJECT_0);
        CloseHandle(child.hThread); CloseHandle(child.hProcess);
    }
    SetEnvironmentVariableW(L"WINE_UWP_AUMID", saved_len && saved_len < 2048 ? saved : NULL);
    printf("appmodel process identity tests: %ld failures\n", failures);
    return failures ? 1 : 0;
}
