/* Synthetic shaders only. No game assets, account, device or network needed. */
#define COBJMACROS
#include <windows.h>
#include <d3dcompiler.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef HRESULT (WINAPI *compile_fn)(const void *, SIZE_T, const char *, const D3D_SHADER_MACRO *,
        ID3DInclude *, const char *, const char *, UINT, UINT, ID3DBlob **, ID3DBlob **);
static compile_fn compile_shader;
static unsigned int checks, failures;
static BOOL baseline;
static BOOL last_syntax_error, last_unimplemented;
static const char *compiler_name;

static void check_creator(ID3DBlob *blob)
{
    const char expected[] = "vkd3d-shader 2.0";
    const DWORD *words = blob ? ID3D10Blob_GetBufferPointer(blob) : NULL;
    SIZE_T count = blob ? ID3D10Blob_GetBufferSize(blob)/sizeof(DWORD) : 0;
    BOOL found = FALSE;
    ++checks;
    for (SIZE_T i = 1; i < count;)
    {
        DWORD size = (words[i] >> 16) & 0x7fff;
        if ((words[i] & 0xffff) != 0xfffe || !size || size > count-i-1) break;
        if (size >= 8 && words[i+1] == 0x42415443)
        {
            const unsigned char *header = (const unsigned char *)&words[i+2];
            SIZE_T length = (size-1)*sizeof(DWORD), offset = words[i+3];
            found = offset <= length && sizeof(expected) <= length-offset
                    && !memcmp(header+offset, expected, sizeof(expected));
            break;
        }
        i += size+1;
    }
    if (!found)
    {
        ++failures;
        printf("FAIL shader compiler must preserve base vkd3d 2.0, not bundled fallback\n");
    }
}

static void control(ID3DBlob *blob, const char *profile, const char *field, const char *value)
{
    if (!blob) return;
    const unsigned char *bytes = ID3D10Blob_GetBufferPointer(blob);
    SIZE_T size = ID3D10Blob_GetBufferSize(blob);
    unsigned long long hash = 14695981039346656037ULL;
    for (SIZE_T i = 0; i < size; ++i) hash = (hash ^ bytes[i]) * 1099511628211ULL;
    /* Regression fingerprint, not an artifact-authentication checksum. */
    printf("CONTROL %s/%s/%s/%s %llu %016llx\n", compiler_name, profile, field, value,
            (unsigned long long)size, hash);
}

static ID3DBlob *compile(const char *source, const char *profile, BOOL success, const char *label)
{
    ID3DBlob *code = NULL, *messages = NULL;
    HRESULT hr = compile_shader(source, strlen(source), NULL, NULL, NULL, "main", profile,
            D3DCOMPILE_PACK_MATRIX_ROW_MAJOR, 0, &code, &messages);
    BOOL compiled = SUCCEEDED(hr) && code && ID3D10Blob_GetBufferSize(code);
    last_syntax_error = messages && strstr(ID3D10Blob_GetBufferPointer(messages), "E5000:");
    last_unimplemented = hr == E_NOTIMPL && messages && strstr(ID3D10Blob_GetBufferPointer(messages), "E5017:");
    ++checks;
    if (compiled != success)
    {
        ++failures;
        printf("FAIL %s (%s) hr=%08lx expected=%s\n", label, profile, (unsigned long)hr,
                success ? "compile" : "reject");
        if (messages) printf("%.*s\n", (int)ID3D10Blob_GetBufferSize(messages),
                (char *)ID3D10Blob_GetBufferPointer(messages));
    }
    if (messages) ID3D10Blob_Release(messages);
    return code;
}

static void same_code(ID3DBlob *a, ID3DBlob *b, const char *label)
{
    ++checks;
    if (!a || !b || ID3D10Blob_GetBufferSize(a) != ID3D10Blob_GetBufferSize(b)
            || memcmp(ID3D10Blob_GetBufferPointer(a), ID3D10Blob_GetBufferPointer(b),
            ID3D10Blob_GetBufferSize(a)))
    {
        ++failures;
        printf("FAIL bytecode differs for %s\n", label);
    }
}

static void release(ID3DBlob *blob) { if (blob) ID3D10Blob_Release(blob); }

static void filters(const char *profile)
{
    static const char *const fields[] = {"MinFilter", "MagFilter", "MipFilter"};
    static const char *const values[] = {"linear", "Linear", "LINEAR", "point", "Point", "POINT",
            "anisotropic", "Anisotropic"};
    const char *head = "texture tex; sampler2D s : register(s0) = sampler_state {Texture=<tex>; ";
    const char *tail = ";}; float4 main(float2 uv:TEXCOORD0):COLOR0{return tex2D(s,uv);}";
    char source[1024], label[128];
    unsigned int f, v;
    for (f = 0; f < 3; ++f) for (v = 0; v < 8; ++v)
    {
        BOOL success = !baseline || (v != 0 && v != 3);
        const char *canonical = v < 3 ? "LINEAR" : v < 6 ? "POINT" : "ANISOTROPIC";
        snprintf(source, sizeof(source), "%s%s=%s%s", head, fields[f], canonical, tail);
        ID3DBlob *reference = compile(source, profile, TRUE, "canonical sampler value");
        if (!f && !v) check_creator(reference);
        if (v == 0 || v == 3 || v == 6) control(reference, profile, fields[f], canonical);
        snprintf(source, sizeof(source), "%s%s=%s%s", head, fields[f], values[v], tail);
        snprintf(label, sizeof(label), "%s=%s", fields[f], values[v]);
        ID3DBlob *actual = compile(source, profile, success, label);
        if (success) same_code(reference, actual, label);
        release(reference); release(actual);
    }
}

static void effects(void)
{
    const char *format = "texture t; sampler s=sampler_state{Texture=<t>;MinFilter=%s;MagFilter=%s;MipFilter=%s;};"
            "float4 main(float2 uv:TEXCOORD0):COLOR0{return tex2D(s,uv);}"
            "technique T{pass P{PixelShader=compile ps_2_0 main();}}";
    char source[1024];
    snprintf(source, sizeof(source), format, "LINEAR", "POINT", "LINEAR");
    release(compile(source, "fx_2_0", FALSE, "canonical effect states unsupported by writer"));
    ++checks;
    if (!last_unimplemented || last_syntax_error)
    {
        ++failures;
        printf("FAIL canonical effect did not reach existing unsupported writer\n");
    }
    snprintf(source, sizeof(source), format, "linear", "point", "linear");
    release(compile(source, "fx_2_0", FALSE, "lowercase effect states"));
    ++checks;
    if (baseline ? !last_syntax_error : (last_syntax_error || !last_unimplemented))
    {
        ++failures;
        printf("FAIL lowercase effect parser/writer boundary changed unexpectedly\n");
    }
    snprintf(source, sizeof(source), format, "NOT_A_FILTER", "POINT", "LINEAR");
    release(compile(source, "fx_2_0", FALSE, "invalid state enum remains invalid"));
}

static void keywords(void)
{
    static const struct { const char *source, *profile, *label; BOOL success; } tests[] = {
        {"float4 main(linear float2 uv:TEXCOORD0):SV_Target{return float4(uv,0,1);}", "ps_4_0", "linear interpolation", TRUE},
        {"void helper(point float4 p[1]){} float4 main():SV_Target{return 1;}", "ps_4_0", "point parameter modifier", TRUE},
        {"sampler s=sampler_state{MinFilter=LINEAR;}; float4 main(linear float2 uv:TEXCOORD0):SV_Target{return float4(uv,0,1);}", "ps_4_0", "keyword after state block", TRUE},
        {"sampler a=sampler_state{MinFilter=LINEAR;}; sampler b=sampler_state{MagFilter=POINT;}; void helper(point float4 p[1]){} float4 main():SV_Target{return 1;}", "ps_4_0", "point after multiple state blocks", TRUE},
        {"float linear=1;float4 main():COLOR0{return linear;}", "ps_3_0", "linear is not a variable name", FALSE},
        {"float point=1;float4 main():COLOR0{return point;}", "ps_3_0", "point is not a variable name", FALSE},
        {"float4 main():COLOR0{return linear;}", "ps_3_0", "linear outside state expression", FALSE},
        {"float4 main():COLOR0{return point;}", "ps_3_0", "point outside state expression", FALSE},
    };
    for (unsigned int i = 0; i < sizeof(tests)/sizeof(*tests); ++i)
        release(compile(tests[i].source, tests[i].profile, tests[i].success, tests[i].label));
}

int main(int argc, char **argv)
{
    static const char *const dlls[] = {"d3dcompiler_43.dll", "d3dcompiler_47.dll"};
    baseline = argc == 2 && !strcmp(argv[1], "--baseline");
    if (argc != 1 && !baseline) return 2;
    for (unsigned int i = 0; i < sizeof(dlls)/sizeof(*dlls); ++i)
    {
        HMODULE module = LoadLibraryA(dlls[i]);
        FARPROC proc = module ? GetProcAddress(module, "D3DCompile") : NULL;
        ++checks;
        if (!proc) { printf("FAIL cannot load %s\n", dlls[i]); ++failures; continue; }
        memcpy(&compile_shader, &proc, sizeof(compile_shader));
        compiler_name = dlls[i];
        printf("COMPILER %s mode=%s\n", dlls[i], baseline ? "baseline" : "fixed");
        filters("ps_2_0"); filters("ps_3_0"); effects(); keywords();
        FreeLibrary(module);
    }
    printf("CHECKS %u FAILURES %u\n", checks, failures);
    return failures ? 1 : 0;
}
