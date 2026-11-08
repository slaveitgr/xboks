/* Independent WinRT weak-reference ABI/lifetime probe for MediaPlayer.
 * No generated playback or weak-reference headers are used. */
#include <windows.h>
#include <stdio.h>
#include <wchar.h>

typedef void *hstring;
typedef struct object { void **vtbl; } object;
typedef HRESULT (WINAPI *qi_fn)(object *, const GUID *, void **);
typedef ULONG (WINAPI *ref_fn)(object *);
typedef HRESULT (WINAPI *out_fn)(object *, object **);
typedef HRESULT (WINAPI *resolve_fn)(object *, const GUID *, object **);
typedef HRESULT (WINAPI *init_fn)(UINT32);
typedef void (WINAPI *uninit_fn)(void);
typedef HRESULT (WINAPI *create_string_fn)(const WCHAR *, UINT32, hstring *);
typedef HRESULT (WINAPI *delete_string_fn)(hstring);
typedef HRESULT (WINAPI *factory_fn)(hstring, const GUID *, object **);
typedef HRESULT (WINAPI *activate_fn)(hstring, object **);

static const GUID unknown_iid = {0,0,0,{0xc0,0,0,0,0,0,0,0x46}};
static const GUID inspectable_iid = {0xaf86e2e0,0xb12d,0x4c6a,{0x9c,0x5a,0xd7,0xaa,0x65,0x10,0x1e,0x90}};
static const GUID activation_iid = {0x35,0,0,{0xc0,0,0,0,0,0,0,0x46}};
static const GUID weak_iid = {0x37,0,0,{0xc0,0,0,0,0,0,0,0x46}};
static const GUID source_iid = {0x38,0,0,{0xc0,0,0,0,0,0,0,0x46}};
static const GUID player_iid = {0x381a83cb,0x6fff,0x499b,{0x8d,0x64,0x28,0x85,0xdf,0xc1,0x24,0x9e}};
static const GUID unsupported_iid = {0xdeaf1234,0x8961,0x4111,{0x90,0x44,0x28,0x85,0x11,0x22,0x33,0x44}};

static unsigned checks, failures;
#define CHECK(expr) do { ++checks; if (!(expr)) { ++failures; printf("FAIL line %u: %s\n", __LINE__, #expr); } } while (0)
#define QI(o,i,p) ((qi_fn)(o)->vtbl[0])((o),(i),(void **)(p))
#define ADDREF(o) ((ref_fn)(o)->vtbl[1])((o))
#define RELEASE(o) ((ref_fn)(o)->vtbl[2])((o))
#define GET_WEAK(o,p) ((out_fn)(o)->vtbl[3])((o),(p))
#define RESOLVE(o,i,p) ((resolve_fn)(o)->vtbl[3])((o),(i),(p))

static init_fn initialize;
static uninit_fn uninitialize;
static activate_fn activate;
static hstring runtime_class;

struct concurrent_context
{
    object *weak;
    HANDLE start;
    volatile LONG stop, live, expired, errors;
};

static DWORD WINAPI resolve_thread(void *param)
{
    struct concurrent_context *ctx = param;
    object *value;
    HRESULT hr = initialize(1);
    if (FAILED(hr)) { InterlockedIncrement(&ctx->errors); return 0; }
    WaitForSingleObject(ctx->start, INFINITE);
    while (!InterlockedCompareExchange(&ctx->stop, 0, 0))
    {
        value = (object *)(ULONG_PTR)1;
        hr = RESOLVE(ctx->weak, &player_iid, &value);
        if (hr != S_OK) InterlockedIncrement(&ctx->errors);
        else if (value)
        {
            InterlockedIncrement(&ctx->live);
            RELEASE(value);
        }
        else InterlockedIncrement(&ctx->expired);
    }
    uninitialize();
    return 0;
}

static void test_lifetime(void)
{
    object *player = NULL, *source = NULL, *weak = NULL, *second = NULL, *identity = NULL, *value = NULL;
    struct { ULONGLONG before; object *value; ULONGLONG after; } guard =
        {0x1122334455667788ull, NULL, 0x8877665544332211ull};
    HRESULT hr;
    CHECK((hr = activate(runtime_class, &player)) == S_OK && player);
    if (FAILED(hr) || !player) return;
    CHECK(QI(player, &player_iid, &identity) == S_OK && identity == player);
    if (identity) RELEASE(identity);
    CHECK(QI(player, &source_iid, NULL) == E_POINTER);
    CHECK(QI(player, &source_iid, &source) == S_OK && source);
    if (!source) { RELEASE(player); return; }
    CHECK(QI(source, &unknown_iid, &identity) == S_OK && identity == player);
    if (identity) RELEASE(identity);
    CHECK(GET_WEAK(source, NULL) == E_POINTER);
    CHECK(GET_WEAK(source, &weak) == S_OK && weak);
    CHECK(GET_WEAK(source, &second) == S_OK && second);
    if (!weak || !second)
    {
        if (weak) RELEASE(weak);
        if (second) RELEASE(second);
        RELEASE(source); RELEASE(player); return;
    }
    CHECK(QI(weak, &unknown_iid, &identity) == S_OK && identity == weak);
    if (identity) RELEASE(identity);
    CHECK(QI(weak, &weak_iid, NULL) == E_POINTER);
    CHECK(RESOLVE(weak, &player_iid, NULL) == E_POINTER);
    CHECK(RESOLVE(weak, &player_iid, &guard.value) == S_OK && guard.value == player);
    CHECK(guard.before == 0x1122334455667788ull && guard.after == 0x8877665544332211ull);
    if (guard.value) RELEASE(guard.value);
    value = (object *)(ULONG_PTR)1;
    CHECK(RESOLVE(weak, &unsupported_iid, &value) == E_NOINTERFACE && !value);
    CHECK(RESOLVE(weak, &source_iid, &value) == S_OK && value == source);
    if (value) RELEASE(value);
    RELEASE(source); /* The source interface is itself a strong reference. */
    CHECK(RELEASE(player) == 0); /* Retained weak handles must not keep the player alive. */
    guard.value = (object *)(ULONG_PTR)1;
    CHECK(RESOLVE(weak, &player_iid, &guard.value) == S_OK && !guard.value);
    CHECK(guard.before == 0x1122334455667788ull && guard.after == 0x8877665544332211ull);
    value = (object *)(ULONG_PTR)1;
    CHECK(RESOLVE(second, &unsupported_iid, &value) == S_OK && !value);
    RELEASE(second);
    RELEASE(weak);
}

static void test_concurrent(void)
{
    struct concurrent_context ctx = {0};
    object *player = NULL, *source = NULL, *value = NULL;
    HANDLE threads[6];
    unsigned i, created = 0;
    DWORD start;
    CHECK(activate(runtime_class, &player) == S_OK && player);
    if (!player) return;
    CHECK(QI(player, &source_iid, &source) == S_OK && source);
    if (!source) { RELEASE(player); return; }
    CHECK(GET_WEAK(source, &ctx.weak) == S_OK && ctx.weak);
    RELEASE(source);
    if (!ctx.weak) { RELEASE(player); return; }
    ctx.start = CreateEventW(NULL, TRUE, FALSE, NULL);
    CHECK(ctx.start != NULL);
    if (!ctx.start) { RELEASE(player); RELEASE(ctx.weak); return; }
    for (i = 0; i < 6; ++i)
    {
        threads[i] = CreateThread(NULL, 0, resolve_thread, &ctx, 0, NULL);
        CHECK(threads[i] != NULL);
        if (!threads[i]) break;
        ++created;
    }
    SetEvent(ctx.start);
    start = GetTickCount();
    while (InterlockedCompareExchange(&ctx.live, 0, 0) < 100 && GetTickCount() - start < 5000) Sleep(1);
    CHECK(ctx.live > 0);
    RELEASE(player); /* Race the last original strong release against active Resolve calls. */
    Sleep(100);
    InterlockedExchange(&ctx.stop, 1);
    if (created)
    {
        DWORD waited = WaitForMultipleObjects(created, threads, TRUE, 10000);
        CHECK(waited == WAIT_OBJECT_0);
        if (waited != WAIT_OBJECT_0) ExitProcess(1); /* Do not free a worker's live context on failure. */
    }
    for (i = 0; i < created; ++i) CloseHandle(threads[i]);
    CHECK(ctx.errors == 0);
    value = (object *)(ULONG_PTR)1;
    CHECK(RESOLVE(ctx.weak, &inspectable_iid, &value) == S_OK && !value);
    printf("concurrent weak Resolve: %ld live, %ld expired, %ld errors across %u threads\n",
           ctx.live, ctx.expired, ctx.errors, created);
    RELEASE(ctx.weak);
    CloseHandle(ctx.start);
}

int main(void)
{
    HMODULE combase = LoadLibraryW(L"combase.dll");
    create_string_fn create_string;
    delete_string_fn delete_string;
    factory_fn get_factory;
    object *factory = NULL;
    HRESULT hr;
    CHECK(combase != NULL);
    if (!combase) return 1;
    initialize = (init_fn)GetProcAddress(combase, "RoInitialize");
    uninitialize = (uninit_fn)GetProcAddress(combase, "RoUninitialize");
    create_string = (create_string_fn)GetProcAddress(combase, "WindowsCreateString");
    delete_string = (delete_string_fn)GetProcAddress(combase, "WindowsDeleteString");
    activate = (activate_fn)GetProcAddress(combase, "RoActivateInstance");
    get_factory = (factory_fn)GetProcAddress(combase, "RoGetActivationFactory");
    CHECK(initialize && uninitialize && create_string && delete_string && activate && get_factory);
    if (!initialize || !uninitialize || !create_string || !delete_string || !activate || !get_factory) return 1;
    CHECK(SUCCEEDED(hr = initialize(1)));
    if (FAILED(hr)) return 1;
    CHECK(create_string(L"Windows.Media.Playback.MediaPlayer", 34, &runtime_class) == S_OK);
    CHECK(get_factory(runtime_class, &activation_iid, &factory) == S_OK && factory);
    if (factory)
    {
        CHECK(((out_fn)factory->vtbl[6])(factory, NULL) == E_POINTER);
        RELEASE(factory);
    }
    test_lifetime();
    test_concurrent();
    delete_string(runtime_class);
    uninitialize();
    printf("MediaPlayer weak-reference raw ABI: %u checks, %u failures\n", checks, failures);
    return failures ? 1 : 0;
}
