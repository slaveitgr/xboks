/* Public GDK queue contract regression. No game, identity, network or saves.
 * Keep all handles alive during observation, so the probe itself cannot
 * introduce a use-after-free while testing composite termination. */
#define COBJMACROS
#define INITGUID
#include <windows.h>
#include <stdio.h>
#include "xtaskqueue.h"
#include "xasyncprovider.h"

static IXThreadingImpl *threads;
static LONG checks, failures, called, canceled, independent, early;
static DWORD caller_thread, terminated_thread;
static HANDLE terminated_event;
#define CHECK(x, label) do { checks++; if (!(x)) { failures++; printf("FAIL %s\n", label); } } while (0)
static void WINAPI task(void *context, BOOLEAN cancel)
{
    InterlockedIncrement(&called);
    if (cancel) InterlockedIncrement(&canceled);
}
static void WINAPI independent_task(void *context, BOOLEAN cancel)
{
    if (!cancel) InterlockedIncrement(&independent);
}
static void WINAPI terminated(void *context)
{
    terminated_thread = GetCurrentThreadId();
    if (called != 2) InterlockedIncrement(&early);
    SetEvent(terminated_event);
}
int main(void)
{
    HMODULE dll = LoadLibraryA("xgameruntime.dll");
    HRESULT (WINAPI *query)(const GUID *, REFIID, void **);
    XTaskQueueHandle parent = NULL, composite = NULL;
    XTaskQueuePortHandle work = NULL, completion = NULL;
    CHECK(dll != NULL, "load");
    if (!dll) return 2;
    query = (void *)GetProcAddress(dll, "QueryApiImpl");
    CHECK(query != NULL, "query-export");
    if (!query) return 2;
    CHECK(query(&CLSID_XThreadingImpl, &IID_IXThreadingImpl, (void **)&threads) == S_OK, "threading-interface");
    if (!threads) return 2;
    caller_thread = GetCurrentThreadId();
    terminated_event = CreateEventW(NULL, TRUE, FALSE, NULL);
    CHECK(terminated_event != NULL, "event");
    CHECK(IXThreadingImpl_XTaskQueueCreate(threads, XTaskQueueDispatchMode_Manual,
        XTaskQueueDispatchMode_Manual, &parent) == S_OK, "parent-create");
    if (!parent) return 2;
    CHECK(IXThreadingImpl_XTaskQueueGetPort(threads, parent, XTaskQueuePort_Work, &work) == S_OK, "work-port");
    CHECK(IXThreadingImpl_XTaskQueueGetPort(threads, parent, XTaskQueuePort_Completion, &completion) == S_OK, "completion-port");
    CHECK(IXThreadingImpl_XTaskQueueCreateComposite(threads, work, completion, &composite) == S_OK, "composite-create");
    if (!composite) return 2;
    CHECK(IXThreadingImpl_XTaskQueueSubmitCallback(threads, composite, XTaskQueuePort_Work, NULL, task) == S_OK, "submit-work");
    CHECK(IXThreadingImpl_XTaskQueueSubmitCallback(threads, composite, XTaskQueuePort_Completion, NULL, task) == S_OK, "submit-completion");
    CHECK(IXThreadingImpl_XTaskQueueTerminate(threads, composite, FALSE, NULL, terminated) == S_OK, "terminate");
    CHECK(WaitForSingleObject(terminated_event, 150) == WAIT_TIMEOUT, "termination-must-wait-for-pending-callbacks");
    CHECK(IXThreadingImpl_XTaskQueueSubmitCallback(threads, composite, XTaskQueuePort_Work, NULL, task) == E_ABORT, "reject-after-terminate");
    /* A sibling queue using the same ports must not be canceled. */
    CHECK(IXThreadingImpl_XTaskQueueSubmitCallback(threads, parent, XTaskQueuePort_Work, NULL, independent_task) == S_OK, "parent-remains-usable");
    for (unsigned i = 0; i < 8; i++)
    {
        IXThreadingImpl_XTaskQueueDispatch(threads, parent, XTaskQueuePort_Work, 0);
        IXThreadingImpl_XTaskQueueDispatch(threads, parent, XTaskQueuePort_Completion, 0);
    }
    CHECK(called == 2, "both-callbacks-drained");
    CHECK(canceled == 2, "both-composite-callbacks-canceled");
    CHECK(independent == 1, "parent-callback-not-canceled");
    CHECK(WaitForSingleObject(terminated_event, 2000) == WAIT_OBJECT_0, "termination-completed");
    CHECK(early == 0, "termination-notified-after-drain");
    CHECK(terminated_thread == caller_thread, "manual-completion-thread-respected");
    IXThreadingImpl_XTaskQueueCloseHandle(threads, composite);
    IXThreadingImpl_XTaskQueueCloseHandle(threads, parent);
    IXThreadingImpl_Release(threads);
    CloseHandle(terminated_event);
    printf("QUEUE CHECKS %ld FAILURES %ld CALLBACKS %ld CANCELED %ld EARLY %ld\n",
        checks, failures, called, canceled, early);
    return failures ? 1 : 0;
}
