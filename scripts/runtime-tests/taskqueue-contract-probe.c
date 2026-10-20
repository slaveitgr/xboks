/* Generic queue ABI checks; no identity, title, service, network or saves. */
#define COBJMACROS
#define INITGUID
#include <windows.h>
#include <stdio.h>
#include "xtaskqueue.h"
#include "xasyncprovider.h"

static IXThreadingImpl *api;
static LONG checks, failures;
#define CHECK(x, label) do { ++checks; if (!(x)) { ++failures; printf("FAIL %s\n", label); } } while (0)
struct state {
    HANDLE done, started, release;
    LONG count, active, max_active, canceled, notifications, work, completion;
    XTaskQueueHandle queue;
    XTaskQueueRegistrationToken token;
    DWORD callback_thread;
};
static void WINAPI task(void *context, BOOLEAN canceled)
{
    struct state *s = context;
    LONG active = InterlockedIncrement(&s->active), prior;
    do { prior = s->max_active; } while (active > prior && InterlockedCompareExchange(&s->max_active, active, prior) != prior);
    if (canceled) InterlockedIncrement(&s->canceled);
    Sleep(1);
    InterlockedDecrement(&s->active);
    if (InterlockedIncrement(&s->count) == 200) SetEvent(s->done);
}
static void WINAPI once(void *context, BOOLEAN canceled)
{
    struct state *s = context;
    InterlockedIncrement(&s->count);
    if (canceled) InterlockedIncrement(&s->canceled);
    s->callback_thread = GetCurrentThreadId();
    SetEvent(s->done);
}
static void WINAPI block(void *context, BOOLEAN canceled)
{
    struct state *s = context;
    SetEvent(s->started);
    WaitForSingleObject(s->release, 5000);
    InterlockedIncrement(&s->count);
}
static void WINAPI finish(void *context)
{
    struct state *s = context;
    if (s->active) InterlockedIncrement(&s->canceled);
    SetEvent(s->done);
}
static void WINAPI close_on_finish(void *context)
{
    struct state *s = context;
    IXThreadingImpl_XTaskQueueCloseHandle(api, s->queue);
    s->queue = NULL;
    SetEvent(s->done);
}
static void WINAPI monitor(void *context, XTaskQueueHandle queue, XTaskQueuePort port)
{
    struct state *s = context;
    InterlockedIncrement(&s->notifications);
    if (port == XTaskQueuePort_Work) InterlockedIncrement(&s->work);
    else if (port == XTaskQueuePort_Completion) InterlockedIncrement(&s->completion);
    SetEvent(s->started);
}
static struct state init(void)
{
    struct state s = {0};
    s.done = CreateEventW(NULL, TRUE, FALSE, NULL);
    s.started = CreateEventW(NULL, TRUE, FALSE, NULL);
    s.release = CreateEventW(NULL, TRUE, FALSE, NULL);
    return s;
}
static void destroy(struct state *s)
{
    CloseHandle(s->done); CloseHandle(s->started); CloseHandle(s->release);
}
static void modes(void)
{
    XTaskQueueDispatchMode modes[] = {XTaskQueueDispatchMode_Manual, XTaskQueueDispatchMode_ThreadPool,
        XTaskQueueDispatchMode_SerializedThreadPool, XTaskQueueDispatchMode_Immediate};
    for (unsigned m = 0; m < 4; ++m)
    {
        struct state s = init();
        CHECK(IXThreadingImpl_XTaskQueueCreate(api, modes[m], modes[m], &s.queue) == S_OK, "mode-create");
        for (unsigned i = 0; i < 200; ++i)
            CHECK(IXThreadingImpl_XTaskQueueSubmitCallback(api, s.queue, XTaskQueuePort_Work, &s, task) == S_OK, "mode-submit");
        if (modes[m] == XTaskQueueDispatchMode_Manual)
            for (unsigned i = 0; i < 200; ++i) CHECK(IXThreadingImpl_XTaskQueueDispatch(api, s.queue, XTaskQueuePort_Work, 1000), "manual-dispatch");
        CHECK(WaitForSingleObject(s.done, 5000) == WAIT_OBJECT_0, "mode-drained");
        CHECK(s.count == 200 && s.canceled == 0, "mode-exactly-once");
        if (modes[m] == XTaskQueueDispatchMode_SerializedThreadPool) CHECK(s.max_active == 1, "serialized-not-concurrent");
        ResetEvent(s.done);
        CHECK(IXThreadingImpl_XTaskQueueTerminate(api, s.queue, FALSE, &s, finish) == S_OK, "mode-terminate");
        if (modes[m] == XTaskQueueDispatchMode_Manual) IXThreadingImpl_XTaskQueueDispatch(api, s.queue, XTaskQueuePort_Completion, 1000);
        CHECK(WaitForSingleObject(s.done, 5000) == WAIT_OBJECT_0, "mode-terminated");
        IXThreadingImpl_XTaskQueueCloseHandle(api, s.queue);
        destroy(&s);
    }
}
static void monitors(void)
{
    struct state s = init();
    XTaskQueueHandle child;
    XTaskQueuePortHandle work, completion;
    CHECK(IXThreadingImpl_XTaskQueueCreate(api, XTaskQueueDispatchMode_Manual, XTaskQueueDispatchMode_Manual, &s.queue) == S_OK, "monitor-create");
    CHECK(IXThreadingImpl_XTaskQueueRegisterMonitor(api, s.queue, &s, monitor, &s.token) == S_OK, "monitor-register");
    IXThreadingImpl_XTaskQueueGetPort(api, s.queue, XTaskQueuePort_Work, &work);
    IXThreadingImpl_XTaskQueueGetPort(api, s.queue, XTaskQueuePort_Completion, &completion);
    CHECK(IXThreadingImpl_XTaskQueueCreateComposite(api, work, completion, &child) == S_OK, "monitor-composite");
    CHECK(IXThreadingImpl_XTaskQueueSubmitCallback(api, child, XTaskQueuePort_Completion, &s, once) == S_OK, "monitor-submit-child");
    CHECK(s.completion == 1 && s.work == 0, "parent-monitor-woken-logical-port");
    CHECK(s.count == 0, "monitor-before-manual-dispatch");
    IXThreadingImpl_XTaskQueueDispatch(api, s.queue, XTaskQueuePort_Completion, 0);
    ResetEvent(s.started); ResetEvent(s.done);
    CHECK(IXThreadingImpl_XTaskQueueSubmitDelayedCallback(api, child, XTaskQueuePort_Work, 100, &s, once) == S_OK, "delayed-submit");
    CHECK(!IXThreadingImpl_XTaskQueueDispatch(api, s.queue, XTaskQueuePort_Work, 0), "delay-not-early");
    CHECK(WaitForSingleObject(s.started, 2000) == WAIT_OBJECT_0, "delayed-monitor-wakes-when-ready");
    CHECK(IXThreadingImpl_XTaskQueueDispatch(api, s.queue, XTaskQueuePort_Work, 0), "delayed-ready-after-notification");
    ResetEvent(s.done); ResetEvent(s.started);
    CHECK(IXThreadingImpl_XTaskQueueTerminate(api, child, FALSE, &s, finish) == S_OK, "monitor-terminate-child");
    CHECK(WaitForSingleObject(s.started, 1000) == WAIT_OBJECT_0, "termination-wakes-parent-monitor");
    CHECK(IXThreadingImpl_XTaskQueueDispatch(api, s.queue, XTaskQueuePort_Completion, 0), "parent-dispatch-final-notification");
    CHECK(WaitForSingleObject(s.done, 1000) == WAIT_OBJECT_0, "monitor-termination-finished");
    IXThreadingImpl_XTaskQueueCloseHandle(api, child);
    IXThreadingImpl_XTaskQueueUnregisterMonitor(api, s.queue, s.token);
    LONG notified = s.notifications;
    IXThreadingImpl_XTaskQueueSubmitCallback(api, s.queue, XTaskQueuePort_Work, &s, once);
    CHECK(s.notifications == notified, "unregistered-monitor-not-invoked");
    IXThreadingImpl_XTaskQueueDispatch(api, s.queue, XTaskQueuePort_Work, 0);
    IXThreadingImpl_XTaskQueueCloseHandle(api, s.queue);
    destroy(&s);
}
static void lifetimes(void)
{
    for (unsigned i = 0; i < 100; ++i)
    {
        struct state s = init();
        IXThreadingImpl_XTaskQueueCreate(api, XTaskQueueDispatchMode_ThreadPool, XTaskQueueDispatchMode_ThreadPool, &s.queue);
        CHECK(IXThreadingImpl_XTaskQueueSubmitDelayedCallback(api, s.queue, XTaskQueuePort_Work, 10, &s, once) == S_OK, "lifetime-submit");
        IXThreadingImpl_XTaskQueueCloseHandle(api, s.queue);
        CHECK(WaitForSingleObject(s.done, 3000) == WAIT_OBJECT_0 && s.count == 1 && !s.canceled, "close-does-not-cancel-pending");
        destroy(&s);
    }
    struct state s = init();
    IXThreadingImpl_XTaskQueueCreate(api, XTaskQueueDispatchMode_ThreadPool, XTaskQueueDispatchMode_Manual, &s.queue);
    IXThreadingImpl_XTaskQueueSubmitCallback(api, s.queue, XTaskQueuePort_Work, &s, block);
    CHECK(WaitForSingleObject(s.started, 2000) == WAIT_OBJECT_0, "running-started");
    IXThreadingImpl_XTaskQueueTerminate(api, s.queue, FALSE, &s, close_on_finish);
    CHECK(!IXThreadingImpl_XTaskQueueDispatch(api, s.queue, XTaskQueuePort_Completion, 0), "running-not-terminated-prematurely");
    SetEvent(s.release);
    CHECK(IXThreadingImpl_XTaskQueueDispatch(api, s.queue, XTaskQueuePort_Completion, 2000), "running-finish-dispatched");
    CHECK(s.count == 1 && s.queue == NULL, "last-handle-closed-in-termination");
    destroy(&s);
    s = init();
    IXThreadingImpl_XTaskQueueCreate(api, XTaskQueueDispatchMode_ThreadPool, XTaskQueueDispatchMode_ThreadPool, &s.queue);
    IXThreadingImpl_XTaskQueueSubmitDelayedCallback(api, s.queue, XTaskQueuePort_Work, 60000, &s, once);
    ULONGLONG start = GetTickCount64();
    CHECK(IXThreadingImpl_XTaskQueueTerminate(api, s.queue, TRUE, &s, finish) == S_OK, "synchronous-terminate");
    CHECK(GetTickCount64() - start < 2000 && s.count == 1 && s.canceled == 1, "delay-canceled-without-waiting-for-timer");
    IXThreadingImpl_XTaskQueueCloseHandle(api, s.queue);
    destroy(&s);
}
struct race_state { XTaskQueueHandle queue; LONG accepted, called, rejected, bad; };
static void WINAPI race_task(void *context, BOOLEAN canceled)
{
    struct race_state *s = context;
    InterlockedIncrement(&s->called);
}
static DWORD WINAPI producer(void *context)
{
    struct race_state *s = context;
    for (unsigned i = 0; i < 500; ++i)
    {
        HRESULT hr = IXThreadingImpl_XTaskQueueSubmitCallback(api, s->queue, XTaskQueuePort_Work, s, race_task);
        if (hr == S_OK) InterlockedIncrement(&s->accepted);
        else if (hr == E_ABORT) InterlockedIncrement(&s->rejected);
        else InterlockedIncrement(&s->bad);
        if (!(i % 10)) Sleep(0);
    }
    return 0;
}
static void race(void)
{
    for (unsigned round = 0; round < 20; ++round)
    {
        struct race_state s = {0};
        HANDLE workers[4];
        IXThreadingImpl_XTaskQueueCreate(api, XTaskQueueDispatchMode_ThreadPool, XTaskQueueDispatchMode_ThreadPool, &s.queue);
        for (unsigned i = 0; i < 4; ++i) workers[i] = CreateThread(NULL, 0, producer, &s, 0, NULL);
        Sleep(1);
        CHECK(IXThreadingImpl_XTaskQueueTerminate(api, s.queue, TRUE, NULL, NULL) == S_OK, "concurrent-termination");
        CHECK(WaitForMultipleObjects(4, workers, TRUE, 5000) == WAIT_OBJECT_0, "concurrent-producers-finished");
        CHECK(!s.bad && s.called == s.accepted && s.accepted + s.rejected == 2000, "concurrent-no-lost-or-duplicate-callbacks");
        for (unsigned i = 0; i < 4; ++i) CloseHandle(workers[i]);
        IXThreadingImpl_XTaskQueueCloseHandle(api, s.queue);
    }
}
/* A bounded regression for the documented Terminate + Dispatch(INFINITE)
 * drain loop. Exit the disposable probe, never terminate a dispatcher thread. */
static DWORD WINAPI drain_deadline(void *context)
{
    if (WaitForSingleObject(context, 8000) != WAIT_OBJECT_0)
    {
        puts("FAIL terminated-infinite-dispatch-hung");
        fflush(stdout);
        ExitProcess(77);
    }
    return 0;
}
static DWORD WINAPI release_later(void *context)
{
    Sleep(150);
    SetEvent(context);
    return 0;
}
static void WINAPI blocking_finish(void *context)
{
    struct state *s = context;
    SetEvent(s->started);
    WaitForSingleObject(s->release, 5000);
    InterlockedIncrement(&s->count);
}
static void terminated_dispatch(void)
{
    HANDLE done = CreateEventW(NULL, TRUE, FALSE, NULL);
    HANDLE watchdog = CreateThread(NULL, 0, drain_deadline, done, 0, NULL), helper;
    struct state s = init();
    XTaskQueueHandle child;
    XTaskQueuePortHandle work, completion;
    ULONGLONG start;
    CHECK(IXThreadingImpl_XTaskQueueCreate(api, XTaskQueueDispatchMode_Manual,
        XTaskQueueDispatchMode_Manual, &s.queue) == S_OK, "drain-create");
    CHECK(IXThreadingImpl_XTaskQueueTerminate(api, s.queue, FALSE, NULL, NULL) == S_OK, "drain-terminate-null-callback");
    CHECK(IXThreadingImpl_XTaskQueueDispatch(api, s.queue, XTaskQueuePort_Completion, INFINITE), "drain-terminal-entry");
    start = GetTickCount64();
    CHECK(!IXThreadingImpl_XTaskQueueDispatch(api, s.queue, XTaskQueuePort_Completion, INFINITE), "drain-completion-infinite-ends");
    CHECK(!IXThreadingImpl_XTaskQueueDispatch(api, s.queue, XTaskQueuePort_Work, INFINITE), "drain-work-infinite-ends");
    CHECK(GetTickCount64() - start < 1000, "drain-no-timeout-required");
    IXThreadingImpl_XTaskQueueCloseHandle(api, s.queue);

    /* A terminal callback already dequeued by another dispatcher is not done. */
    CHECK(IXThreadingImpl_XTaskQueueCreate(api, XTaskQueueDispatchMode_Manual,
        XTaskQueueDispatchMode_ThreadPool, &s.queue) == S_OK, "drain-blocking-create");
    CHECK(IXThreadingImpl_XTaskQueueTerminate(api, s.queue, FALSE, &s, blocking_finish) == S_OK, "drain-blocking-terminate");
    CHECK(WaitForSingleObject(s.started, 2000) == WAIT_OBJECT_0, "drain-terminal-callback-started");
    helper = CreateThread(NULL, 0, release_later, s.release, 0, NULL);
    start = GetTickCount64();
    CHECK(!IXThreadingImpl_XTaskQueueDispatch(api, s.queue, XTaskQueuePort_Work, INFINITE), "drain-waits-for-terminal-callback");
    CHECK(GetTickCount64() - start >= 100 && s.count == 1, "drain-not-premature");
    WaitForSingleObject(helper, 2000); CloseHandle(helper);
    IXThreadingImpl_XTaskQueueCloseHandle(api, s.queue);

    /* Terminating a composite cannot make its live parent return early. */
    ResetEvent(s.done); s.count = 0;
    CHECK(IXThreadingImpl_XTaskQueueCreate(api, XTaskQueueDispatchMode_Manual,
        XTaskQueueDispatchMode_Manual, &s.queue) == S_OK, "drain-parent-create");
    IXThreadingImpl_XTaskQueueGetPort(api, s.queue, XTaskQueuePort_Work, &work);
    IXThreadingImpl_XTaskQueueGetPort(api, s.queue, XTaskQueuePort_Completion, &completion);
    CHECK(IXThreadingImpl_XTaskQueueCreateComposite(api, work, completion, &child) == S_OK, "drain-child-create");
    CHECK(IXThreadingImpl_XTaskQueueTerminate(api, child, FALSE, NULL, NULL) == S_OK, "drain-child-terminate");
    CHECK(IXThreadingImpl_XTaskQueueDispatch(api, child, XTaskQueuePort_Completion, INFINITE), "drain-child-terminal-entry");
    CHECK(!IXThreadingImpl_XTaskQueueDispatch(api, child, XTaskQueuePort_Completion, INFINITE), "drain-child-ends");
    start = GetTickCount64();
    CHECK(!IXThreadingImpl_XTaskQueueDispatch(api, s.queue, XTaskQueuePort_Completion, 150), "drain-live-parent-timeout");
    CHECK(GetTickCount64() - start >= 100, "drain-parent-not-terminated-by-child");
    CHECK(IXThreadingImpl_XTaskQueueSubmitCallback(api, s.queue, XTaskQueuePort_Completion, &s, once) == S_OK, "drain-parent-still-accepts");
    CHECK(IXThreadingImpl_XTaskQueueDispatch(api, s.queue, XTaskQueuePort_Completion, 0) && s.count == 1, "drain-parent-still-dispatches");
    IXThreadingImpl_XTaskQueueCloseHandle(api, child);
    IXThreadingImpl_XTaskQueueCloseHandle(api, s.queue);
    destroy(&s);
    SetEvent(done); WaitForSingleObject(watchdog, 2000);
    CloseHandle(watchdog); CloseHandle(done);
}
struct termination_request {
    XTaskQueueHandle queue;
    HANDLE entered, release, returned;
    LONG count;
    DWORD thread;
    HRESULT result;
};
static void WINAPI repeat_finish(void *context)
{
    struct termination_request *r = context;
    r->thread = GetCurrentThreadId();
    InterlockedIncrement(&r->count);
    if (r->entered) SetEvent(r->entered);
    if (r->release) WaitForSingleObject(r->release, 5000);
}
static DWORD WINAPI repeat_wait(void *context)
{
    struct termination_request *r = context;
    r->result = IXThreadingImpl_XTaskQueueTerminate(api, r->queue, TRUE, r, repeat_finish);
    SetEvent(r->returned);
    return 0;
}
static void repeated_termination(void)
{
    XTaskQueueHandle queue;
    struct termination_request requests[8] = {0};
    struct state pending = init();
    HANDLE worker;
    DWORD caller = GetCurrentThreadId();
    /* Games may drain the same queue again from a destructor. Each request
     * owns its callback/context, including requests made after full teardown. */
    CHECK(IXThreadingImpl_XTaskQueueCreate(api, XTaskQueueDispatchMode_Manual,
        XTaskQueueDispatchMode_Manual, &queue) == S_OK, "repeat-create");
    for (unsigned round = 0; round < 2; ++round)
    {
        struct termination_request r = {0};
        CHECK(IXThreadingImpl_XTaskQueueTerminate(api, queue, FALSE, &r, repeat_finish) == S_OK,
            "repeat-accept-terminated-queue");
        IXThreadingImpl_XTaskQueueDispatch(api, queue, XTaskQueuePort_Work, 0);
        IXThreadingImpl_XTaskQueueDispatch(api, queue, XTaskQueuePort_Completion, 0);
        CHECK(r.count == 1 && r.thread == caller, "repeat-notify-on-manual-completion");
    }
    IXThreadingImpl_XTaskQueueCloseHandle(api, queue);
    CHECK(IXThreadingImpl_XTaskQueueCreate(api, XTaskQueueDispatchMode_Manual,
        XTaskQueueDispatchMode_Manual, &queue) == S_OK, "repeat-pending-create");
    CHECK(IXThreadingImpl_XTaskQueueSubmitCallback(api, queue, XTaskQueuePort_Work, &pending, once) == S_OK,
        "repeat-pending-submit");
    /* Retain all termination requests while ordinary work still needs drain. */
    for (unsigned i = 0; i < 8; ++i)
        CHECK(IXThreadingImpl_XTaskQueueTerminate(api, queue, FALSE, &requests[i], repeat_finish) == S_OK,
            "repeat-pending-accepted");
    CHECK(!IXThreadingImpl_XTaskQueueDispatch(api, queue, XTaskQueuePort_Completion, 0),
        "repeat-no-notification-before-drain");
    IXThreadingImpl_XTaskQueueDispatch(api, queue, XTaskQueuePort_Work, 0);
    CHECK(pending.count == 1 && pending.canceled == 1, "repeat-pending-work-canceled-once");
    for (unsigned i = 0; i < 8; ++i)
        IXThreadingImpl_XTaskQueueDispatch(api, queue, XTaskQueuePort_Completion, 0);
    for (unsigned i = 0; i < 8; ++i)
        CHECK(requests[i].count == 1 && requests[i].thread == caller, "repeat-distinct-context-once");
    CHECK(IXThreadingImpl_XTaskQueueSubmitCallback(api, queue, XTaskQueuePort_Work, NULL, task) == E_ABORT,
        "repeat-keeps-submissions-disabled");
    IXThreadingImpl_XTaskQueueCloseHandle(api, queue);
    destroy(&pending);

    /* wait=true must wait for this request, even if a prior request finished. */
    CHECK(IXThreadingImpl_XTaskQueueCreate(api, XTaskQueueDispatchMode_ThreadPool,
        XTaskQueueDispatchMode_ThreadPool, &queue) == S_OK, "repeat-wait-create");
    CHECK(IXThreadingImpl_XTaskQueueTerminate(api, queue, TRUE, NULL, NULL) == S_OK, "repeat-initial-wait");
    {
        struct termination_request r = {0};
        r.queue = queue;
        r.entered = CreateEventW(NULL, TRUE, FALSE, NULL);
        r.release = CreateEventW(NULL, TRUE, FALSE, NULL);
        r.returned = CreateEventW(NULL, TRUE, FALSE, NULL);
        worker = CreateThread(NULL, 0, repeat_wait, &r, 0, NULL);
        CHECK(WaitForSingleObject(r.entered, 1000) == WAIT_OBJECT_0, "repeat-wait-callback-entered");
        CHECK(WaitForSingleObject(r.returned, 100) == WAIT_TIMEOUT, "repeat-wait-not-prior-notification");
        SetEvent(r.release);
        CHECK(WaitForSingleObject(worker, 5000) == WAIT_OBJECT_0, "repeat-wait-returned");
        CHECK(r.result == S_OK && r.count == 1, "repeat-wait-own-callback-completed");
        CloseHandle(worker); CloseHandle(r.entered); CloseHandle(r.release); CloseHandle(r.returned);
    }
    IXThreadingImpl_XTaskQueueCloseHandle(api, queue);
    /* Simultaneous synchronous callers retain independent completion state. */
    {
        struct termination_request concurrent[8] = {0};
        HANDLE workers[8];
        CHECK(IXThreadingImpl_XTaskQueueCreate(api, XTaskQueueDispatchMode_ThreadPool,
            XTaskQueueDispatchMode_ThreadPool, &queue) == S_OK, "repeat-concurrent-create");
        for (unsigned i = 0; i < 8; ++i)
        {
            concurrent[i].queue = queue;
            concurrent[i].returned = CreateEventW(NULL, TRUE, FALSE, NULL);
            workers[i] = CreateThread(NULL, 0, repeat_wait, &concurrent[i], 0, NULL);
        }
        CHECK(WaitForMultipleObjects(8, workers, TRUE, 5000) == WAIT_OBJECT_0, "repeat-concurrent-returned");
        for (unsigned i = 0; i < 8; ++i)
        {
            CHECK(concurrent[i].result == S_OK && concurrent[i].count == 1, "repeat-concurrent-own-callback");
            CloseHandle(workers[i]); CloseHandle(concurrent[i].returned);
        }
        IXThreadingImpl_XTaskQueueCloseHandle(api, queue);
    }
    for (unsigned mode = XTaskQueueDispatchMode_SerializedThreadPool; mode <= XTaskQueueDispatchMode_Immediate; ++mode)
    {
        CHECK(IXThreadingImpl_XTaskQueueCreate(api, mode, mode, &queue) == S_OK, "repeat-other-mode-create");
        for (unsigned round = 0; round < 2; ++round)
        {
            struct termination_request r = {0};
            CHECK(IXThreadingImpl_XTaskQueueTerminate(api, queue, TRUE, &r, repeat_finish) == S_OK,
                "repeat-other-mode-accepted");
            CHECK(r.count == 1, "repeat-other-mode-notified");
        }
        IXThreadingImpl_XTaskQueueCloseHandle(api, queue);
    }
}
int main(void)
{
    HMODULE dll = LoadLibraryA("xgameruntime.dll");
    HRESULT (WINAPI *query)(const GUID *, REFIID, void **) = (void *)GetProcAddress(dll, "QueryApiImpl");
    if (!query || FAILED(query(&CLSID_XThreadingImpl, &IID_IXThreadingImpl, (void **)&api))) return 2;
    repeated_termination(); terminated_dispatch(); modes(); monitors(); lifetimes(); race();
    IXThreadingImpl_Release(api);
    printf("QUEUE CHECKS %ld FAILURES %ld\n", checks, failures);
    return failures ? 1 : 0;
}
