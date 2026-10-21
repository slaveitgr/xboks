# Game Bar 7.326: native widgets, settings and Spotify boundaries

This is the 2026-10-21 static analysis of the supplied Game Bar bundle and its x64/Greek child packages. It corrects the earlier assumption that the absence of standalone `.xbf` ZIP entries meant no recoverable native markup: **74 XBF resources are embedded inside `resources.pri`**. All 74 now pass the existing bounded XBF reader. This recovers persisted UI operations and typed interfaces, not complete native source, evaluated Windows view trees, external widget packages or tested service behavior.

## Inputs and reproducible coverage

| Input | Bytes | SHA-256 |
| --- | ---: | --- |
| `Microsoft.XboxGamingOverlay.appxbundle` | 44,357,654 | `2d4fe1ccdced62da61dc43d1700c19824b53309166f12858ae9d6e83f2616726` |
| `GameBar_7.326.10141.0_x64.appx` | 14,062,327 | `0e5a3db9e6ba78a20ad804f2a16ba67de50585be6a3744dae3c4eefe395e4093` |
| Greek resource child, `GameBar_7.326.10141.0_language-el.appx` | 35,750 | `76d85d5b669149f2fbd33b3e00ba23b489e9ef9bf778d29620f869bfea27e34f` |

The bundle's members receive ZIP CRC reads and a hash inventory. Semantic analysis targets x64 plus Greek; ARM64/x86 code and other language/scale resources are not claimed as semantically reversed. The package's Microsoft signing authenticity has not been cryptographically verified.

| Layer | Completed bounded pass |
| --- | --- |
| x64 ZIP | 84 entries, sizes and hashes, manifest identity/protocol/capability/extension declarations |
| PE | 19 files, 1,603 ordinary/delay import symbol records, section/export tables and ten native PE resource leaves |
| Printable PE literals | 56,312 located ASCII/ASCII-range UTF-16 literals; these are search leads, **not callsites** |
| WinMD | Ten files, 2,145 types, 16,553 decoded method/field signatures and constants; zero decode errors |
| Main and Greek PRI | 19 sections; 2,500 mapped resource entries; 3,688 candidates, including 1,184 `EL-GR` candidates; zero errors/unsupported structures |
| Embedded XBF | All 74 files, 64,312 persisted object-writer nodes; zero incomplete streams/errors |

The fresh private library is `work/reference/library/gamebar-v1/gamebar.sqlite3`. `summary.json` binds its inputs and output files by SHA-256. Every XBF has its owning PRI hash, byte offset, length, decoded report hash and individual node offsets. Original resources, labels, binaries and screenshots remain in ignored local storage.

## Host, OS and third-party boundaries

The manifest identifies `Microsoft.XboxGamingOverlay` version `7.326.10141.0`, executable `GameBar.exe`, entry point `GameBar.App`. Companion processes are `GameBarFTServer.exe` and `GameBarElevatedFT.exe`. It declares `ms-gamingoverlay`/`ms-gamebar` protocols, a `windows.overlayApp` extension and a host for **`microsoft.gameBarUIExtension`**. It also declares restricted capture/game-bar/elevation capabilities and global media control. A declaration is not evidence that a particular user can invoke the feature successfully.

The public widget model uses separate installed applications. Microsoft's [manifest contract](https://learn.microsoft.com/en-us/xbox/game-bar/guide/pkg-manifest) defines widget IDs, public icon folders, Standard/Settings widget types, pin/resize support, menu visibility and compact priority. These Windows UWP/WinRT contracts cannot be invoked directly by a Linux renderer.

`Microsoft.Gaming.XboxGameBar.winmd`, interface `IXboxGameBarWidget`, provides concrete native contracts:

| MethodDef | Member | Decoded shape |
| ---: | --- | --- |
| 40 | `get_Pinned` | `() → bool` |
| 43 | `get_RequestedOpacity` | `() → float64` |
| 46 | `get_RequestedTheme` | `() → Windows.UI.Xaml.ElementTheme` |
| 62 | `get_CompactModeEnabled` | `() → bool` |
| 83 | `ActivateSettingsAsync` | `() → Windows.Foundation.IAsyncAction` |
| 89 | `TryResizeWindowAsync` | `(Windows.Foundation.Size size) → IAsyncOperation<bool>` |

The same file contains change notifications and display-mode values including Foreground/PinnedOnly. Pinned visibility, interaction/click-through, compact navigation and theme are distinct host state, not a single `visible` flag. Settings page activation and widget window resize can fail asynchronously.

`GameBar.exe` (SHA-256 `e152d0b51a5efef2d8975d98e2bae382d27e1af671968370ec55724d88334f73`) imports these symbols from `api-ms-win-gaming-experience-l1-1-0.dll`: `SetGamingFullScreenExperience`, `CanSetGamingFullScreenExperience`, `IsGamingFullScreenExperienceActive`, and register/unregister change notifications. The native Settings VM separately exposes FSE and compact toggles. This is evidence of a Windows OS integration boundary, not an Electron window-fullscreen implementation.

## Widget and screenshot map

Paths in this table are **named embedded resources in PRI**, under `Files/Widgets/`; they are not standalone archive members. The supplied captures are local observations, not redistributed images or a guarantee that every account/flight exposes the same set.

| Surface / local capture | Embedded XBF or separate owner | Important behavior boundary |
| --- | --- | --- |
| Widget menu, 111/141 | `CompactWidgetMenu/CompactMenuPanel.xbf`; Home/compact navigation files | Enumerated installed widgets, favorite/menu state and activation; does not imply all widgets are built into Game Bar. |
| Home / launcher, 114 | `Home/HomePanel.xbf`, `GameLauncher/GameLauncherPanel.xbf` | Recent games and launcher entries come from runtime data. |
| Settings quick controls, 115/126/127 | `Settings/SettingsPanel.xbf`, `Settings/PowerOptions/PowerFlyoutContent.xbf` | Hardware/service gates, nested pages and separate OS actions. |
| Native Settings categories, 116–125 | `Settings/SettingsCategories/*.xbf` | General, personalization, input, widgets and gaming features; exact capture/page IDs are recorded below. |
| Audio, 129/130 | `Audio/AudioPanel.xbf`, `AudioStatus/AudioStatusPanel.xbf` | Output/input defaults, communications defaults, mute/volume, per-process sessions and favorites. |
| Capture, 131 | `Capture/CapturePanel.xbf`, `CaptureStatus/CaptureStatusPanel.xbf` | Screenshot, retrospective recording, start/stop recording, microphone and target-sensitive availability. |
| Gallery, 132/140 | `Gallery/GalleryPanel.xbf`, `Gallery/EditorPage.xbf` | Capture library/editor; empty/unsupported states are part of the flow. |
| Performance, 133 | `Chart/ChartPanel.xbf`, `Chart/ChartSettings/ChartSettingsPanel.xbf` | CPU/GPU/NPU/VRAM/RAM/FPS capability gates; expanded/collapsed and layout modes. |
| Spotify, 113/134 | **Separate Spotify widget application** | Desktop-player state and Spotify-owned content; no Spotify XBF in this package. |
| Xbox Social / settings, 112/135–139 | **Separate Xbox social provider/application** | Friends/chat/party and linked-account/notification settings are not recovered by pretending native host settings own them. |
| Browser, 128 | **Microsoft Edge Game Assist widget** | Shared browser/session and content belong to Edge; a WebView2 dependency alone does not implement this widget. |
| Display / graphics | `Graphics/GraphicsPanel.xbf`, `Graphics/Display/DisplayPanel.xbf`, `Graphics/AutoSr/AutoSrPanel.xbf` | OS/device-specific resolution, refresh, HDR/Auto SR capabilities; not generic Linux equivalents. |
| Resources / options | `Resources/ResourcesPanel.xbf`, `Resources/ResourcesSettings/ResourcesSettingsPanel.xbf` | Runtime process/resource counters and actions. |
| Widget store | `Store/StorePanel.xbf`, Browse/Installed/Details subviews | Package discovery/acquisition and installed-widget state, distinct from the game catalog. |

Captures 116, 117–118, 119–120, 121–123 and 124–125 correspond respectively to Gaming features, Personalization, Input, Widgets and General. The native category enum is broader than those observed tabs: `GameBar.SettingsCategoryId` (TypeDef 293) has None=0, General=1, InstalledWidgets=2, KeyboardShortcuts=3, Accounts=4, Visuals=5, GamingFeatures=6, Notifications=7, Feedback=8, Debug=9 (FieldDef 636–645). Enum membership does not prove that every category is visible in the captured build/configuration.

## Exact UI and action locators

XBF offsets below are **within the embedded XBF**, not the entire PRI. Add the stated PRI base only when looking at the original `resources.pri` byte buffer. Node names identify controls; WinMD method declarations establish available interface shapes. Native event-body/call-target reconstruction is still separate.

| Evidence | Concrete locator and implication |
| --- | --- |
| Audio master slider | `Audio/AudioPanel.xbf`, PRI base 429204, stream 0 / XBF offset 12239: `SetName EndpointMasterVolumeSlider`. Input slider is at 12379; device selector group at 13146–13488; session mute template at 18045. |
| Audio contracts | `GameBar.winmd`, `__IAudioModelPublicNonVirtuals`, MethodDef 2199–2224 declares playback/capture devices, defaults, communications defaults, master volume/mute and session list. `__IAudioSessionModelPublicNonVirtuals` MethodDef 2260–2273 declares PID/image path, session volume/mute and favorite state. |
| Capture controls | `Capture/CapturePanel.xbf`, PRI base 419528, stream 0: ScreenshotButton at 4493, RecordThatButton at 4615, RecordButton at 4731, RecordMicButton at 4839. VM MethodDef 1777–1811 declares availability and action methods including `ScreenshotButtonClick` 1807 and `RecordThatButtonClick` 1806. A rendered button is insufficient without capture permissions and target state. |
| Performance tabs | `Chart/ChartPanel.xbf`, PRI base 409276, stream 0: CPU 4219, GPU 4260, NPU 4293, VRAM 4326, RAM 4359, FPS 4392. VM MethodDef 2577/2581 distinguishes NPU/FPS availability; missing measurements must not display invented zeroes. |
| General controls | `SettingsGeneralDetail.xbf`, PRI base 270324, stream 0: battery checkbox at 4978; tips 5009; invoke-to-home 5054; notification position button 5118; feedback 5426; audio cues 5457; HDR notifications 5488; fullscreen notifications 5519. VM MethodDef 3493/3494 controls whether invoke/battery checkboxes appear. |
| Personalization | `SettingsVisualsDetail.xbf`, PRI base 258132: Light/Dark/Default theme names at 4687/4740/4923; pinned/click-through transparency section at 4979; animations at 6059/6090; reset layout at 6357. VM MethodDef 3608–3613 keeps pinned and click-through transparency/opacity separate. |
| Input | `SettingsKeyboardShortcutsDetail.xbf`, PRI base 266300: guide-button launch 3217; controller-bar options 3262–3346; mouse-mode option 3522; save/reset shortcuts 3897/3958. The internal `Nexus` name here is Microsoft's controller-button terminology, not the Linux backend product. |
| Quick Settings capabilities | `GameBar.winmd`, `__ISettingsPanelViewModelPublicNonVirtuals`, MethodDef 3664–3704: brightness availability, FSE visibility/toggle, Wi-Fi/Bluetooth lists, keyboard, mouse mode and compact toggle. Do not conflate a checkable UI property with successful OS mutation. |

The exact source names/params/signatures and node payloads are queryable in the private database; they are not copied wholesale into this document. `SetConnectionId` nodes preserve code-behind connection IDs, but this pass does not resolve native handlers from those IDs into a full native call graph.

## Greek resources and visual assets

Game Bar's namespace is separate from the Xbox app's. Its resource keys use lower-case `resources/`. The Greek resource map references the main schema identity/version/checksum and contributes 1,184 candidates tagged `Language=EL-GR`; it is not an English string list translated by guesswork.

Short confirmed examples are `resources/AudioWidget_DisplayName` → Ήχος, `resources/CaptureWidget_DisplayName` → Εγγραφή, `resources/ChartPanel_Title` → Επιδόσεις, `resources/ResourcesWidget_DisplayName` → Πόροι, `resources/GalleryWidget_DisplayName` → Συλλογή, `resources/CompactMenuWidget_DisplayName` → Γραφικά στοιχεία, `resources/SettingsGeneralHeader/Text` → Γενικά and `resources/SettingsVisualsHeader` → Εξατομίκευση.

The package's icon fonts are `Assets/XboxFluentGB2.ttf` and `Assets/XboxFluentInline2.ttf`; native icon/style declarations live in `Files/Visuals/Styles/FontIcons.xbf`, CommonStyles and theme/XDS dictionaries. Other native assets include `Assets/AudioSessionDefaultIcon.png`, `ResourcesDefaultIcon.png`, `ResourcesServiceIcon.png`, `ResourcesCmdIcon.png` and `Nexus_Delegation_Controller.png`. These are source locators, not permission to redistribute fonts/assets. The actual Spotify cover/recommendation content is runtime Spotify data and is not present in Game Bar's asset inventory.

`Typography.xbf` offset 8906 resolves `GameBarFluentFont` to `/Assets/XboxFluentGB2.ttf#Xbox Fluent Game Bar v2`. Short exact `FontIcons.xbf` mappings are Related=U+E955 (offset 9940), HomeFill=U+EABF (9961), SettingsSolid=U+EACD (9975), VolumeSolid=U+E80C (9807), CameraSolid=U+E7D3 (9919) and PerformanceMonitoringSolid=U+E92F (9933). The Home menu button explicitly selects that font at HomePanel.xbf offset 8178 and Related at 8184. Photo=U+EA03 exists at FontIcons offset 9128, but its use as the Gallery toolbar icon has not been established by this resource declaration alone. No Spotify or PeopleSolid resource key is present here; external-widget icons must retain their own source identity.

## Spotify is not an audio-mixer row

The main native package contains an audio display label `resources/AudioModelSpotifySessionName` and a located `spotify.exe` literal in GameBar.exe at file offset `0xa64068` (UTF-16). It has no Spotify XBF or Spotify-named WinMD widget implementation. This is consistent with Spotify's own [published widget description](https://community.spotify.com/forum/en/kb/articles/949-improvements-to-spotify-xbox-game-bar-for-windows): the Microsoft Store desktop app supplies the widget and shares the running desktop player's account. It is not evidence of a reusable public Spotify widget API inside Game Bar.

Capture 134 shows a roughly 320-pixel panel with header, current artwork/title/artist, playback controls, a progress line, an expandable recommendation list and a persistent green Open Spotify action. Account/track/recommendation values are deliberately excluded from the public reference.

The Linux implementation can expose real desktop MPRIS metadata, playback status, previous/next/play-pause, capability-gated seek and explicit player launch. `src/main/spotify.ts` and `src/shared/spotify.ts` now define that **Linux MPRIS** boundary. The original widget's recommendations, account-linked save/like, device switching and playlist discovery are richer Spotify-owned functions: local MPRIS alone does not provide those services. They must not be populated with sample recommendations and called a working Spotify integration.

## Linux implementation audit and remaining acceptance

This source audit captures the implementation boundary while the current Game Bar feature work is in progress. It is not a declaration that all new features have passed live acceptance:

| Original feature | Current Linux source boundary | Remaining acceptance / parity work |
| --- | --- | --- |
| Overlay host | `DesktopGuide` is a separate transparent Electron top-level window, with global-shortcut integration; optional GNOME compositor work has its own lifecycle. | Test above real external fullscreen games, compositor lock/overview/input behavior and crash restore. Electron always-on-top alone is not universal Wayland overlay support. |
| Widget ordering, favorite/pin/resize | Widget directory, favorite pages, visibility preferences and panels kept open beside the selected widget are implemented; native XBFs supply structural chrome/menu references. | Independent pinned windows, arbitrary resize/drag layouts and click-through remain separate. Kept-open panels hide when the Guide closes. |
| Audio | `guide-mixer.ts` reads PipeWire topology and node volume/mute, supports default input/output selection and per-application volume/mute with current object-serial guards; the local mic test remains separate. | Device/mixer mutation acceptance, Windows communications-role parity, audio favorites and spatial state remain separate. |
| Capture and gallery | Capture saves the xboks window as PNG and excludes its guide; the gallery lists/opens/deletes only bounded owned PNG files. | External-game/video/retrospective capture, recording lifecycle, editing and portal permissions need separate adapters and acceptance. |
| Performance | `GuidePerformanceReader` now reads CPU deltas, `/proc/meminfo` and available DRM counters. | Driver-dependent GPU/VRAM, graph fidelity and external-game FPS/NPU remain capability-specific; no inferred FPS. |
| Spotify | Persistent GJS/MPRIS helper protocol and bounded Node DTO exist. | Real-player acceptance and visual matching are separate from fake-bus tests. Recommendations/Connect/save are outside MPRIS scope. |
| Network/Bluetooth/power | `GuideSystemAdapter` uses capability-aware Linux commands, with confirmed power actions. | OS-policy/hardware-specific live acceptance remains distinct from fake-runner verification. |
| Social/chat/party | Shared app/guide social state and typed backend routes exist; party voice has a separate [analysis](party-voice.md). | Authenticated service operation and audible multi-user party media cannot pass because a panel opens. |
| Embedded browser / widget store | Windows Edge/external-widget contracts now identified. | An external browser link does not equal Edge Game Assist; Windows widget package installation is not portable Linux widget hosting. |

The implemented desktop media boundary follows [MPRIS](https://specifications.freedesktop.org/mpris/latest/) and [WirePlumber's wpctl controls](https://pipewire.pages.freedesktop.org/wireplumber/man/wpctl.html). Thirty-one Spotify protocol tests include a real GJS helper against isolated fake D-Bus players, including permission denial; 32 mixer tests use fake command runners. The actual host read-only mixer probe returned one output, one input and no application streams. The host Spotify read was denied by session-bus policy and returned a disabled error state, now with a safe stage-specific diagnostic. No host playback, volume, mute, default-device or Snap-policy mutation was performed for these tests; live operation remains an acceptance task. Private records are `work/spotify-mpris/host-readonly.json` and `mixer-host-readonly.json`.

## Rebuild and query

Use the optional local Python metadata dependencies from [the canonical setup](README.md#rebuild-the-local-indexes), and the hash-pinned Microsoft stable XBF CSV tables from [the XBF chapter](xbf-resources.md#reproduce-and-inspect). No Windows package is installed or executed:

```sh
PYTHONPATH=work/reference/metadata-tools python3 scripts/analysis/build-gamebar-reference.py build \
  work/reference/GameBar_7.326.10141.0_x64.appx \
  --bundle work/reference/Microsoft.XboxGamingOverlay.appxbundle \
  --format-source work/reference/library/xbf/source \
  --private-output work/reference/library/gamebar-v1

python3 scripts/analysis/build-gamebar-reference.py search \
  work/reference/library/gamebar-v1/gamebar.sqlite3 SettingsShowBattery --limit 8
python3 scripts/analysis/build-gamebar-reference.py search \
  work/reference/library/gamebar-v1/gamebar.sqlite3 AudioPanel --limit 8
python3 scripts/analysis/build-gamebar-reference.py search \
  work/reference/library/gamebar-v1/gamebar.sqlite3 Spotify --limit 8

python3 scripts/analysis/test-gamebar-reference.py
```

The builder refuses an existing output directory: use a fresh ignored directory for another build. Its schema-1 SQLite tables are `files`, `manifest`, `resources`, `members`, `pe_contracts`, `literals`, `xbf_files` and `xbf_nodes`. Search opens SQLite read-only, escapes SQL wildcard characters and bounds result counts. Detailed resource and native JSON reports remain private. Search results include raw proprietary values for local engineering use; do not paste bulk output into public documentation.

Thirteen new synthetic tests cover PRI-slice/hash bounds, archive duplicate/CRC handling, non-extraction of archive paths, manifest contracts/entities, located literal offsets, literal/read-only SQL search, query bounds and refusal to overwrite evidence. Together with the existing PRI/XBF/WinMD parser suites, **59 focused tests passed**. Two fresh real-package builds independently completed with zero recorded parser errors; their SQLite database, all 74 decoded XBF reports and native-signature report are hash-identical. The final producer also records its own and its reader scripts' hashes. These checks prove bounded reproducible decoding of supported structures, not complete native semantics, Windows behavior, pixel equality or Linux feature success.
