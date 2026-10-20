# Nexus runtime: game startup and compatibility

- Fix Indiana Jones and the Great Circle crashing after the opening logos.
- Fix PowerWash Simulator 2 getting stuck on its initial loading screen.
- Fix Kingdom Come: Deliverance II crashing during startup. Thanks @TinyRoar-Basti for reporting the issue.
- Fix LIMBO failing to start with a pixel shader compiler error.
- Fix Balatro startup and a crash when quitting. Protect pending work from repeated task-queue closes.
- Improve Xbox multiplayer permission checks. Tony Hawk's Pro Skater 3 + 4 can open a Private Match; public matchmaking remains unverified.
- Support legacy installed-package metadata queries and installed chunk, language, tag and feature enumeration.
- Support gzip responses and server certificate-chain queries in WinHTTP.

Update the launcher to **0.3.6**, the backend to **0.2.5** and the runtime in **Settings**. Compatibility remains game-dependent.
