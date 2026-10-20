/* SPDX-License-Identifier: MIT
 * Missing Windows stock UI for in-process PlayFab, and acknowledged final
 * uploads before normal SDK shutdown. Never select a save without consent.
 */
#include <windows.h>
#include <commctrl.h>
#include <stdint.h>
#include <stddef.h>
#include <stdio.h>
#include <string.h>
#include <wchar.h>
#include "playfab-session.h"
static HMODULE sdkModule;
static NexusThreads *threads;
static SRWLOCK sessionLock=SRWLOCK_INIT, uiLock=SRWLOCK_INIT;
static SaveCallbacks titleCallbacks;
static BOOL enabled, closing;
static LONG generation;
static HANDLE sessionDone;
static HRESULT sessionResult;
static SRWLOCK drainLock=SRWLOCK_INIT;
static HRESULT WINAPI drain_session(void *context);
static HRESULT (WINAPI *duplicate_user)(void *,void **);
static void (WINAPI *close_user)(void *);
static int32_t (WINAPI *compare_user)(void *,void *);
static HRESULT (WINAPI *set_callbacks)(SaveCallbacks *);
static HRESULT (WINAPI *upload_async)(void *,unsigned,NexusAsync *);
static HRESULT (WINAPI *upload_result)(NexusAsync *);
static HRESULT (WINAPI *connected)(void *,BOOLEAN *);
static HRESULT (WINAPI *cleanup_async)(NexusAsync *);
static HRESULT (WINAPI *cleanup_result)(NexusAsync *);
typedef struct SaveUser { void *handle; struct SaveUser *next; } SaveUser;
static SaveUser *users;
static const GUID threadingId={0x073b7dcb,0x1fcf,0x4030,{0x94,0xbe,0xe3,0xc9,0xeb,0x62,0x34,0x28}};
static void note(const char *phase,HRESULT hr)
{
    /* Numeric status only; never paths, identities or SDK payloads. */
    fprintf(stderr,"Nexus cloud saves: %s hr=%08lx\n",phase,(unsigned long)hr);
}
static FARPROC sdk_proc(const char *name) { return sdkModule?GetProcAddress(sdkModule,name):NULL; }
static HRESULT bind_session(HMODULE sdk)
{
    HMODULE core=GetModuleHandleW(L"PlayFabCore.dll"),runtime=GetModuleHandleW(L"xgameruntime.dll");
    HRESULT (WINAPI *query)(const GUID *,const GUID *,void **);
    HRESULT hr;
    if(threads) return S_OK;
    if(!core||!runtime) return HRESULT_FROM_WIN32(ERROR_MOD_NOT_FOUND);
    sdkModule=sdk;
    duplicate_user=(void*)GetProcAddress(core,"PFLocalUserDuplicateHandle");
    close_user=(void*)GetProcAddress(core,"PFLocalUserCloseHandle");
    compare_user=(void*)GetProcAddress(core,"PFLocalUserHandleCompare");
    set_callbacks=(void*)sdk_proc("PFGameSaveFilesSetUiCallbacks");
    upload_async=(void*)sdk_proc("PFGameSaveFilesUploadWithUiAsync");
    upload_result=(void*)sdk_proc("PFGameSaveFilesUploadWithUiResult");
    connected=(void*)sdk_proc("PFGameSaveFilesIsConnectedToCloud");
    cleanup_async=(void*)sdk_proc("PFGameSaveFilesUninitializeAsync");
    cleanup_result=(void*)sdk_proc("PFGameSaveFilesUninitializeResult");
    query=(void*)GetProcAddress(runtime,"QueryApiImpl");
    if(!duplicate_user||!close_user||!compare_user||!set_callbacks||!upload_async||
       !upload_result||!connected||!cleanup_async||!cleanup_result||!query)
        return HRESULT_FROM_WIN32(ERROR_PROC_NOT_FOUND);
    hr=query(&threadingId,&threadingId,(void**)&threads);
    return FAILED(hr)?hr:threads?S_OK:E_POINTER;
}
typedef struct {
    void *user; LONG generation; unsigned kind,state;
    HRESULT error; uint64_t requiredBytes;
    SaveDescriptor local,remote;
} Dialog;
static void descriptor_text(const SaveDescriptor *d,WCHAR *out,size_t capacity)
{
    WCHAR description[256]=L"",date[64]=L"Unknown date";
    SYSTEMTIME systemTime;
    FILETIME ft;
    if(d->time>0 && d->time<253402300800LL) {
        ULARGE_INTEGER ticks;
        ticks.QuadPart=((uint64_t)d->time+11644473600ULL)*10000000ULL;
        ft.dwLowDateTime=ticks.LowPart;ft.dwHighDateTime=ticks.HighPart;
        if(FileTimeToSystemTime(&ft,&systemTime))
            swprintf(date,64,L"%04u-%02u-%02u %02u:%02u UTC",systemTime.wYear,
                systemTime.wMonth,systemTime.wDay,systemTime.wHour,systemTime.wMinute);
    }
    /* Fixed-size SDK fields need not be terminated in a malformed descriptor. */
    int n=0;while(n<255 && d->shortSaveDescription[n]) ++n;
    MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,d->shortSaveDescription,n,description,255);
    swprintf(out,capacity,L"%ls\n%ls\n%llu bytes",description[0]?description:L"No description",date,
        (unsigned long long)d->totalBytes);
}
static int choose(Dialog *dialog)
{
    WCHAR text[1800],local[512],remote[512];
    const WCHAR *instruction,*first,*second;
    unsigned buttons=MB_YESNOCANCEL|MB_DEFBUTTON3|MB_ICONWARNING|MB_SETFOREGROUND|MB_TASKMODAL;
    if(dialog->kind==1) {
        instruction=L"Synchronize the last completed cloud save?";
        first=L"Sync last completed cloud save";second=L"Retry";
        descriptor_text(&dialog->local,local,512);descriptor_text(&dialog->remote,remote,512);
        swprintf(text,1800,L"Another device has an unfinished cloud-save session. Close the game on that device and let its upload finish first.\n\nSynchronizing here uses the last completed cloud save, NOT that device's unfinished progress. Local files may be replaced; if no completed cloud save exists, a profile may be missing. That device can no longer upload its unfinished session. Cancel makes no selection.\n\nUNFINISHED SESSION\n%ls\n\nLAST COMPLETED CLOUD SAVE\n%ls",local,remote);
    } else if(dialog->kind==2) {
        instruction=L"Choose which save to keep";first=L"Use cloud save";second=L"Use local save";
        descriptor_text(&dialog->local,local,512);descriptor_text(&dialog->remote,remote,512);
        swprintf(text,1800,L"Local and cloud progress differ. The version you choose will be used for synchronization. Cancel leaves the choice unresolved.\n\nLOCAL\n%ls\n\nCLOUD\n%ls",local,remote);
    } else if(dialog->kind==3) {
        instruction=L"Cloud synchronization failed";first=L"Retry";second=NULL;
        swprintf(text,1800,L"Cloud synchronization failed (0x%08lx). Retry after checking the connection, or cancel synchronization. Local files will not be deleted.",(unsigned long)dialog->error);
        buttons=MB_RETRYCANCEL|MB_DEFBUTTON2|MB_ICONWARNING|MB_SETFOREGROUND|MB_TASKMODAL;
    } else {
        instruction=L"More disk space is required";first=L"Retry";second=NULL;
        swprintf(text,1800,L"Cloud synchronization needs %llu bytes of free disk space. Free space, then retry, or cancel synchronization.",(unsigned long long)dialog->requiredBytes);
        buttons=MB_RETRYCANCEL|MB_DEFBUTTON2|MB_ICONWARNING|MB_SETFOREGROUND|MB_TASKMODAL;
    }
#ifdef NEXUS_PGS_TEST
    extern int nexus_test_choice(unsigned);
    (void)instruction;(void)first;(void)second;(void)buttons;
    return nexus_test_choice(dialog->kind);
#else
    HMODULE controls=LoadLibraryW(L"comctl32.dll");
    HRESULT (WINAPI *task_dialog)(const TASKDIALOGCONFIG*,int*,int*,BOOL*)=
        controls?(void*)GetProcAddress(controls,"TaskDialogIndirect"):NULL;
    if(task_dialog) {
        TASKDIALOG_BUTTON options[2]={{100,first},{101,second}};
        TASKDIALOGCONFIG config={0};int selected=IDCANCEL;
        DWORD ownerPid=0;HWND owner=GetForegroundWindow();
        if(owner)GetWindowThreadProcessId(owner,&ownerPid);
        config.hwndParent=ownerPid==GetCurrentProcessId()?owner:NULL;
        config.cbSize=sizeof(config);config.dwFlags=TDF_ALLOW_DIALOG_CANCELLATION|TDF_SIZE_TO_CONTENT|TDF_POSITION_RELATIVE_TO_WINDOW;
        config.dwCommonButtons=TDCBF_CANCEL_BUTTON;config.pszWindowTitle=L"Nexus runtime — Cloud saves";
        config.pszMainInstruction=instruction;config.pszContent=text;
        config.cButtons=second?2:1;config.pButtons=options;config.nDefaultButton=IDCANCEL;
        HRESULT hr=task_dialog(&config,&selected,NULL,NULL);
        FreeLibrary(controls);
        if(SUCCEEDED(hr)) return selected==100?1:selected==101?2:0;
    } else if(controls) FreeLibrary(controls);
    /* Explicit labels in fallback text, never rely on ambiguous Yes/No. */
    if(second) wcscat(text,dialog->kind==2?L"\n\nYES = Cloud save; NO = Local save; CANCEL = Neither":L"\n\nYES = Sync last completed cloud save; NO = Retry; CANCEL = Stop synchronization");
    int selected=MessageBoxW(NULL,text,L"Nexus runtime — Cloud saves",buttons);
    return selected==IDYES||selected==IDRETRY?1:selected==IDNO?2:0;
#endif
}
static DWORD WINAPI dialog_worker(void *arg)
{
    Dialog *d=arg;
    int choice;
    unsigned action;
    const char *name;
    HRESULT (WINAPI *respond)(void*,unsigned);
    AcquireSRWLockExclusive(&uiLock);
    choice=d->generation==InterlockedCompareExchange(&generation,0,0)?choose(d):0;
    ReleaseSRWLockExclusive(&uiLock);
    name=d->kind==1?"PFGameSaveFilesSetUiActiveDeviceContentionResponse":
         d->kind==2?"PFGameSaveFilesSetUiConflictResponse":
         d->kind==3?"PFGameSaveFilesSetUiSyncFailedResponse":"PFGameSaveFilesSetUiOutOfStorageResponse";
    action=d->kind==1?(choice==1?2:choice==2?1:0):d->kind==2?(choice==1?2:choice==2?1:0):choice==1?1:0;
    respond=(void*)sdk_proc(name);
    if(respond && d->generation==InterlockedCompareExchange(&generation,0,0))
        note("dialog response",respond(d->user,action));
    close_user(d->user);HeapFree(GetProcessHeap(),0,d);return 0;
}
static void show_dialog(unsigned kind,void *user,SaveDescriptor *local,SaveDescriptor *remote,
                        unsigned state,HRESULT error,uint64_t requiredBytes)
{
    Dialog *d=HeapAlloc(GetProcessHeap(),HEAP_ZERO_MEMORY,sizeof(*d));
    HANDLE worker;
    HRESULT hr=d?duplicate_user(user,&d->user):E_OUTOFMEMORY;
    if(SUCCEEDED(hr)) {
        d->generation=InterlockedCompareExchange(&generation,0,0);d->kind=kind;
        d->state=state;d->error=error;d->requiredBytes=requiredBytes;
        if(local) d->local=*local;
        if(remote) d->remote=*remote;
        worker=CreateThread(NULL,0,dialog_worker,d,0,NULL);
        if(worker) {CloseHandle(worker);return;}
        hr=HRESULT_FROM_WIN32(GetLastError());close_user(d->user);
    }
    if(d) HeapFree(GetProcessHeap(),0,d);
    note("dialog unavailable",hr);
    const char *name=kind==1?"PFGameSaveFilesSetUiActiveDeviceContentionResponse":kind==2?
        "PFGameSaveFilesSetUiConflictResponse":kind==3?"PFGameSaveFilesSetUiSyncFailedResponse":"PFGameSaveFilesSetUiOutOfStorageResponse";
    HRESULT (WINAPI *respond)(void*,unsigned)=(void*)sdk_proc(name);
    if(respond) respond(user,0); /* Fail closed; never choose a save on failure. */
}
static void WINAPI contention_ui(void *u,SaveDescriptor *l,SaveDescriptor *r,void *context)
{ (void)context;show_dialog(1,u,l,r,0,S_OK,0); }
static void WINAPI conflict_ui(void *u,SaveDescriptor *l,SaveDescriptor *r,void *context)
{ (void)context;show_dialog(2,u,l,r,0,S_OK,0); }
static void WINAPI failed_ui(void *u,unsigned state,HRESULT hr,void *context)
{ (void)context;show_dialog(3,u,NULL,NULL,state,hr,0); }
static void WINAPI storage_ui(void *u,uint64_t needed,void *context)
{ (void)context;show_dialog(4,u,NULL,NULL,0,S_OK,needed); }
static HRESULT install_callbacks(void)
{
    SaveCallbacks callbacks=titleCallbacks;
    if(!callbacks.contention){callbacks.contention=contention_ui;callbacks.contentionContext=NULL;}
    if(!callbacks.conflict){callbacks.conflict=conflict_ui;callbacks.conflictContext=NULL;}
    if(!callbacks.failed){callbacks.failed=failed_ui;callbacks.failedContext=NULL;}
    if(!callbacks.storage){callbacks.storage=storage_ui;callbacks.storageContext=NULL;}
    return set_callbacks(&callbacks);
}
HRESULT nexus_session_initialized(HMODULE sdk)
{
    BOOLEAN grts=TRUE;
    HMODULE core=GetModuleHandleW(L"PlayFabCore.dll");
    HRESULT (WINAPI *available)(BOOLEAN*)=core?(void*)GetProcAddress(core,"PFPlatformIsGRTSAvailable"):NULL;
    HKEY key;DWORD force=0,size=sizeof(force),type=0;
    if(!RegOpenKeyExW(HKEY_LOCAL_MACHINE,L"SOFTWARE\\Microsoft\\GamingServices",0,KEY_READ,&key)) {
        if(RegQueryValueExW(key,L"ForceUseInprocGameSaves",NULL,&type,(BYTE*)&force,&size)||type!=REG_DWORD)force=0;
        RegCloseKey(key);
    }
    if(!force && (!available || FAILED(available(&grts)) || grts)) return S_OK;
    AcquireSRWLockExclusive(&sessionLock);
    HRESULT hr=bind_session(sdk);
    if(SUCCEEDED(hr)&&!sessionDone) {
        sessionDone=CreateEventW(NULL,TRUE,TRUE,NULL);
        if(!sessionDone)hr=HRESULT_FROM_WIN32(GetLastError());
    }
    if(SUCCEEDED(hr)) {
        InterlockedIncrement(&generation);closing=FALSE;enabled=TRUE;
        hr=install_callbacks();
        if(SUCCEEDED(hr)) {
            HMODULE runtime=GetModuleHandleW(L"xgameruntime.dll");
            HRESULT(WINAPI *register_drain)(HRESULT(WINAPI *)(void*),void*)=
                runtime?(void*)GetProcAddress(runtime,"NexusRegisterCloudShutdown"):NULL;
            if(register_drain)hr=register_drain(drain_session,NULL);
            else note("runtime drain unavailable",HRESULT_FROM_WIN32(ERROR_PROC_NOT_FOUND));
        }
        if(SUCCEEDED(hr)){sessionResult=S_OK;ResetEvent(sessionDone);}
        if(FAILED(hr))enabled=FALSE;
    }
    ReleaseSRWLockExclusive(&sessionLock);
    note("session setup",hr);
    return hr;
}
HRESULT nexus_session_callbacks(HMODULE sdk,SaveCallbacks *callbacks)
{
    HRESULT (WINAPI *f)(SaveCallbacks*)=(void*)GetProcAddress(sdk,"PFGameSaveFilesSetUiCallbacks");
    if(!f)return HRESULT_FROM_WIN32(ERROR_PROC_NOT_FOUND);
    AcquireSRWLockExclusive(&sessionLock);
    SaveCallbacks previous=titleCallbacks;
    if(callbacks)titleCallbacks=*callbacks;else ZeroMemory(&titleCallbacks,sizeof(titleCallbacks));
    HRESULT hr=enabled?install_callbacks():f(callbacks);
    if(FAILED(hr))titleCallbacks=previous;
    ReleaseSRWLockExclusive(&sessionLock);return hr;
}
HRESULT nexus_session_add_user(HMODULE sdk,void *user,unsigned options,NexusAsync *async)
{
    HRESULT (WINAPI *f)(void*,unsigned,NexusAsync*)=(void*)GetProcAddress(sdk,"PFGameSaveFilesAddUserWithUiAsync");
    if(!f)return HRESULT_FROM_WIN32(ERROR_PROC_NOT_FOUND);
    AcquireSRWLockExclusive(&sessionLock);
    if(enabled) {
        if(closing){ReleaseSRWLockExclusive(&sessionLock);return E_ABORT;}
        SaveUser *entry;for(entry=users;entry;entry=entry->next)if(!compare_user(entry->handle,user))break;
        if(!entry) {
            entry=HeapAlloc(GetProcessHeap(),HEAP_ZERO_MEMORY,sizeof(*entry));
            HRESULT hr=entry?duplicate_user(user,&entry->handle):E_OUTOFMEMORY;
            if(FAILED(hr)){if(entry)HeapFree(GetProcessHeap(),0,entry);ReleaseSRWLockExclusive(&sessionLock);return hr;}
            entry->next=users;users=entry;
        }
    }
    ReleaseSRWLockExclusive(&sessionLock);return f(user,options,async);
}
typedef struct {
    LONG refs;NexusAsync *outer,upload,cleanup;void *queue;
    HANDLE done;SaveUser *users;NexusThreads *threads;
} Finish;
static void finish_release(Finish *f)
{
    if(InterlockedDecrement(&f->refs))return;
    f->threads->vtable->close_queue(f->threads,f->queue);
    CloseHandle(f->done);f->threads->vtable->release(f->threads);
    HeapFree(GetProcessHeap(),0,f);
}
static void WINAPI signal_done(NexusAsync *async) { SetEvent((HANDLE)async->context); }
static DWORD WINAPI finish_worker(void *arg)
{
    Finish *f=arg;HRESULT result=S_OK,hr;
    char syncMode[16]={0};
    GetEnvironmentVariableA("XODUS_SAVE_SYNC",syncMode,sizeof(syncMode));
    for(SaveUser *u=f->users;u;u=u->next) {
        if(!strcmp(syncMode,"none"))continue; /* Preserve explicit cloud opt-out. */
        BOOLEAN cloud=FALSE;
        hr=connected(u->handle,&cloud);
        if(FAILED(hr)||!cloud)continue; /* Failed/offline AddUser owns no cloud lock. */
        ZeroMemory(&f->upload,sizeof(f->upload));f->upload.queue=f->queue;
        f->upload.context=f->done;f->upload.callback=signal_done;ResetEvent(f->done);
        note("upload requested",S_OK);
        hr=upload_async(u->handle,1,&f->upload); /* ReleaseDeviceAsActive, official SDK enum. */
        if(SUCCEEDED(hr)) {
            WaitForSingleObject(f->done,INFINITE);
            hr=upload_result(&f->upload);
        }
        note("final upload",hr);
        if(FAILED(hr)&&SUCCEEDED(result))result=hr;
    }
    while(f->users) {
        SaveUser *u=f->users;f->users=u->next;close_user(u->handle);HeapFree(GetProcessHeap(),0,u);
    }
    /* Cleanup must still run after a genuine sync failure; preserve that error. */
    f->cleanup.queue=f->queue;f->cleanup.context=f->done;f->cleanup.callback=signal_done;
    ResetEvent(f->done);hr=cleanup_async(&f->cleanup);
    if(SUCCEEDED(hr)){WaitForSingleObject(f->done,INFINITE);hr=cleanup_result(&f->cleanup);}
    if(FAILED(hr)&&SUCCEEDED(result))result=hr;
    AcquireSRWLockExclusive(&sessionLock);enabled=FALSE;closing=FALSE;
    sessionResult=result;SetEvent(sessionDone);
    ZeroMemory(&titleCallbacks,sizeof(titleCallbacks));InterlockedIncrement(&generation);
    ReleaseSRWLockExclusive(&sessionLock);
    note("session closed",result);
    f->threads->vtable->complete(f->threads,f->outer,result,0);
    finish_release(f);return 0;
}
static HRESULT WINAPI finish_provider(unsigned op,const NexusProviderData *data)
{
    Finish *f=data->context;
    if(op==0) {
        f->outer=data->async;InterlockedIncrement(&f->refs);
        HANDLE worker=CreateThread(NULL,0,finish_worker,f,0,NULL);
        if(!worker){
            HRESULT hr=HRESULT_FROM_WIN32(GetLastError());
            AcquireSRWLockExclusive(&sessionLock);users=f->users;f->users=NULL;closing=FALSE;
            ReleaseSRWLockExclusive(&sessionLock);finish_release(f);return hr;
        }
        CloseHandle(worker);
    } else if(op==4)finish_release(f);
    return S_OK;
}
HRESULT nexus_session_cleanup(HMODULE sdk,NexusAsync *async)
{
    HRESULT (WINAPI *native)(NexusAsync*)=(void*)GetProcAddress(sdk,"PFGameSaveFilesUninitializeAsync");
    if(!async)return E_INVALIDARG;
    note("cleanup requested",S_OK);
    AcquireSRWLockExclusive(&sessionLock);
    if(!enabled){ReleaseSRWLockExclusive(&sessionLock);return native?native(async):HRESULT_FROM_WIN32(ERROR_PROC_NOT_FOUND);}
    if(closing){ReleaseSRWLockExclusive(&sessionLock);return E_ABORT;}
    Finish *f=HeapAlloc(GetProcessHeap(),HEAP_ZERO_MEMORY,sizeof(*f));
    HRESULT hr=f?S_OK:E_OUTOFMEMORY;
    if(f) {
        f->threads=threads;threads->vtable->addref(threads);f->refs=1;
        f->done=CreateEventW(NULL,TRUE,FALSE,NULL);
        hr=f->done?threads->vtable->create_queue(threads,1,1,&f->queue):HRESULT_FROM_WIN32(GetLastError());
        if(FAILED(hr)){if(f->done)CloseHandle(f->done);threads->vtable->release(threads);HeapFree(GetProcessHeap(),0,f);f=NULL;}
    }
    if(SUCCEEDED(hr)){closing=TRUE;f->users=users;users=NULL;}
    ReleaseSRWLockExclusive(&sessionLock);
    if(FAILED(hr))return hr;
    /* The real caller's completion port and callback remain owned by XAsync. */
    hr=threads->vtable->begin(threads,async,f,NULL,"Nexus PlayFab final synchronization",finish_provider);
    if(FAILED(hr)) {
        AcquireSRWLockExclusive(&sessionLock);users=f->users;f->users=NULL;closing=FALSE;
        ReleaseSRWLockExclusive(&sessionLock);finish_release(f);
    }
    return hr;
}
/* Runtime Uninitialize is synchronous and outside the loader lock. SDK cleanup
 * stays asynchronous; this final barrier waits for acknowledged SDK work, not
 * the title's Manual completion callback. It cannot cover ExitProcess/kill. */
static HRESULT WINAPI drain_session(void *context)
{
    NexusAsync async={0};HANDLE complete=NULL;void *queue=NULL;
    HRESULT hr=S_OK;BOOL active,inFlight;
    (void)context;
    AcquireSRWLockExclusive(&drainLock);
    AcquireSRWLockShared(&sessionLock);active=enabled;inFlight=closing;
    ReleaseSRWLockShared(&sessionLock);
    note("runtime drain requested",S_OK);
    if(active&&!inFlight) {
        complete=CreateEventW(NULL,TRUE,FALSE,NULL);
        hr=complete?threads->vtable->create_queue(threads,1,1,&queue):HRESULT_FROM_WIN32(GetLastError());
        if(SUCCEEDED(hr)) {
            async.queue=queue;async.context=complete;async.callback=signal_done;
            hr=nexus_session_cleanup(sdkModule,&async);
            if(SUCCEEDED(hr)) {
                /* Our stack async cannot outlive its completion callback. */
                WaitForSingleObject(complete,INFINITE);
                hr=threads->vtable->status(threads,&async,FALSE);
            } else if(hr==E_ABORT) {
                AcquireSRWLockShared(&sessionLock);inFlight=closing;
                ReleaseSRWLockShared(&sessionLock);
                if(inFlight){WaitForSingleObject(sessionDone,INFINITE);hr=sessionResult;}
            }
        }
    } else {
        if(inFlight)WaitForSingleObject(sessionDone,INFINITE);
        hr=sessionResult;
    }
    if(queue)threads->vtable->close_queue(threads,queue);
    if(complete)CloseHandle(complete);
    note("runtime drain complete",hr);
    ReleaseSRWLockExclusive(&drainLock);
    return hr;
}
