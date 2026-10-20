# Xbox package analysis: first visual implementation

Reference: Microsoft.GamingApp 2610.1001.20.0, x64.

## Observed package structure

- Downloaded bundle: 433,446,690 bytes; ZIP CRC check passed (not a signature verification).
- SHA-256: `7205c87463c4deccbe196bec94af8a5ac6bd677defc483cb5976b02764b1f805`.
- x64 package: 967 archive entries.
- `Bundle/index.bundle`: 19,267,652 bytes, binary rather than readable JavaScript. React Native strings occur in it; this is evidence of React Native components, not a complete architecture determination.
- Compiled XAML (`.xbf`), PRI resources, bundled fonts and native Windows executables are present.
- Main manifest application: `XboxPcAppCE.exe`, Windows.FullTrustApplication.
- Companion processes include XboxPcApp, XboxPcAppFT, XboxPcAppAdminServer, XboxPcTray, XboxPartyChatHost and XboxGameBarWidgets.

## Manifest dependencies

- Microsoft.VCLibs.140.00 >= 14.0.33519.0
- Microsoft.VCLibs.140.00.UWPDesktop >= 14.0.33728.0
- Microsoft.UI.Xaml.2.8 >= 8.2310.30001.0
- Microsoft.WindowsAppRuntime.2 >= 2.1.1.0

## Screenshot measurements and implementation

- 1920×1080 references show a 68 px navigation rail; 48 px active navigation buttons.
- Search is centered, approximately 500×32 px. Clock appears at the right.
- Content begins around x=188, leaving a 120 px inset after the navigation rail.
- Home has recent square tiles followed by a 2:2:1 featured grid with two stacked cards at the right.
- Dark surfaces: approximately #1b1d1f for content and #25282a for the rail.
- Implemented these structural proportions with responsive adaptations, blurred artwork, current local library and live Store highlights.
- Recent cards open the actual selected library game; runtime and queue tiles open the existing working pages.
- Catalog tiles currently open Store; direct product selection is future work.
- Current backend does not provide Home editorial/Game Pass collections: these are labelled Store highlights, without invented subscription or social data.

## Boundaries and next steps

- Package was inspected statically. No downloaded Windows executable was run.
- Extracted Microsoft binaries, fonts, assets, screenshots and personal profile data stay in ignored `work/reference`; they are not part of the app distribution.
- No decompiled source was copied into xboks. The UI is independently implemented from screenshots.
- Settings modal, Game Pass navigation, social/notification overlays and product details remain to be rebuilt.
- Linux integration for system controls and Xbox social APIs remains unverified.
