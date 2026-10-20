/* SPDX-License-Identifier: MIT
 * Queue/lifetime contracts over synthetic extracted metadata, no game/account. */
#define COBJMACROS
#define INITGUID
#include <windows.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "xpackage.h"
#include "xtaskqueue.h"
#include "xasyncprovider.h"
#include "xgameerr.h"

static LONG checks, failures;
static IXPackageImpl4 *package;
static IXThreadingImpl *threading;
static WCHAR root[MAX_PATH];
static const char *identifier = "12345678123456789abcdef012345678";
#define CHECK(name, test) do { InterlockedIncrement(&checks); if (!(test)) { InterlockedIncrement(&failures); printf("FAIL %s line=%d\n", name, __LINE__); } } while (0)
static const char *xml = "<Package><Features><Feature Id=\"High\" Tags=\"base\"/></Features>"
    "<Chunk Id=\"Registration\"><FileGroup SourcePath=\".\" Include=\"MicrosoftGame.config\"/></Chunk>"
    "<Chunk Id=\"7\" Languages=\"en-US\" Tags=\"base\"><FileGroup SourcePath=\".\" Include=\"base.bin\"/></Chunk>"
    "<Chunk Id=\"9\" Tags=\"extra\"><FileGroup SourcePath=\".\" Include=\"optional.bin\"/></Chunk></Package>";
static void file( const WCHAR *name, const char *text )
{
    WCHAR path[MAX_PATH];
    HANDLE handle;
    DWORD written;
    swprintf(path, MAX_PATH, L"%ls\\%ls", root, name);
    handle = CreateFileW(path, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, 0, NULL);
    CHECK("fixture-open", handle != INVALID_HANDLE_VALUE);
    if (handle == INVALID_HANDLE_VALUE) return;
    CHECK("fixture-write", WriteFile(handle, text, strlen(text), &written, NULL) && written == strlen(text));
    CloseHandle(handle);
}
static void remove_file( const WCHAR *name )
{
    WCHAR path[MAX_PATH];
    swprintf(path, MAX_PATH, L"%ls\\%ls", root, name);
    CHECK("fixture-remove", DeleteFileW(path));
}
struct state
{
    XPackageInstallationMonitorHandle monitor;
    XTaskQueueRegistrationToken token;
    XTaskQueueHandle queue;
    LONG calls;
    BOOL complete, close, unregister;
    HANDLE started, release, finished;
};
static void WINAPI progress( void *context, XPackageInstallationMonitorHandle monitor )
{
    struct state *state = context;
    XPackageInstallationProgress value;
    CHECK("callback-monitor", state && monitor == state->monitor);
    IXPackageImpl4_XPackageGetInstallationProgress(package, monitor, &value);
    state->complete = value.completed;
    CHECK("honest-byte-counts", !value.totalBytes && !value.installedBytes && !value.launchBytes);
    CHECK("launchable-consistent", value.completed == value.launchable);
    InterlockedIncrement(&state->calls);
    if (state->started)
    {
        SetEvent(state->started);
        CHECK("callback-release", WaitForSingleObject(state->release, 5000) == WAIT_OBJECT_0);
    }
    if (state->unregister)
        CHECK("self-unregister-pending", !IXPackageImpl4_XPackageUnregisterInstallationProgressChanged(package, monitor, state->token, TRUE));
    if (state->close) IXPackageImpl4_XPackageCloseInstallationMonitorHandle(package, monitor);
}
static XTaskQueueHandle queue( XTaskQueueDispatchMode mode )
{
    XTaskQueueHandle result = NULL;
    CHECK("queue-create", IXThreadingImpl_XTaskQueueCreate(threading, mode, mode, &result) == S_OK && result);
    return result;
}
static struct state make( XTaskQueueHandle queue, UINT32 id, UINT interval )
{
    struct state state = {0};
    XPackageChunkSelector selector = {0};
    selector.type = XPackageChunkSelectorType_Chunk; selector.chunkId = id;
    state.queue = queue;
    CHECK("monitor-create", IXPackageImpl4_XPackageCreateInstallationMonitor(package, identifier, 1, &selector, interval, queue, &state.monitor) == S_OK && state.monitor);
    return state;
}
static void subscribe( struct state *state )
{
    CHECK("monitor-register", IXPackageImpl4_XPackageRegisterInstallationProgressChanged(package, state->monitor, state, progress, &state->token) == S_OK && state->token.token);
}
static void get( struct state *state, BOOL ready )
{
    XPackageInstallationProgress value;
    memset(&value, 0xcc, sizeof(value));
    IXPackageImpl4_XPackageGetInstallationProgress(package, state->monitor, &value);
    CHECK("snapshot-ready", value.completed == ready && value.launchable == ready);
    CHECK("snapshot-no-fabricated-bytes", !value.totalBytes && !value.installedBytes && !value.launchBytes);
}
static BOOL dispatch( XTaskQueueHandle queue, XTaskQueuePort port, UINT timeout )
{
    return IXThreadingImpl_XTaskQueueDispatch(threading, queue, port, timeout);
}
static void drain_completion( XTaskQueueHandle queue )
{
    unsigned i;
    /* Shared ports also carry private-queue termination bookkeeping. It must
     * not be mistaken for a title progress callback or left holding a queue. */
    for (i = 0; i < 64 && dispatch(queue, XTaskQueuePort_Completion, 0); i++);
    CHECK("bounded-completion-drain", i < 64);
}
static void close_monitor( struct state *state )
{
    IXPackageImpl4_XPackageCloseInstallationMonitorHandle(package, state->monitor);
}
static void snapshots(void)
{
    XPackageChunkSelector selector = {0};
    XPackageInstallationMonitorHandle handle = (void *)1;
    XTaskQueueRegistrationToken token = {123};
    struct state state = make(NULL, 7, 0);
    get(&state, TRUE);
    subscribe(&state); CHECK("zero-interval-no-event", !state.calls);
    close_monitor(&state);
    state = make(NULL, 9, 0); get(&state, FALSE); close_monitor(&state);
    state = make(NULL, 123, 0); get(&state, FALSE); close_monitor(&state);
    CHECK("whole-package", IXPackageImpl4_XPackageCreateInstallationMonitor(package, identifier, 0, NULL, 0, NULL, &handle) == S_OK);
    state.monitor = handle; get(&state, FALSE); close_monitor(&state);
    CHECK("null-output", IXPackageImpl4_XPackageCreateInstallationMonitor(package, identifier, 0, NULL, 0, NULL, NULL) == E_INVALIDARG);
    CHECK("null-identifier", IXPackageImpl4_XPackageCreateInstallationMonitor(package, NULL, 0, NULL, 0, NULL, &handle) == E_INVALIDARG && !handle);
    handle = (void *)1;
    CHECK("empty-identifier", IXPackageImpl4_XPackageCreateInstallationMonitor(package, "", 0, NULL, 0, NULL, &handle) == E_INVALIDARG && !handle);
    CHECK("unknown-package", IXPackageImpl4_XPackageCreateInstallationMonitor(package, "ffffffffffffffffffffffffffffffff", 0, NULL, 0, NULL, &handle) == E_GAMEPACKAGE_NO_PACKAGE_IDENTIFIER && !handle);
    CHECK("count-bound", IXPackageImpl4_XPackageCreateInstallationMonitor(package, identifier, 4097, &selector, 0, NULL, &handle) == E_INVALIDARG && !handle);
    CHECK("missing-selectors", IXPackageImpl4_XPackageCreateInstallationMonitor(package, identifier, 1, NULL, 0, NULL, &handle) == E_INVALIDARG && !handle);
    selector.type = (XPackageChunkSelectorType)99;
    CHECK("invalid-type", IXPackageImpl4_XPackageCreateInstallationMonitor(package, identifier, 1, &selector, 0, NULL, &handle) == E_INVALIDARG && !handle);
    selector.type = XPackageChunkSelectorType_Tag; selector.tag = NULL;
    CHECK("null-tag", IXPackageImpl4_XPackageCreateInstallationMonitor(package, identifier, 1, &selector, 0, NULL, &handle) == E_INVALIDARG && !handle);
    selector.tag = "";
    CHECK("empty-tag", IXPackageImpl4_XPackageCreateInstallationMonitor(package, identifier, 1, &selector, 0, NULL, &handle) == E_INVALIDARG && !handle);
    CHECK("null-monitor-register", IXPackageImpl4_XPackageRegisterInstallationProgressChanged(package, NULL, NULL, progress, &token) == E_INVALIDARG && !token.token);
    CHECK("null-monitor-update", !IXPackageImpl4_XPackageUpdateInstallationMonitor(package, NULL));
    IXPackageImpl4_XPackageCloseInstallationMonitorHandle(package, NULL);
    state.monitor = NULL; get(&state, FALSE);
}
static void manual(void)
{
    XTaskQueueHandle q = queue(XTaskQueueDispatchMode_Manual);
    struct state a = make(q, 7, 10), b;
    XTaskQueueRegistrationToken other;
    subscribe(&a);
    CHECK("initial-is-queued", !a.calls);
    CHECK("no-work-needed-for-ready", !dispatch(q, XTaskQueuePort_Work, 0));
    CHECK("initial-completion-port", dispatch(q, XTaskQueuePort_Completion, 1000));
    CHECK("initial-ready-once", a.calls == 1 && a.complete);
    CHECK("no-duplicate", !dispatch(q, XTaskQueuePort_Completion, 0));
    CHECK("unchanged-update", IXPackageImpl4_XPackageUpdateInstallationMonitor(package, a.monitor));
    CHECK("unchanged-not-notified", !dispatch(q, XTaskQueuePort_Completion, 0));
    CHECK("null-callback", IXPackageImpl4_XPackageRegisterInstallationProgressChanged(package, a.monitor, &a, NULL, &other) == E_INVALIDARG && !other.token);
    CHECK("null-token", IXPackageImpl4_XPackageRegisterInstallationProgressChanged(package, a.monitor, &a, progress, NULL) == E_INVALIDARG);
    CHECK("second-subscription", IXPackageImpl4_XPackageRegisterInstallationProgressChanged(package, a.monitor, &a, progress, &other) == S_OK && other.token != a.token.token);
    CHECK("second-snapshot", dispatch(q, XTaskQueuePort_Completion, 1000) && a.calls == 2);
    CHECK("unregister-other", IXPackageImpl4_XPackageUnregisterInstallationProgressChanged(package, a.monitor, other, TRUE));
    close_monitor(&a); drain_completion(q);
    b = make(q, 7, 10); subscribe(&b);
    CHECK("queued-unregister-no-wait", IXPackageImpl4_XPackageUnregisterInstallationProgressChanged(package, b.monitor, b.token, FALSE));
    CHECK("suppressed-entry-drains", dispatch(q, XTaskQueuePort_Completion, 1000) && !b.calls);
    close_monitor(&b); drain_completion(q);
    b = make(q, 7, 10); subscribe(&b); close_monitor(&b);
    CHECK("close-suppresses-pending", dispatch(q, XTaskQueuePort_Completion, 1000) && !b.calls);
    drain_completion(q);
    b = make(q, 7, 10); b.unregister = TRUE; subscribe(&b);
    CHECK("reentrant-unregister", dispatch(q, XTaskQueuePort_Completion, 1000) && b.calls == 1);
    CHECK("unregister-fully-drained", IXPackageImpl4_XPackageUnregisterInstallationProgressChanged(package, b.monitor, b.token, FALSE));
    close_monitor(&b); drain_completion(q);
    b = make(q, 7, 10); b.close = TRUE; subscribe(&b);
    CHECK("close-in-callback", dispatch(q, XTaskQueuePort_Completion, 1000) && b.calls == 1);
    drain_completion(q);
    IXThreadingImpl_XTaskQueueCloseHandle(threading, q);
}
static DWORD WINAPI dispatch_thread( void *arg )
{
    struct state *state = arg;
    CHECK("thread-dispatch", dispatch(state->queue, XTaskQueuePort_Completion, 2000));
    return 0;
}
static DWORD WINAPI unregister_thread( void *arg )
{
    struct state *state = arg;
    CHECK("wait-unregister", IXPackageImpl4_XPackageUnregisterInstallationProgressChanged(package, state->monitor, state->token, TRUE));
    SetEvent(state->finished);
    return 0;
}
static DWORD WINAPI close_thread( void *arg )
{
    struct state *state = arg;
    close_monitor(state);
    SetEvent(state->finished);
    return 0;
}
static void races(void)
{
    unsigned i;
    for (i = 0; i < 12; i++)
    {
        XTaskQueueHandle q = queue(XTaskQueueDispatchMode_Manual);
        struct state state = make(q, 7, 5);
        HANDLE runner, waiter = NULL;
        state.started = CreateEventW(NULL, TRUE, FALSE, NULL);
        state.release = CreateEventW(NULL, TRUE, FALSE, NULL);
        state.finished = CreateEventW(NULL, TRUE, FALSE, NULL);
        subscribe(&state);
        runner = CreateThread(NULL, 0, dispatch_thread, &state, 0, NULL);
        CHECK("callback-started", WaitForSingleObject(state.started, 3000) == WAIT_OBJECT_0);
        CHECK("running-unregister-pending", !IXPackageImpl4_XPackageUnregisterInstallationProgressChanged(package, state.monitor, state.token, FALSE));
        CHECK("repeated-pending", !IXPackageImpl4_XPackageUnregisterInstallationProgressChanged(package, state.monitor, state.token, FALSE));
        if (i % 3)
        {
            waiter = CreateThread(NULL, 0, i % 3 == 1 ? unregister_thread : close_thread, &state, 0, NULL);
            CHECK("wait-blocks-running", WaitForSingleObject(state.finished, 20) == WAIT_TIMEOUT);
        }
        SetEvent(state.release);
        CHECK("dispatch-done", WaitForSingleObject(runner, 3000) == WAIT_OBJECT_0);
        if (waiter) { CHECK("unregister-done", WaitForSingleObject(waiter, 3000) == WAIT_OBJECT_0); CloseHandle(waiter); }
        CHECK("after-running-unregistered", IXPackageImpl4_XPackageUnregisterInstallationProgressChanged(package, state.monitor, state.token, FALSE));
        CHECK("exactly-once", state.calls == 1);
        CloseHandle(runner); CloseHandle(state.started); CloseHandle(state.release); CloseHandle(state.finished);
        if (i % 3 != 2) close_monitor(&state);
        drain_completion(q);
        IXThreadingImpl_XTaskQueueCloseHandle(threading, q);
    }
}
static void updates(void)
{
    XTaskQueueHandle q = queue(XTaskQueueDispatchMode_Manual);
    struct state state = make(q, 9, 10);
    XPackageChunkSelector selector = {0};
    char tag[] = "extra";
    subscribe(&state);
    CHECK("initial-unavailable-event", dispatch(q, XTaskQueuePort_Completion, 1000) && state.calls == 1 && !state.complete);
    file(L"optional.bin", "synthetic");
    CHECK("poll-work", dispatch(q, XTaskQueuePort_Work, 2000));
    CHECK("real-change-event", dispatch(q, XTaskQueuePort_Completion, 1000) && state.calls == 2 && state.complete);
    CHECK("completed-poll-stops", !dispatch(q, XTaskQueuePort_Work, 30));
    remove_file(L"optional.bin");
    CHECK("refresh-missing", IXPackageImpl4_XPackageUpdateInstallationMonitor(package, state.monitor));
    CHECK("missing-not-success", dispatch(q, XTaskQueuePort_Completion, 1000) && state.calls == 3 && !state.complete);
    file(L"optional.bin", "synthetic");
    CHECK("explicit-refresh", IXPackageImpl4_XPackageUpdateInstallationMonitor(package, state.monitor));
    CHECK("ready-again", dispatch(q, XTaskQueuePort_Completion, 1000) && state.calls == 4 && state.complete);
    close_monitor(&state);
    CHECK("closed-poll-drains", dispatch(q, XTaskQueuePort_Work, 2000));
    drain_completion(q);
    selector.type = XPackageChunkSelectorType_Tag; selector.tag = tag;
    CHECK("tag-create", IXPackageImpl4_XPackageCreateInstallationMonitor(package, identifier, 1, &selector, 10, q, &state.monitor) == S_OK);
    strcpy(tag, "xxxxx");
    CHECK("tag-copy-refresh", IXPackageImpl4_XPackageUpdateInstallationMonitor(package, state.monitor));
    get(&state, TRUE); close_monitor(&state); drain_completion(q);
    selector.type = XPackageChunkSelectorType_Language; selector.language = "EN-us";
    CHECK("language-create", IXPackageImpl4_XPackageCreateInstallationMonitor(package, identifier, 1, &selector, 0, NULL, &state.monitor) == S_OK);
    get(&state, TRUE); close_monitor(&state);
    selector.type = XPackageChunkSelectorType_Feature; selector.feature = "High";
    CHECK("feature-create", IXPackageImpl4_XPackageCreateInstallationMonitor(package, identifier, 1, &selector, 0, NULL, &state.monitor) == S_OK);
    get(&state, TRUE); close_monitor(&state);
    remove_file(L"optional.bin");
    IXThreadingImpl_XTaskQueueCloseHandle(threading, q);
}
static void modes(void)
{
    XTaskQueueDispatchMode modes[] = {XTaskQueueDispatchMode_Immediate, XTaskQueueDispatchMode_ThreadPool, XTaskQueueDispatchMode_SerializedThreadPool};
    unsigned i;
    for (i = 0; i < 3; i++)
    {
        XTaskQueueHandle q = queue(modes[i]);
        struct state state = make(q, 7, 10);
        DWORD until;
        state.close = TRUE;
        subscribe(&state);
        until = GetTickCount() + 3000;
        while (!InterlockedCompareExchange(&state.calls, 0, 0) && (LONG)(until - GetTickCount()) > 0) Sleep(1);
        /* Termination waits for all queued callbacks, including close itself. */
        CHECK("queue-terminate", IXThreadingImpl_XTaskQueueTerminate(threading, q, TRUE, NULL, NULL) == S_OK);
        CHECK("mode-ready-once", state.calls == 1 && state.complete);
        IXThreadingImpl_XTaskQueueCloseHandle(threading, q);
    }
    {
        XTaskQueueHandle q = queue(XTaskQueueDispatchMode_Manual);
        struct state state = make(q, 7, 10);
        subscribe(&state);
        CHECK("cancel-queue", IXThreadingImpl_XTaskQueueTerminate(threading, q, FALSE, NULL, NULL) == S_OK);
        CHECK("canceled-entry-drains", dispatch(q, XTaskQueuePort_Completion, 1000) && !state.calls);
        close_monitor(&state);
        drain_completion(q);
        state = make(q, 7, 10);
        CHECK("terminated-registration-errors", IXPackageImpl4_XPackageRegisterInstallationProgressChanged(package, state.monitor, &state, progress, &state.token) == E_ABORT && !state.token.token);
        close_monitor(&state);
        IXThreadingImpl_XTaskQueueCloseHandle(threading, q);
    }
}
static void WINAPI independent_work( void *context, BOOLEAN canceled )
{
    LONG *calls = context;
    CHECK("parent-work-not-canceled", !canceled);
    InterlockedIncrement(calls);
}
static void isolated_cancel(void)
{
    XTaskQueueHandle q = queue(XTaskQueueDispatchMode_Manual);
    struct state state = make(q, 9, 3600000);
    LONG calls = 0;
    unsigned i;
    close_monitor(&state);
    CHECK("independent-submit", IXThreadingImpl_XTaskQueueSubmitCallback(threading, q, XTaskQueuePort_Work, &calls, independent_work) == S_OK);
    for (i = 0; i < 2 && !calls; i++) CHECK("independent-dispatch", dispatch(q, XTaskQueuePort_Work, 2000));
    CHECK("independent-once", calls == 1);
    /* The canceled one-hour poll must become dispatchable now, not in an hour. */
    if (i == 1) CHECK("long-poll-cancel-drains", dispatch(q, XTaskQueuePort_Work, 2000));
    CHECK("no-poll-reschedule", !dispatch(q, XTaskQueuePort_Work, 0));
    drain_completion(q);
    IXThreadingImpl_XTaskQueueCloseHandle(threading, q);
}
static void child( BOOL baseline )
{
    HMODULE dll = LoadLibraryW(L"xgameruntime.dll");
    HRESULT (WINAPI *query)(const GUID *, REFIID, void **);
    WCHAR *sep;
    CHECK("module-path", GetModuleFileNameW(NULL, root, MAX_PATH));
    if ((sep = wcsrchr(root, '\\'))) *sep = 0;
    CHECK("load-runtime", dll != NULL);
    if (!dll) return;
    query = (void *)GetProcAddress(dll, "QueryApiImpl");
    CHECK("query-export", query != NULL);
    if (!query) return;
    CHECK("package-interface", query(&CLSID_XPackageImpl, &IID_IXPackageImpl4, (void **)&package) == S_OK && package);
    CHECK("threading-interface", query(&CLSID_XThreadingImpl, &IID_IXThreadingImpl, (void **)&threading) == S_OK && threading);
    if (package && threading)
    {
        if (baseline)
        {
            XTaskQueueHandle q = queue(XTaskQueueDispatchMode_Manual);
            struct state state = make(q, 7, 10);
            subscribe(&state);
            CHECK("baseline-initial-notification", dispatch(q, XTaskQueuePort_Completion, 200) && state.calls == 1 && state.complete);
            close_monitor(&state); IXThreadingImpl_XTaskQueueCloseHandle(threading, q);
        }
        else { snapshots(); manual(); races(); updates(); modes(); isolated_cancel(); }
    }
    if (package) IXPackageImpl4_Release(package);
    if (threading) IXThreadingImpl_Release(threading);
    FreeLibrary(dll);
}
int main( int argc, char **argv )
{
    if (argc == 2 && (!strcmp(argv[1], "--child") || !strcmp(argv[1], "--baseline-child"))) child(!strcmp(argv[1], "--baseline-child"));
    else
    {
        WCHAR temporary[MAX_PATH], own[MAX_PATH], exe[MAX_PATH], command[MAX_PATH + 40];
        STARTUPINFOW startup = {0};
        PROCESS_INFORMATION process = {0};
        DWORD wait, code = 99;
        CHECK("temp", GetTempPathW(MAX_PATH, temporary));
        swprintf(root, MAX_PATH, L"%lsnexus-monitors-%lu-%lu", temporary, GetCurrentProcessId(), GetTickCount());
        CHECK("root", CreateDirectoryW(root, NULL));
        file(L"MicrosoftGame.config", "<Game><Identity Name=\"Nexus.Monitors\" Publisher=\"CN=Probe\" Version=\"1.2.3.4\"/><StoreId>B00000000001</StoreId></Game>");
        file(L"appxmanifest.xml", "<Package><Identity Name=\"Nexus.Monitors\" Publisher=\"CN=Probe\" Version=\"1.2.3.4\"/><Applications/></Package>");
        file(L"layout_12345678-1234-5678-9abc-def012345678.xml", xml);
        file(L"base.bin", "synthetic");
        CHECK("own", GetModuleFileNameW(NULL, own, MAX_PATH));
        swprintf(exe, MAX_PATH, L"%ls\\probe.exe", root);
        CHECK("copy", CopyFileW(own, exe, TRUE));
        swprintf(command, MAX_PATH + 40, L"\"%ls\" %ls", exe, argc == 2 && !strcmp(argv[1], "--baseline") ? L"--baseline-child" : L"--child");
        startup.cb = sizeof(startup);
        CHECK("child-start", CreateProcessW(exe, command, NULL, NULL, FALSE, 0, NULL, NULL, &startup, &process));
        if (process.hProcess)
        {
            wait = WaitForSingleObject(process.hProcess, 30000);
            CHECK("child-finished", wait == WAIT_OBJECT_0);
            if (wait != WAIT_OBJECT_0) TerminateProcess(process.hProcess, 77);
            GetExitCodeProcess(process.hProcess, &code); CHECK("child-pass", code == 0);
            CloseHandle(process.hProcess); CloseHandle(process.hThread);
        }
    }
    printf("CHECKS %ld FAILURES %ld\n", checks, failures);
    return failures ? 1 : 0;
}
