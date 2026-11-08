/* Raw public gamingexperience.h ABI probe. No accounts, game files or Shell APIs.
 * Header contract pinned by the adjacent investigation; no candidate implementation included.
 * fixture mode is driven only by run-private-fixture.py on an isolated session bus.
 */
#include <windows.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef BOOL (WINAPI *query_fn)(void);
typedef HRESULT (WINAPI *set_fn)(BOOL);
typedef void (CALLBACK *callback_fn)(void *);
typedef HRESULT (WINAPI *register_fn)(callback_fn, void *, void **);
typedef void (WINAPI *unregister_fn)(void *);
static query_fn supported, active, can_set;
static set_fn set_mode;
static register_fn register_change;
static unregister_fn unregister_change;
static LONG checks, failures;
static LONG null_context_count;
#define CHECK(expr) do { InterlockedIncrement(&checks); if (!(expr)) { InterlockedIncrement(&failures); printf("FAIL line=%u expression=%s\n", __LINE__, #expr); fflush(stdout); } } while (0)
static void CALLBACK changed_without_context(void *context)
{
    if (context) InterlockedIncrement(&failures);
    InterlockedIncrement(&null_context_count);
}

struct callback_state {
    LONG count, errors, reenter, self_remove, block;
    void *registration;
    HANDLE entered, release;
};
static void CALLBACK changed(void *context)
{
    struct callback_state *state = context;
    BOOL now = active();
    (void)can_set();
    if (state->reenter && FAILED(set_mode(now))) InterlockedIncrement(&state->errors);
    if (state->self_remove) unregister_change(state->registration);
    InterlockedIncrement(&state->count);
    if (state->entered) SetEvent(state->entered);
    if (state->block && WaitForSingleObject(state->release, 5000) != WAIT_OBJECT_0)
        InterlockedIncrement(&state->errors);
}
static void fixture(const char *action)
{
    char response[80];
    printf("FIXTURE_REQUEST %s\n", action);
    fflush(stdout);
    if (!fgets(response, sizeof(response), stdin) || strcmp(response, "OK\n")) {
        fputs("FIXTURE_CONTROL_FAILED\n", stdout);
        fflush(stdout);
        ExitProcess(3);
    }
}
static BOOL wait_query(query_fn function, BOOL expected, DWORD timeout)
{
    DWORD start = GetTickCount();
    do {
        if (!!function() == !!expected) return TRUE;
        Sleep(20);
    } while (GetTickCount() - start < timeout);
    return FALSE;
}
static BOOL wait_count(struct callback_state *state, LONG expected, DWORD timeout)
{
    DWORD start = GetTickCount();
    while (InterlockedCompareExchange(&state->count, 0, 0) < expected) {
        if (GetTickCount() - start >= timeout) return FALSE;
        Sleep(10);
    }
    return TRUE;
}
static void test_exports(void)
{
    static const struct { const char *name; WORD ordinal; } exports[] = {
        {"CanSetGamingFullScreenExperience",1},
        {"IsGamingFullScreenExperienceActive",4},
        {"IsGamingFullScreenExperienceSupported",5},
        {"RegisterGamingFullScreenExperienceChangeNotification",11},
        {"SetGamingFullScreenExperience",13},
        {"UnregisterGamingFullScreenExperienceChangeNotification",14}
    };
    HMODULE module = LoadLibraryW(L"gamemode.dll");
    HMODULE apiset = LoadLibraryW(L"api-ms-win-gaming-experience-l1-1-0.dll");
    unsigned i;
    CHECK(sizeof(BOOL) == 4 && sizeof(HRESULT) == 4 && sizeof(void *) == 8);
    CHECK(module != NULL);
    CHECK(apiset != NULL);
    if (!module) ExitProcess(2);
    for (i = 0; i < sizeof(exports)/sizeof(exports[0]); ++i) {
        FARPROC named = GetProcAddress(module, exports[i].name);
        FARPROC ordinal = GetProcAddress(module, (const char *)(ULONG_PTR)exports[i].ordinal);
        CHECK(named != NULL && named == ordinal);
        if (apiset) CHECK(GetProcAddress(apiset, exports[i].name) == named);
    }
    can_set = (query_fn)GetProcAddress(module, exports[0].name);
    active = (query_fn)GetProcAddress(module, exports[1].name);
    supported = (query_fn)GetProcAddress(module, exports[2].name);
    register_change = (register_fn)GetProcAddress(module, exports[3].name);
    set_mode = (set_fn)GetProcAddress(module, exports[4].name);
    unregister_change = (unregister_fn)GetProcAddress(module, exports[5].name);
    if (!can_set || !active || !supported || !register_change || !set_mode || !unregister_change) ExitProcess(2);
    /* Intentionally keep module loaded while asynchronous callbacks may run. */
}
static void test_invalid_registration(void)
{
    struct callback_state state = {0};
    void *handle = (void *)(ULONG_PTR)0xdeadbeef;
    CHECK(FAILED(register_change(NULL, NULL, &handle)) && handle == NULL);
    CHECK(FAILED(register_change(changed, &state, NULL)));
    unregister_change(NULL);
    unregister_change((void *)(ULONG_PTR)1);
    unregister_change((void *)(ULONG_PTR)0xdeadbeef);
    CHECK(TRUE); /* Invalid opaque handles must return without dereferencing arbitrary memory. */
}
static void test_unavailable(void)
{
    struct callback_state state = {0};
    void *handle = (void *)(ULONG_PTR)0xdeadbeef;
    CHECK(!supported());
    CHECK(!active());
    CHECK(!can_set());
    CHECK(FAILED(set_mode(TRUE)));
    CHECK(FAILED(set_mode(FALSE)));
    CHECK(FAILED(register_change(changed, &state, &handle)) && !handle);
    Sleep(150);
    CHECK(state.count == 0 && !active());
}
struct operation {
    HANDLE done;
    void *registration;
    BOOL enabled;
    HRESULT result;
};
static DWORD WINAPI do_set(void *context)
{
    struct operation *operation = context;
    operation->result = set_mode(operation->enabled);
    SetEvent(operation->done);
    return 0;
}
static DWORD WINAPI do_unregister(void *context)
{
    struct operation *operation = context;
    unregister_change(operation->registration);
    SetEvent(operation->done);
    return 0;
}
static void finish_thread(HANDLE thread, HANDLE event)
{
    if (WaitForSingleObject(event, 7000) != WAIT_OBJECT_0) {
        CHECK(FALSE);
        fputs("THREAD_DID_NOT_COMPLETE\n", stdout);
        fflush(stdout);
        ExitProcess(4); /* Do not return into a freed stack callback context. */
    }
    CHECK(WaitForSingleObject(thread, 2000) == WAIT_OBJECT_0);
    CloseHandle(thread);
    CloseHandle(event);
}
static void test_fixture(void)
{
    struct callback_state state = {0}, self = {0}, block = {0};
    struct operation operation = {0};
    HANDLE thread;
    void *null_context_registration = NULL;
    LONG count;
    unsigned i;
    CHECK(wait_query(supported, TRUE, 5000));
    CHECK(!active() && can_set());
    CHECK(register_change(changed_without_context, NULL, &null_context_registration) == S_OK && null_context_registration);
    unregister_change(null_context_registration);
    CHECK(null_context_count == 0);
    CHECK(register_change(changed, &state, &state.registration) == S_OK && state.registration);
    Sleep(200);
    CHECK(state.count == 0); /* Register/query cannot fabricate a state transition. */
    state.reenter = 1;
    CHECK(set_mode(TRUE) == S_OK);
    CHECK(wait_query(active, TRUE, 2000));
    CHECK(wait_count(&state, 1, 5000));
    CHECK(state.errors == 0);
    count = state.count;
    CHECK(set_mode(TRUE) == S_OK);
    Sleep(200);
    CHECK(state.count == count); /* Idempotent entry is not a new transition. */
    CHECK(set_mode(FALSE) == S_OK);
    CHECK(wait_query(active, FALSE, 2000));
    CHECK(wait_count(&state, count + 1, 5000));
    unregister_change(state.registration);
    count = state.count;
    fixture("force-other-active");
    CHECK(wait_query(active, TRUE, 3000));
    CHECK(!can_set());
    CHECK(FAILED(set_mode(FALSE))); /* Cannot release another sender's lease. */
    CHECK(active());
    Sleep(300);
    CHECK(state.count == count);
    fixture("emergency-exit");
    CHECK(wait_query(active, FALSE, 3000));
    fixture("deny");
    CHECK(!can_set() && supported());
    CHECK(FAILED(set_mode(TRUE)) && !active());
    fixture("allow");
    CHECK(can_set());

    self.self_remove = 1;
    self.reenter = 1;
    CHECK(register_change(changed, &self, &self.registration) == S_OK && self.registration);
    CHECK(set_mode(TRUE) == S_OK);
    CHECK(wait_count(&self, 1, 5000));
    CHECK(self.errors == 0);
    CHECK(set_mode(FALSE) == S_OK);
    Sleep(300);
    CHECK(self.count == 1);
    unregister_change(self.registration); /* Already removed handle is safe. */

    block.block = 1;
    block.entered = CreateEventW(NULL, TRUE, FALSE, NULL);
    block.release = CreateEventW(NULL, TRUE, FALSE, NULL);
    CHECK(block.entered && block.release);
    CHECK(register_change(changed, &block, &block.registration) == S_OK && block.registration);
    CHECK(set_mode(TRUE) == S_OK);
    CHECK(WaitForSingleObject(block.entered, 5000) == WAIT_OBJECT_0);
    operation.registration = block.registration;
    operation.done = CreateEventW(NULL, TRUE, FALSE, NULL);
    thread = CreateThread(NULL, 0, do_unregister, &operation, 0, NULL);
    CHECK(thread != NULL);
    CHECK(WaitForSingleObject(operation.done, 150) == WAIT_TIMEOUT);
    SetEvent(block.release);
    if (thread) finish_thread(thread, operation.done);
    CHECK(block.errors == 0);
    count = block.count;
    CHECK(set_mode(FALSE) == S_OK);
    Sleep(250);
    CHECK(block.count == count);
    CloseHandle(block.entered);
    CloseHandle(block.release);

    /* Exercise real state changes with repeated independent registration lifetimes. */
    for (i = 0; i < 12; ++i) {
        struct callback_state race = {0};
        race.reenter = 1;
        CHECK(register_change(changed, &race, &race.registration) == S_OK && race.registration);
        CHECK(set_mode(TRUE) == S_OK);
        CHECK(wait_count(&race, 1, 5000));
        unregister_change(race.registration);
        count = race.count;
        CHECK(set_mode(FALSE) == S_OK);
        Sleep(30);
        CHECK(race.errors == 0 && race.count == count);
    }

    fixture("delay-next-set");
    operation.done = CreateEventW(NULL, TRUE, FALSE, NULL);
    operation.enabled = TRUE;
    thread = CreateThread(NULL, 0, do_set, &operation, 0, NULL);
    CHECK(thread != NULL);
    Sleep(200);
    fixture("emergency-exit");
    if (thread) finish_thread(thread, operation.done);
    CHECK(FAILED(operation.result)); /* Delayed enter acknowledgment lost to newer exit. */
    CHECK(wait_query(active, FALSE, 3000));
    fixture("service-restart");
    CHECK(wait_query(supported, TRUE, 5000));
    CHECK(!active() && can_set());
    CHECK(set_mode(TRUE) == S_OK && active());
    fixture("service-stop");
    CHECK(wait_query(supported, FALSE, 5000));
    CHECK(!active() && !can_set());
    CHECK(FAILED(set_mode(TRUE)));
}
int main(int argc, char **argv)
{
    const char *mode = argc == 2 ? argv[1] : "disabled";
    if (strcmp(mode, "disabled") && strcmp(mode, "unavailable") && strcmp(mode, "fixture")) return 2;
    test_exports();
    test_invalid_registration();
    if (!strcmp(mode, "fixture")) test_fixture();
    else test_unavailable();
    printf("GAMING_EXPERIENCE_TESTS mode=%s checks=%ld failures=%ld\n", mode, checks, failures);
    fflush(stdout);
    return failures ? 1 : 0;
}
