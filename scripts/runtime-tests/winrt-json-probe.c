/* Real WinRT JSON dependency used by XUser. No account/network/saves. */
#define COBJMACROS
#define INITGUID
#include <windows.h>
#include <roapi.h>
#include <winstring.h>
#define WIDL_using_Windows_Data_Json
#include <windows.data.json.h>
#include <stdio.h>

static unsigned checks, failures;
#define CHECK(name, expr) do { ++checks; if (!(expr)) { ++failures; printf("FAIL %s\n", name); } } while (0)
int main(void)
{
    IJsonValueStatics *statics = NULL;
    IJsonValue *value = NULL;
    IJsonObject *object = NULL;
    IJsonArray *array = NULL;
    HSTRING class_name = NULL, input = NULL, key = NULL;
    HRESULT hr = RoInitialize(RO_INIT_MULTITHREADED);
    BOOL initialized = SUCCEEDED(hr);
    CHECK("initialize", SUCCEEDED(hr));
    if (FAILED(hr)) goto done;
    CHECK("class-name", WindowsCreateString(L"Windows.Data.Json.JsonValue", 27, &class_name) == S_OK);
    hr = RoGetActivationFactory(class_name, &IID_IJsonValueStatics, (void **)&statics);
    CHECK("factory", hr == S_OK && statics);
    if (FAILED(hr) || !statics) goto done;
    const WCHAR payload[] = L"{\"EndPoints\":[{\"Host\":\"example.invalid\"}],\"SignaturePolicies\":[]}";
    CHECK("input", WindowsCreateString(payload, ARRAYSIZE(payload) - 1, &input) == S_OK);
    hr = IJsonValueStatics_Parse(statics, input, &value);
    CHECK("parse-object-not-stub", hr == S_OK && value);
    if (FAILED(hr) || !value) goto done;
    hr = IJsonValue_GetObject(value, &object);
    CHECK("object", hr == S_OK && object);
    if (FAILED(hr) || !object) goto done;
    CHECK("key", WindowsCreateString(L"EndPoints", 9, &key) == S_OK);
    hr = IJsonObject_GetNamedArray(object, key, &array);
    CHECK("endpoint-array", hr == S_OK && array);
    if (SUCCEEDED(hr) && array) {
        IJsonObject *endpoint = NULL;
        CHECK("array-object", IJsonArray_GetObjectAt(array, 0, &endpoint) == S_OK && endpoint);
        if (endpoint) IJsonObject_Release(endpoint);
    }
done:
    if (array) IJsonArray_Release(array);
    if (object) IJsonObject_Release(object);
    if (value) IJsonValue_Release(value);
    if (statics) IJsonValueStatics_Release(statics);
    WindowsDeleteString(key); WindowsDeleteString(input); WindowsDeleteString(class_name);
    if (initialized) RoUninitialize();
    printf("CHECKS %u FAILURES %u\n", checks, failures);
    return failures ? 1 : 0;
}
