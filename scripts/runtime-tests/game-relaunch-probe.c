/* SPDX-License-Identifier: MIT
 * Real x64 XLaunchNewGame ABI, account-free child processes and private files.
 * Never calls XUserAdd, authenticates, starts a game or enables cloud saves.
 */
#define COBJMACROS
#define INITGUID
#include <windows.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>
#include "xgame.h"
static unsigned checks, failures;
#define CHECK(name,expr) do { ++checks; if (!(expr)) { ++failures; printf("FAIL %s line=%d\n",name,__LINE__); } } while(0)

static void relaunch(const WCHAR *self, int kind)
{
    HMODULE dll=LoadLibraryW(L"xgameruntime.dll");
    HRESULT (WINAPI *query)(REFCLSID,REFIID,void **)=dll?(void *)GetProcAddress(dll,"QueryApiImpl"):NULL;
    IXGameImpl2 *game=NULL;
    char executable[32768], argument[32768];
    if(!query||FAILED(query(&CLSID_XGameImpl,&IID_IXGameImpl2,(void **)&game))||!game)ExitProcess(90);
    if(!WideCharToMultiByte(CP_UTF8,0,self,-1,executable,sizeof(executable),NULL,NULL))ExitProcess(91);
    strcpy(argument,"--target \"two words\" \"\xc5\xbe\xc5\xa5\" \\\"literal\\\"");
    const char *target=executable,*args=argument;
    XUserHandle user=NULL;
    if(kind==1)target="relative target.exe";
    if(kind==2)target="missing-target.exe";
    if(kind==3)target=NULL;
    if(kind==4)target="";
    if(kind==5)target="\xc3\x28";
    if(kind==6)args="\xc3\x28";
    if(kind==7)target="invalid\"target.exe";
    if(kind==8) { memset(argument,'x',sizeof(argument)-1);argument[sizeof(argument)-1]=0; }
    if(kind==9)user=(XUserHandle)(ULONG_PTR)1;
    if(kind==10) { args=NULL;SetEnvironmentVariableW(L"NEXUS_RELAUNCH_EMPTY_ARGS",L"1"); }
    IXGameImpl2_XLaunchNewGame(game,target,args,user);
    ExitProcess(77); /* The API must never return, even on error. */
}

int wmain(int argc,WCHAR **argv)
{
    WCHAR self[32768],output[32768],cwd[32768],temporary[MAX_PATH],root[MAX_PATH],command[32768];
    DWORD length=GetModuleFileNameW(NULL,self,ARRAYSIZE(self));
    if(!length||length>=ARRAYSIZE(self))return 90;
    if(argc==3&&!wcscmp(argv[1],L"--relaunch")) { relaunch(self,_wtoi(argv[2]));return 78; }
    if((argc>1&&!wcscmp(argv[1],L"--target"))||GetEnvironmentVariableW(L"NEXUS_RELAUNCH_EMPTY_ARGS",output,ARRAYSIZE(output)))
    {
        BOOL empty=argc==1;
        if(!GetEnvironmentVariableW(L"NEXUS_RELAUNCH_RESULT",output,ARRAYSIZE(output)))return 92;
        GetCurrentDirectoryW(ARRAYSIZE(cwd),cwd);
        WCHAR expected[32768],value[32];
        BOOL valid=GetEnvironmentVariableW(L"NEXUS_RELAUNCH_CWD",expected,ARRAYSIZE(expected))&&!wcscmp(cwd,expected)&&
            GetEnvironmentVariableW(L"NEXUS_RELAUNCH_VALUE",value,ARRAYSIZE(value))&&!wcscmp(value,L"kept");
        if(!empty)valid=valid&&argc==5&&!wcscmp(argv[2],L"two words")&&!wcscmp(argv[3],L"\x017e\x0165")&&!wcscmp(argv[4],L"\"literal\"");
        HANDLE file=CreateFileW(output,GENERIC_WRITE,0,NULL,CREATE_NEW,FILE_ATTRIBUTE_NORMAL,NULL);
        DWORD written;char result=valid?'1':'0';
        if(file==INVALID_HANDLE_VALUE)return 93;
        WriteFile(file,&result,1,&written,NULL);CloseHandle(file);
        return valid?0:94;
    }
    CHECK("temporary-path",GetTempPathW(ARRAYSIZE(temporary),temporary)>0);
    CHECK("temporary-name",GetTempFileNameW(temporary,L"nxr",0,root)!=0);
    DeleteFileW(root);CHECK("private-directory",CreateDirectoryW(root,NULL));
    CHECK("current-directory",GetCurrentDirectoryW(ARRAYSIZE(cwd),cwd)>0);
    CHECK("set-private-directory",SetCurrentDirectoryW(root));
    SetEnvironmentVariableW(L"NEXUS_RELAUNCH_CWD",root);
    SetEnvironmentVariableW(L"NEXUS_RELAUNCH_VALUE",L"kept");
    CHECK("relative-executable-copy",CopyFileW(self,L"relative target.exe",TRUE));
    for(int kind=0;kind<=10;kind++)
    {
        STARTUPINFOW startup={sizeof(startup)};PROCESS_INFORMATION process;DWORD code=999;
        _snwprintf(output,ARRAYSIZE(output),L"%s\\result-%d.txt",root,kind);
        SetEnvironmentVariableW(L"NEXUS_RELAUNCH_RESULT",output);
        _snwprintf(command,ARRAYSIZE(command),L"\"%s\" --relaunch %d",self,kind);
        BOOL created=CreateProcessW(self,command,NULL,NULL,FALSE,0,NULL,NULL,&startup,&process);
        CHECK("caller-created",created);if(!created)continue;
        CHECK("caller-exited",WaitForSingleObject(process.hProcess,10000)==WAIT_OBJECT_0);
        GetExitCodeProcess(process.hProcess,&code);CloseHandle(process.hThread);CloseHandle(process.hProcess);
        BOOL success=kind==0||kind==1||kind==10;
        CHECK("caller-never-returns",code!=77&&code!=78&&code!=90&&code!=91);
        CHECK("caller-exit-status",code==(success?0:1));
        if(success)
        {
            HANDLE file=INVALID_HANDLE_VALUE;char value='0';DWORD read=0;
            for(unsigned attempt=0;attempt<200;attempt++)
            {
                file=CreateFileW(output,GENERIC_READ,0,NULL,OPEN_EXISTING,FILE_ATTRIBUTE_NORMAL,NULL);
                if(file!=INVALID_HANDLE_VALUE)break;
                Sleep(25);
            }
            CHECK("target-started",file!=INVALID_HANDLE_VALUE);
            if(file!=INVALID_HANDLE_VALUE) {ReadFile(file,&value,1,&read,NULL);CloseHandle(file);}
            CHECK("unicode-arguments-and-environment",read==1&&value=='1');
        }
        else CHECK("invalid-launch-no-target",GetFileAttributesW(output)==INVALID_FILE_ATTRIBUTES);
        DeleteFileW(output);
    }
    DeleteFileW(L"relative target.exe");SetCurrentDirectoryW(cwd);RemoveDirectoryW(root);
    printf("CHECKS %u FAILURES %u\n",checks,failures);
    return failures?1:0;
}
