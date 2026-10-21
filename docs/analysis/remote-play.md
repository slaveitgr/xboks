# Remote Play integration

The previous shell entry was a placeholder. It now opens a centered 416 × 580 connection dialog, based on reference `36009.png`, with the current launcher's profile and a connect action.

Connect opens Microsoft's actual `https://www.xbox.com/play/consoles` client in a dedicated Electron window. Microsoft owns console discovery, its sign-in and WebRTC streaming in that window. This is an official web-client integration, **not a reimplementation of the Windows native streaming protocol or an exact clone of its console picker**.

Reference: https://www.xbox.com/en-US/play/consoles and https://www.xbox.com/en-US/consoles/remote-play . Microsoft documents browser-based Remote Play for Xbox One and Series X|S with remote features enabled.

The window has no launcher preload, Node integration or Xodus account tokens. A separate persistent Chromium partition retains its Microsoft web sign-in, independently of the launcher account; users must choose the same account themselves. Top-level navigation permits HTTPS Xbox domains and explicit Microsoft authentication origins only. Other permissions, including microphone, are denied. Voice chat is not implemented. F11 toggles fullscreen; launching from Fullscreen Experience starts the window fullscreen. The original window's controller-navigation code is not attached to the web streaming surface, so it cannot intercept controller gameplay. A display-sleep blocker is released on close or failed load. Failed initial navigation closes the blank window and returns a retryable error to the dialog.

Validation: renderer and Electron TypeScript checks; 157 focused tests, including window reuse, navigation restrictions, failed-load retry and display blocker cleanup; Vite production build. A clean-profile Electron smoke run loaded the live Xbox Remote Play site, with sandbox=true and no preload. It did not sign in or connect to a console. Actual account discovery, console wake, video/audio, latency and controller gameplay still require a real console and account; none are claimed tested. Linux/Electron compatibility remains subject to the Microsoft service.
