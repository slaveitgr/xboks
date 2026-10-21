# Remote Play: original client ownership

This targeted static analysis of Xbox PC `2610.1001.20.0` distinguishes the original embedded player from xboks's official web-client adapter. It does not establish which flight is enabled for a running Windows account. No Windows package or authenticated streaming service was executed.

## Pinned bytecode evidence

The input is the 19,267,652-byte Hermes v96 `index.bundle`, SHA-256 `4f9f633da95002aeab380f01813bb7da63bc7f938f7f1f26b401c0bb2b180b55`. Function IDs and instruction offsets below use the existing [decoder and evidence library](bytecode-analysis.md); offsets prefixed `+` are relative to the named function. Private decoded rows remain under `work/reference/library/remote-play/`.

| Function / file offset | Proven instruction sequence | Implication |
| --- | --- | --- |
| F21821 `remotePlay`, 11760117 | `push` +7, `NavigationRoute.StreamingRoute` +18/+23, `pathname` +29, `device` +39, `state` +44 | The navigation action pushes an internal streaming route carrying the selected console. It does not simply launch a browser URL. |
| F65996 `StreamingScreen`, 18659127 | Route `state.device` +1683/+1688; `StreamingMode.RemotePlay` +1715; `homeUser` +1753; `StreamingProvider` +3301; child JSX +3605–3656 loads environment slot 90 | Console streaming belongs to the client's React Native screen and streaming state/provider. F65979 +1628/+1635/+1641 binds slot 90 to F66021 `StreamingView`. |
| F66020 `getRemotePlayConfiguration`, 18666884 | `type: 'console'` +135/+139; `serverId` from device ID +145/+150; console name/type/power/warnings +155–241; `user` +248/+251; `xuid` +256/+259 | The configuration addresses a console and a Home streaming user, rather than a cloud title. This proves property construction, not a reusable Linux wire protocol. |
| F35397 `StreamHost`, 13230249 | `createElement` +3016, `GameStreamView` +3025, `user` +3047, `streamConfig` +3052, `audioConfiguration` +3057 | The player surface is embedded in the streaming host. |
| F10663 module factory, 10619738 | `requireNativeComponent` +185, literal `GameStreamView` +191, call +195, exported memo/forwardRef wrapper +222–248 | `GameStreamView` is a native React Native component. An external browser window is not the proven original ownership model. |
| F67169 console action, 18884542 | `device.state.consoleStreamingEnabled` +30/+35; console setup mode +48–60; `navigationActions.remotePlay` +88/+94 | Console setup is a prerequisite when Remote Play is not enabled. |
| F67141 setup command, 18881104 | `sendCommand` +14; `RemoteAccess` +24; `AllowConsoleStreaming` +31; `deviceId` +40; parameters `enabled: 'True'` +47–56 | The original setup flow invokes a console service operation. These bounded request semantics do not prove its complete endpoint/auth/retry contract. |
| F67089 setup completion, 18872720 | `xccsActions.fetchDevices.start` +48–60; modal dismissal +117–133; `navigationActions.remotePlay` +155/+161 | The client refreshes console state and proceeds through its internal route after setup. |

The setup modal F67084 (file offset 18871802) obtains `xccsService.getService` at +43/+49 and has Introduction, LookingForNewConsoles, WaitingForRemoteAccessEnabled, SetConsoleName and Error states. This is stronger evidence for original discovery/setup behavior than SDK interface names alone. The native [WinMD contracts](winmd-signatures.md) additionally expose console enumeration and stream session connection, but their presence does not prove all service implementations or a portable media stack.

## WebView qualification

F65996 +628–663 reads `FeatureGateNames.EnableWebView2` into register 31. The Remote Play configuration call at +3051–3127 passes that register as parameter 7; F66020 +70–74 stores parameter 7 under `GSUIEnableWebView2`. Thus the original console streaming configuration includes a flight-controlled WebView2 flag. Static instructions do not prove whether that flag was enabled, which native renderer implementation was selected, or that an ordinary Xbox web page owns this player.

F40417 `useWebView2` (file offset 14002479) reads the `GSUIEnableWebView2` experiment and checks React Native major/minor compatibility. That hook is also used by feedback/store surfaces. In particular, `StreamingScreen` +3566 `useWebView` is inside **feedbackConfig** (+3564–3571), not a proven player-host option. A generic WebView symbol must not be treated as evidence that native console streaming opens a separate browser.

## Current official browser service

Microsoft's [April 16, 2025 announcement](https://news.xbox.com/en-us/2025/04/16/xbox-april-update-buy-games-xbx-app-stream-your-own-game-console/) makes console Remote Play available through supported browsers at Xbox.com. Its explicit removal of direct Remote Play applies to the Xbox app **on mobile**. It does not say that the Windows PC client was removed or that the supplied 2610 client opens an external browser. The current [official requirements](https://www.xbox.com/en-US/consoles/remote-play) list Xbox One and Series X|S consoles with remote features enabled and browser-supported PCs among supported device categories. Linux/Electron support and a successful connection are not established by that page.

The practical near-term xboks adapter can host that official service in an isolated view inside the app, with its own Microsoft web sign-in and trusted close/retry/navigation controls. This removes an unnecessary second window without claiming to reproduce the native console picker, account bootstrap, wake/discovery commands or GameStreamView implementation. Launcher tokens must not be injected into the Microsoft page. Full native parity still requires independently implemented and tested console discovery/authentication, session negotiation, media/input transport, lifecycle and error recovery. Account/console discovery, wake, video/audio and controller gameplay require a real console acceptance test; the user's Xbox One X has not been exercised by this static analysis.
