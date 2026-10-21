# Native boundaries recovered from the supplied packages

Reference: GamingApp **2610.1001.20.0 x64**, Game Bar **7.326.10141.0 x64**. These findings come from **all 39 WinMD files in GamingApp** and **all 10 WinMD files in Game Bar**, indexed in this analysis. GamingApp contributes 4,058 type declarations; Game Bar contributes 2,145. Counts include generated interfaces, framework bindings and duplicate projection shapes, not that many independent application features.

The names-only sources are `work/reference/xbox-components.json` and `gamebar-components.json`. The later [typed signature pass](winmd-signatures.md) adds 43,571 decoded method/field records, parameter types/names and constants in `work/reference/library/native-signatures-{xbox,gamebar}.json`. The searchable library preserves each originating file and metadata row. **Zero managed IL bodies exist in these particular 49 files**; decoded signatures do not reveal native implementations, marshalling stubs or successful service calls. The separate Gaming Services TCUI component does contain 198 decoded IL bodies; keep those findings scoped to that component/version.

## Controller focus is a native contract

Evidence: `xbox-components.json::GamepadNavigation.winmd`.

| Type | Declared surface | Independent implementation consequence |
|---|---|---|
| `FocusContainer` / `IFocusContainer` | Last focused interactable, focus ownership, Z index, focus/blur, searchable/interactable children | Maintain an explicit active focus container and restore its last valid child. A CSS selected state is insufficient. |
| `FocusGroup` / `IFocusGroup` | Exit directions, directional overrides, tab behavior, grid/group positioning, capture/persistent focus, enter/exit callbacks | Each modal/menu group must own directional movement and Back before the page beneath it. |
| `GamepadScrollable` | Alignment, offsets, snap thresholds, paging, trigger overrides, focus scrolling | Scroll policies belong to each region. Do not make shoulder/trigger input scroll the whole app unconditionally. |
| `Interactable` / `GamepadInteractable` | Focus/blur and press/press-in/press-out | Distinguish hover/selection, focus and activation; focus must not open a product route. |

The actual numeric thresholds and active feature-flight conditions need bytecode/data-flow or Windows observation. Do not invent defaults and label them original values.

## Console Remote Play has a session lifecycle

Evidence: `xbox-components.json::gamestreaming_sdk.winmd`, with rendering bridges in `Microsoft.Streaming.XccWebRtc.winmd`, `GameStreaming.UI.winmd`, `ReactNativeGameStreaming.winmd`.

| Stage | Declared metadata |
|---|---|
| User/session bootstrap | `IStreamClient.LoginAsync`, `GetConsoleManagerForUser`, `CreateSessionRequestAsync` |
| Console discovery | `IConsoleManager.EnumerateConsolesAsync`; console result fields include server ID, device name, console type, power state and out-of-home warning |
| Session request | `StreamSessionRequestState`: NotStarted, Queued, Launching, Ready, Cancelled, Failed |
| Connected session | `IStreamSession.ConnectAsync`, PauseAsync, ResumeAsync, DisconnectAsync, ShutdownAsync |
| State updates | Disconnected/reconnecting, quality/statistics, controller disconnection, video dimensions, input error and recording-permission changes |
| Input | Virtual input manager and gamepad, relative mouse/touch methods; explicit input configuration options |
| Rendering | `GameStreamingControl.BindVideoFrameProvider`, HWND-backed control and scaling factor |

This establishes the vocabulary and separation of responsibilities. It does **not** recover the authorization exchange, packet format, codec negotiation, transport implementation or a portable SDK. SDK presence alone does not prove which renderer or remote session type an observed UI path chooses. The current xboks web Remote Play window is a different adapter and has not been validated with the user's Xbox One X.

For a native adapter, define typed state transitions and preserve real error causes before adding screen animations. A successful web page load is not console discovery or streaming success. Test cancellation during each stage, network loss/reconnection, expired authorization, console standby and controller loss on real hardware.

## Xbox, Store and linked-provider accounts remain different

Evidence: `Microsoft.GamePlatform.Services.winmd`, `Xbox.Web.winmd`, `XboxGameBarWidgets.winmd` inside GamingApp.

- `Microsoft.GamePlatform.Services.Identity.IUser` declares `get_IsStoreUser` alongside gamertag/XUID/web-account fields. These are separate identity roles, not aliases inferred from displayed text.
- `Xbox.Web.User_PlatformStore.IUser_PlatformStoreApiHandler` declares `GetPlatformStoreUserInfoAsync` and `SetPlatformStoreAccountAsync`. Store profile fields have ID, username, display name and avatar image.
- `GameBar.Social.AccountLinking.LinkedAccountViewModel` exposes link status, token status, profile visibility/friend-finding state and link/unlink commands. Provider presence in a desktop file is not linked-account evidence.
- `XboxSettingsAccountPageViewModel` declares Xbox linked/unlinked account collections and error/visibility conditions. This is the **Game Bar social settings** surface. It must not be assumed identical to the main Xbox app Settings category just because its type name contains Settings.

## Navigation and hosted content

Evidence: `Xbox.Web.winmd`.

The app contains `AppNavigationApi`, handler methods for protocol activation/folder launch and launch milestones, user/platform-store handlers, WebView navigation/new-window callbacks, and configuration fields for preferred source/bundle updates. These declarations show that the shipped package includes hosted-content infrastructure. They do not establish whether a particular screenshot used hosted content or prove that all UI resources are fixed inside this package. Server-delivered collections, content and feature flights remain separate evidence gaps.

Evidence: `XboxPcAppFT.winmd`.

`ISettingsStore` declares JSON settings persistence; `IUserUtilities` includes startup-task configuration; `IWindowActivationManager` declares window activation/maximization. In Linux these map to small Electron/XDG/platform adapters. Do not expose COM or arbitrary shell execution in the renderer to imitate an API name.

## How to inspect an exact declaration

```sh
python3 scripts/analysis/xbox-reference-library.py search FocusGroup --limit 5
python3 scripts/analysis/xbox-reference-library.py search IConsoleManager --limit 5
python3 scripts/analysis/xbox-reference-library.py search IUser_PlatformStore --limit 5
python3 scripts/analysis/xbox-reference-library.py search LinkedAccountViewModel --limit 5
python3 scripts/analysis/xbox-reference-library.py member EnumerateConsolesAsync --limit 5
python3 scripts/analysis/xbox-reference-library.py member SetPlatformStoreAccountAsync --limit 5
```

The `source` field distinguishes versions/components. Metadata names are evidence locators, not instructions to invoke a Windows-only method in the Linux app.
