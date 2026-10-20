/* Queue ownership regression, account-free and independent of any game. */
#define COBJMACROS
#define INITGUID
#include <windows.h>
#include <stdio.h>
#include "xtaskqueue.h"
#include "xasyncprovider.h"
#include "xgameerr.h"

static IXThreadingImpl *api;
static LONG checks, failures;
#define CHECK(x, label) do { InterlockedIncrement(&checks); if (!(x)) { InterlockedIncrement(&failures); printf("FAIL %s\n", label); } } while (0)
static LONG CALLBACK fault(EXCEPTION_POINTERS *info)
{
    if (info->ExceptionRecord->ExceptionCode != EXCEPTION_ACCESS_VIOLATION) return EXCEPTION_CONTINUE_SEARCH;
    printf("FAIL access-violation\n"); fflush(stdout); ExitProcess(86);
    return EXCEPTION_CONTINUE_SEARCH;
}
static void WINAPI count(void *context, BOOLEAN canceled)
{
    CHECK(!canceled, "not-canceled"); InterlockedIncrement((LONG *)context);
}
struct blocked_state { XTaskQueueHandle queue; HANDLE entered, release, done; LONG called; XTaskQueueDispatchMode mode; };
static void WINAPI blocked(void *context, BOOLEAN canceled)
{
    struct blocked_state *s = context;
    CHECK(!canceled, "pending-not-canceled"); SetEvent(s->entered);
    CHECK(WaitForSingleObject(s->release, 5000) == WAIT_OBJECT_0, "pending-release");
    InterlockedIncrement(&s->called);
    SetEvent(s->done);
}
static DWORD WINAPI dispatch_or_submit(void *context)
{
    struct blocked_state *s = context;
    if (s->mode == XTaskQueueDispatchMode_Manual)
        CHECK(IXThreadingImpl_XTaskQueueDispatch(api, s->queue, XTaskQueuePort_Work, 5000), "manual-dispatch");
    else CHECK(IXThreadingImpl_XTaskQueueSubmitCallback(api, s->queue, XTaskQueuePort_Work, s, blocked) == S_OK, "immediate-submit");
    SetEvent(s->done); return 0;
}
static DWORD WINAPI close_same(void *queue)
{
    IXThreadingImpl_XTaskQueueCloseHandle(api, queue); return 0;
}
static void pending(XTaskQueueDispatchMode mode)
{
    struct blocked_state s = {0};
    HANDLE worker = NULL;
    s.mode = mode;
    s.entered = CreateEventW(NULL, TRUE, FALSE, NULL);
    s.release = CreateEventW(NULL, TRUE, FALSE, NULL);
    s.done = CreateEventW(NULL, TRUE, FALSE, NULL);
    CHECK(s.entered && s.release && s.done, "pending-events");
    CHECK(IXThreadingImpl_XTaskQueueCreate(api, mode, mode, &s.queue) == S_OK, "pending-create");
    if (mode != XTaskQueueDispatchMode_Immediate)
        CHECK(IXThreadingImpl_XTaskQueueSubmitCallback(api, s.queue, XTaskQueuePort_Work, &s, blocked) == S_OK, "pending-submit");
    if (mode == XTaskQueueDispatchMode_Manual || mode == XTaskQueueDispatchMode_Immediate)
        worker = CreateThread(NULL, 0, dispatch_or_submit, &s, 0, NULL);
    CHECK(WaitForSingleObject(s.entered, 5000) == WAIT_OBJECT_0, "pending-entered");
    IXThreadingImpl_XTaskQueueCloseHandle(api, s.queue);
    for (unsigned i = 0; i < 8; ++i) IXThreadingImpl_XTaskQueueCloseHandle(api, s.queue);
    SetEvent(s.release);
    if (worker) { CHECK(WaitForSingleObject(worker, 5000) == WAIT_OBJECT_0, "pending-worker"); CloseHandle(worker); }
    else CHECK(WaitForSingleObject(s.done, 5000) == WAIT_OBJECT_0, "pending-callback");
    CHECK(s.called == 1, "pending-exactly-once");
    CloseHandle(s.entered); CloseHandle(s.release); CloseHandle(s.done);
}
int main(void)
{
    HMODULE dll = LoadLibraryA("xgameruntime.dll");
    HRESULT (WINAPI *query)(const GUID *, REFIID, void **);
    XTaskQueueHandle queue = NULL, duplicate = NULL, process = NULL;
    HANDLE threads[8]; LONG called = 0;
    SetErrorMode(SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX);
    AddVectoredExceptionHandler(1, fault);
    CHECK(dll != NULL, "load"); if (!dll) return 2;
    query = (void *)GetProcAddress(dll, "QueryApiImpl");
    CHECK(query && query(&CLSID_XThreadingImpl, &IID_IXThreadingImpl, (void **)&api) == S_OK, "interface");
    if (!api) return 2;
    CHECK(IXThreadingImpl_XTaskQueueCreate(api, XTaskQueueDispatchMode_Manual, XTaskQueueDispatchMode_Manual, &queue) == S_OK, "create");
    IXThreadingImpl_XTaskQueueCloseHandle(api, queue);
    IXThreadingImpl_XTaskQueueCloseHandle(api, queue);
    CHECK(TRUE, "repeat-close-survived");
    IXThreadingImpl_XTaskQueueCloseHandle(api, NULL);
    IXThreadingImpl_XTaskQueueCloseHandle(api, (XTaskQueueHandle)(ULONG_PTR)0x1234);
    CHECK(IXThreadingImpl_XTaskQueueCreate(api, XTaskQueueDispatchMode_Manual, XTaskQueueDispatchMode_Manual, &queue) == S_OK, "duplicate-create");
    CHECK(IXThreadingImpl_XTaskQueueDuplicateHandle(api, queue, &duplicate) == S_OK, "duplicate");
    IXThreadingImpl_XTaskQueueCloseHandle(api, queue);
    CHECK(IXThreadingImpl_XTaskQueueSubmitCallback(api, duplicate, XTaskQueuePort_Work, &called, count) == S_OK, "duplicate-still-open");
    CHECK(IXThreadingImpl_XTaskQueueDispatch(api, duplicate, XTaskQueuePort_Work, 1000), "duplicate-dispatch");
    CHECK(called == 1, "duplicate-callback");
    IXThreadingImpl_XTaskQueueCloseHandle(api, duplicate);
    IXThreadingImpl_XTaskQueueCloseHandle(api, duplicate);
    duplicate = (XTaskQueueHandle)(ULONG_PTR)0x1234;
    CHECK(IXThreadingImpl_XTaskQueueDuplicateHandle(api, queue, &duplicate) == E_GAMERUNTIME_INVALID_HANDLE, "closed-duplicate-rejected");
    CHECK(duplicate == NULL, "closed-duplicate-cleared");
    for (unsigned i = 0; i < 64; ++i) {
        CHECK(IXThreadingImpl_XTaskQueueCreate(api, XTaskQueueDispatchMode_Manual, XTaskQueueDispatchMode_Manual, &queue) == S_OK, "race-create");
        for (unsigned j = 0; j < 8; ++j) { threads[j] = CreateThread(NULL, 0, close_same, queue, 0, NULL); CHECK(threads[j] != NULL, "race-thread"); }
        for (unsigned j = 0; j < 8; ++j) if (threads[j]) { CHECK(WaitForSingleObject(threads[j], 5000) == WAIT_OBJECT_0, "race-joined"); CloseHandle(threads[j]); }
    }
    for (unsigned i = 0; i < 4; ++i) pending((XTaskQueueDispatchMode)i);
    CHECK(IXThreadingImpl_XTaskQueueCreate(api, XTaskQueueDispatchMode_Immediate, XTaskQueueDispatchMode_Immediate, &queue) == S_OK, "process-create");
    IXThreadingImpl_XTaskQueueSetCurrentProcessTaskQueue(api, queue);
    IXThreadingImpl_XTaskQueueCloseHandle(api, queue);
    CHECK(IXThreadingImpl_XTaskQueueGetCurrentProcessTaskQueue(api, &process), "process-retained");
    IXThreadingImpl_XTaskQueueSetCurrentProcessTaskQueue(api, NULL);
    CHECK(IXThreadingImpl_XTaskQueueSubmitCallback(api, process, XTaskQueuePort_Work, &called, count) == S_OK, "process-handle-retained");
    IXThreadingImpl_XTaskQueueCloseHandle(api, process);
    IXThreadingImpl_XTaskQueueCloseHandle(api, process);
    IXThreadingImpl_Release(api);
    printf("QUEUE CHECKS %ld FAILURES %ld\n", checks, failures);
    return failures ? 1 : 0;
}
