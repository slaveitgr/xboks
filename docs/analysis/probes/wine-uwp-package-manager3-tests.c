/* Independent raw WinRT ABI probe; no generated deployment header is used.
 * Slots follow Microsoft windows-rs 9769d429 IPackageManager3_Vtbl. */
#include <windows.h>
#include <stdio.h>
#include <wchar.h>
#include <stddef.h>

typedef void *hstring;
typedef struct object { void **vtbl; } object;
typedef HRESULT (WINAPI *query_fn)(object *, const GUID *, void **);
typedef ULONG (WINAPI *ref_fn)(object *);
typedef HRESULT (WINAPI *out_fn)(object *, void **);
typedef HRESULT (WINAPI *string_fn)(object *, hstring *);
typedef HRESULT (WINAPI *bool_fn)(object *, BYTE *);
typedef HRESULT (WINAPI *name_fn)(object *, hstring, void **);
typedef HRESULT (WINAPI *one_fn)(object *, void *);
typedef HRESULT (WINAPI *state_fn)(object *, hstring, UINT32);
typedef HRESULT (WINAPI *uri_fn)(object *, void *, void *, UINT32, void *, void **);
typedef HRESULT (WINAPI *move_fn)(object *, hstring, UINT32, void *, void **);
typedef HRESULT (WINAPI *stage_fn)(object *, hstring, UINT32, void **);
typedef HRESULT (WINAPI *volume_fn)(object *, void *, void **);
typedef HRESULT (WINAPI *initialize_fn)(UINT32);
typedef void (WINAPI *uninitialize_fn)(void);
typedef HRESULT (WINAPI *create_fn)(const WCHAR *, UINT32, hstring *);
typedef HRESULT (WINAPI *delete_fn)(hstring);
typedef const WCHAR *(WINAPI *buffer_fn)(hstring, UINT32 *);
typedef HRESULT (WINAPI *activate_fn)(hstring, object **);

static const GUID manager3_iid = {0xdaad9948,0x36f1,0x41a7,{0x91,0x88,0xbc,0x26,0x3e,0x0d,0xcb,0x72}};
static const GUID unknown_iid = {0,0,0,{0xc0,0,0,0,0,0,0,0x46}};
static const GUID absent_iid = {0xfeed1234,0x1234,0x1234,{0,0,0,0,0,0,0,1}};
static LONG failures;
#define CHECK(x) do { if (!(x)) { ++failures; printf("FAIL line %d: %s\n", __LINE__, #x); } } while (0)
#define SLOT(o,n,t) ((t)(o)->vtbl[n])
#define RELEASE(o) SLOT(o,2,ref_fn)(o)
#define QUERY(o,i,p) SLOT(o,0,query_fn)(o,i,(void **)p)
#define SENTINEL ((void *)(ULONG_PTR)0xdeadbeef)

int main(void)
{
    const WCHAR classname[] = L"Windows.Management.Deployment.PackageManager";
    HMODULE base = LoadLibraryW(L"combase.dll");
    initialize_fn initialize;
    uninitialize_fn uninitialize;
    create_fn create;
    delete_fn destroy;
    buffer_fn buffer;
    activate_fn activate;
    object *instance = NULL, *manager = NULL, *unknown1 = NULL, *unknown2 = NULL;
    object *iterable = NULL, *iterator = NULL, *volume = NULL, *def = NULL, *found = NULL;
    hstring cls = NULL, mount = NULL, name = NULL, store = NULL, defname = NULL, missing = NULL;
    WCHAR root[MAX_PATH], expected_store[MAX_PATH], expected_name[MAX_PATH], suffixed[MAX_PATH];
    void *out;
    HRESULT hr;
    BYTE flag = 0, has_current = 0;
    UINT count = 0;
    int i;

    CHECK(base != NULL);
    if (!base) return 2;
    initialize = (initialize_fn)GetProcAddress(base,"RoInitialize");
    uninitialize = (uninitialize_fn)GetProcAddress(base,"RoUninitialize");
    create = (create_fn)GetProcAddress(base,"WindowsCreateString");
    destroy = (delete_fn)GetProcAddress(base,"WindowsDeleteString");
    buffer = (buffer_fn)GetProcAddress(base,"WindowsGetStringRawBuffer");
    activate = (activate_fn)GetProcAddress(base,"RoActivateInstance");
    CHECK(initialize && uninitialize && create && destroy && buffer && activate);
    if (!initialize || !uninitialize || !create || !destroy || !buffer || !activate) return 2;
    hr = initialize(1); CHECK(SUCCEEDED(hr));
    if (FAILED(hr)) return 2;
    CHECK(create(classname, sizeof(classname)/sizeof(classname[0])-1, &cls) == S_OK);
    hr = activate(cls, &instance); CHECK(hr == S_OK && instance);
    destroy(cls);
    if (FAILED(hr) || !instance) { uninitialize(); return 2; }
    hr = QUERY(instance,&manager3_iid,&manager); CHECK(hr == S_OK && manager);
    if (FAILED(hr) || !manager) { RELEASE(instance); uninitialize(); return 2; }
    CHECK(QUERY(instance,&unknown_iid,&unknown1) == S_OK);
    CHECK(QUERY(manager,&unknown_iid,&unknown2) == S_OK && unknown1 == unknown2);
    if (unknown1) RELEASE(unknown1);
    if (unknown2) RELEASE(unknown2);
    CHECK(SLOT(manager,1,ref_fn)(manager) == 3);
    CHECK(RELEASE(manager) == 2);
    out = SENTINEL;
    CHECK(QUERY(manager,&absent_iid,&out) == E_NOINTERFACE && out == NULL);

    /* The original Xbox calls slot 11 (0x58), not an IDL-derived macro. */
    CHECK(SLOT(manager,11,out_fn)(manager,NULL) == E_POINTER);
    CHECK(SLOT(manager,12,out_fn)(manager,NULL) == E_POINTER);
    CHECK(SLOT(manager,10,name_fn)(manager,NULL,NULL) == E_POINTER);
    out = SENTINEL;
    CHECK(SLOT(manager,10,name_fn)(manager,NULL,&out) == E_INVALIDARG && out == NULL);
    hr = SLOT(manager,11,out_fn)(manager,(void **)&iterable);
    CHECK(hr == S_OK && iterable);
    if (iterable)
    {
        CHECK(SLOT(iterable,6,out_fn)(iterable,(void **)&iterator) == S_OK && iterator);
        RELEASE(iterable); iterable = NULL; /* Iterator must retain its backing view. */
    }
    if (iterator)
    {
        CHECK(SLOT(iterator,7,bool_fn)(iterator,&has_current) == S_OK && has_current);
        while (has_current && count < 8)
        {
            object *current = NULL;
            CHECK(SLOT(iterator,6,out_fn)(iterator,(void **)&current) == S_OK && current);
            if (current && !volume) volume = current;
            else if (current) RELEASE(current);
            ++count;
            CHECK(SLOT(iterator,8,bool_fn)(iterator,&has_current) == S_OK);
        }
        CHECK(count == 1 && !has_current);
        RELEASE(iterator); iterator = NULL;
    }
    CHECK(SLOT(manager,12,out_fn)(manager,(void **)&def) == S_OK && def);
    if (volume)
    {
        CHECK(SLOT(volume,6,bool_fn)(volume,&flag) == S_OK && !flag);
        CHECK(SLOT(volume,7,bool_fn)(volume,&flag) == S_OK && flag);
        CHECK(SLOT(volume,8,string_fn)(volume,&mount) == S_OK && mount);
        CHECK(SLOT(volume,9,string_fn)(volume,&name) == S_OK && name);
        CHECK(SLOT(volume,10,string_fn)(volume,&store) == S_OK && store);
        CHECK(GetSystemWindowsDirectoryW(root,MAX_PATH) >= 3); root[3] = 0;
        wcscpy(expected_store,root); wcscat(expected_store,L"Program Files\\WindowsApps");
        if (!GetVolumeNameForVolumeMountPointW(root,expected_name,MAX_PATH)) wcscpy(expected_name,root);
        CHECK(!_wcsicmp(buffer(mount,NULL),root));
        CHECK(!_wcsicmp(buffer(name,NULL),expected_name));
        CHECK(!_wcsicmp(buffer(store,NULL),expected_store));
        printf("volume count %u; mount %ls; name %ls; package store %ls\n",count,buffer(mount,NULL),buffer(name,NULL),buffer(store,NULL));
        CHECK(SLOT(manager,10,name_fn)(manager,name,(void **)&found) == S_OK && found);
        if (found) { RELEASE(found); found = NULL; }
        {
            hstring malformed = NULL;
            UINT32 length = 0;
            const WCHAR *text = buffer(name,&length);
            CHECK(length + 2 < MAX_PATH);
            if (length + 2 < MAX_PATH)
            {
                memcpy(suffixed,text,length * sizeof(WCHAR));
                suffixed[length] = 0; suffixed[length+1] = L'X';
                CHECK(create(suffixed,length+2,&malformed) == S_OK);
                out = SENTINEL;
                CHECK(SLOT(manager,10,name_fn)(manager,malformed,&out) == E_NOTIMPL && out == NULL);
                destroy(malformed);
            }
        }
    }
    if (def && name)
    {
        CHECK(SLOT(def,9,string_fn)(def,&defname) == S_OK && defname);
        CHECK(!_wcsicmp(buffer(defname,NULL),buffer(name,NULL)));
    }
    CHECK(create(L"unrepresented-volume",20,&missing) == S_OK);
    out = SENTINEL;
    CHECK(SLOT(manager,10,name_fn)(manager,missing,&out) == E_NOTIMPL && out == NULL);

    /* Every unsupported deployment slot must fail rather than mutate storage. */
    out = SENTINEL;
    CHECK(SLOT(manager,6,name_fn)(manager,NULL,&out) == E_NOTIMPL && out == NULL);
    CHECK(SLOT(manager,6,name_fn)(manager,NULL,NULL) == E_POINTER);
    for (i=7;i<=19;i+=12)
    {
        out = SENTINEL;
        CHECK(SLOT(manager,i,uri_fn)(manager,NULL,NULL,0,NULL,&out) == E_NOTIMPL && out == NULL);
        CHECK(SLOT(manager,i,uri_fn)(manager,NULL,NULL,0,NULL,NULL) == E_POINTER);
    }
    CHECK(SLOT(manager,8,state_fn)(manager,NULL,0) == E_NOTIMPL);
    out = SENTINEL;
    CHECK(SLOT(manager,9,uri_fn)(manager,NULL,NULL,0,NULL,&out) == E_NOTIMPL && out == NULL);
    CHECK(SLOT(manager,9,uri_fn)(manager,NULL,NULL,0,NULL,NULL) == E_POINTER);
    out = SENTINEL;
    CHECK(SLOT(manager,13,move_fn)(manager,NULL,0,NULL,&out) == E_NOTIMPL && out == NULL);
    CHECK(SLOT(manager,13,move_fn)(manager,NULL,0,NULL,NULL) == E_POINTER);
    for (i=14;i<=18;i++) if (i != 15 && i != 16)
    {
        out = SENTINEL;
        CHECK(SLOT(manager,i,volume_fn)(manager,NULL,&out) == E_NOTIMPL && out == NULL);
        CHECK(SLOT(manager,i,volume_fn)(manager,NULL,NULL) == E_POINTER);
    }
    CHECK(SLOT(manager,15,one_fn)(manager,NULL) == E_NOTIMPL);
    CHECK(SLOT(manager,16,state_fn)(manager,NULL,0) == E_NOTIMPL);
    out = SENTINEL;
    CHECK(SLOT(manager,20,stage_fn)(manager,NULL,0,&out) == E_NOTIMPL && out == NULL);
    CHECK(SLOT(manager,20,stage_fn)(manager,NULL,0,NULL) == E_POINTER);

    destroy(mount); destroy(name); destroy(store); destroy(defname); destroy(missing);
    if (volume) RELEASE(volume);
    if (def) RELEASE(def);
    CHECK(RELEASE(manager) == 1);
    CHECK(RELEASE(instance) == 0);
    uninitialize();
    FreeLibrary(base);
    printf("package manager3 raw ABI tests: %ld failures\n",failures);
    return failures ? 1 : 0;
}
