# Typed native metadata contracts

The earlier WinMD index listed type/member names. This pass decodes the **actual method and field signature blobs**, parameter metadata and constant-table values in all 39 GamingApp and 10 Game Bar WinMD files. It follows [ECMA-335 Partition II](https://ecma-international.org/publications-and-standards/standards/ecma-335/), sections 23.1/23.2. It does not load an assembly or invoke its code.

| Supplied package | WinMD files | Type declarations | Decoded method/field members | Decode errors |
|---|---:|---:|---:|---:|
| GamingApp 2610.1001.20.0 x64 |39|4058|27018|0|
| XboxGamingOverlay 7.326.10141.0 x64 |10|2145|16553|0|

Counts include framework bindings and generated projections. Members are retained per originating file and metadata row ID; they are not that many independent Xbox features. In total this adds **43,571 typed member records**. Raw signatures, decoded structure and enum constants remain in ignored local indexes.

## What is decoded

Compressed unsigned/signed metadata integers; method calling convention/instance/generic-arity flags; return and parameter types; primitive and named class/value types; type/method generic parameters; generic instances; pointer/by-reference forms; vectors and shaped arrays; required/optional modifiers; function-pointer signatures; field types; typed constant values; parameter names and In/Out/Optional metadata.

Type references preserve their table/RID and namespace/name. They do not resolve all external assemblies, native COM vtables, calling-marshalling stubs or runtime class activation. Invalid/truncated types, bad coded indexes and trailing signature bytes produce explicit errors, rather than a guessed type. The parser's supported forms are bounded to the tested metadata grammar; it is not a universal CLI verifier.

## Concrete Remote Play interface shapes

Source: `gamestreaming_sdk.winmd` in the GamingApp package. The following notation is a readable rendering of the decoded metadata, not a portable SDK implementation:

| Interface/member | Metadata contract |
|---|---|
| `IConsoleManager.EnumerateConsolesAsync` (MethodDef 23) | `(uint32 itemsToReturn, ConsoleEnumerationState state) → IAsyncOperation<ConsoleEnumerationResult>` |
| `IStreamSession.ConnectAsync` (MethodDef 89) | `(uint64 renderTarget) → IAsyncAction` |
| `IStreamSession.PauseAsync` (MethodDef 90) | `(bool shouldConstrain) → IAsyncOperation<bool>` |
| `IStreamSession.ResumeAsync` (MethodDef 91) | `(bool shouldUnconstrain) → IAsyncOperation<bool>` |

`uint64 renderTarget` is the metadata's type/name. Its meaning, ownership, lifetime and accepted native window/control are not recovered merely from the parameter. A Linux renderer handle must not be passed to an imagined Windows call.

The constant table establishes `StreamSessionRequestState`: NotStarted=0, Queued=1, Launching=2, Ready=3, Cancelled=4, Failed=5. It also establishes `ConsolePowerState`: ConnectedStandby=0, On=1, Off=2, Unknown=3. These are versioned SDK enum values; they do not prove a public network payload uses those numbers. The interface declaration does not recover authentication, discovery, wake or transport implementations.

## Store identity has its own typed interface

Source: `Xbox.Web.winmd`.

- `Xbox.Web.User_PlatformStore.IUser_PlatformStoreApiHandler.GetPlatformStoreUserInfoAsync` (MethodDef 2730) has no parameters and returns `IAsyncOperation<PlatformStoreUserInfoResult>`.
- `SetPlatformStoreAccountAsync` (MethodDef 2731) takes a **string `webAccountId`** and returns `IAsyncAction`.

This corroborates the distinct Store identity role. It does not authorize deriving that ID from an Xbox gamertag/email or prove that the current backend supplies the API. An account name and a Windows web-account ID must not be interchanged.

## Reproduce/query

```sh
PYTHONPATH=work/reference/metadata-tools python3 scripts/analysis/inspect-winmd-signatures.py \
  work/reference/XboxAppPackage_2610.1001.20.0_x64.msix \
  --private-output work/reference/library/native-signatures-xbox.json

PYTHONPATH=work/reference/metadata-tools python3 scripts/analysis/inspect-winmd-signatures.py \
  work/reference/GameBar_7.326.10141.0_x64.appx \
  --private-output work/reference/library/native-signatures-gamebar.json

python3 scripts/analysis/xbox-reference-library.py build
python3 scripts/analysis/xbox-reference-library.py member EnumerateConsolesAsync
python3 scripts/analysis/xbox-reference-library.py member SetPlatformStoreAccountAsync
python3 scripts/analysis/test-winmd-signatures.py
```

Fourteen synthetic tests cover method/generic/byref/array/modifier signatures, compressed integers, signed array bounds, constants, malformed/truncated/trailing inputs and invalid array rank. Package integration separately verifies all 49 WinMD files decode without errors. The library checks package/member SHA-256 and byte counts, rejects file/member decode errors, and reconciles member/type/file counts before importing these records. These checks bind the saved report to its inputs; they are not an independent native implementation audit.

The existing [native-contracts chapter](native-contracts.md) describes architectural boundaries. This pass supersedes its earlier limitation that member signatures were not decoded. Native implementation/marshalling, external type resolution and successful calls remain open.
