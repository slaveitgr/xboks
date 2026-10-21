/* SPDX-License-Identifier: MIT
 * Synthetic D3D11 compute/readback through the actual shared DXVK DLLs.
 * No game, account, network or private shader assets.
 */
#define COBJMACROS
#include <windows.h>
#include <d3d11.h>
#include <d3dcompiler.h>
#include <stdio.h>
#include <string.h>
static unsigned checks,failures;
#define CHECK(name,x) do {++checks;if(!(x)){++failures;printf("FAIL %s line=%d\n",name,__LINE__);}}while(0)
int main(void)
{
    ID3D11Device *device=NULL;ID3D11DeviceContext *context=NULL;ID3DBlob *code=NULL,*errors=NULL;
    ID3D11ComputeShader *shader=NULL;ID3D11Buffer *buffer=NULL,*readback=NULL;ID3D11UnorderedAccessView *view=NULL;
    D3D_FEATURE_LEVEL level;
    HRESULT hr=D3D11CreateDevice(NULL,D3D_DRIVER_TYPE_HARDWARE,NULL,0,NULL,0,D3D11_SDK_VERSION,&device,&level,&context);
    CHECK("device",SUCCEEDED(hr)&&device&&context);if(FAILED(hr))goto done;
    CHECK("compute-level",level>=D3D_FEATURE_LEVEL_11_0);
    const char *source="RWStructuredBuffer<uint> output : register(u0); [numthreads(8,1,1)] void main(uint3 id : SV_DispatchThreadID) { output[id.x] = id.x * 17u + 23u; }";
    hr=D3DCompile(source,strlen(source),"synthetic",NULL,NULL,"main","cs_5_0",0,0,&code,&errors);
    CHECK("compile",SUCCEEDED(hr)&&code);if(FAILED(hr))goto done;
    hr=ID3D11Device_CreateComputeShader(device,ID3D10Blob_GetBufferPointer(code),ID3D10Blob_GetBufferSize(code),NULL,&shader);
    CHECK("shader",SUCCEEDED(hr)&&shader);if(FAILED(hr))goto done;
    D3D11_BUFFER_DESC desc={0};desc.ByteWidth=32*sizeof(UINT);desc.Usage=D3D11_USAGE_DEFAULT;
    desc.BindFlags=D3D11_BIND_UNORDERED_ACCESS;desc.MiscFlags=D3D11_RESOURCE_MISC_BUFFER_STRUCTURED;desc.StructureByteStride=sizeof(UINT);
    hr=ID3D11Device_CreateBuffer(device,&desc,NULL,&buffer);CHECK("output-buffer",SUCCEEDED(hr)&&buffer);if(FAILED(hr))goto done;
    D3D11_UNORDERED_ACCESS_VIEW_DESC uav={0};uav.ViewDimension=D3D11_UAV_DIMENSION_BUFFER;uav.Format=DXGI_FORMAT_UNKNOWN;uav.Buffer.NumElements=32;
    hr=ID3D11Device_CreateUnorderedAccessView(device,(ID3D11Resource *)buffer,&uav,&view);CHECK("uav",SUCCEEDED(hr)&&view);if(FAILED(hr))goto done;
    desc.Usage=D3D11_USAGE_STAGING;desc.BindFlags=0;desc.CPUAccessFlags=D3D11_CPU_ACCESS_READ;desc.MiscFlags=0;
    hr=ID3D11Device_CreateBuffer(device,&desc,NULL,&readback);CHECK("readback-buffer",SUCCEEDED(hr)&&readback);if(FAILED(hr))goto done;
    ID3D11DeviceContext_CSSetShader(context,shader,NULL,0);ID3D11DeviceContext_CSSetUnorderedAccessViews(context,0,1,&view,NULL);
    ID3D11DeviceContext_Dispatch(context,4,1,1);ID3D11DeviceContext_CopyResource(context,(ID3D11Resource *)readback,(ID3D11Resource *)buffer);
    D3D11_MAPPED_SUBRESOURCE mapped={0};
    hr=ID3D11DeviceContext_Map(context,(ID3D11Resource *)readback,0,D3D11_MAP_READ,0,&mapped);CHECK("map",SUCCEEDED(hr)&&mapped.pData);
    if(SUCCEEDED(hr)){for(UINT i=0;i<32;i++)CHECK("computed-value",((UINT *)mapped.pData)[i]==i*17+23);ID3D11DeviceContext_Unmap(context,(ID3D11Resource *)readback,0);}
done:
    if(view)ID3D11UnorderedAccessView_Release(view);
    if(buffer)ID3D11Buffer_Release(buffer);
    if(readback)ID3D11Buffer_Release(readback);
    if(shader)ID3D11ComputeShader_Release(shader);
    if(code)ID3D10Blob_Release(code);
    if(errors)ID3D10Blob_Release(errors);
    if(context)ID3D11DeviceContext_Release(context);
    if(device)ID3D11Device_Release(device);
    printf("DXVK COMPUTE CHECKS %u FAILURES %u\n",checks,failures);return failures?1:0;
}
