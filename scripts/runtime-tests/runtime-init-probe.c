/* SPDX-License-Identifier: MIT
 * Account-free GDK configuration bootstrap contract. Separate process per case.
 */
#include <windows.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
typedef struct { UINT32 tag; BOOL isInline; const char *gameConfig; } Options;
typedef struct Storage Storage;
typedef struct {
    HRESULT (WINAPI *query)(Storage *, const GUID *, void **);
    ULONG (WINAPI *addref)(Storage *);
    ULONG (WINAPI *release)(Storage *);
    HRESULT (WINAPI *size)(Storage *, size_t *);
    HRESULT (WINAPI *path)(Storage *, size_t, char *, size_t *);
} Vtable;
struct Storage { const Vtable *vtable; };
static const GUID storageId = {0xf4faf4d4,0x2d04,0x4fce,{0xb3,0xe0,0x47,0x4a,0x71,0x3a,0x3e,0x84}};
static unsigned checks, failures;
#define CHECK(test) do { ++checks; if (!(test)) { ++failures; printf("FAIL %d: %s\n", __LINE__, #test); } } while (0)
int main(int argc, char **argv)
{
    HMODULE dll = LoadLibraryW(L"xgameruntime.dll");
    CHECK(dll != NULL);
    if (!dll) return 1;
    HRESULT (WINAPI *initialize)(ULONG, ULONG, char, const Options *) = (void *)GetProcAddress(dll, "InitializeApiImplEx2");
    HRESULT (WINAPI *query)(const GUID *, const GUID *, void **) = (void *)GetProcAddress(dll, "QueryApiImpl");
    CHECK(initialize && query);
    if (!initialize || !query) return 1;
    const char *xml = "<Game><!-- example -> <Identity Name=\"Wrong.Example\" Publisher=\"CN=Wrong\"/>"
        "<MSAAppId>wrong</MSAAppId><TitleId>0000</TitleId><StoreId>000000000000</StoreId> -->"
        "<Identity Name=\"Nexus.Init.Inline\" Publisher=\"CN=NexusProbe\"/><TitleId>1234</TitleId></Game>";
    Options options = {1, TRUE, xml};
    if (argc > 1 && !strcmp(argv[1], "retry")) {
        Options bad = {1, TRUE, "<invalid>"};
        CHECK(initialize(0, 0, 0, &bad) == (HRESULT)0x8924010b);
    } else if (argc > 1 && !strcmp(argv[1], "default")) {
        options.isInline = FALSE; options.gameConfig = NULL;
    }
    CHECK(initialize(0, 0, 0, &options) == S_OK);
    Storage *storage = NULL;
    CHECK(query(&storageId, &storageId, (void **)&storage) == S_OK && storage != NULL);
    if (storage) {
        char path[1024];
        CHECK(storage->vtable->path(storage, sizeof(path), path, NULL) == S_OK);
        CHECK(strstr(path, "Nexus.Init.Inline_") != NULL);
        storage->vtable->release(storage);
    }
    printf("CHECKS %u FAILURES %u\n", checks, failures);
    return failures ? 1 : 0;
}
