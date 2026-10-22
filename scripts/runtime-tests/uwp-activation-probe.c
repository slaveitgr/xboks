/* Bounded activation probe, not a game or a claim of UWP compatibility.
 * Run only in a disposable Wine prefix. No package registration, account,
 * network, game files or real application view is used. */
#define COBJMACROS
#define CONST_VTABLE
#include <windows.h>
#include <windows.applicationmodel.core.h>
#include <stdio.h>

typedef __x_ABI_CWindows_CApplicationModel_CCore_CICoreApplication ICoreApplication;
typedef __x_ABI_CWindows_CApplicationModel_CCore_CIFrameworkViewSource IFrameworkViewSource;
typedef __x_ABI_CWindows_CApplicationModel_CCore_CIFrameworkViewSourceVtbl IFrameworkViewSourceVtbl;
typedef __x_ABI_CWindows_CApplicationModel_CCore_CIFrameworkView IFrameworkView;

typedef HRESULT (WINAPI *ro_initialize_fn)(UINT32);
typedef void (WINAPI *ro_uninitialize_fn)(void);
typedef HRESULT (WINAPI *create_string_fn)(PCNZWCH, UINT32, HSTRING *);
typedef HRESULT (WINAPI *delete_string_fn)(HSTRING);
typedef HRESULT (WINAPI *get_factory_fn)(HSTRING, REFIID, void **);
typedef HRESULT (WINAPI *dll_factory_fn)(HSTRING, void **);

static const GUID core_iid = {0x0aacf7a4,0x5e1d,0x49df,{0x80,0x34,0xfb,0x6a,0x68,0xbc,0x5e,0xd1}};
static const GUID window_iid = {0x4d239005,0x3c2a,0x41b1,{0x90,0x22,0x53,0x6b,0xb9,0xcf,0x93,0xb1}};
static const GUID factory_iid = {0x00000035,0,0,{0xc0,0,0,0,0,0,0,0x46}};
static const GUID unknown_iid = {0,0,0,{0xc0,0,0,0,0,0,0,0x46}};
static const GUID inspectable_iid = {0xaf86e2e0,0xb12d,0x4c6a,{0x9c,0x5a,0xd7,0xaa,0x65,0x10,0x1e,0x90}};
static const GUID source_iid = {0xcd770614,0x65c4,0x426c,{0x94,0x94,0x34,0xfc,0x43,0x55,0x48,0x62}};
static unsigned create_view_calls;

/* Fail before creating a window or entering an application event loop. A Run
 * implementation should reach CreateView; a stub can return without doing so. */
static HRESULT STDMETHODCALLTYPE source_query(IFrameworkViewSource *self, REFIID iid, void **out)
{
    if (!out) return E_POINTER;
    *out = NULL;
    if (!IsEqualGUID(iid,&unknown_iid) && !IsEqualGUID(iid,&inspectable_iid) && !IsEqualGUID(iid,&source_iid)) return E_NOINTERFACE;
    *out = self;
    return S_OK;
}
static ULONG STDMETHODCALLTYPE source_addref(IFrameworkViewSource *self) { (void)self; return 2; }
static ULONG STDMETHODCALLTYPE source_release(IFrameworkViewSource *self) { (void)self; return 1; }
static HRESULT STDMETHODCALLTYPE source_iids(IFrameworkViewSource *self, ULONG *count, IID **iids)
{ (void)self; if (!count || !iids) return E_POINTER; *count = 0; *iids = NULL; return S_OK; }
static HRESULT STDMETHODCALLTYPE source_name(IFrameworkViewSource *self, HSTRING *name)
{ (void)self; if (!name) return E_POINTER; *name = NULL; return E_NOTIMPL; }
static HRESULT STDMETHODCALLTYPE source_trust(IFrameworkViewSource *self, TrustLevel *trust)
{ (void)self; if (!trust) return E_POINTER; *trust = BaseTrust; return S_OK; }
static HRESULT STDMETHODCALLTYPE source_view(IFrameworkViewSource *self, IFrameworkView **view)
{ (void)self; create_view_calls++; if (!view) return E_POINTER; *view = NULL; return E_NOTIMPL; }
static const IFrameworkViewSourceVtbl source_vtable = {
    source_query, source_addref, source_release, source_iids, source_name, source_trust, source_view
};

int main(void)
{
    HMODULE combase = LoadLibraryW(L"combase.dll");
    ro_initialize_fn initialize = combase ? (ro_initialize_fn)GetProcAddress(combase,"RoInitialize") : NULL;
    ro_uninitialize_fn uninitialize = combase ? (ro_uninitialize_fn)GetProcAddress(combase,"RoUninitialize") : NULL;
    create_string_fn create_string = combase ? (create_string_fn)GetProcAddress(combase,"WindowsCreateString") : NULL;
    delete_string_fn delete_string = combase ? (delete_string_fn)GetProcAddress(combase,"WindowsDeleteString") : NULL;
    get_factory_fn get_factory = combase ? (get_factory_fn)GetProcAddress(combase,"RoGetActivationFactory") : NULL;
    if (!initialize || !uninitialize || !create_string || !delete_string || !get_factory) {
        puts("{\"schema\":1,\"error\":\"missing-combase-exports\"}"); return 20;
    }
    HRESULT init = initialize(1); /* RO_INIT_MULTITHREADED */
    if (FAILED(init)) { printf("{\"schema\":1,\"error\":\"RoInitialize\",\"hresult\":\"0x%08lx\"}\n",(unsigned long)init); return 21; }
    const WCHAR *classes[] = {L"Windows.ApplicationModel.Core.CoreApplication",L"Windows.UI.Core.CoreWindow",L"Windows.UI.Xaml.Application"};
    const char *labels[] = {"CoreApplication","CoreWindow","XamlApplication"};
    const GUID *iids[] = {&core_iid,&window_iid,&factory_iid};
    const WCHAR *providers[] = {L"twinapi.appcore.dll",NULL,L"windows.ui.xaml.dll"};
    puts("{\"schema\":1,\"probe\":\"uwp-activation\",\"gameCompatibilityProven\":false,\"factories\":[");
    for (unsigned i = 0; i < 3; ++i) {
        HSTRING name = NULL; IUnknown *factory = NULL;
        HRESULT result = create_string(classes[i],(UINT32)lstrlenW(classes[i]),&name);
        if (SUCCEEDED(result)) result = get_factory(name,iids[i],(void **)&factory);
        printf("%s{\"class\":\"%s\",\"hresult\":\"0x%08lx\",\"obtained\":%s",i ? "," : "",labels[i],(unsigned long)result,SUCCEEDED(result) && factory ? "true" : "false");
        if (i == 0 && SUCCEEDED(result) && factory) {
            IFrameworkViewSource source = {&source_vtable};
            HRESULT run = ((ICoreApplication *)factory)->lpVtbl->Run((ICoreApplication *)factory,&source);
            printf(",\"runHresult\":\"0x%08lx\",\"createViewCalls\":%u",(unsigned long)run,create_view_calls);
        }
        if (providers[i] && name) {
            /* Bypass missing registration for a second, explicitly separate
             * provider check. Do not write activation registry entries. */
            HMODULE provider = LoadLibraryW(providers[i]);
            dll_factory_fn direct = provider ? (dll_factory_fn)GetProcAddress(provider,"DllGetActivationFactory") : NULL;
            IUnknown *direct_factory = NULL;
            if (direct) {
                HRESULT direct_result = direct(name,(void **)&direct_factory);
                printf(",\"directProviderHresult\":\"0x%08lx\",\"directProviderObtained\":%s",(unsigned long)direct_result,SUCCEEDED(direct_result) && direct_factory ? "true" : "false");
            } else printf(",\"directProviderError\":\"missing-export-or-module\"");
            if (direct_factory) IUnknown_Release(direct_factory);
            if (provider) FreeLibrary(provider);
        }
        puts("}");
        if (factory) IUnknown_Release(factory);
        if (name) delete_string(name);
    }
    puts("]}"); uninitialize(); FreeLibrary(combase); return 0;
}
