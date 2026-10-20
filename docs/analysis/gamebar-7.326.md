# Xbox Game Bar 7.326.10141.0

## Verified package evidence

- Identity: `Microsoft.XboxGamingOverlay`, version `7.326.10141.0`.
- Download: 44,357,654 bytes. SHA-256: `2d4fe1ccdced62da61dc43d1700c19824b53309166f12858ae9d6e83f2616726`.
- Bundle ZIP CRC check passed; Microsoft signing authenticity was not cryptographically verified.
- Bundle contains ARM64, x64 and x86 application packages. The x64 application has 84 entries.
- Main entry: `GameBar.exe`, `GameBar.App`. Companion executables: `GameBarElevatedFT.exe` and `GameBarFTServer.exe`.
- No `.js`, `.bundle`, `.html` or `.xbf` entries were found in this x64 package. This is unlike the Xbox app package's Hermes bundle. UI resources may be embedded in binaries/PRI; no source-code recovery is claimed.
- Dependencies: Microsoft.UI.Xaml.2.8, Microsoft.VCLibs.140.00 and Microsoft.VCLibs.140.00.UWPDesktop.
- Manifest protocols: `ms-gamingoverlay`, `ms-gamebar`.
- Declares an app-extension host and a `windows.overlayApp` extension with ID `GameBar`.
- Declared capabilities include `gameBarServices`, `appCaptureServices`, `backgroundMediaRecording`, `globalMediaControl`, `picturesLibrary`, `videosLibrary` and `runFullTrust`.
- Includes Game Bar public/private WinMD metadata and WebView2 components. Their presence does not verify Linux support or prove which screenshot uses which component.

All inspection was static. Downloaded executables were not run. Package binaries, Microsoft fonts and private screenshots remain in ignored local reference storage.

## Linux implementation mapping

| Reference capability | First xboks implementation | Remaining work |
| --- | --- | --- |
| Guide navigation | Six icon tabs and left panel from the screenshots | Further visual matching and additional widgets |
| Guide shortcut | Ctrl+G, button, controller Guide when exposed | System-wide hotkey and compositor integration |
| Recent games / navigation | Opens actual selected library game, Home, Library and queue | OS-level running-app discovery |
| Audio | Default output volume and mute through `wpctl`, with capability/error states | Device selection, microphone and per-app mixer |
| Capture | PNG screenshot of the xboks window, hiding its own overlay | Game-window/video capture via Linux portals/compositor |
| Social | Account identity and explicit unavailable state | Verified friends, messaging and party integration |
| Browser | External browser search/link | Isolated embedded browser widget |
| System settings | Existing app settings and full-screen toggle | Network, Bluetooth, keyboard and power services |

The guide is currently **inside xboks**. Rendering it over unrelated applications/games needs a separate compositor/overlay implementation. Windows manifest capabilities cannot simply be transplanted to Linux.

## Validation of first integration

- TypeScript validation and renderer/Electron compilation passed.
- 152 tests passed across renderer tests and the new audio tests.
- Electron smoke check verified modal background isolation, focus containment on opening, restoring focus on closing, Ctrl+G, tab switching, and disabling real audio changes in demo mode.
- Read-only `wpctl get-volume` works on the development machine. Volume mutations and real capture saving were not exercised against the user's desktop.
- Demo screenshot: captured locally for visual review; it is not evidence of external-game overlay, recording or social functionality.
