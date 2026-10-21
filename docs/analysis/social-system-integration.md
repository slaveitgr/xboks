# Xbox social and Linux system controls

Implemented in the xboks 0.3.10 working tree on 2026-10-21. This records actual adapters and their limits; it does not certify the original Windows client, authenticated Xbox service behavior or physical desktop/controller behavior.

## Shared social service

The app Friends flyout and Game Bar use `XboxSocialPanel` and the same main-process `XboxSocialService`. Friends, observed presence, player search, inbox and one-to-one text conversations use a bounded Rust `social` command. Queries and outgoing text use stdin, not process arguments. Tokens remain in the backend. Replies are bound to the selected account, current peer and conversation participants. Main-process caching is memory-only, expires after 20 seconds and is cleared on account/backend changes. UI sessions discard private state on credential-identity changes; a gamertag-only refresh preserves an existing draft.

Only explicit Send submits a message. There is no optimistic delivery or automatic resend after a timeout. The UI preserves an uncertain draft and asks the user to inspect the conversation before sending again. Deleted, filtered and unsupported message content remains unavailable. The current inbox omits group/system threads and reports that omission; only the returned message page is displayed. Consumer Xbox party creation/join/invitation signaling and bidirectional voice negotiation/media are not implemented. Remote Play's stream microphone channel does not supply an independent party voice service.

The selected Nexus backend is used when it advertises `social`. Otherwise an optional bundled companion is verified against its manifest SHA-256 and a bounded `--help` probe. It does not replace the selected backend. The social path rejects keyring set/remove operations and skips token/device renewal, because a newer credential encoding could break an older selected backend. Missing/expired credentials require the normal launcher Account refresh/sign-in flow. The companion is never used for login, profile renewal, provisioning or game execution.

Source: `assets/xodus-social.patch`, `src/main/xbox-social.ts`, `src/main/social-backend.ts`, `src/shared/xbox-social.ts`, `src/renderer/XboxSocialPanel.tsx`. The backend recipe remains pinned by `assets/backend-source.lock.json`.

## Linux service controls

`GuideSystemAdapter` reads NetworkManager, BlueZ, logind and available session services through bounded, shell-free commands. It does not start Bluetooth discovery or collect Wi-Fi passwords. Controls cover Wi-Fi/Bluetooth radio power and connect/disconnect of a device whose paired status is checked again immediately before use. Returned state is re-read after commands; command acceptance alone does not invent a new connection state. New networks/pairing use desktop settings.

Power capabilities are read from the OS. Lock/logout/suspend/reboot/poweroff require an explicit Cancel-focused dialog and a 60-second, one-use token bound to the initiating window/action. The main process rechecks active games, installations, authentication and updates at execution. The adapter checks again after asynchronous capability reads, immediately before the OS command. Tests do not execute actual disruptive actions. Normal logout and settings panels currently support GNOME; lock/logind actions are independently capability-gated. Unsupported services/desktops return reasons.

Primary contracts: [NetworkManager nmcli](https://networkmanager.pages.freedesktop.org/NetworkManager/NetworkManager/nmcli.html), [BlueZ bluetoothctl](https://github.com/bluez/bluez/blob/master/doc/bluetoothctl.rst), [logind D-Bus](https://www.freedesktop.org/software/systemd/man/latest/org.freedesktop.login1.html), [GNOME SessionManager](https://gnome.pages.gitlab.gnome.org/gnome-session/re04.html). The social recipe follows [OpenXbox's providers](https://github.com/OpenXbox/xbox-webapi-python/blob/672f34f256f18640d387147867950234fc2e140f/xbox/webapi/api/client.py) and [messaging models](https://github.com/OpenXbox/xbox-webapi-python/blob/672f34f256f18640d387147867950234fc2e140f/xbox/webapi/api/provider/message/models.py), pinned to commit `672f34f256f18640d387147867950234fc2e140f`. These are reverse-engineered service interfaces, not a Microsoft support guarantee. Greenlight's [chat stream channel](https://github.com/unknownskl/greenlight/blob/ef852c3b90292def435c8c877feeb1aeaefd8a33/packages/player/src/client/lib/channel/chat.ts) and [stream manager](https://github.com/unknownskl/greenlight/blob/ef852c3b90292def435c8c877feeb1aeaefd8a33/packages/desktop/main/helpers/streammanager.ts) bind microphone SDP to an existing console/cloud stream; they do not implement independent consumer party voice.

## Build the optional companion

Use the Rust version recorded in the source lock plus the backend recipe prerequisites, including `protoc`. Work/output directories must be new. The recipe builds tests and release binaries without starting authentication, a service or a game:

```sh
node scripts/build-backend.mjs --work work/social-build --output outputs/social-backend
node scripts/bundle-social-backend.mjs \
  --binary work/social-build/target/release/xodus-cli \
  --license work/social-build/source/LICENSE \
  --source-archive outputs/social-backend/xodus-nexus-backend-0.3.0-linux-x86_64-source.tar.xz
npm run dist
```

The bundle includes the supplied license and corresponding-source archive, with hashes. Generated `assets/social-backend/` stays out of Git and ASAR; Electron packaging copies it into `resources/social-backend/`. A build without it remains usable for other features, but social requires an independently selected compatible backend. No GitHub release is published by these commands.

The local x86_64 companion was built on this host and requires OpenSSL 4 (`libssl.so.4` / `libcrypto.so.4`) and strong glibc symbols through 2.38. Older distribution compatibility has not been verified. The loader/help check disables an unusable companion rather than replacing the selected backend or claiming service connectivity.

## Verification records

The dated machine-readable result is `outputs/social-system-2026-10-21/verification.json`. `node scripts/ui/social-system-smoke.mjs` runs isolated Chromium with explicit sample launcher APIs; its screenshots are watermarked fixtures. The prior app navigation regression suite is `node scripts/ui/reference-app-smoke.mjs`. These do not send Xbox messages, toggle radios, connect devices or execute OS power actions. Read-only host capability probing, Rust local HTTP protocol tests, production packaging/startup and any authenticated read are recorded separately rather than counted as UI success.

Final results: 1,100 launcher tests passed, 46 social/system renderer fixture checks and 25 previous-app navigation checks passed. The backend CLI suite passed 84 tests, including 20 social tests; the recipe's other filtered test runs overlap and are not added into a unique total. Type checking, production build, packaged companion hash/help/ASAR checks and isolated demo AppImage startup passed.

Authenticated read-only checks returned 18 friends and 5 supported one-to-one inbox conversations; one group/system thread was omitted. The inbox passed the main-process DTO validator. No raw friend/message data was persisted, no message was sent, and no conversation was marked read. Linux host probing recognized NetworkManager, BlueZ and GNOME/logind capabilities without mutating them. Actual message delivery, Bluetooth/radio changes, disruptive power operations, physical controller/desktop overlay acceptance and standalone party voice remain separate acceptance gaps.
