/* Independent raw ABI probe for old and Xbox2612 GamePlatform client interfaces. */
#include <windows.h>
#include <stdio.h>
#include <wchar.h>

typedef void *hstring;
typedef struct object { void **vtbl; } object;
typedef HRESULT (WINAPI *query_fn)(object *,const GUID *,void **);
typedef ULONG (WINAPI *ref_fn)(object *);
typedef HRESULT (WINAPI *out_fn)(object *,void **);
typedef HRESULT (WINAPI *string_fn)(object *,hstring *);
typedef HRESULT (WINAPI *uint_fn)(object *,UINT32 *);
typedef HRESULT (WINAPI *size_fn)(object *,UINT64 *);
typedef HRESULT (WINAPI *bool_fn)(object *,BYTE *);
typedef HRESULT (WINAPI *int_fn)(object *,INT32 *);
typedef HRESULT (WINAPI *id_fn)(object *,INT32,hstring *);
typedef HRESULT (WINAPI *arg_out_fn)(object *,void *,void **);
typedef HRESULT (WINAPI *two_out_fn)(object *,void *,hstring,void **);
typedef HRESULT (WINAPI *event_fn)(object *,object *,LONGLONG *);
typedef HRESULT (WINAPI *remove_fn)(object *,LONGLONG);
typedef HRESULT (WINAPI *noarg_fn)(object *);
typedef HRESULT (WINAPI *one_fn)(object *,void *);
typedef HRESULT (WINAPI *policy_fn)(object *,INT32);
typedef HRESULT (WINAPI *create_package_fn)(object *,hstring,INT32,object **);
typedef HRESULT (WINAPI *create_string_fn)(const WCHAR *,UINT32,hstring *);
typedef HRESULT (WINAPI *delete_string_fn)(hstring);
typedef const WCHAR *(WINAPI *buffer_fn)(hstring,UINT32 *);
typedef HRESULT (WINAPI *dll_factory_fn)(hstring,object **);
typedef void (WINAPI *free_fn)(void *);
typedef HRESULT (WINAPI *ids_fn)(object *,ULONG *,GUID **);
typedef HRESULT (WINAPI *guid_at_fn)(object *,UINT32,GUID *);
typedef HRESULT (WINAPI *default_fn)(object *,INT32,BYTE,GUID *);
typedef HRESULT (WINAPI *details_fn)(object *,const GUID *,object **);
typedef HRESULT (WINAPI *guid_content_fn)(object *,const GUID *,object **);

static const GUID unknown_iid={0,0,0,{0xc0,0,0,0,0,0,0,0x46}};
static const GUID absent_iid={0x99887766,0x5544,0x3322,{0,1,2,3,4,5,6,7}};
static const GUID content_old={0xf68e477c,0x55a7,0x52e3,{0xb0,0x2c,0x57,0x70,0x88,0x9f,0x5c,0x86}};
static const GUID content_new={0x92823c39,0xad1f,0x591c,{0x8f,0xcb,0xeb,0xdd,0xb2,0xf9,0xc9,0x78}};
static const GUID licensing_old={0x02d46bad,0xaf94,0x53df,{0x8f,0xb9,0x4e,0x02,0x7d,0xaa,0x99,0x46}};
static const GUID licensing_new={0x8a2e333a,0xec1f,0x583c,{0xbf,0x20,0xed,0x77,0x3c,0x52,0x63,0xdd}};
static const GUID package_iid={0xfe24ef0e,0x2f43,0x5f1b,{0xa3,0xd0,0x81,0xab,0x31,0x65,0xd5,0x78}};
static const GUID pi_old={0xffa05c03,0x5784,0x56a4,{0xbe,0x9c,0x82,0xcf,0x03,0x5b,0x2a,0xd4}};
static const GUID pi_new={0x91267ef4,0x4abb,0x592f,{0xa5,0x26,0xea,0x17,0x2c,0x8a,0xaf,0x7d}};
static const GUID desktop_package={0x7d812c10,0x1312,0x505e,{0x88,0xec,0xce,0x06,0xa6,0xc4,0x7e,0x58}};
static const GUID desktop_util={0x0dce56b4,0x95b9,0x5084,{0xa2,0xe2,0x7a,0x57,0x2e,0x29,0xae,0x4a}};
static const GUID storage_iid={0xdeab5d1a,0x89a8,0x5987,{0xb0,0x5f,0x1b,0x61,0x63,0x9a,0x67,0x9c}};
static const GUID queue_iid={0xde4e4989,0x2bc5,0x5d62,{0x84,0x75,0x43,0x5f,0x7a,0x58,0x8b,0xbb}};
static LONG failures;
static create_string_fn create_string;
static delete_string_fn delete_string;
static buffer_fn string_buffer;
static dll_factory_fn dll_factory;
static free_fn task_free;
#define CHECK(x) do {if(!(x)){failures++;printf("FAIL line %d: %s\n",__LINE__,#x);}}while(0)
#define SLOT(o,n,t) ((t)(o)->vtbl[n])
#define RELEASE(o) SLOT(o,2,ref_fn)(o)
#define QUERY(o,i,p) SLOT(o,0,query_fn)(o,i,(void **)p)
#define NO_SERVICE ((HRESULT)0x87e00196)
#define SENTINEL ((void *)(ULONG_PTR)0xdeadbeef)

static HRESULT WINAPI handler_qi(object *o,const GUID *id,void **out);
static ULONG WINAPI handler_add(object *o);
static ULONG WINAPI handler_release(object *o);
static void *handler_vtbl[]={handler_qi,handler_add,handler_release};
static struct {void **vtbl;LONG refs;} handler={handler_vtbl,1};
static HRESULT WINAPI handler_qi(object *o,const GUID *id,void **out)
{if(!out)return E_POINTER;*out=NULL;if(!IsEqualGUID(id,&unknown_iid))return E_NOINTERFACE;*out=o;handler_add(o);return S_OK;}
static ULONG WINAPI handler_add(object *o){(void)o;return InterlockedIncrement(&handler.refs);}
static ULONG WINAPI handler_release(object *o){(void)o;return InterlockedDecrement(&handler.refs);}

static object *get_class(const WCHAR *name,const GUID *id)
{
 hstring s=NULL;object *f=NULL,*v=NULL;HRESULT hr;
 CHECK(create_string(name,(UINT32)wcslen(name),&s)==S_OK);
 hr=dll_factory(s,&f);CHECK(hr==S_OK&&f);delete_string(s);
 if(f){CHECK(QUERY(f,id,&v)==S_OK&&v);RELEASE(f);}return v;
}
static void identity(object *a,object *b,const GUID *old,const GUID *newer)
{
 object *u=NULL,*v=NULL,*round=NULL;GUID *ids=NULL;ULONG n=0;void *out=SENTINEL;BOOL sawold=FALSE,sawnew=FALSE;ULONG i;
 CHECK(a!=b);CHECK(QUERY(a,&unknown_iid,&u)==S_OK);CHECK(QUERY(b,&unknown_iid,&v)==S_OK&&u==v);
 if(u)RELEASE(u);if(v)RELEASE(v);
 CHECK(QUERY(b,old,&round)==S_OK&&round==a);if(round)RELEASE(round);
 CHECK(QUERY(a,newer,&round)==S_OK&&round==b);if(round)RELEASE(round);
 CHECK(QUERY(b,&absent_iid,&out)==E_NOINTERFACE&&out==NULL);
 CHECK(SLOT(b,3,ids_fn)(b,&n,&ids)==S_OK&&n==2&&ids);
 for(i=0;i<n;i++){if(IsEqualGUID(&ids[i],old))sawold=TRUE;if(IsEqualGUID(&ids[i],newer))sawnew=TRUE;}
 CHECK(sawold&&sawnew);task_free(ids);
 CHECK(SLOT(b,3,ids_fn)(b,NULL,NULL)==E_POINTER);
}
static void content_test(void)
{
 object *old=get_class(L"Microsoft.GamePlatform.Services.ContentAccess",&content_old),*v=NULL;void *out;LONGLONG t1=0,t2=0;int n;
 if(!old)return;CHECK(QUERY(old,&content_new,&v)==S_OK&&v);if(!v){RELEASE(old);return;}
 identity(old,v,&content_old,&content_new);
 /* Old slot10 remains an event; new slot10 is an asynchronous data query. */
 CHECK(SLOT(old,10,event_fn)(old,(object*)&handler,&t1)==S_OK&&t1);
 out=SENTINEL;CHECK(SLOT(v,10,arg_out_fn)(v,NULL,&out)==E_NOTIMPL&&out==NULL);
 CHECK(SLOT(v,10,arg_out_fn)(v,NULL,NULL)==E_POINTER);
 out=SENTINEL;CHECK(SLOT(v,11,two_out_fn)(v,NULL,NULL,&out)==E_NOTIMPL&&out==NULL);
 for(n=12;n<=16;n+=2){CHECK(SLOT(v,n,event_fn)(v,(object*)&handler,&t2)==S_OK&&t2>t1);CHECK(SLOT(v,n+1,remove_fn)(v,t2)==S_OK);}
 CHECK(SLOT(old,11,remove_fn)(old,t1)==S_OK);
 CHECK(SLOT(v,18,noarg_fn)(v)==NO_SERVICE);
 out=SENTINEL;CHECK(SLOT(v,7,out_fn)(v,&out)==NO_SERVICE&&out==NULL);
 out=SENTINEL;CHECK(SLOT(v,8,two_out_fn)(v,NULL,NULL,&out)==NO_SERVICE&&out==NULL);
 out=SENTINEL;CHECK(SLOT(v,9,two_out_fn)(v,NULL,NULL,&out)==NO_SERVICE&&out==NULL);
 CHECK(SLOT(v,6,out_fn)(v,NULL)==E_POINTER); /* Do not start the real account/network operation. */
 RELEASE(v);RELEASE(old);
}
static void licensing_test(void)
{
 object *old=get_class(L"Microsoft.GamePlatform.Services.Licensing",&licensing_old),*v=NULL;void *out;
 if(!old)return;CHECK(QUERY(old,&licensing_new,&v)==S_OK&&v);if(!v){RELEASE(old);return;}
 identity(old,v,&licensing_old,&licensing_new);
 CHECK(SLOT(old,6,policy_fn)(old,0)==NO_SERVICE);CHECK(SLOT(v,6,policy_fn)(v,0)==NO_SERVICE);
 CHECK(SLOT(v,7,one_fn)(v,NULL)==E_NOTIMPL);
 out=SENTINEL;CHECK(SLOT(v,8,out_fn)(v,&out)==E_NOTIMPL&&out==NULL);
 out=SENTINEL;CHECK(SLOT(v,9,arg_out_fn)(v,NULL,&out)==E_NOTIMPL&&out==NULL);
 CHECK(SLOT(v,8,out_fn)(v,NULL)==E_POINTER);CHECK(SLOT(v,9,arg_out_fn)(v,NULL,NULL)==E_POINTER);
 RELEASE(v);RELEASE(old);
}
static void package_test(void)
{
 object *f=get_class(L"Microsoft.GamePlatform.Services.Package",&package_iid),*old=NULL,*v=NULL;hstring source=NULL,s;HRESULT hr;
 struct {BYTE left;BYTE value;BYTE right;} flag={0xa5,0xff,0x5a};UINT64 size;void *out;LONGLONG t1=0,t2=0;INT32 category;
 if(!f)return;
 CHECK(create_string(L"AdapterProbe.Uninstalled",24,&source)==S_OK);
 CHECK(SLOT(f,6,create_package_fn)(f,source,0,&old)==S_OK&&old);delete_string(source);RELEASE(f);
 if(!old)return;CHECK(QUERY(old,&pi_new,&v)==S_OK&&v);if(!v){RELEASE(old);return;}
 identity(old,v,&pi_old,&pi_new);
 s=SENTINEL;CHECK(SLOT(v,7,string_fn)(v,&s)==E_NOTIMPL&&s==NULL);
 s=SENTINEL;CHECK(SLOT(v,8,string_fn)(v,&s)==NO_SERVICE&&s==NULL);
 CHECK(SLOT(old,7,string_fn)(old,&s)==NO_SERVICE);
 CHECK(SLOT(v,8,string_fn)(v,NULL)==E_POINTER);
 s=SENTINEL;CHECK(SLOT(v,9,id_fn)(v,0,&s)==NO_SERVICE&&s==NULL);
 for(int i=10;i<=11;i++){size=~(UINT64)0;CHECK(SLOT(v,i,size_fn)(v,&size)==NO_SERVICE&&size==0);}
 category=-1;CHECK(SLOT(v,12,int_fn)(v,&category)==NO_SERVICE&&category==0);
 for(int i=15;i<=22;i++){if(i==16||i==17||i==18||i==20)continue;out=SENTINEL;hr=SLOT(v,i,out_fn)(v,&out);CHECK(FAILED(hr)&&out==NULL);}
 CHECK(SLOT(v,16,out_fn)(v,NULL)==E_POINTER);CHECK(SLOT(v,17,out_fn)(v,NULL)==E_POINTER);
 out=SENTINEL;CHECK(SLOT(v,20,arg_out_fn)(v,NULL,&out)==E_NOTIMPL&&out==NULL);
 for(int i=28;i<=29;i++){flag.value=0xff;CHECK(SLOT(v,i,bool_fn)(v,&flag.value)==NO_SERVICE&&flag.value==0&&flag.left==0xa5&&flag.right==0x5a);}
 for(int i=35;i<=40;i++){if(i==36||i==38){size=~(UINT64)0;CHECK(SLOT(v,i,size_fn)(v,&size)==NO_SERVICE&&size==0);}else if(i==39){CHECK(SLOT(v,i,noarg_fn)(v)==NO_SERVICE);}else {flag.value=0xff;CHECK(SLOT(v,i,bool_fn)(v,&flag.value)==NO_SERVICE&&flag.value==0&&flag.left==0xa5&&flag.right==0x5a);}}
 /* High slots must route through the real retained subscription implementation. */
 CHECK(SLOT(old,37,event_fn)(old,(object*)&handler,&t1)==S_OK&&t1);
 CHECK(SLOT(v,41,event_fn)(v,(object*)&handler,&t2)==S_OK&&t2!=t1&&handler.refs==3);
 CHECK(SLOT(v,42,remove_fn)(v,t2)==S_OK&&handler.refs==2);
 CHECK(SLOT(old,38,remove_fn)(old,t1)==S_OK&&handler.refs==1);
 CHECK(SLOT(v,41,event_fn)(v,NULL,NULL)==E_POINTER);
 RELEASE(v);RELEASE(old);
}
static void desktop_test(void)
{
 object *p=get_class(L"Microsoft.GamePlatform.Services.DesktopPackage",&desktop_package),*u=get_class(L"Microsoft.GamePlatform.Services.DesktopUtilities",&desktop_util);BYTE b=0xff;UINT32 pid=~0u;
 struct result { hstring package_full_name,aumid; };
 struct {UINT64 before;struct result value;UINT64 after;} registration={0xaabbccddeeff0011ULL,{SENTINEL,SENTINEL},0x1122334455667788ULL};
 if(p){CHECK(((HRESULT(WINAPI*)(object*,hstring,struct result*))p->vtbl[6])(p,NULL,&registration.value)==E_NOTIMPL&&registration.value.package_full_name==NULL&&registration.value.aumid==NULL&&registration.before==0xaabbccddeeff0011ULL&&registration.after==0x1122334455667788ULL);CHECK(SLOT(p,6,arg_out_fn)(p,NULL,NULL)==E_POINTER);CHECK(SLOT(p,7,one_fn)(p,NULL)==E_NOTIMPL);CHECK(((HRESULT(WINAPI*)(object*,hstring,hstring,UINT32*))p->vtbl[8])(p,NULL,NULL,&pid)==E_NOTIMPL&&pid==0);CHECK(((HRESULT(WINAPI*)(object*,hstring,BYTE))p->vtbl[9])(p,NULL,0)==E_NOTIMPL);RELEASE(p);}
 if(u){CHECK(SLOT(u,6,bool_fn)(u,&b)==E_NOTIMPL&&b==0);b=0xff;CHECK(((HRESULT(WINAPI*)(object*,hstring,BYTE*))u->vtbl[7])(u,NULL,&b)==E_NOTIMPL&&b==0);RELEASE(u);}
}
static void storage_queue_test(void)
{
 object *f=get_class(L"Microsoft.GamePlatform.Services.Storage",&storage_iid),*view=NULL,*d=NULL,*q=NULL,*items=NULL;UINT32 count=0,queue_count=0;GUID id,def;UINT64 total=0,freebytes=0;hstring drive=NULL;WCHAR root[4];ULARGE_INTEGER actual_free,actual_total;
 if(f){
 CHECK(SLOT(f,7,out_fn)(f,(void**)&view)==S_OK&&view);
 CHECK(SLOT(f,14,default_fn)(f,0,1,&def)==S_OK);
 if(view){CHECK(SLOT(view,7,uint_fn)(view,&count)==S_OK&&count>0);CHECK(SLOT(view,6,guid_at_fn)(view,0,&id)==S_OK&&IsEqualGUID(&id,&def));
  CHECK(SLOT(f,6,details_fn)(f,&def,&d)==S_OK&&d);
  if(d){CHECK(SLOT(d,7,size_fn)(d,&total)==S_OK);CHECK(SLOT(d,8,size_fn)(d,&freebytes)==S_OK);CHECK(SLOT(d,10,string_fn)(d,&drive)==S_OK&&drive);
   if(drive){const WCHAR *s=string_buffer(drive,NULL);CHECK(wcslen(s)==2&&s[1]==L':');root[0]=s[0];root[1]=L':';root[2]=L'\\';root[3]=0;CHECK(GetDiskFreeSpaceExW(root,&actual_free,&actual_total,NULL));CHECK(total==actual_total.QuadPart&&freebytes<=total);delete_string(drive);}
   printf("storage system volume: capacity %llu; free %llu\n",(unsigned long long)total,(unsigned long long)freebytes);RELEASE(d);}
 RELEASE(view);}RELEASE(f);}
 q=get_class(L"Microsoft.GamePlatform.Services.PackageQueue",&queue_iid);
 if(q){CHECK(SLOT(q,17,out_fn)(q,(void**)&items)==S_OK&&items);if(items){CHECK(SLOT(items,7,uint_fn)(items,&queue_count)==S_OK&&queue_count==0);printf("actual private queue entries: %u\n",queue_count);RELEASE(items);}RELEASE(q);}
}
int main(void)
{
 HMODULE base=LoadLibraryW(L"combase.dll"),gp=LoadLibraryW(L"winegameplatform.dll");
 CHECK(base&&gp);if(!base||!gp)return 2;
 create_string=(create_string_fn)GetProcAddress(base,"WindowsCreateString");delete_string=(delete_string_fn)GetProcAddress(base,"WindowsDeleteString");string_buffer=(buffer_fn)GetProcAddress(base,"WindowsGetStringRawBuffer");task_free=(free_fn)GetProcAddress(base,"CoTaskMemFree");dll_factory=(dll_factory_fn)GetProcAddress(gp,"DllGetActivationFactory");
 CHECK(create_string&&delete_string&&string_buffer&&task_free&&dll_factory);if(!create_string||!delete_string||!string_buffer||!task_free||!dll_factory)return 2;
 content_test();licensing_test();package_test();desktop_test();storage_queue_test();
 printf("GamePlatform old/new raw ABI tests: %ld failures\n",failures);
 return failures?1:0;
}
