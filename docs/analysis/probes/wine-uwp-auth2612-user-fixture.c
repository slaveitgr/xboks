/* Offline synthetic account fixture for internal IUser ABI tests.
 * This executable links provider objects; it never exports a test user from the DLL,
 * reads a sign-in store, invokes authentication, or represents a real sign-in. */
#include IDENTITY_SOURCE

static unsigned failures,checks,event_calls;
#define CHECK(c) do { ++checks; if(!(c)) { ++failures; printf("FAIL line %u: %s\n",__LINE__,#c); } }while(0)
#define RAW(o,n,type) ((type)(*(void ***)(o))[n])
struct fixture_delegate { const void **vtbl; LONG ref; void *expected; };
static HRESULT WINAPI delegate_qi(struct fixture_delegate *d,REFIID iid,void **out)
{ if(!out)return E_POINTER;*out=d;InterlockedIncrement(&d->ref);return S_OK; }
static ULONG WINAPI delegate_addref(struct fixture_delegate *d){return InterlockedIncrement(&d->ref);}
static ULONG WINAPI delegate_release(struct fixture_delegate *d){return InterlockedDecrement(&d->ref);}
static HRESULT WINAPI delegate_invoke(struct fixture_delegate *d,void *sender,IUnknown *args)
{
    IUnknown *userargs=NULL,*user=NULL;
    ++event_calls;CHECK(sender==d->expected);
    CHECK(IUnknown_QueryInterface(args,&IID_IUserEventArgs,(void **)&userargs)==S_OK && userargs);
    if(userargs){
        CHECK(RAW(userargs,6,HRESULT (WINAPI *)(IUnknown *,IUnknown **))(userargs,&user)==S_OK && user==(IUnknown *)d->expected);
        if(user)IUnknown_Release(user);IUnknown_Release(userargs);
    }
    return S_OK;
}
static const void *delegate_vtbl[]={delegate_qi,delegate_addref,delegate_release,delegate_invoke};
int main(void)
{
    struct user *fixture;void *old,*modern,*back=NULL,*u1=NULL,*u2=NULL;
    UINT64 value;HSTRING str=NULL;INT32 i;boolean b;INT64 token;
    struct privilege_result privilege;struct modern_gamertag tags;
    struct fixture_delegate delegate={delegate_vtbl,1,NULL};
    unsigned mode;
    account_init();
    account.signed_in=TRUE;
    account.gtg=str_dup("SyntheticFixture");account.mgt=str_dup("SyntheticFixture");
    account.mgs=str_dup("1234");account.umg=str_dup("SyntheticFixture#1234");
    account.xid=str_dup("1234567890123456");account.agg=str_dup("Adult");account.prv=str_dup("254");
    fixture=get_current_user();CHECK(fixture!=NULL);if(!fixture)return 1;
    old=&fixture->obj.vtbl[0];modern=&fixture->obj.vtbl[2];
    CHECK(RAW(old,0,HRESULT (WINAPI *)(void *,REFIID,void **))(old,&IID_IUser2612,&back)==S_OK && back==modern);
    IUnknown_Release((IUnknown *)back);
    CHECK(RAW(modern,0,HRESULT (WINAPI *)(void *,REFIID,void **))(modern,&IID_IUser,&back)==S_OK && back==old);
    IUnknown_Release((IUnknown *)back);
    CHECK(RAW(old,0,HRESULT (WINAPI *)(void *,REFIID,void **))(old,&IID_IUnknown,&u1)==S_OK);
    CHECK(RAW(modern,0,HRESULT (WINAPI *)(void *,REFIID,void **))(modern,&IID_IUnknown,&u2)==S_OK && u1==u2);
    IUnknown_Release((IUnknown *)u1);IUnknown_Release((IUnknown *)u2);
    CHECK(RAW(modern,6,HRESULT (WINAPI *)(void *,HSTRING *))(modern,&str)==S_OK && !wcscmp(WindowsGetStringRawBuffer(str,NULL),L"SyntheticFixture"));WindowsDeleteString(str);
    CHECK(RAW(modern,7,HRESULT (WINAPI *)(void *,struct modern_gamertag *))(modern,&tags)==S_OK);
    WindowsDeleteString(tags.modern);WindowsDeleteString(tags.suffix);WindowsDeleteString(tags.unique);
    value=~(UINT64)0;CHECK(RAW(modern,8,HRESULT (WINAPI *)(void *,UINT64 *))(modern,&value)==E_NOTIMPL && value==0);
    CHECK(RAW(old,8,HRESULT (WINAPI *)(void *,UINT64 *))(old,&value)==S_OK && value==1234567890123456ULL);
    value=0;CHECK(RAW(modern,9,HRESULT (WINAPI *)(void *,UINT64 *))(modern,&value)==S_OK && value==1234567890123456ULL);
    CHECK(RAW(modern,10,HRESULT (WINAPI *)(void *,HSTRING *))(modern,&str)==S_OK && !wcscmp(WindowsGetStringRawBuffer(str,NULL),L"1234567890123456"));WindowsDeleteString(str);
    str=(HSTRING)1;CHECK(RAW(modern,11,HRESULT (WINAPI *)(void *,HSTRING *))(modern,&str)==E_NOTIMPL && str==NULL);
    CHECK(RAW(modern,12,HRESULT (WINAPI *)(void *,INT32 *))(modern,&i)==S_OK && i==3);
    CHECK(RAW(modern,13,HRESULT (WINAPI *)(void *,INT32 *))(modern,&i)==S_OK && i==0);
    CHECK(RAW(modern,14,HRESULT (WINAPI *)(void *,boolean *))(modern,&b)==S_OK && b==TRUE);
    CHECK(RAW(modern,16,HRESULT (WINAPI *)(void *,INT32,struct privilege_result *))(modern,254,&privilege)==S_OK && privilege.has);
    CHECK(RAW(modern,17,HRESULT (WINAPI *)(void *,IInspectable *,void **))(modern,NULL,NULL)==E_POINTER);
    CHECK(RAW(modern,18,HRESULT (WINAPI *)(void *,HSTRING,void **))(modern,NULL,NULL)==E_POINTER);
    CHECK(RAW(modern,19,HRESULT (WINAPI *)(void *,HSTRING,boolean,void **))(modern,NULL,0,NULL)==E_POINTER);
    for(mode=20;mode<=21;mode++){
        void *out=(void *)1;
        if(mode==20)CHECK(RAW(modern,20,HRESULT (WINAPI *)(void *,HSTRING,void **))(modern,NULL,&out)==E_NOTIMPL && out==NULL);
        else CHECK(RAW(modern,21,HRESULT (WINAPI *)(void *,HSTRING,boolean,void **))(modern,NULL,0,&out)==E_NOTIMPL && out==NULL);
    }
    CHECK(RAW(modern,22,HRESULT (WINAPI *)(void *,INT32,void **))(modern,0,NULL)==E_NOTIMPL);
    CHECK(RAW(modern,23,HRESULT (WINAPI *)(void *,HSTRING,void **))(modern,NULL,NULL)==E_POINTER);
    CHECK(RAW(modern,24,HRESULT (WINAPI *)(void *,HSTRING,INT32 *))(modern,NULL,&i)==S_OK && i==1);
    CHECK(RAW(modern,25,HRESULT (WINAPI *)(void *,HSTRING,void **))(modern,NULL,NULL)==E_POINTER);
    CHECK(RAW(modern,26,HRESULT (WINAPI *)(void *,void **))(modern,NULL)==E_POINTER);
    for(mode=0;mode<2;mode++){
        SetEnvironmentVariableW(L"WINE_UWP_IDENTITY_ABI",mode?L"2612":NULL);
        delegate.expected=mode?modern:old;
        CHECK(RAW(modern,27,HRESULT (WINAPI *)(void *,IUnknown *,INT64 *))(modern,(IUnknown *)&delegate,&token)==S_OK);
        user_raise_state(fixture,0);
        CHECK(RAW(modern,28,HRESULT (WINAPI *)(void *,INT64))(modern,token)==S_OK);
    }
    CHECK(event_calls==2 && delegate.ref==1);
    CHECK(RAW(modern,29,HRESULT (WINAPI *)(void *,IUnknown *,INT64 *))(modern,(IUnknown *)&delegate,&token)==S_OK);
    CHECK(RAW(modern,30,HRESULT (WINAPI *)(void *,INT64))(modern,token)==S_OK);
    CHECK(RAW(modern,31,HRESULT (WINAPI *)(void *,IUnknown *,INT64 *))(modern,(IUnknown *)&delegate,&token)==S_OK);
    CHECK(RAW(modern,32,HRESULT (WINAPI *)(void *,INT64))(modern,token)==S_OK);
    CHECK(fixture->obj.ref==2);
    current_user=NULL;obj_Release(&fixture->obj);obj_Release(&fixture->obj);
    account.signed_in=FALSE;
    free(account.gtg);free(account.mgt);free(account.mgs);free(account.umg);free(account.xid);free(account.agg);free(account.prv);
    SetEnvironmentVariableW(L"WINE_UWP_IDENTITY_ABI",NULL);
    printf("auth2612 SYNTHETIC internal User fixture: %u checks, %u failures; not sign-in evidence\n",checks,failures);
    return failures?1:0;
}
