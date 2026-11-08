#include <windows.h>
#include <stdio.h>

#ifndef _WIN64
#error This probe verifies the x64 TEB layout used by the candidate runtime.
#endif

typedef HRESULT (WINAPI *get_id_fn)(ULONG *);
typedef ULONG (WINAPI *ref_fn)(ULONG);

static get_id_fn get_id;
static ref_fn add_ref, release_ref;
static LONG failures;

#define CHECK(x) do { if (!(x)) { InterlockedIncrement(&failures); \
    printf("FAIL line %d: %s\n", __LINE__, #x); } } while (0)

/* Wine's x64 winternl.h and the native caller both locate SubProcessTag here. */
static ULONG_PTR set_tag(ULONG_PTR value)
{
    ULONG_PTR *slot = (ULONG_PTR *)((BYTE *)NtCurrentTeb() + 0x1720);
    ULONG_PTR old = *slot;
    *slot = value;
    return old;
}

struct worker_args { ULONG id, common; };

static DWORD WINAPI worker(void *opaque)
{
    struct worker_args *args = opaque;
    ULONG_PTR previous = set_tag(args->id);
    ULONG id = ~0u, n;
    unsigned int i;

    CHECK(get_id(&id) == S_OK && id == args->id);
    CHECK(add_ref(id) == 1);
    CHECK(release_ref(id) == 0);
    for (i = 0; i < 2000; ++i)
    {
        n = add_ref(args->common);
        CHECK(n >= 1 && n <= 8);
        n = release_ref(args->common);
        CHECK(n < 8);
    }
    set_tag(previous);
    return 0;
}

int main(void)
{
    const char *rpc_names[] = {"CoGetClassObject", "CoMarshalInterface", "CoCreateInstance", "StringFromGUID2"};
    HMODULE module = LoadLibraryW(L"combase.dll");
    struct { ULONG before, id, after; } guarded = {0x11223344, ~0u, 0x55667788};
    struct worker_args args[8];
    HANDLE threads[8];
    ULONG_PTR original;
    ULONG repeated;
    unsigned int i;

    if (!module) { printf("FAIL cannot load combase: %lu\n", GetLastError()); return 2; }
    get_id = (get_id_fn)GetProcAddress(module, (const char *)66);
    add_ref = (ref_fn)GetProcAddress(module, (const char *)67);
    release_ref = (ref_fn)GetProcAddress(module, (const char *)68);
    CHECK(get_id && add_ref && release_ref);
    if (!get_id || !add_ref || !release_ref) return 2;
    CHECK((FARPROC)get_id == GetProcAddress(module, "CoGetSharedServiceId"));
    CHECK((FARPROC)add_ref == GetProcAddress(module, "CoAddRefSharedService"));
    CHECK((FARPROC)release_ref == GetProcAddress(module, "CoReleaseSharedService"));
    for (i = 0; i < sizeof(rpc_names) / sizeof(rpc_names[0]); ++i)
        CHECK(GetProcAddress(module, rpc_names[i]) != NULL);
    CHECK(get_id(NULL) == E_INVALIDARG);

    original = set_tag((ULONG_PTR)0xabcdef1200002001ULL);
    CHECK(get_id(&guarded.id) == S_OK);
    CHECK(guarded.id == 0x2001);
    CHECK(guarded.before == 0x11223344 && guarded.after == 0x55667788);
    CHECK(get_id(&repeated) == S_OK && repeated == guarded.id);
    CHECK(add_ref(guarded.id) == 1);
    CHECK(add_ref(guarded.id) == 2);
    CHECK(release_ref(guarded.id) == 1);
    CHECK(release_ref(guarded.id) == 0);
    CHECK(get_id(&repeated) == S_OK && repeated == guarded.id);
    CHECK(add_ref(repeated) == 1);
    CHECK(release_ref(repeated) == 0);

    set_tag(0x2002);
    CHECK(get_id(&repeated) == S_OK && repeated == 0x2002);
    CHECK(add_ref(repeated) == 1);
    CHECK(add_ref(guarded.id) == 1);
    CHECK(release_ref(repeated) == 0);
    CHECK(release_ref(guarded.id) == 0);
    set_tag(original);
    CHECK(get_id(&repeated) == S_OK && repeated == (ULONG)original);
    CHECK(add_ref(repeated) == 1);
    CHECK(release_ref(repeated) == 0);

    set_tag(0x3000);
    CHECK(get_id(&repeated) == S_OK && repeated == 0x3000);
    for (i = 0; i < 8; ++i)
    {
        args[i].id = 0x3100 + i;
        args[i].common = repeated;
        threads[i] = CreateThread(NULL, 0, worker, &args[i], 0, NULL);
        CHECK(threads[i] != NULL);
        if (!threads[i]) return 2;
    }
    CHECK(WaitForMultipleObjects(8, threads, TRUE, 30000) == WAIT_OBJECT_0);
    for (i = 0; i < 8; ++i) CloseHandle(threads[i]);
    CHECK(add_ref(repeated) == 1);
    CHECK(release_ref(repeated) == 0);
    set_tag(original);
    printf("shared-service ABI tests: %ld failures; 8 threads, 16000 balanced concurrent pairs\n", failures);
    return failures ? 1 : 0;
}
