/* Independent raw-ABI probe of the registered CoreWindow broker and native AppInstance.
 * Run in a dedicated test prefix with the candidate installed. No account or app launch is used.
 * Each invocation is a separate process: launch, protocol, race-launch, race-protocol,
 * invalid-uri, or uri-file-conflict. The race modes query startup concurrently from STA/MTA. */
#include <windows.h>
#include <stdio.h>
#include <wchar.h>
#include <string.h>

typedef struct object { void **vtbl; } object;
typedef void *hstring;
typedef HRESULT (WINAPI *qi_fn)(object *, const GUID *, void **);
typedef ULONG (WINAPI *ref_fn)(object *);
typedef HRESULT (WINAPI *out_fn)(object *, object **);
typedef HRESULT (WINAPI *int_fn)(object *, INT32 *);
typedef HRESULT (WINAPI *service_fn)(object *, const GUID *, const GUID *, object **);
typedef HRESULT (WINAPI *register_fn)(object *, const WCHAR *, DWORD *);
typedef HRESULT (WINAPI *noarg_fn)(object *);
typedef HRESULT (WINAPI *redirect_fn)(object *, const WCHAR *);
typedef HRESULT (WINAPI *keys_fn)(object *, ULONG *, WCHAR ***);
typedef HRESULT (WINAPI *initialize_fn)(UINT32);
typedef void (WINAPI *uninitialize_fn)(void);
typedef HRESULT (WINAPI *create_string_fn)(const WCHAR *, UINT32, hstring *);
typedef HRESULT (WINAPI *delete_string_fn)(hstring);
typedef const WCHAR *(WINAPI *raw_string_fn)(hstring, UINT32 *);
typedef HRESULT (WINAPI *activation_factory_fn)(hstring, const GUID *, object **);
typedef HRESULT (WINAPI *co_create_fn)(const GUID *, object *, DWORD, const GUID *, object **);
typedef HRESULT (WINAPI *hstring_out_fn)(object *, hstring *);
typedef HRESULT (WINAPI *apartment_type_fn)(INT32 *, INT32 *);

static const GUID core_class = {0x3480a401,0xbde9,0x4407,{0xbc,0x02,0x79,0x8a,0x86,0x6a,0xc0,0x51}};
static const GUID core_iid = {0x0f4accb1,0xd8f9,0x4011,{0xba,0x37,0x25,0x57,0x92,0x5a,0x78,0xcf}};
static const GUID instance_iid = {0x4c79fb19,0xe2a8,0x4f1a,{0xb4,0x77,0xad,0x6e,0x7b,0x0b,0xcc,0xc9}};
static const GUID unknown_iid = {0,0,0,{0xc0,0,0,0,0,0,0,0x46}};
static const GUID inspectable_iid = {0xaf86e2e0,0xb12d,0x4c6a,{0x9c,0x5a,0xd7,0xaa,0x65,0x10,0x1e,0x90}};
static const GUID activated_iid = {0xcf651713,0xcd08,0x4fd8,{0xb6,0x97,0xa2,0x81,0xb6,0x54,0x4e,0x2e}};
static const GUID launch_iid = {0xfbc93e26,0xa14a,0x4b4f,{0x82,0xb0,0x33,0xbe,0xd9,0x20,0xaf,0x52}};
static const GUID protocol_iid = {0x6095f4dd,0xb7c0,0x46ab,{0x81,0xfe,0xd9,0x0f,0x36,0xd0,0x0d,0x24}};
static const GUID uri_iid = {0x9e365e57,0x48b2,0x4160,{0x95,0x6f,0xc7,0x38,0x51,0x20,0xbb,0xfc}};
static const GUID appinstance_statics_iid = {0x9d11e77f,0x9ea6,0x47af,{0xa6,0xec,0x46,0x78,0x4c,0x5b,0xa2,0x54}};
static const GUID unsupported_iid = {0xdeaf1234,0x8961,0x4111,{0x90,0x44,0x28,0x85,0x11,0x22,0x33,0x44}};

static unsigned checks, failures;
#define CHECK(expr) do { ++checks; if (!(expr)) { ++failures; printf("FAIL line %u: %s\n", __LINE__, #expr); } } while (0)
#define QI(o,i,p) ((qi_fn)(o)->vtbl[0])((o),(i),(void **)(p))
#define RELEASE(o) ((ref_fn)(o)->vtbl[2])((o))
#define GET_ARGS(o,p) ((out_fn)(o)->vtbl[5])((o),(p))
#define GET_INT(o,n,p) ((int_fn)(o)->vtbl[n])((o),(p))
#define SERVICE(o,s,i,p) ((service_fn)(o)->vtbl[3])((o),(s),(i),(p))

static initialize_fn initialize;
static uninitialize_fn uninitialize;
static create_string_fn create_string;
static delete_string_fn delete_string;
static raw_string_fn raw_string;
static activation_factory_fn activation_factory;
static co_create_fn co_create;
static apartment_type_fn apartment_type;

struct race_shared
{
    HANDLE start, ready;
    volatile LONG prepared;
};
struct race_context
{
    struct race_shared *shared;
    UINT32 init_type;
    HRESULT init_hr, apartment_hr, create_hr, service_hr, args_hr, repeat_hr;
    INT32 apartment, qualifier;
    DWORD wait_result;
    object *args, *again;
};

static DWORD WINAPI race_get_initial_args(void *parameter)
{
    struct race_context *ctx = parameter;
    object *core = NULL, *broker = NULL;

    ctx->init_hr = initialize(ctx->init_type);
    if (SUCCEEDED(ctx->init_hr))
    {
        ctx->apartment_hr = apartment_type(&ctx->apartment, &ctx->qualifier);
        ctx->create_hr = co_create(&core_class, NULL, 0x404, &core_iid, &core);
        if (SUCCEEDED(ctx->create_hr) && core)
            ctx->service_hr = SERVICE(core, &instance_iid, &instance_iid, &broker);
    }
    if (InterlockedIncrement(&ctx->shared->prepared) == 2) SetEvent(ctx->shared->ready);
    ctx->wait_result = WaitForSingleObject(ctx->shared->start, 15000);
    if (ctx->wait_result == WAIT_OBJECT_0 && broker)
    {
        ctx->args_hr = GET_ARGS(broker, &ctx->args);
        ctx->repeat_hr = GET_ARGS(broker, &ctx->again);
    }
    if (broker) RELEASE(broker);
    if (core) RELEASE(core);
    if (SUCCEEDED(ctx->init_hr)) uninitialize();
    return 0;
}

static void test_concurrent_initial_args(void)
{
    struct race_shared shared = {0};
    struct race_context contexts[2] = {0};
    HANDLE threads[2] = {NULL, NULL};
    DWORD ready_result, join_result;
    unsigned i;

    shared.start = CreateEventW(NULL, TRUE, FALSE, NULL);
    shared.ready = CreateEventW(NULL, TRUE, FALSE, NULL);
    CHECK(shared.start && shared.ready);
    if (!shared.start || !shared.ready) goto close;
    for (i = 0; i < 2; ++i)
    {
        contexts[i].shared = &shared;
        contexts[i].init_type = i; /* RO_INIT_SINGLETHREADED=0; RO_INIT_MULTITHREADED=1. */
        contexts[i].apartment = -1;
        contexts[i].init_hr = contexts[i].apartment_hr = contexts[i].create_hr = E_PENDING;
        contexts[i].service_hr = contexts[i].args_hr = contexts[i].repeat_hr = E_PENDING;
        threads[i] = CreateThread(NULL, 0, race_get_initial_args, &contexts[i], 0, NULL);
        CHECK(threads[i] != NULL);
    }
    if (!threads[0] || !threads[1])
    {
        SetEvent(shared.start);
        for (i = 0; i < 2; ++i)
            if (threads[i] && WaitForSingleObject(threads[i], 20000) != WAIT_OBJECT_0) ExitProcess(3);
        goto release_args;
    }
    ready_result = WaitForSingleObject(shared.ready, 15000);
    CHECK(ready_result == WAIT_OBJECT_0);
    SetEvent(shared.start);
    join_result = WaitForMultipleObjects(2, threads, TRUE, 20000);
    CHECK(join_result == WAIT_OBJECT_0);
    /* Exit only this probe process on a stuck COM call; never leave stack-backed contexts live. */
    if (join_result != WAIT_OBJECT_0) ExitProcess(3);
    for (i = 0; i < 2; ++i)
    {
        CHECK(SUCCEEDED(contexts[i].init_hr));
        CHECK(contexts[i].apartment_hr == S_OK);
        CHECK(i ? contexts[i].apartment == 1 :
              contexts[i].apartment == 0 || contexts[i].apartment == 3); /* MTA vs STA/MAINSTA. */
        CHECK(contexts[i].create_hr == S_OK);
        CHECK(contexts[i].service_hr == S_OK);
        CHECK(contexts[i].wait_result == WAIT_OBJECT_0);
        CHECK(contexts[i].args_hr == S_OK && contexts[i].args);
        CHECK(contexts[i].repeat_hr == S_OK && contexts[i].again == contexts[i].args);
    }
    CHECK(contexts[0].args && contexts[0].args == contexts[1].args);
release_args:
    for (i = 0; i < 2; ++i)
    {
        if (contexts[i].again) RELEASE(contexts[i].again);
        if (contexts[i].args) RELEASE(contexts[i].args);
        if (threads[i]) CloseHandle(threads[i]);
    }
close:
    if (shared.ready) CloseHandle(shared.ready);
    if (shared.start) CloseHandle(shared.start);
}

static void test_native_args(object *expected, BOOL expect_failure)
{
    object *statics = NULL;
    struct { ULONGLONG before; object *value; ULONGLONG after; } guard =
        {0x1122334455667788ull, (object *)(ULONG_PTR)1, 0x8877665544332211ull};
    hstring name = NULL;
    HRESULT hr;

    CHECK(create_string(L"Windows.ApplicationModel.AppInstance", 36, &name) == S_OK);
    if (!name) return;
    CHECK(activation_factory(name, &appinstance_statics_iid, &statics) == S_OK && statics);
    if (statics)
    {
        /* IAppInstanceStatics::GetActivatedEventArgs is slot7, after RecommendedInstance. */
        hr = ((out_fn)statics->vtbl[7])(statics, &guard.value);
        CHECK(guard.before == 0x1122334455667788ull && guard.after == 0x8877665544332211ull);
        if (expect_failure) CHECK(FAILED(hr) && guard.value == NULL);
        else CHECK(hr == S_OK && guard.value == expected);
        if (SUCCEEDED(hr) && guard.value && guard.value != (object *)(ULONG_PTR)1) RELEASE(guard.value);
        RELEASE(statics);
    }
    delete_string(name);
}

static void test_failed_initial_args(object *broker)
{
    struct { ULONGLONG before; object *value; ULONGLONG after; } guard =
        {0x1122334455667788ull, (object *)(ULONG_PTR)1, 0x8877665544332211ull};
    HRESULT hr;

    hr = GET_ARGS(broker, &guard.value);
    CHECK(FAILED(hr) && guard.value == NULL);
    CHECK(guard.before == 0x1122334455667788ull && guard.after == 0x8877665544332211ull);
    guard.value = (object *)(ULONG_PTR)1;
    hr = GET_ARGS(broker, &guard.value);
    CHECK(FAILED(hr) && guard.value == NULL);
    test_native_args(NULL, TRUE);
    /* Failed construction must not publish a partial startup snapshot. Recover in this process. */
    CHECK(SetEnvironmentVariableW(L"WINE_UWP_ACTIVATE_URI", NULL));
    CHECK(SetEnvironmentVariableW(L"WINE_UWP_ACTIVATE_FILE", NULL));
}

static void test_args(object *args, BOOL protocol)
{
    object *activated = NULL, *view = NULL, *uri = NULL, *typed_uri = NULL, *identity = NULL;
    INT32 value = -1;
    hstring absolute = NULL;
    const WCHAR *text;

    CHECK(QI(args, &activated_iid, &activated) == S_OK && activated);
    if (!activated) return;
    CHECK(QI(activated, &unknown_iid, &identity) == S_OK && identity == args);
    if (identity) RELEASE(identity);
    CHECK(GET_INT(activated, 6, NULL) == E_POINTER);
    CHECK(GET_INT(activated, 7, NULL) == E_POINTER);
    CHECK(GET_INT(activated, 6, &value) == S_OK && value == (protocol ? 4 : 0));
    value = -1;
    CHECK(GET_INT(activated, 7, &value) == S_OK && value == 0);
    CHECK(QI(activated, &activated_iid, NULL) == E_POINTER);
    view = (object *)(ULONG_PTR)1;
    CHECK(QI(activated, &unsupported_iid, &view) == E_NOINTERFACE && !view);
    if (protocol)
    {
        CHECK(QI(activated, &launch_iid, &view) == E_NOINTERFACE && !view);
        CHECK(QI(activated, &protocol_iid, &view) == S_OK && view);
        if (view)
        {
            CHECK(((out_fn)view->vtbl[6])(view, NULL) == E_POINTER);
            CHECK(((out_fn)view->vtbl[6])(view, &uri) == S_OK && uri);
            if (uri)
            {
                CHECK(QI(uri, &uri_iid, &typed_uri) == S_OK && typed_uri);
                if (typed_uri)
                {
                    CHECK(((hstring_out_fn)typed_uri->vtbl[6])(typed_uri, &absolute) == S_OK && absolute);
                    if (absolute)
                    {
                        text = raw_string(absolute, NULL);
                        CHECK(text && !wcscmp(text, L"msxbox://config/?XboxPcAppCE=1"));
                        delete_string(absolute);
                    }
                    RELEASE(typed_uri);
                }
                RELEASE(uri);
            }
            RELEASE(view);
        }
    }
    else
    {
        CHECK(QI(activated, &protocol_iid, &view) == E_NOINTERFACE && !view);
        CHECK(QI(activated, &launch_iid, &view) == S_OK && view);
        if (view) RELEASE(view);
    }
    RELEASE(activated);
}

int main(int argc, char **argv)
{
    HMODULE combase = LoadLibraryW(L"combase.dll"), ole32 = LoadLibraryW(L"ole32.dll");
    object *core = NULL, *broker = NULL, *args = NULL, *again = NULL, *identity = NULL, *value = NULL;
    ULONG count;
    WCHAR **keys;
    DWORD status;
    HRESULT hr;
    const char *mode = argc > 1 ? argv[1] : "launch";
    BOOL protocol = !strcmp(mode, "protocol") || !strcmp(mode, "race-protocol");
    BOOL concurrent = !strcmp(mode, "race-launch") || !strcmp(mode, "race-protocol");
    BOOL invalid_uri = !strcmp(mode, "invalid-uri");
    BOOL uri_file_conflict = !strcmp(mode, "uri-file-conflict");

    initialize = (initialize_fn)GetProcAddress(combase, "RoInitialize");
    uninitialize = (uninitialize_fn)GetProcAddress(combase, "RoUninitialize");
    create_string = (create_string_fn)GetProcAddress(combase, "WindowsCreateString");
    delete_string = (delete_string_fn)GetProcAddress(combase, "WindowsDeleteString");
    raw_string = (raw_string_fn)GetProcAddress(combase, "WindowsGetStringRawBuffer");
    activation_factory = (activation_factory_fn)GetProcAddress(combase, "RoGetActivationFactory");
    co_create = (co_create_fn)GetProcAddress(ole32, "CoCreateInstance");
    apartment_type = (apartment_type_fn)GetProcAddress(ole32, "CoGetApartmentType");
    if (!initialize || !uninitialize || !create_string || !delete_string || !raw_string || !activation_factory || !co_create || !apartment_type)
        return 2;
    if (strcmp(mode, "launch") && !protocol && !concurrent && !invalid_uri && !uri_file_conflict) return 2;
    CHECK(SetEnvironmentVariableW(L"WINE_UWP_ACTIVATE_FILE", NULL));
    CHECK(SetEnvironmentVariableW(L"WINE_UWP_ACTIVATE_URI", invalid_uri ? L"not a URI" :
          protocol || uri_file_conflict ? L"msxbox://config/?XboxPcAppCE=1" : NULL));
    if (uri_file_conflict)
        CHECK(SetEnvironmentVariableW(L"WINE_UWP_ACTIVATE_FILE", L"C:\\activation-probe.txt"));
    hr = initialize(1);
    CHECK(SUCCEEDED(hr));
    if (FAILED(hr)) goto done;
    hr = co_create(&core_class, NULL, 0x404, &core_iid, &core);
    CHECK(hr == S_OK && core);
    if (!core) goto uninit;
    CHECK(SERVICE(core, &instance_iid, &instance_iid, NULL) == E_POINTER);
    value = (object *)(ULONG_PTR)1;
    CHECK(SERVICE(core, &unsupported_iid, &instance_iid, &value) == E_NOINTERFACE && !value);
    value = (object *)(ULONG_PTR)1;
    CHECK(SERVICE(core, &instance_iid, &unsupported_iid, &value) == E_NOINTERFACE && !value);
    CHECK(SERVICE(core, &instance_iid, &instance_iid, &broker) == S_OK && broker);
    if (!broker) goto release_core;
    CHECK(QI(broker, &unknown_iid, &identity) == S_OK && identity == broker);
    if (identity) RELEASE(identity);
    CHECK(QI(broker, &unknown_iid, NULL) == E_POINTER);
    value = (object *)(ULONG_PTR)1;
    CHECK(QI(broker, &inspectable_iid, &value) == E_NOINTERFACE && !value);
    CHECK(GET_ARGS(broker, NULL) == E_POINTER);
    if (invalid_uri || uri_file_conflict) test_failed_initial_args(broker);
    if (concurrent) test_concurrent_initial_args();
    CHECK(GET_ARGS(broker, &args) == S_OK && args);
    if (args)
    {
        test_args(args, protocol);
        CHECK(SetEnvironmentVariableW(L"WINE_UWP_ACTIVATE_URI", L"msxbox://different/"));
        CHECK(GET_ARGS(broker, &again) == S_OK && again == args);
        if (again) RELEASE(again);
        test_native_args(args, FALSE);
        RELEASE(args);
    }
    status = 0xdeadbeef;
    CHECK(((register_fn)broker->vtbl[3])(broker, L"probe-key", &status) == E_NOTIMPL && status == 0);
    CHECK(((register_fn)broker->vtbl[3])(broker, L"probe-key", NULL) == E_POINTER);
    CHECK(((noarg_fn)broker->vtbl[4])(broker) == E_NOTIMPL);
    CHECK(((redirect_fn)broker->vtbl[6])(broker, L"probe-key") == E_NOTIMPL);
    count = 99; keys = (WCHAR **)(ULONG_PTR)1;
    CHECK(((keys_fn)broker->vtbl[7])(broker, &count, &keys) == E_NOTIMPL && count == 0 && !keys);
    keys = (WCHAR **)(ULONG_PTR)1;
    CHECK(((keys_fn)broker->vtbl[7])(broker, NULL, &keys) == E_POINTER && !keys);
    RELEASE(broker);
release_core:
    RELEASE(core);
uninit:
    uninitialize();
done:
    printf("ACTIVATION_BROKER_TESTS mode=%s checks=%u failures=%u\n", mode, checks, failures);
    return failures ? 1 : 0;
}
