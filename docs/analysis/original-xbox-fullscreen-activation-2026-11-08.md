# Original Xbox Fullscreen Experience: activation investigation

Date: 2026-11-08. Status: the original CE Home frontend has visibly rendered in
an isolated candidate; Xbox fullscreen activation under Wine has **not** been
demonstrated. These are separate milestones.

The later [mode-bridge checkpoint](original-xbox-mode-bridge-2026-11-08.md)
records the implemented Wine/Native1 adapter, passing isolated runtime gates
and installed extension files. A fresh GNOME login and real mode entry/exit
acceptance are still pending.

This investigation concerns the original Microsoft GamingApp 2612 client.
The profile-menu **New app experience** switch, the app's controller-oriented
fullscreen layout, and the operating system's gaming session are separate
acceptance cases.

## What XboxFullScreenExperienceTool changes

Audited revision:
[`1170d773104f8e490ebc831887ed20cc6780c9aa`](https://github.com/8bit2qubit/XboxFullScreenExperienceTool/tree/1170d773104f8e490ebc831887ed20cc6780c9aa),
version 0.9.4. The source was read without executing the tool.

| Operation | Source |
| --- | --- |
| Select Windows feature IDs 52580392, 50902630, and conditionally 59765208 according to OS build, physical display size and existing overrides | [MainForm.cs, GetRequiredFeatureIds](https://github.com/8bit2qubit/XboxFullScreenExperienceTool/blob/1170d773104f8e490ebc831887ed20cc6780c9aa/XboxFullScreenExperienceTool/MainForm.cs#L555) |
| Back up and set `HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\OEM\DeviceForm` to DWORD `0x2e` (46) | [BackupAndSetRegistry](https://github.com/8bit2qubit/XboxFullScreenExperienceTool/blob/1170d773104f8e490ebc831887ed20cc6780c9aa/XboxFullScreenExperienceTool/MainForm.cs#L1276) |
| Reset the three feature overrides, then enable the required subset at User priority for both Runtime and Boot configurations | [EnableViveFeatures](https://github.com/8bit2qubit/XboxFullScreenExperienceTool/blob/1170d773104f8e490ebc831887ed20cc6780c9aa/XboxFullScreenExperienceTool/MainForm.cs#L1299) |
| Open `ms-settings:gaming-fullscreen`; Xbox home-app and startup selection are performed in Windows Settings | [Settings button](https://github.com/8bit2qubit/XboxFullScreenExperienceTool/blob/1170d773104f8e490ebc831887ed20cc6780c9aa/XboxFullScreenExperienceTool/MainForm.cs#L1147), [setup instructions](https://github.com/8bit2qubit/XboxFullScreenExperienceTool/blob/1170d773104f8e490ebc831887ed20cc6780c9aa/README.md#L120) |
| Apply persistent device-form/display overrides using a SYSTEM boot task or, on the legacy path, an optional driver; reboot after acknowledgment | [task setup](https://github.com/8bit2qubit/XboxFullScreenExperienceTool/blob/1170d773104f8e490ebc831887ed20cc6780c9aa/XboxFullScreenExperienceTool/Helpers/TaskSchedulerManager.cs#L217), [reboot](https://github.com/8bit2qubit/XboxFullScreenExperienceTool/blob/1170d773104f8e490ebc831887ed20cc6780c9aa/XboxFullScreenExperienceTool/MainForm.cs#L1474) |

The tool enables existing Windows functionality. It does not provide a
fullscreen renderer, a replacement shell, or a direct command that launches the
original Xbox fullscreen interface. It does not itself select a GamingHome
application identity.

Its build classifier treats our Windows image version **26300.9457** as Native
Insider. For a desktop/laptop or an unknown display diagonal it selects all
three IDs. For a genuine handheld with a diagonal greater than zero and at
most 9.5 inches, with no display override, it selects the first two. This is
the tool's classification, not a runtime compatibility result.

## Relevant Wine-UWP behavior

The current research source already implements `RtlQueryFeatureConfiguration`
in `dlls/ntdll/rtl.c`. It has no Windows staging store; by default the query
returns `STATUS_NOT_FOUND`, leaving the caller's compiled-in default in use.
Its process environment override accepts **hexadecimal** feature IDs and states
`0` (default), `1` (disabled), and `2` (enabled).

The desktop/laptop feature subset from the audited tool corresponds to:

```text
WINE_UWP_FEATURES=03225028:2,0308b666:2,038ff1d8:2
```

This is a candidate for an explicitly scoped diagnostic launch, **not a tested
activation recipe**. It does not install Windows components or supply missing
APIs. An all-features override would not isolate the relevant checks.

The research source's `RtlGetDeviceFamilyInfoEnum` currently reports the device
form as `DEVICEFAMILYDEVICEFORM_UNKNOWN`. It does not read the tool's OEM
DeviceForm registry key. Therefore copying that registry value alone does not
establish equivalent device detection in this runtime.

## Original-client contracts

Static inspection of the unmodified 2612 clients identifies a native
`WindowsFullScreenExperienceController` and references to:

- `CanSetGamingFullScreenExperience`
- `IsGamingFullScreenExperienceActive`
- `IsGamingFullScreenExperienceSupported`
- `SetGamingFullScreenExperience`

CE also imports gaming-experience notification functionality through
`api-ms-win-gaming-experience-l1-1-0.dll`. Its shipped UI calls
`api.xboxMode().getXboxModeState()`, `enterXboxMode()` and `exitXboxMode()`, and
listens for `xboxMode.xboxModeStateChanged`. The UI contains a controller-layout
decision based on the supported and active state.

The extracted `web-payload/assets/entry.client-lsuj6d01.js` has SHA256
`d80ceff4f093a428d847dcf1d1cbf087864a400051c18bf0485cdbf19c179cd6`.
The supported-and-active density decision is at byte offset `904071`.
`XboxModeCoordinator-gudwyf0o.js`, SHA256
`59377db31b06fafcb9d6ba3dc604dbfce0fa6dee81cabe2bc7c22ed7b7654088`,
waits for native state confirmation after requesting a transition. A setter
returning success without a state update can therefore leave the transition
unconfirmed.

AppL also has a React Native `FullScreenExperienceModule` exposing entry, exit
and state refresh operations. Its fullscreen route can be investigated
independently of whether CE/new-client activation succeeds. CE is the host for
the new web frontend examined above.

The API names above were not found in the research Wine source's `.c`, `.h`,
`.idl` or `.spec` files. Their real provider, ABI and state-change semantics
must be established before implementing a compatibility bridge. A success
return from an unimplemented setter would not provide those semantics.

### Official ABI confirmation

Microsoft's [gamingexperience.h](https://github.com/microsoft/win32metadata/blob/71033001b4479c6566546b68d32276e70a8d68b9/generation/WinSDK/RecompiledIdlHeaders/um/gamingexperience.h)
(Git blob `30451570b29bea123b94dfa2aa1a33972bb75c1f`) declares the complete
contract:

| API | Signature |
| --- | --- |
| Supported, Active, CanSet | `BOOL WINAPI Function(void)` |
| Set | `HRESULT WINAPI SetGamingFullScreenExperience(BOOL active)` |
| Register | `HRESULT WINAPI RegisterGamingFullScreenExperienceChangeNotification(callback, context, registration*)` |
| Callback | `VOID CALLBACK Routine(PVOID context)` |
| Unregister | `VOID WINAPI UnregisterGamingFullScreenExperienceChangeNotification(registration)` |

The [official GDK guidance](https://learn.microsoft.com/en-us/gaming/gdk/docs/gdk-dev/pc-dev/handheld/handheld-launchers?view=gdk-2604)
also describes querying the active state after a change notification. Thus the
function signatures no longer require guessing from native callsites. The
Windows provider and behavior on unsupported, unavailable or failed transitions
remain separate questions.

The retained Windows 26300.9457 image subsequently resolves the API-set contract
to **`gamemode.dll`**, using the unconditional host mapping in API-set namespace
v6, entry 246. Schema SHA256:
`391a2818fdef14f4a9b6e6ce2a7e7f01d04f943de9ef543ec683927cfe480889`.
Provider SHA256:
`6ac2805504aa8bbbc599504a1d8774cc1f1e63bcb20ef07c538939fe937dc919`.
REA export evidence `ev_8e0162dc49f4f84a4c45eaca97e2c0088ff0b48de07f1032766388cb796ee6ae`
confirms all six functions have code addresses in that provider. This identifies
the Windows implementation; it does not establish that the native DLL can
manage a Linux session or run successfully under the current Wine runtime.

A Linux adapter must make `CanSet` depend on the availability of a working
desktop integration. On entry it must request that integration, wait for its
acknowledgment, update the active state and notify subscribers. Failed entry
must preserve the prior state and return an error. Exit and loss of the desktop
integration must restore the desktop and update subscribers consistently.

### Existing Linux integration

The existing XBOKS GNOME extension exports session-bus interface
`org.slaveitgr.Xboks.Experience` at `/org/slaveitgr/Xboks/Experience`:
`GetState` returns active/owned, `Enter` acquires a mode lease, `Leave` releases
it, and `StateChanged` reports transitions. A persistent bus connection owns
the lease; losing that owner restores the desktop.

This extension is our Linux desktop implementation. The original Microsoft
client would continue rendering its own UI. Wine's adapter would translate its
gaming-experience calls into the Linux mode operations and state notifications.

The extension currently authorizes XBOKS application identities and checks the
relationship between the bus sender and the focused application process. The
original `original-xbox-wineuwp.desktop` / `xboxpcapp.exe` identity does not pass
that policy. A bridge therefore also needs explicit authorization bound to the
verified original-client process and private runtime. Globally trusting a generic
Wine window class would not establish the intended application identity.

Relevant source: `desktop/gnome/xboks-experience@slaveitgr.github.io/extension.js`
and `state.js`, `src/main/experience-client.ts`, and
`src/main/fullscreen-experience.ts`. The existing acknowledgment, owner-loss and
restoration behavior can guide the adapter; it is not yet a Wine integration.

Original CE SHA256:
`dc50e62227838178c6f8b1e42463cd2b4a7f4b4f55dfc4b0e672d71a8fed0d89`.
CE import-table evidence:
`ev_a6207c043d9b16adbd1c59295e9e9f2977d4c0b6fcf8c52213f40af312c19533`.
Representative CE dynamic API-name file offsets are `0x900470` (Active),
`0x900498` (Supported), `0x9004c0` (CanSet), and `0x900540` (Set). Names and
imports establish dependencies; they do not establish successful execution.

## Next implementation and acceptance work

1. Finish allowlisted local `msxbox` routing for the profile-menu transition.
   The earlier CE activation-context `E_NOINTERFACE` has been corrected in a
   tested candidate. Its original configuration parser selects CE, and an
   isolated WebView presentation trial visibly rendered the original CE Home.
   See the [activation checkpoint](new-app-experience-activation-2026-11-08.md).
   Interactive transition delivery and acknowledgment remain separate work.
2. The candidate now supplies the confirmed API set/provider contract and has
   passed disabled, unavailable and private-service ABI gates. Verify the same
   support/active/permission behavior against the real Native1 desktop service
   after a fresh GNOME login; isolated fixture success does not prove that
   integration.
3. Compare a baseline launch with a launch carrying only the three feature
   overrides above. Record which checks the client actually performs. Treat
   device-form emulation as a separate variable if a traced check requires it.
4. Exercise the implemented state/notification bridge against the real desktop,
   then verify that the original client switches its own layout and that
   controller navigation and exit-to-desktop work.
5. Test operating-system behavior separately: app activation, task switching,
   fullscreen enforcement, restoration and startup. Rendering the original
   Xbox fullscreen home does not by itself validate a Windows-equivalent
   gaming session or performance improvement.

The Windows enabling tool has not been executed, and no system scheduled task,
display driver or feature override was installed for this investigation. The
related CE selection/WebView experiments used a separate candidate prefix and
verified rollback while preserving the working original-client session.
Visible Home rendering used an experimental 120 ms CapturePreview bridge;
it does not validate input, streaming, Xbox mode or a performance improvement.
See the [client reproduction notes](wine-uwp-client2612-reproduction.md) for the
experimental runtime and its current limitations.
