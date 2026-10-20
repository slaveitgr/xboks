/* SPDX-License-Identifier: MIT
 * XSystem COM ABI and documented unavailable-device-ID contract.
 * Uses no game, account, hardware identifier or network. */
#include <windows.h>
#include <limits.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

typedef struct { const void *const *vtable; } System;
typedef HRESULT (WINAPI *GetId)(System *, INT32, char *, SIZE_T *);
typedef ULONG (WINAPI *Release)(System *);
static const GUID clsid = {0xe349bd1a,0xfc20,0x4e40,{0xb9,0x9c,0x41,0x78,0xcc,0x6b,0x40,0x9f}};
static const GUID iids[] = {
    {0xe349bd1a,0xfc20,0x4e40,{0xb9,0x9c,0x41,0x78,0xcc,0x6b,0x40,0x9f}},
    {0x6fd71f09,0x7513,0x49f0,{0x89,0xbc,0xbf,0xaf,0x5d,0xf6,0xf8,0x52}},
    {0x67ce4bfc,0xb1d1,0x4ac7,{0xbc,0x3a,0xcb,0x92,0x19,0xa9,0x7a,0x85}},
    {0xdadc2895,0x34b0,0x4ef5,{0xa8,0x3e,0x45,0x11,0x4d,0x62,0x9b,0x80}},
    {0x1861cf2e,0xe18b,0x4834,{0xa9,0xf5,0xb4,0xa4,0xe6,0xef,0xb4,0xcf}},
};
static const char unavailable[] = "00000000000000000000000000000000000000000000";
static unsigned checks, failures;
#define CHECK(x) do { ++checks; if (!(x)) { ++failures; printf("FAIL %d: %s\n", __LINE__, #x); } } while (0)
_Static_assert(sizeof(unavailable) == 45, "XSystemAppSpecificDeviceIdBytes");

static void exercise(System *system)
{
    GetId device = (GetId)system->vtable[5];
    char buffer[80], before[80];
    SIZE_T used;
    const INT32 sizes[] = {INT_MIN, -1, 0, 1, 43, 44};
    unsigned i;
    for (i = 0; i < sizeof(sizes)/sizeof(sizes[0]); ++i) {
        memset(buffer, '!', sizeof(buffer)); memcpy(before, buffer, sizeof(buffer)); used = 123;
        CHECK(device(system, sizes[i], buffer + 1, &used) == HRESULT_FROM_WIN32(ERROR_INSUFFICIENT_BUFFER));
        CHECK(!used && !memcmp(buffer, before, sizeof(buffer)));
        CHECK(device(system, sizes[i], buffer + 1, NULL) == HRESULT_FROM_WIN32(ERROR_INSUFFICIENT_BUFFER));
    }
    used = 123;
    CHECK(device(system, 45, NULL, &used) == E_POINTER && !used);
    CHECK(device(system, 0, NULL, NULL) == E_POINTER);
    CHECK(device(system, INT_MAX, NULL, NULL) == E_POINTER);
    memset(buffer, '!', sizeof(buffer)); used = 123;
    CHECK(device(system, 45, buffer + 1, &used) == S_OK);
    CHECK(used == sizeof(unavailable));
    CHECK(!memcmp(buffer + 1, unavailable, sizeof(unavailable)) && buffer[0] == '!' && buffer[46] == '!');
    memset(buffer, '!', sizeof(buffer));
    CHECK(device(system, 78, buffer + 1, NULL) == S_OK);
    CHECK(!memcmp(buffer + 1, unavailable, sizeof(unavailable)) && buffer[0] == '!' && buffer[46] == '!' && buffer[79] == '!');
    memset(buffer, '!', sizeof(buffer)); used = 123;
    CHECK(device(system, INT_MAX, buffer + 1, &used) == S_OK && used == 45);
    CHECK(!memcmp(buffer + 1, unavailable, sizeof(unavailable)) && buffer[46] == '!');
    for (i = 0; i < 32; i++) CHECK(device(system, 45, buffer + 1, NULL) == S_OK && !memcmp(buffer + 1, unavailable, 45));
    used = 0;
    CHECK(((GetId)system->vtable[3])(system, sizeof(buffer), buffer, &used) == S_OK);
    CHECK(used == 39 && !strcmp(buffer, "00000000.00000000.00000000.00000000.00"));
    CHECK(((GetId)system->vtable[4])(system, sizeof(buffer), buffer, &used) == S_OK);
    CHECK(used == 7 && !strcmp(buffer, "RETAIL"));
}

int main(void)
{
    HMODULE dll = LoadLibraryW(L"xgameruntime.dll");
    HRESULT (WINAPI *query)(const GUID *, const GUID *, void **);
    System *system = NULL, *first = NULL;
    unsigned i;
    CHECK(dll != NULL);
    if (!dll) goto done;
    query = (void *)GetProcAddress(dll, "QueryApiImpl");
    CHECK(query != NULL);
    if (!query) goto done;
    for (i = 0; i < sizeof(iids)/sizeof(iids[0]); i++) {
        CHECK(query(&clsid, &iids[i], (void **)&system) == S_OK && system);
        if (!system) continue;
        if (!first) first = system;
        CHECK(first == system);
        exercise(system);
        ((Release)system->vtable[2])(system);
    }
done:
    if (dll) FreeLibrary(dll);
    printf("CHECKS %u FAILURES %u\n", checks, failures);
    return failures ? 1 : 0;
}
