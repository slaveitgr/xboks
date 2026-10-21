# Local audio tools and Xbox party voice

Implemented in the xboks 0.3.11 working tree on 2026-10-21. This adds working local capture/render tools and targeted original-package research. It does not establish Xbox party connectivity or audible cross-device acceptance.

## App and Guide audio

Sound settings and Guide Audio expose the same local microphone test. Start explicitly requests an audio-only capture lease, then opens the selected browser microphone. The test shows an input-level meter, enumerated input/output devices, local mute, focused-window push to talk, supported noise suppression and optional local monitoring. Monitoring starts off, at 20% playback volume; it is enabled only by the Listen checkbox. Device-reported settings determine whether noise suppression is reported active. Output selection routes this test's audio element only; it does not change the desktop default or Xbox party audio.

The test has no recorder, network or peer connection. Every raw/processed track is stopped on cancellation, unmount, hidden page/window, capture failure, selected-device loss or the 60-second timeout. A stream returned after an old Start was cancelled is immediately stopped. The audio graph disconnects, output pauses and its `srcObject` is cleared, then its context closes. Lease release happens before a new idle Start can overtake slow graph cleanup. Same-window Settings and inline Guide share one engine, and the main process prevents another window from acquiring a parallel lease.

Push to talk is a held pointer/Space/Enter control while the test button has focus. It releases on pointer/key cancellation and focus loss. This is not a global Wayland or controller shortcut. Original Xbox-specific party audio categories stay unavailable until a real party transport owns those operations.

## Permission boundary

`VoiceCapturePermissions` installs both Electron session permission handlers before app windows load. Only the visible, focused main/Guide window, its main frame and the exact packaged document or configured HTTP loopback development document can request a lease. The pending lease expires after 15 seconds; an accepted audio request expires after 75 seconds, beyond the renderer's own 60-second limit. Camera, combined camera/microphone, screen capture, subframes and remote origins are denied. Speaker selection is restricted to the current owner. Native hide, navigation, renderer exit and app shutdown revoke the lease and notify the renderer to stop tracks.

The Remote Play web client's separate session and the sign-in partitions retain their own deny policies. The local test does not silently grant microphone access to Microsoft web pages or expose Nexus tickets. Demo mode rejects physical capture requests. Automated tests use Chromium's fake media device exclusively and mute output.

Source: `src/main/voice-capture.ts`, `src/renderer/voice-test.ts`, `src/renderer/LocalVoiceTest.tsx`, `src/renderer/AudioSettings.tsx`, `src/renderer/GuideOverlay.tsx` and their focused tests. API references: [Electron session permissions](https://www.electronjs.org/docs/latest/api/session), [media capture and track lifecycle](https://www.w3.org/TR/mediacapture-streams/), [audio output routing](https://www.w3.org/TR/audio-output/).

## Xbox party transport

The [party voice chapter](reference/party-voice.md) records a separate COM host, typed `xCommsUwp` interfaces, 49 direct PartyWin imports, versioned signaling request locators and native PlayFab identity/network fields. Official PlayFab Party Linux 1.10.27 supplies a plausible native media worker, inspected statically with its release hash. Matching consumer Xbox identity, authenticated party signaling, network descriptor/invitation handling and roster/privacy/lifecycle behavior still need implementation and service acceptance. Text-chat authentication and microphone access do not satisfy those requirements.

No party was created or joined, no invitation was sent and no audio was transmitted during this work. The user has no second device/participant available for a live test now. Two-way audibility, native party mute/PTT, account changes, network recovery and leave/rejoin remain separate acceptance gates. `partyVoice` stays false.

## Reproduce verification

```sh
npm run typecheck
npm test
node scripts/ui/social-system-smoke.mjs outputs/voice-check voice
npx tsc -p tsconfig.electron.json
node_modules/.bin/electron scripts/ui/voice-permission-smoke.mjs outputs/voice-check
```

The injected voice engine suite covers 23 lifecycle/audio cases, with 3 renderer markup/localization tests and 8 main permission tests. The Chromium fixture covers 12 actual component interactions with fake audio, zero external requests and zero browser errors. The Electron permission fixture verifies the packaged-document security context, permission denial without Start, explicit fake audio capture, camera/combined-request denial, track stop and post-release denial through the actual Electron permission handlers. It never opens a physical microphone.

Local run reports and watermarked previews are under ignored `outputs/voice-2026-10-21/`. The full application suite, package startup and publication revision are recorded separately in that directory's final verification report. Passing local audio tests does not mark Xbox party voice complete.
