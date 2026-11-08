/* Independent raw-ABI probe for the real provider. No generated identity header. */
#include <windows.h>
#include <stdio.h>
#include <wchar.h>
typedef struct object { void **v; } object;
typedef void *hstring;
typedef HRESULT (WINAPI *query_fn)(object *,const GUID *,void **);
typedef ULONG (WINAPI *ref_fn)(object *);
typedef HRESULT (WINAPI *out_fn)(object *,void **);
typedef HRESULT (WINAPI *str_fn)(object *,hstring *);
typedef HRESULT (WINAPI *status_fn)(object *,INT32 *);
typedef HRESULT (WINAPI *create_fn)(object *,object *,object **);
typedef HRESULT (WINAPI *factory_fn)(hstring,object **);
static HRESULT (WINAPI *make_string)(const WCHAR *,UINT32,hstring *);
static HRESULT (WINAPI *delete_string)(hstring);
static const WCHAR *(WINAPI *raw_string)(hstring,UINT32 *);
static const GUID unknown={0,0,0,{0xc0,0,0,0,0,0,0,0x46}};
static const GUID ctor_iid={0x0fe0a92a,0x8479,0x509b,{0x98,0xaf,0x99,0xfb,0xce,0xa8,0x5a,0x36}};
static const GUID manager_old={0xfebeda28,0x6412,0x558d,{0x97,0x81,0xc3,0xb0,0xd3,0x57,0x22,0xc5}};
static const GUID manager_new={0x9433e55e,0x57e3,0x5d3e,{0xb8,0x84,0xab,0x1c,0x02,0x52,0xad,0x74}};
static const GUID statics_old={0xa4d7c0e6,0xc053,0x5b25,{0xa3,0xdf,0x14,0xae,0xd1,0x49,0xf7,0x36}};
static const GUID statics_new={0x77fbd972,0x642f,0x5703,{0xbf,0x49,0x42,0x39,0xfc,0x53,0x1f,0x43}};
static const GUID async_old={0x33ba6bff,0xf4cd,0x5235,{0x8e,0x39,0xb6,0xa0,0x3b,0xf6,0x5e,0x9d}};
static const GUID async_new={0xa2751ca5,0xfd5a,0x5f9c,{0xa0,0xdb,0x07,0x11,0xca,0x17,0xa7,0x13}};
static const GUID async_auth={0xdf44e8c8,0xe062,0x5072,{0x8a,0x70,0x49,0xaf,0xda,0x45,0xee,0xc2}};
static const GUID async_transfer={0x3f3b1941,0x2ef2,0x5905,{0x9d,0x88,0x03,0x77,0x8a,0x1d,0xe7,0x3d}};
static const GUID async_info={0x00000036,0,0,{0xc0,0,0,0,0,0,0,0x46}};
static unsigned failures,checks;
#define CHECK(c) do { ++checks; if(!(c)) { ++failures; printf("FAIL line %u: %s\n",__LINE__,#c); } }while(0)
#define CALL(o,n,type) ((type)((o)->v[n]))
static HRESULT qi(object *o,const GUID *g,object **out){return CALL(o,0,query_fn)(o,g,(void **)out);}
static void release(object *o){if(o)CALL(o,2,ref_fn)(o);}
static int completed(object *op)
{
    object *info=NULL;INT32 status=0;unsigned i;HRESULT hr=qi(op,&async_info,&info);
    CHECK(hr==S_OK && info);if(!info)return 0;
    for(i=0;i<500 && !status;i++){CHECK(CALL(info,7,status_fn)(info,&status)==S_OK);if(!status)Sleep(10);}
    CHECK(status==1);release(info);return status==1;
}
static void silent(object *m,unsigned slot,const GUID *iid)
{
    object *op=NULL,*id=NULL,*result=(object *)1;
    CHECK(CALL(m,slot,out_fn)(m,NULL)==E_POINTER);
    CHECK(CALL(m,slot,out_fn)(m,(void **)&op)==S_OK && op);
    if(!op)return;
    CHECK(qi(op,iid,&id)==S_OK && id==op);release(id);
    if(completed(op)){
        CHECK(CALL(op,8,out_fn)(op,NULL)==E_POINTER);
        CHECK(CALL(op,8,out_fn)(op,(void **)&result)==S_OK && result==NULL);
    }
    release(op);
}
static void transfer(object *s,const GUID *iid)
{
    object *op=NULL,*id=NULL;
    struct { UINT32 pre; INT32 status; HRESULT error; UINT32 post; } value={0x1234,99,E_FAIL,0x5678};
    typedef HRESULT (WINAPI *transfer_fn)(object *,hstring,object **);
    CHECK(CALL(s,6,transfer_fn)(s,NULL,NULL)==E_POINTER);
    CHECK(CALL(s,6,transfer_fn)(s,NULL,&op)==S_OK && op);
    if(!op)return;
    CHECK(qi(op,iid,&id)==S_OK && id==op);release(id);
    if(completed(op))CHECK(CALL(op,8,out_fn)(op,(void **)&value.status)==S_OK);
    CHECK(value.pre==0x1234 && value.post==0x5678 && value.status==1 && value.error==S_OK);
    release(op);
}
int main(void)
{
    HMODULE cb=LoadLibraryW(L"combase.dll"),dll=LoadLibraryW(L"winexboxauth.dll");
    factory_fn get_factory;object *factory=NULL,*ctor=NULL,*so=NULL,*sn=NULL;hstring name=NULL;
    unsigned mode;const WCHAR cls[]=L"Microsoft.GamePlatform.Services.Identity.XboxAuthManager";
    CHECK(cb!=NULL && dll!=NULL);if(!cb || !dll)return 1;
    make_string=(void *)GetProcAddress(cb,"WindowsCreateString");delete_string=(void *)GetProcAddress(cb,"WindowsDeleteString");
    raw_string=(void *)GetProcAddress(cb,"WindowsGetStringRawBuffer");get_factory=(void *)GetProcAddress(dll,"DllGetActivationFactory");
    CHECK(make_string && delete_string && raw_string && get_factory);if(!get_factory)return 1;
    CHECK(make_string(cls,(UINT32)wcslen(cls),&name)==S_OK);
    CHECK(get_factory(name,&factory)==S_OK && factory);delete_string(name);
    if(!factory)return 1;
    CHECK(qi(factory,&ctor_iid,&ctor)==S_OK && ctor);
    CHECK(qi(factory,&statics_old,&so)==S_OK && so);
    CHECK(qi(factory,&statics_new,&sn)==S_OK && sn);
    if(!ctor || !so || !sn)return 1;
    for(mode=0;mode<2;mode++){
        object *m=NULL,*old=NULL,*modern=NULL,*u1=NULL,*u2=NULL;hstring sandbox=NULL;
        SetEnvironmentVariableW(L"WINE_UWP_IDENTITY_ABI",mode?L"2612":NULL);
        CHECK(CALL(ctor,6,create_fn)(ctor,NULL,NULL)==E_POINTER);
        CHECK(CALL(ctor,6,create_fn)(ctor,NULL,&m)==S_OK && m);if(!m)continue;
        CHECK(qi(m,&manager_old,&old)==S_OK && old);CHECK(qi(m,&manager_new,&modern)==S_OK && modern);
        CHECK(m==(mode?modern:old));
        CHECK(qi(old,&unknown,&u1)==S_OK && qi(modern,&unknown,&u2)==S_OK && u1==u2);
        release(u1);release(u2);
        CHECK(CALL(modern,6,str_fn)(modern,&sandbox)==S_OK && !wcscmp(raw_string(sandbox,NULL),L"RETAIL"));delete_string(sandbox);
        silent(old,7,&async_old);silent(modern,8,&async_new);
        CHECK(CALL(modern,7,HRESULT (WINAPI *)(object *,BYTE))(modern,1)==E_NOTIMPL);
        CHECK(CALL(modern,9,out_fn)(modern,NULL)==E_POINTER);
        CHECK(CALL(modern,10,out_fn)(modern,NULL)==E_POINTER);
        {object *out=(object *)1;CHECK(CALL(modern,11,out_fn)(modern,(void **)&out)==E_NOTIMPL && out==NULL);}
        {object *out=(object *)1;typedef HRESULT (WINAPI *ticket_fn)(object *,UINT32,hstring,object **);
         CHECK(CALL(modern,12,ticket_fn)(modern,2,NULL,&out)==E_NOTIMPL && out==NULL);
         out=(object *)1;CHECK(CALL(modern,12,ticket_fn)(modern,8,NULL,&out)==E_INVALIDARG && out==NULL);}
        {object *out=(object *)1;CHECK(CALL(modern,13,out_fn)(modern,(void **)&out)==E_NOTIMPL && out==NULL);}
        release(old);release(modern);release(m);
    }
    transfer(so,&async_transfer);transfer(sn,&async_auth);
    CHECK(CALL(sn,7,HRESULT (WINAPI *)(object *,hstring))(sn,NULL)==E_NOTIMPL);
    {BYTE valid=99;CHECK(CALL(sn,8,HRESULT (WINAPI *)(object *,hstring,BYTE *))(sn,NULL,&valid)==E_NOTIMPL && valid==0);}
    {object *out=(object *)1;CHECK(CALL(sn,9,out_fn)(sn,(void **)&out)==E_NOTIMPL && out==NULL);}
    SetEnvironmentVariableW(L"WINE_UWP_IDENTITY_ABI",NULL);
    release(ctor);release(so);release(sn);release(factory);
    printf("auth2612 real-provider ABI: %u checks, %u failures; no-account silent operations only\n",checks,failures);
    return failures?1:0;
}
