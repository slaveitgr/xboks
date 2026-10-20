/* SPDX-License-Identifier: MIT
 * Synthetic SDK/user fixtures. No identities, services, account or saves.
 */
#define COBJMACROS
#define INITGUID
#include <windows.h>
#include <stdint.h>
#include <stddef.h>
#include <stdio.h>
#include "../runtime-compat/playfab-session.h"
#if defined(PROBE_CORE)
static LONG references[3]={0,1,1};
__declspec(dllexport) HRESULT WINAPI PFLocalUserDuplicateHandle(void *u,void **out)
{ if((uintptr_t)u<1||(uintptr_t)u>2||!out)return E_INVALIDARG;InterlockedIncrement(&references[(uintptr_t)u]);*out=u;return S_OK; }
__declspec(dllexport) void WINAPI PFLocalUserCloseHandle(void *u)
{ if((uintptr_t)u>=1&&(uintptr_t)u<=2)InterlockedDecrement(&references[(uintptr_t)u]); }
__declspec(dllexport) int32_t WINAPI PFLocalUserHandleCompare(void *a,void *b)
{ return (intptr_t)a==(intptr_t)b?0:(intptr_t)a<(intptr_t)b?-1:1; }
__declspec(dllexport) HRESULT WINAPI PFPlatformIsGRTSAvailable(BOOLEAN *out)
{ if(!out)return E_POINTER;*out=FALSE;return S_OK; }
__declspec(dllexport) LONG WINAPI FixtureReferences(unsigned u)
{ return u<3?references[u]:-1; }
#elif defined(PROBE_PROXY)
static LONG selected;
__declspec(dllexport) void WINAPI NexusTestSetChoice(int choice) {InterlockedExchange(&selected,choice);}
int nexus_test_choice(unsigned kind) {(void)kind;Sleep(40);return InterlockedCompareExchange(&selected,0,0);}
#elif defined(PROBE_SDK)
static NexusThreads *api;
static SaveCallbacks callbacks;
static LONG uploadCalls,uploaded,cleanupCalls,badOrder,response=-1;
static HRESULT uploadError,addError;
static BOOLEAN online[3];
static unsigned uploadOption;
static HANDLE uiDone;
static const GUID tid={0x073b7dcb,0x1fcf,0x4030,{0x94,0xbe,0xe3,0xc9,0xeb,0x62,0x34,0x28}};
typedef struct {HRESULT error;BOOL upload;} Mock;
static HRESULT WINAPI provider(unsigned op,const NexusProviderData *data)
{
    Mock *m=data->context;
    if(op==0) {
        HRESULT(WINAPI *schedule)(NexusThreads*,NexusAsync*,UINT32)=(void*)api->vtable->unused_schedule;
        return schedule(api,data->async,0);
    }
    if(op==1) {
        Sleep(40);if(m->upload)InterlockedIncrement(&uploaded);
        api->vtable->complete(api,data->async,m->error,0);return E_PENDING;
    }
    if(op==4)HeapFree(GetProcessHeap(),0,m);
    return S_OK;
}
static HRESULT start(NexusAsync *async,HRESULT hr,BOOL upload)
{
    Mock *m=HeapAlloc(GetProcessHeap(),0,sizeof(*m));if(!m)return E_OUTOFMEMORY;
    m->error=hr;m->upload=upload;
    HRESULT result=api->vtable->begin(api,async,m,NULL,"synthetic SDK operation",provider);
    if(FAILED(result))HeapFree(GetProcessHeap(),0,m);
    return result;
}
typedef struct {void *queue;uint64_t options;const char *folder;} Args;
__declspec(dllexport) HRESULT WINAPI PFGameSaveFilesInitialize(const Args *args)
{
    if(!args)return E_INVALIDARG;
    HMODULE runtime=GetModuleHandleW(L"xgameruntime.dll");
    HRESULT(WINAPI *query)(const GUID*,const GUID*,void**)=(void*)GetProcAddress(runtime,"QueryApiImpl");
    if(!api&&FAILED(query(&tid,&tid,(void**)&api)))return E_FAIL;
    if(!uiDone)uiDone=CreateEventW(NULL,TRUE,FALSE,NULL);
    return S_OK;
}
__declspec(dllexport) HRESULT WINAPI PFGameSaveFilesSetUiCallbacks(SaveCallbacks *c)
{ if(c)callbacks=*c;else ZeroMemory(&callbacks,sizeof(callbacks));return S_OK; }
__declspec(dllexport) HRESULT WINAPI PFGameSaveFilesAddUserWithUiAsync(void *u,unsigned options,NexusAsync *async)
{ (void)options;(void)async;if((uintptr_t)u<1||(uintptr_t)u>2)return E_INVALIDARG;online[(uintptr_t)u]=SUCCEEDED(addError);return addError; }
__declspec(dllexport) HRESULT WINAPI PFGameSaveFilesIsConnectedToCloud(void *u,BOOLEAN *out)
{ if(!out|| (uintptr_t)u<1||(uintptr_t)u>2)return E_INVALIDARG;*out=online[(uintptr_t)u];return S_OK; }
__declspec(dllexport) HRESULT WINAPI PFGameSaveFilesUploadWithUiAsync(void *u,unsigned option,NexusAsync *async)
{ (void)u;++uploadCalls;uploadOption=option;return start(async,uploadError,TRUE); }
__declspec(dllexport) HRESULT WINAPI PFGameSaveFilesUploadWithUiResult(NexusAsync *async)
{ return api->vtable->status(api,async,FALSE); }
__declspec(dllexport) HRESULT WINAPI PFGameSaveFilesUninitializeAsync(NexusAsync *async)
{ ++cleanupCalls;if(uploaded!=uploadCalls)++badOrder;ZeroMemory(online,sizeof(online));return start(async,S_OK,FALSE); }
__declspec(dllexport) HRESULT WINAPI PFGameSaveFilesUninitializeResult(NexusAsync *async)
{ return api->vtable->status(api,async,FALSE); }
__declspec(dllexport) HRESULT WINAPI FixtureResponse(void *u,unsigned action)
{ (void)u;InterlockedExchange(&response,action);SetEvent(uiDone);return S_OK; }
__declspec(dllexport) void WINAPI FixtureReset(HRESULT upload,HRESULT add)
{ uploadCalls=uploaded=cleanupCalls=badOrder=0;uploadError=upload;addError=add;uploadOption=99; }
__declspec(dllexport) LONG WINAPI FixtureCount(unsigned kind)
{ return kind==0?uploadCalls:kind==1?uploaded:kind==2?cleanupCalls:kind==3?badOrder:kind==4?(LONG)uploadOption:response; }
__declspec(dllexport) HRESULT WINAPI FixtureUi(unsigned kind)
{
    SaveDescriptor local={0},remote={0};local.time=remote.time=1700000000;
    local.totalBytes=12;remote.totalBytes=24;
    ResetEvent(uiDone);InterlockedExchange(&response,-1);
    if(kind==1&&callbacks.contention)callbacks.contention((void*)1,&local,&remote,callbacks.contentionContext);
    else if(kind==2&&callbacks.conflict)callbacks.conflict((void*)1,&local,&remote,callbacks.conflictContext);
    else if(kind==3&&callbacks.failed)callbacks.failed((void*)1,1,E_ACCESSDENIED,callbacks.failedContext);
    else if(kind==4&&callbacks.storage)callbacks.storage((void*)1,1024,callbacks.storageContext);
    else return E_NOTIMPL;
    return S_OK;
}
__declspec(dllexport) DWORD WINAPI FixtureWait(void) {return WaitForSingleObject(uiDone,3000);}
__declspec(dllexport) HRESULT WINAPI FixtureStub(void) {return E_NOTIMPL;}
#else
#include "xtaskqueue.h"
#include "xasyncprovider.h"
_Static_assert(sizeof(NexusAsync)==sizeof(XAsyncBlock),"async size");
_Static_assert(offsetof(NexusAsync,internal)==offsetof(XAsyncBlock,internal),"async state");
_Static_assert(sizeof(NexusProviderData)==sizeof(XAsyncProviderData),"provider data");
#define ABI(member,native) _Static_assert(offsetof(NexusThreadsVtable,member)==offsetof(IXThreadingImplVtbl,native),"threading slot " #member)
ABI(status,XAsyncGetStatus);ABI(begin,XAsyncBegin);ABI(complete,XAsyncComplete);
ABI(create_queue,XTaskQueueCreate);ABI(close_queue,XTaskQueueCloseHandle);
static unsigned checks,failures;static LONG customCalls,completions;
#define CHECK(x) do{++checks;if(!(x)){++failures;printf("FAIL %d: %s\n",__LINE__,#x);}}while(0)
static HRESULT(WINAPI *response_fn)(void*,unsigned);
static void WINAPI custom_conflict(void *u,SaveDescriptor *l,SaveDescriptor *r,void *context)
{ (void)l;(void)r;CHECK(context==(void*)0x1234);++customCalls;response_fn(u,0); }
static void WINAPI completion(NexusAsync *async) {CHECK(async->context==(void*)0x5678);InterlockedIncrement(&completions);}
int main(void)
{
    SetEnvironmentVariableA("XODUS_SAVE_SYNC","auto"); /* Synthetic SDK only. */
    HMODULE runtime=LoadLibraryW(L"xgameruntime.dll"),core=LoadLibraryW(L"PlayFabCore.dll"),proxy=LoadLibraryW(L"PlayFabGameSave.dll"),sdk=GetModuleHandleW(L"nexus_pgs_native.dll");
    CHECK(runtime&&core&&proxy);if(!runtime||!core||!proxy)return 2;
    HRESULT(WINAPI *init)(void*)=(void*)GetProcAddress(proxy,"PFGameSaveFilesInitialize");
    HRESULT(WINAPI *add)(void*,unsigned,NexusAsync*)=(void*)GetProcAddress(proxy,"PFGameSaveFilesAddUserWithUiAsync");
    HRESULT(WINAPI *cleanup)(NexusAsync*)=(void*)GetProcAddress(proxy,"PFGameSaveFilesUninitializeAsync");
    HRESULT(WINAPI *set)(SaveCallbacks*)=(void*)GetProcAddress(proxy,"PFGameSaveFilesSetUiCallbacks");
    void(WINAPI *choice)(int)=(void*)GetProcAddress(proxy,"NexusTestSetChoice");
    struct {void*queue;uint64_t options;const char*folder;} args={NULL,0,"caller-path"};
    CHECK(init(&args)==S_OK);sdk=GetModuleHandleW(L"nexus_pgs_native.dll");CHECK(sdk!=NULL);if(!sdk)return 3;
    HRESULT(WINAPI *ui)(unsigned)=(void*)GetProcAddress(sdk,"FixtureUi");
    DWORD(WINAPI *wait_ui)(void)=(void*)GetProcAddress(sdk,"FixtureWait");
    void(WINAPI *reset)(HRESULT,HRESULT)=(void*)GetProcAddress(sdk,"FixtureReset");
    LONG(WINAPI *count)(unsigned)=(void*)GetProcAddress(sdk,"FixtureCount");
    LONG(WINAPI *refs)(unsigned)=(void*)GetProcAddress(core,"FixtureReferences");
    response_fn=(void*)GetProcAddress(sdk,"FixtureResponse");
    CHECK(choice&&ui&&wait_ui&&reset&&count&&refs&&response_fn);if(!choice||!ui||!refs)return 4;
    for(unsigned kind=1;kind<=4;++kind)for(int c=0;c<=2;++c) {
        choice(c);ULONGLONG start=GetTickCount64();CHECK(ui(kind)==S_OK);
        CHECK(GetTickCount64()-start<30);CHECK(wait_ui()==WAIT_OBJECT_0);
        LONG expected=kind<=2?(c==1?2:c==2?1:0):c==1?1:0;CHECK(count(5)==expected);
    }
    SaveCallbacks custom={0};custom.conflict=custom_conflict;custom.conflictContext=(void*)0x1234;
    CHECK(set(&custom)==S_OK);CHECK(ui(2)==S_OK);CHECK(wait_ui()==WAIT_OBJECT_0);CHECK(customCalls==1&&count(5)==0);
    CHECK(set(NULL)==S_OK);choice(0);CHECK(ui(2)==S_OK);CHECK(wait_ui()==WAIT_OBJECT_0);CHECK(customCalls==1);
    IXThreadingImpl *threads;
    HRESULT(WINAPI *query)(const GUID*,const GUID*,void**)=(void*)GetProcAddress(runtime,"QueryApiImpl");
    CHECK(query(&CLSID_XThreadingImpl,&IID_IXThreadingImpl,(void**)&threads)==S_OK);
    XTaskQueueHandle queue;CHECK(IXThreadingImpl_XTaskQueueCreate(threads,XTaskQueueDispatchMode_Manual,XTaskQueueDispatchMode_Manual,&queue)==S_OK);
    for(unsigned mode=0;mode<4;++mode) {
        SetEnvironmentVariableA("XODUS_SAVE_SYNC",mode==3?"none":"auto");
        reset(mode==1?E_ACCESSDENIED:S_OK,mode==2?E_ACCESSDENIED:S_OK);
        NexusAsync dummy={0};CHECK(add((void*)1,0,&dummy)==(mode==2?E_ACCESSDENIED:S_OK));
        if(mode==0)CHECK(add((void*)2,0,&dummy)==S_OK);
        CHECK(refs(1)>=2);
        NexusAsync finish={0};finish.queue=queue;finish.context=(void*)0x5678;finish.callback=completion;
        ULONGLONG start=GetTickCount64();CHECK(cleanup(&finish)==S_OK);CHECK(GetTickCount64()-start<30);
        while(InterlockedCompareExchange(&completions,0,0)<(LONG)mode+1&&GetTickCount64()-start<3000)
            IXThreadingImpl_XTaskQueueDispatch(threads,queue,XTaskQueuePort_Completion,50);
        CHECK(completions==(LONG)mode+1);
        CHECK(IXThreadingImpl_XAsyncGetStatus(threads,(XAsyncBlock*)&finish,FALSE)==(mode==1?E_ACCESSDENIED:S_OK));
        CHECK(count(0)==(mode==0?2:mode==1?1:0));CHECK(count(1)==count(0));
        CHECK(count(2)==1&&count(3)==0);if(mode<2)CHECK(count(4)==1);
        CHECK(refs(1)==1&&refs(2)==1);
        if(mode<3)CHECK(init(&args)==S_OK);
    }
    HRESULT(WINAPI *runtime_exit)(void)=(void*)GetProcAddress(runtime,"UninitializeApiImpl");
    CHECK(runtime_exit!=NULL);
    if(runtime_exit)for(unsigned mode=0;mode<3;++mode) {
        CHECK(init(&args)==S_OK);SetEnvironmentVariableA("XODUS_SAVE_SYNC","auto");
        reset(mode==1?E_ACCESSDENIED:S_OK,S_OK);
        NexusAsync dummy={0};CHECK(add((void*)1,0,&dummy)==S_OK);
        NexusAsync pending={0};pending.queue=queue;pending.context=(void*)0x5678;pending.callback=completion;
        /* A title can leave its Manual callback unpumped during shutdown. */
        if(mode==2)CHECK(cleanup(&pending)==S_OK);
        CHECK(runtime_exit()==(mode==1?E_ACCESSDENIED:S_OK));
        CHECK(count(0)==1&&count(1)==1&&count(2)==1&&count(3)==0);
        CHECK(refs(1)==1);
        if(mode==2) {
            ULONGLONG start=GetTickCount64();
            while(completions<5&&GetTickCount64()-start<3000)
                IXThreadingImpl_XTaskQueueDispatch(threads,queue,XTaskQueuePort_Completion,50);
            CHECK(completions==5);
        }
    }
    IXThreadingImpl_XTaskQueueCloseHandle(threads,queue);IXThreadingImpl_Release(threads);
    printf("CHECKS %u FAILURES %u\n",checks,failures);return failures?1:0;
}
#endif
