# Xbox Game Bar 7.326.10141.0

Updated 2026-10-21. The detailed, reproducible [native widget and settings reference](reference/gamebar-widgets.md) supersedes the original inventory-only conclusions in this report. Static recovery, Linux implementation and live acceptance remain separate.

## Verified package evidence

- Identity: `Microsoft.XboxGamingOverlay`, version `7.326.10141.0`.
- Download: 44,357,654 bytes. SHA-256: `2d4fe1ccdced62da61dc43d1700c19824b53309166f12858ae9d6e83f2616726`.
- Bundle ZIP CRC check passed; Microsoft signing authenticity was not cryptographically verified.
- Bundle contains ARM64, x64 and x86 application packages. The x64 application has 84 entries.
- Main entry: `GameBar.exe`, `GameBar.App`. Companion executables: `GameBarElevatedFT.exe` and `GameBarFTServer.exe`.
- No standalone `.js`, `.bundle`, `.html` or `.xbf` entries were found. The deeper pass recovered **74 embedded XBF resources inside `resources.pri`**, decoding all **64,312 persisted UI operations** with zero incomplete streams. These describe native controls/styles/templates, not decompiled native event bodies or an evaluated render tree.
- Dependencies: Microsoft.UI.Xaml.2.8, Microsoft.VCLibs.140.00 and Microsoft.VCLibs.140.00.UWPDesktop.
- Manifest protocols: `ms-gamingoverlay`, `ms-gamebar`.
- Declares an app-extension host and a `windows.overlayApp` extension with ID `GameBar`.
- Declared capabilities include `gameBarServices`, `appCaptureServices`, `backgroundMediaRecording`, `globalMediaControl`, `picturesLibrary`, `videosLibrary` and `runFullTrust`.
- Includes Game Bar public/private WinMD metadata and WebView2 components. Their presence does not verify Linux support or prove which screenshot uses which component.
- The fresh dedicated library indexes 84 files, 19 PE files, 1,603 import records, ten WinMDs/16,553 typed members, and 3,688 PRI candidates including 1,184 Greek candidates from the bundle's actual Greek child package.
- Spotify, Edge Game Assist and Xbox Social are separate widget/provider boundaries. The Spotify entry in the native audio mixer does not supply the Spotify widget's recommendation/account services.

All inspection was static. Downloaded executables were not run. Package binaries, Microsoft fonts and private screenshots remain in ignored local reference storage.

## Linux implementation mapping

| Reference capability | Linux implementation boundary | Remaining work |
| --- | --- | --- |
| Guide navigation | Widget registry/menu, reference sections and scoped Back/focus | Further visual comparison and per-widget acceptance |
| Guide shortcut | Ctrl+G, button, controller Guide when exposed, configured desktop shortcut | Compositor-specific stacking/input and external-game acceptance |
| Recent games / navigation | Opens actual selected library game, Home, Library and queue | OS-level running-app discovery |
| Audio | Real PipeWire controls; local microphone testing has its own permission/lifecycle | Device/mixer capability and live acceptance vary by desktop; Windows communications/spatial roles are separate |
| Capture / Gallery | xboks-window PNGs, owned capture list/open/delete, hiding its guide | External-game capture, recording, retrospective capture and editor |
| Social | Shared real Friends/text-chat adapters and account validation | Live send coverage and consumer party voice |
| Spotify | Linux desktop MPRIS state/transport adapter | Rich Spotify account/recommendation/Connect functions are separate; live player acceptance remains required |
| Performance | CPU/RAM and available GPU/VRAM counters | Driver coverage, NPU and game FPS; unknown values stay unknown |
| Browser | External browser search/link | Isolated embedded browser widget |
| System settings | Capability-aware Wi-Fi, paired Bluetooth devices and confirmed power/session actions | New pairing/passwords use desktop settings; hardware/policy-specific acceptance remains required |

The guide is a **separate top-level Electron window**. This is not proof of universal Wayland overlay behavior. The optional GNOME host and actual external-game input/stacking require their own tests. Windows manifest capabilities cannot simply be transplanted to Linux.

## Validation scope

- The new analysis builder and existing PRI/XBF/WinMD readers pass **59 focused synthetic tests**. A fresh real-package build records zero parser errors and hash-binds its private outputs.
- The private Game Bar library is rebuilt with `scripts/analysis/build-gamebar-reference.py`; [commands, table schema, exact locators and limits](reference/gamebar-widgets.md#rebuild-and-query) are documented separately.
- Earlier first-integration renderer/audio tests and fixture captures verified their then-current scope. They are not the final application test count or proof of native Game Bar behavior.
- Original Windows execution, full native method decompilation, real external-game capture, rich Spotify service parity and audible Xbox party voice are not claimed by structural decoding or UI fixtures.
