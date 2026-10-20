/* SPDX-License-Identifier: MIT
 * Independent x64 COM-slot contract for the legacy package IID. Uses only
 * synthetic manifests in a fresh prefix, no SDK binary, account or game. */
#include <windows.h>
#include <stdint.h>
#include <stddef.h>
#include <stdio.h>
#include <string.h>

typedef struct { UINT32 tag; BOOL is_inline; const char *config; } Options;
typedef struct Package { const void *const *vtable; } Package;
typedef struct {
    const char *identifier;
    uint16_t major, minor, build, revision;
    UINT32 kind;
    const char *display, *description, *publisher, *store;
    BYTE installing;
    UINT32 index, count;
    BYTE restricted;
    const char *title;
} Details;
_Static_assert(sizeof(Details) == 80, "x64 package details ABI");
_Static_assert(offsetof(Details, major) == 8 && offsetof(Details, title) == 72, "x64 package field offsets");
typedef BYTE (WINAPI *Visit)(void *, const Details *);
typedef HRESULT (WINAPI *Enumerate)(Package *, UINT32, UINT32, void *, Visit);
typedef HRESULT (WINAPI *Query)(Package *, const GUID *, void **);
typedef ULONG (WINAPI *Ref)(Package *);
typedef HRESULT (WINAPI *Identifier)(Package *, const char *, SIZE_T, char *);
typedef HRESULT (WINAPI *Mount)(Package *, const char *, void **);
typedef HRESULT (WINAPI *Register)(Package *, void *, void *, void *, int64_t *);
typedef HRESULT (WINAPI *Features)(Package *, const char *, void *, void *);
static const GUID package_class = {0xaf406016,0xe850,0x4aa8,{0xa8,0x8d,0x2f,0x3d,0xcb,0x9d,0xac,0x7e}};
static const GUID legacy_iid = {0xbe3f3e9f,0xc4b3,0x424d,{0x9a,0x95,0xd1,0xaf,0x06,0x05,0x59,0xa5}};
static const GUID current_iids[] = {
    {0x3720de07,0xe8e4,0x44a3,{0xad,0x32,0xb3,0x59,0xe8,0xad,0xbe,0x55}},
    {0xf92d8712,0x2b27,0x4d8a,{0xbf,0x01,0x11,0xa6,0xf8,0xe3,0xeb,0x42}},
    {0xe2a4734b,0x2f4a,0x456d,{0xaa,0x8f,0xd0,0x65,0xe0,0x4f,0xb2,0x09}},
    {0x0b9d556e,0xab70,0x43f4,{0xba,0xa0,0x99,0x99,0xac,0x4c,0xb0,0x40}},
};
static const char config[] = "<Game><Identity Name=\"Nexus.Legacy\" Publisher=\"CN=Probe\" Version=\"1.2.3.4\"/>"
    "<StoreId>B00000000001</StoreId><TitleId>DEADBEEF</TitleId>"
    "<ShellVisuals DefaultDisplayName=\"Legacy fixture\"/></Game>";
static const char id[] = "0123456789abcdef0123456789abcdef";
static unsigned checks, failures, visits;
#define CHECK(x) do { ++checks; if (!(x)) { ++failures; printf("FAIL %d: %s\n", __LINE__, #x); } } while (0)

static BYTE WINAPI visit(void *context, const Details *details)
{
    ++visits;
    CHECK(context == &visits);
    CHECK(!strcmp(details->identifier, id));
    CHECK(!strcmp(details->display, "Legacy fixture"));
    CHECK(!strcmp(details->store, "B00000000001"));
    CHECK(!strcmp(details->title, "DEADBEEF"));
    CHECK(details->major == 1 && details->minor == 2 && details->build == 3 && details->revision == 4);
    CHECK(details->kind == 0 && !details->installing && details->index == 0 && details->count == 1);
    return FALSE; /* Caller-stop and callback ABI must be retained. */
}

static BYTE WINAPI feature_visit(void *context, const void *feature)
{
    (void)feature;
    CHECK(context == &visits);
    ++visits;
    return TRUE;
}

static void exercise(Package *package)
{
    const unsigned slots[] = {20, 28, 35, 39};
    unsigned i;
    char buffer[35];
    Identifier identifier = (Identifier)package->vtable[27];
    int64_t token = 123;
    void *mount = (void *)(uintptr_t)1;
    for (i = 0; i < sizeof(slots)/sizeof(slots[0]); ++i) {
        Enumerate enumerate = (Enumerate)package->vtable[slots[i]];
        visits = 0;
        CHECK(enumerate(package, 0, 0, &visits, visit) == S_OK);
        CHECK(visits == 1);
        CHECK(enumerate(package, 0, 0, NULL, NULL) == E_INVALIDARG);
        CHECK(enumerate(package, 99, 0, &visits, visit) == E_INVALIDARG);
        CHECK(enumerate(package, 0, 99, &visits, visit) == E_INVALIDARG);
    }
    memset(buffer, '!', sizeof(buffer));
    CHECK(identifier(package, "B00000000001", 33, buffer + 1) == S_OK);
    CHECK(!memcmp(buffer + 1, id, sizeof(id)) && buffer[0] == '!' && buffer[34] == '!');
    memset(buffer, '!', sizeof(buffer));
    CHECK(identifier(package, "B00000000001", 32, buffer + 1) == HRESULT_FROM_WIN32(ERROR_INSUFFICIENT_BUFFER));
    CHECK(!buffer[1] && buffer[0] == '!' && buffer[33] == '!' && buffer[34] == '!');
    CHECK(identifier(package, "B00000000001", 0, buffer + 1) == HRESULT_FROM_WIN32(ERROR_INSUFFICIENT_BUFFER));
    CHECK(identifier(package, "B00000000002", 33, buffer + 1) == E_INVALIDARG);
    CHECK(identifier(package, NULL, 33, buffer + 1) == E_INVALIDARG);
    CHECK(identifier(package, "B00000000001", 33, NULL) == E_INVALIDARG);
    CHECK(((Mount)package->vtable[23])(package, id, &mount) == E_NOTIMPL && !mount);
    CHECK(((Mount)package->vtable[23])(package, id, NULL) == E_INVALIDARG);
    CHECK(((Register)package->vtable[21])(package, NULL, NULL, (void *)visit, &token) == E_NOTIMPL && !token);
    CHECK(((Register)package->vtable[21])(package, NULL, NULL, NULL, &token) == E_INVALIDARG);
    CHECK(((Features)package->vtable[31])(package, id, NULL, NULL) == E_INVALIDARG);
    visits = 0;
    CHECK(((Features)package->vtable[31])(package, id, &visits, (void *)feature_visit) == S_OK && !visits);
}

static void child(void)
{
    HMODULE dll = LoadLibraryW(L"xgameruntime.dll");
    HRESULT (WINAPI *query)(const GUID *, const GUID *, void **);
    HRESULT (WINAPI *initialize)(ULONG, ULONG, char, const Options *);
    Package *legacy = NULL, *current = NULL;
    Options options = {1, TRUE, config};
    GUID invalid = legacy_iid;
    unsigned i;
    CHECK(dll != NULL); if (!dll) return;
    query = (void *)GetProcAddress(dll, "QueryApiImpl");
    initialize = (void *)GetProcAddress(dll, "InitializeApiImplEx2");
    CHECK(query && initialize); if (!query || !initialize) return;
    CHECK(initialize(0, 0, 0, &options) == S_OK);
    CHECK(query(&package_class, &legacy_iid, (void **)&legacy) == S_OK && legacy);
    for (i = 0; i < sizeof(current_iids)/sizeof(current_iids[0]); ++i) {
        CHECK(query(&package_class, &current_iids[i], (void **)&current) == S_OK && current);
        if (!current) continue;
        CHECK(!legacy || current == legacy);
        if (i == 3) exercise(current);
        ((Ref)current->vtable[2])(current);
    }
    if (legacy) {
        void *out = (void *)(uintptr_t)1;
        ULONG count = ((Ref)legacy->vtable[1])(legacy);
        CHECK(((Ref)legacy->vtable[2])(legacy) + 1 == count);
        invalid.Data4[7] ^= 1;
        CHECK(((Query)legacy->vtable[0])(legacy, &invalid, &out) == E_NOINTERFACE && !out);
        CHECK(((Query)legacy->vtable[0])(legacy, &legacy_iid, NULL) == E_POINTER);
        exercise(legacy);
        ((Ref)legacy->vtable[2])(legacy);
    }
    FreeLibrary(dll);
}

static BOOL write_text(const WCHAR *path, const char *text)
{
    HANDLE file = CreateFileW(path, GENERIC_WRITE, 0, NULL, CREATE_NEW, 0, NULL);
    DWORD written;
    BOOL ok;
    if (file == INVALID_HANDLE_VALUE) return FALSE;
    ok = WriteFile(file, text, strlen(text), &written, NULL) && written == strlen(text);
    CloseHandle(file); return ok;
}

int main(int argc, char **argv)
{
    if (argc == 2 && !strcmp(argv[1], "--child")) child();
    else {
        WCHAR temporary[MAX_PATH], root[MAX_PATH], own[MAX_PATH], exe[MAX_PATH], xml[MAX_PATH], layout[MAX_PATH], command[MAX_PATH + 32];
        STARTUPINFOW startup = {0}; PROCESS_INFORMATION process = {0};
        DWORD code = 1, wait;
        CHECK(GetTempPathW(MAX_PATH, temporary) && GetTempFileNameW(temporary, L"nxl", 0, root));
        if (failures) return 1;
        CHECK(DeleteFileW(root) && CreateDirectoryW(root, NULL));
        CHECK(GetModuleFileNameW(NULL, own, MAX_PATH));
        swprintf(exe, MAX_PATH, L"%ls\\probe.exe", root);
        swprintf(xml, MAX_PATH, L"%ls\\MicrosoftGame.config", root);
        swprintf(layout, MAX_PATH, L"%ls\\layout_01234567-89ab-cdef-0123-456789abcdef.xml", root);
        CHECK(CopyFileW(own, exe, TRUE)); CHECK(write_text(xml, config)); CHECK(write_text(layout, "<Package/>"));
        startup.cb = sizeof(startup); swprintf(command, MAX_PATH + 32, L"\"%ls\" --child", exe);
        CHECK(CreateProcessW(exe, command, NULL, NULL, FALSE, 0, NULL, root, &startup, &process));
        if (process.hProcess) {
            wait = WaitForSingleObject(process.hProcess, 15000); CHECK(wait == WAIT_OBJECT_0);
            if (wait != WAIT_OBJECT_0) { TerminateProcess(process.hProcess, 2); WaitForSingleObject(process.hProcess, 5000); }
            CHECK(GetExitCodeProcess(process.hProcess, &code) && code == 0);
            CloseHandle(process.hThread); CloseHandle(process.hProcess);
        }
        CHECK(DeleteFileW(exe)); CHECK(DeleteFileW(xml)); CHECK(DeleteFileW(layout)); CHECK(RemoveDirectoryW(root));
    }
    printf("CHECKS %u FAILURES %u (legacy package)\n", checks, failures);
    return failures ? 1 : 0;
}
