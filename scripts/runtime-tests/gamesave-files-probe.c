/* SPDX-License-Identifier: MIT
 * File-provider ABI/lifetime probe. Synthetic identity, explicit offline mode;
 * no account, network or real saves. Actual provider, child and filesystem. */
#define COBJMACROS
#define INITGUID
#include <windows.h>
#include <stdio.h>
#include "xtaskqueue.h"
#include "xasyncprovider.h"
#include "xuser.h"
#include "xgamesave.h"
#include "userprovider.h"
struct test_user {
    IUser iface; LONG refs;
    void *key;
    char *proof, *user, *device, *title, *auth;
    ULONGLONG auth_time;
    CRITICAL_SECTION cs;
    CONDITION_VARIABLE cv;
    LONG initialized; HRESULT result;
    UINT64 xuid;
};
static ULONG WINAPI retain(IUser *iface) { return InterlockedIncrement(&((struct test_user *)iface)->refs); }
static ULONG WINAPI release(IUser *iface) { return InterlockedDecrement(&((struct test_user *)iface)->refs); }
static IUserVtbl user_vtable = {NULL, retain, release};
static LONG checks, failures;
#define CHECK(n,v) do { checks++; if (!(v)) { failures++; printf("FAIL %s\n",n); } } while(0)
static LONG WINAPI exception(EXCEPTION_POINTERS *e) {
    printf("FAIL exception=%08lx\n",e->ExceptionRecord->ExceptionCode); fflush(stdout); ExitProcess(77); return EXCEPTION_CONTINUE_SEARCH;
}
int main(void) {
    AddVectoredExceptionHandler(1,exception);
    SetEnvironmentVariableA("XODUS_SAVE_SYNC","none");
    HMODULE dll=LoadLibraryA("xgameruntime.dll");
    HRESULT (WINAPI *query)(REFCLSID,REFIID,void **)=dll?(void *)GetProcAddress(dll,"QueryApiImpl"):NULL;
    IXThreadingImpl *threads=NULL; IXGameSaveImpl3 *saves=NULL;
    CHECK("interfaces",query && SUCCEEDED(query(&CLSID_XThreadingImpl,&IID_IXThreadingImpl,(void **)&threads)) &&
        SUCCEEDED(query(&CLSID_XGameSaveImpl,&IID_IXGameSaveImpl3,(void **)&saves)));
    if (!threads || !saves) return 1;
    struct test_user user={0}; user.iface.lpVtbl=&user_vtable; user.refs=1; user.xuid=42;
    const char *scid="00000000-0000-0000-0000-000000000042";
    XTaskQueueHandle queue=NULL; XAsyncBlock block={0};
    CHECK("queue",SUCCEEDED(IXThreadingImpl_XTaskQueueCreate(threads,XTaskQueueDispatchMode_Manual,XTaskQueueDispatchMode_Manual,&queue)));
    block.queue=queue;
    CHECK("null-user",IXGameSaveImpl3_XGameSaveFilesGetFolderWithUiAsync(saves,NULL,scid,&block)==E_INVALIDARG);
    CHECK("invalid-scid",IXGameSaveImpl3_XGameSaveFilesGetFolderWithUiAsync(saves,(XUserHandle)&user,"../escape",&block)==E_INVALIDARG);
    CHECK("begin",SUCCEEDED(IXGameSaveImpl3_XGameSaveFilesGetFolderWithUiAsync(saves,(XUserHandle)&user,scid,&block)));
    ULONGLONG start=GetTickCount64();
    CHECK("work-dispatch",IXThreadingImpl_XTaskQueueDispatch(threads,queue,XTaskQueuePort_Work,0));
    CHECK("nonblocking-dispatch",GetTickCount64()-start<200);
    HRESULT hr=E_PENDING;
    for(unsigned i=0;i<200 && hr==E_PENDING;i++) { Sleep(50); hr=IXThreadingImpl_XAsyncGetStatus(threads,&block,FALSE); }
    printf("FOLDER_STATUS %08lx\n",hr); CHECK("folder-ready",hr==S_OK);
    char folder[2048]={0};
    CHECK("small-buffer",FAILED(IXGameSaveImpl3_XGameSaveFilesGetFolderWithUiResult(saves,&block,1,folder)));
    CHECK("folder-result",SUCCEEDED(IXGameSaveImpl3_XGameSaveFilesGetFolderWithUiResult(saves,&block,sizeof(folder),folder)));
    WCHAR wide[2048], child[2048];
    CHECK("UTF8",MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,folder,-1,wide,2048)>0);
    CHECK("directory",GetFileAttributesW(wide)!=INVALID_FILE_ATTRIBUTES);
    swprintf(child,2048,L"%ls\\Save1",wide); CHECK("container",CreateDirectoryW(child,NULL));
    swprintf(child,2048,L"%ls\\Save1\\Nested",wide); CHECK("nested-container",CreateDirectoryW(child,NULL));
    swprintf(child,2048,L"%ls\\Save1\\Nested\\stav-\x010d.dat",wide);
    HANDLE file=CreateFileW(child,GENERIC_WRITE,0,NULL,CREATE_NEW,0,NULL); DWORD written=0;
    CHECK("unicode-file",file!=INVALID_HANDLE_VALUE && WriteFile(file,"test",4,&written,NULL) && written==4);
    if(file!=INVALID_HANDLE_VALUE)CloseHandle(file);
    INT64 quota=0;
    CHECK("actual-quota",SUCCEEDED(IXGameSaveImpl3_XGameSaveFilesGetRemainingQuota(saves,(XUserHandle)&user,scid,&quota)) && quota==256LL*1024*1024-4);
    swprintf(child,2048,L"%ls\\ignored.txt",wide); file=CreateFileW(child,GENERIC_WRITE,0,NULL,CREATE_NEW,0,NULL);
    if(file!=INVALID_HANDLE_VALUE) { WriteFile(file,"ignore",6,&written,NULL); CloseHandle(file); }
    CHECK("root-files-ignored",SUCCEEDED(IXGameSaveImpl3_XGameSaveFilesGetRemainingQuota(saves,(XUserHandle)&user,scid,&quota)) && quota==256LL*1024*1024-4);
    ZeroMemory(&block,sizeof(block)); block.queue=queue; char again[2048];
    CHECK("repeat-begin",SUCCEEDED(IXGameSaveImpl3_XGameSaveFilesGetFolderWithUiAsync(saves,(XUserHandle)&user,scid,&block)));
    IXThreadingImpl_XTaskQueueDispatch(threads,queue,XTaskQueuePort_Work,0);
    CHECK("repeat-status",IXThreadingImpl_XAsyncGetStatus(threads,&block,TRUE)==S_OK);
    CHECK("stable-folder",SUCCEEDED(IXGameSaveImpl3_XGameSaveFilesGetFolderWithUiResult(saves,&block,sizeof(again),again)) && !strcmp(folder,again));
    /* Completion may wake the caller before the worker drops its last context
     * reference. Assert eventual cleanup, not a scheduler timing accident. */
    for(unsigned i=0;i<1000 && user.refs!=1;i++)Sleep(1);
    CHECK("retained-user-released",user.refs==1);
    IXThreadingImpl_XTaskQueueCloseHandle(threads,queue);
    printf("CHECKS %ld FAILURES %ld\n",checks,failures);
    return failures?1:0;
}
