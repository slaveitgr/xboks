# Xbox supporting package analysis

Static inspection of the five packages supplied on 2026-10-20. No package, service, driver or protocol handler was installed or executed. Raw packages, manifests, binary strings and metadata indexes remain under ignored `work/reference/incoming/`. This report contains interface names and findings, not recovered proprietary source.

## Package inventory

| Package identity | Version | Bytes | Relevant contents |
|---|---|---:|---|
| Microsoft.Xbox.TCUI | 1.24.10001.0 | 13,887,776 | Older Xbox Title Callable UI; `xbox-tcui` protocol; .NET Native dependencies |
| Microsoft.GamingServices | 38.118.9001.0 | 200,322,495 | GamingServices/GamingServicesNet, identity and installation APIs, cloud-save metadata, TCUI, launch helpers and Windows drivers |
| Microsoft.XboxIdentityProvider | 12.130.16001.0 | 30,062,765 | Xbox account-provider registration and silent token task |
| Microsoft.WindowsStore | 12107.1001.15.0 | 58,508,241 | Store application, purchase components, Store protocols and background tasks |
| Microsoft.WindowsStore | 22609.1401.5.0 | 126,973,085 | Store application, desktop extension, CLI, account/purchase/game-platform metadata |

The supplied Gaming Services version differs from the 39.118.16001.0 version visible in the original Xbox app screenshot. Interface differences must therefore be tracked by package version, not assumed identical.

## Confirmed findings

### 1. Xbox identity and Store identity have separate roles

`XboxIdp_12.130.16001.0_x64.appx/AppxManifest.xml` registers a `windows.webAccountProvider` for `https://xsts.auth.xboxlive.com`, with background entry point `XboxIdp.Tasks.GetTokenSilentlyTask`. It also registers `xboxidp`.

`GamingServicesTcui-Package_38.118.9001.0_x64.appx/microsoft.gameplatform.services.winmd` exposes `Microsoft.GamePlatform.Services.Identity.IUser` with `get_Gamertag`, `get_Xuid`, `get_WebAccountId`, **`get_IsStoreUser`**, `GetTokenAndSignatureAsync`, `GetMsaTicketAsync`, `GetGamerPictureAsync`, `CheckPrivilege` and `SignOutAsync`.

`XboxAuthManager` includes `TryAddDefaultUserSilentlyAsync`, `AddUserWithOptionalUiAsync`, `AddUserWithUiAsync` and `GetDeviceUserAsync`. These are declarations in Windows Runtime metadata, not proof that a portable public endpoint implements the same methods.

The original Xbox app resource names already distinguish `IdentityGamingAccountTitleText`, `IdentityStoreAccountTitleText`, and `MismatchStoreAccount`. Together these are strong evidence for separate identity roles in the original settings. They do **not** establish that the Linux backend has obtained both identities, or that two accounts are currently signed in.

The newer Store's native `WinStore.App.dll` additionally contains names such as `StoreUserIdentityCache`, `StoreUserProfileManager`, `EnsureStoreUserAuthenticated` and `AccountMismatch`. Native strings alone do not expose complete execution flow.

**Implication:** subscription/account UI needs independently sourced Xbox and Store identities, with explicit unavailable states. Never duplicate the current Xbox account and label the duplicate a verified Store account. Third-party linked identities also require their own service results.

### 2. TCUI is a delegated UI host, not the entire Xbox app

The Gaming Services package contains readable .NET metadata and IL for `gamingservicestcui/gamingservicestcui.dll`: **53 types, 237 method declarations, 198 decoded IL bodies, zero IL parse errors**.

Its `MainWindow.GetLaunchPage` directly compares the launch types `Xbox-AccountPicker`, `Xbox-WebView`, `Xbox-Spinner`, `Xbox-InstallerConsent` and `Xbox-ErrorPage`, and calls the corresponding page constructors/helpers. `GetMsaAuthPage` reads `Xbox-AccountPicker-UiMode`, `MsaScope`, `ClientId`, `MsaUserId` and `Authority` keys. `GetWebViewPage` reads `Xbox-WebView-StartUri` and `Xbox-WebView-EndUri`.

`App.OnProtocolActivated` reads the URI and owner-window argument `Xbox-Gaming-Window-Owner`. The manifest registers `gaming-tcui`. `MsaAuthPage` references Windows `AccountsSettingsPane` and `WebAuthenticationCoreManager` interfaces. `GetTokenRequest` constructs a Windows `WebTokenRequest`; these are Windows broker operations, not a standalone cross-platform OAuth implementation.

`GamingUI.XboxLive.InternalHelpers.GamingUsersHelpers` declares completion callbacks for MSA, web view, spinner, consent and error pages. Raw XAML includes dashboard, button, icon and style resources. This is useful evidence for modal flows and ownership, but does not supply the main Xbox application's home/settings implementation.

### 3. Install progress and launch readiness are separate

`PackageInstallationState` declares `Idle`, `Paused`, `Streaming`, `Completed`, `Failed`, `Canceled`, `Waiting`, `Terminal`. `PackageInstallationType` includes install, update, copy, move, repair and other modes. `IPackageInstallationInfo` separately exposes `get_State`, **`get_Launchable`**, `get_Progress`, `get_DataRate`, `get_Error`, `get_ExtendedError`, `get_WaitReason` and `get_RemediationAction`.

`PackageInstallationMetric` contains `StreamedBytes` and `TotalBytes`; progress metadata separates package/install/launch/network/optical/defragment dimensions. These declarations explain why original download UI can show progress, a wait reason and launch readiness independently.

**Implication:** the Linux queue should keep downloaded bytes, completion and launchability distinct. Original enum names are a specification reference; they must be mapped to actual backend events rather than displayed as invented progress.

### 4. Cloud-save synchronization has its own model

`IGameSaveInfo` exposes bytes, uploaded bytes, last sync result, in-sync/active flags, user/game IDs and location. `IGameSaveChangedInfo` includes state, flags, percentage and last-modified device. `GameSaveSyncState` includes local/remote offline, uploading/uploaded, downloading/downloaded and local-changed states. Flags include `NoAuth`, `NoConnectivity`, `UnSynced` and `LostLock`.

A useful versioning detail: the package contains **two different** GamePlatform metadata files. The root copy has 225 types; `GamingServicesUI/microsoft.gameplatform.services.winmd` has 250. Their `GameSaveMonitor` APIs and some sync flags differ: the UI copy has Start/Stop and state-change events, while the root copy has registered-AUMID add/remove methods. Do not merge these into one assumed ABI.

The package also contains `GamingServicesUI/synccloudsavescontrol.xbf`, `launchingpromptdialog.xbf`, `closepromptdialog.xbf`, `installitemcontrol.xbf` and update/error controls. File presence confirms UI components, not exact rendered pixels or server behavior.

**Implication:** a real cloud-sync stage needs backend state, errors and completion evidence. Showing a cosmetic syncing animation would not reproduce the original behavior.

### 5. Native services and Store integration remain Windows-specific

Gaming Services declares automatic `GamingServices` (LocalSystem) and `GamingServicesNet` (LocalService) services. It includes `drivers/gameflt.sys` and `drivers/xvdd.sys`. `gamelaunchhelper.dll` exports `GameLaunch`; `gameplatformservices.dll` exports API initialization/query/rundown functions. Export names alone do not define their calling contracts.

The newer Store registers `ms-windows-store`, `ms-windows-store2`, `ms-windows-store-deskext`, `microsoft-store-appservice`, a desktop extension and a `store.exe` application alias. Its package metadata declares purchase sign-in APIs. These are additional Windows integration boundaries, not Linux components that can be enabled by copying the bundle.

## What these packages do not establish

- They do not identify actual connected accounts, current subscriptions, renewal dates or billing prices for this user.
- They do not implement Windows Xbox launcher extensions on Linux.
- They do not reveal a complete working Remote Play protocol implementation.
- They are not the main `Microsoft.GamingApp` package or a replacement for its screenshots and Hermes analysis.
- Static interfaces and strings do not establish service authorization, complete HTTP schemas, native ABI signatures or working Proton compatibility.

## Reproduction and next implementation work

`scripts/analysis/inspect-xbox-components.py` indexes native PE imports/exports and filtered ASCII/UTF-16 strings, plus managed type/method/field names and IL string/call references. It requires `dnfile` and `dncil`; analysis dependencies were installed only in ignored `work/reference/metadata-tools`. It never imports the inspected binaries. Generic MethodSpec call tokens remain unresolved; this is an index, not complete source decompilation.

Priority work informed by the findings:

1. Extend the account backend contract to return independently verified Xbox/Store identities; preserve identity source and freshness. Only then expose another connected-account card.
2. Model install wait/error/remediation and launchability separately using backend capabilities.
3. Expose real cloud-sync lifecycle events and connect a matching pre-launch dialog.
4. Recreate TCUI-style account/error/consent dialogs with a Linux-compatible auth flow, preserving clear ownership and cancellation.
5. Continue deriving main Settings and third-party provider behavior from the original GamingApp; supporting packages complement that analysis.

No application behavior was changed as part of this package-analysis pass.
