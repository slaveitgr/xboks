# Upstream launcher comparison — 2026-11-08

Compared the user-selected [domsvoboda/nexus-launcher](https://github.com/domsvoboda/nexus-launcher) main source at **2560895d983affb074e603d643f62c05eea27e9a**, committed **2026-11-08T19:15:31Z**, with XBOKS development source at base **1bfb8fb27889e069b7db1c25bb99f6f5741a8507** plus the current working changes. Upstream declares version **0.5.0**; XBOKS declares **0.3.30** at this checkpoint. Version numbers alone do not establish compatible component protocols or release readiness.

The upstream checkout is confined to an ignored research directory. No application, account service, game, installer, package script or upstream test was executed. This is source inspection and local regression testing of explicitly adapted changes. The separate backend repository and its runtime binaries were not audited in this pass.

## Changes adapted now

### Preserve terminal hyperlink labels and progress

Source commit: [ac44b2cb8d44d55d9431ed30dfa22d7ac53ffdc1](https://github.com/domsvoboda/nexus-launcher/commit/ac44b2cb8d44d55d9431ed30dfa22d7ac53ffdc1).

The old OSC expression in XBOKS consumed visible text between an opening and closing ST-terminated terminal hyperlink. The corrected expression ends each control sequence at its first BEL or ESC-backslash terminator. It preserves the visible label and progress text, existing CSI removal, carriage-return normalization and unterminated-input behavior.

Files: `src/shared/utils.ts`, `src/shared/utils.test.ts`. No engine identity, account data, runtime or launch command changed.

### Read bounded Xbox authentication diagnostics

Source commit: [05b9df26c171910fcd0f1bc07478e8b81c7e0604](https://github.com/domsvoboda/nexus-launcher/commit/05b9df26c171910fcd0f1bc07478e8b81c7e0604).

Added a small parser for fixed user-token/XSTS stage names, valid HTTP outcome classes and an eight-character uppercase hexadecimal service code. The existing reader still limits ASCII frame length, total bytes and record count. URLs, account identifiers, response bodies, freeform suffixes and credentials are not admitted. Service codes are retained only for the exact authorized operation/stage pairs.

The legacy wire prefix remains compatible, and the same fixed format can be emitted with the XBOKS prefix. These protocol identifiers are not user-facing branding. Existing structured cloud-stream diagnostics remain independent and unchanged.

Files: `src/main/xbox-auth-diagnostic.ts`, its test, and `src/main/backend-diagnostics.ts`. This improves safe error reporting when a compatible backend emits the frame; it does not fix an authentication refusal or prove game/cloud compatibility by itself. The backend source pin and installed backend remain unchanged.

The changes are adaptations of MIT-licensed upstream source. Existing contributor notices are retained in the repository license.

## Functional differences requiring separate ports

| Area | Upstream source evidence | XBOKS equivalent / status | Safe next action |
| --- | --- | --- | --- |
| Runtime families | `runtime-families.ts`, `managed-runtime.ts`, `runtime-family-release.ts`, `component-update-runtime.ts`; recent a98608c and d550cd3 | XBOKS has one managed runtime pointer and its own artifact/source identity contract. No equivalent Standard/CachyOS family receipts or verified local family importer. | Port the backend-owned family and archive contracts first, retain XBOKS channels/branding, then expose verified installed choices. Do not copy only the selector UI. |
| Prefix preservation | `runtime-prefix-binding.ts`, `runtime-settings.ts`, `game-runtime-readiness.ts`; 94b9490/d550cd3 | XBOKS captures per-game compatibility data and has strict prefix preparation/stop handling, but does not persist an equivalent runtime-family prefix identity. | Define stable prefix binding and active-session runner retention before allowing family changes. Verify saves remain in place; reject ambiguous existing paths without moving data. |
| Prefix permissions | `managed-prefix.ts` validates owned real directories and path identity | XBOKS already has `secureProtonDirectory` in `proton.ts`, using descriptor-based no-follow checks and removing group/other write permission. | The original owner-only-write launch failure already has an equivalent local repair. Upstream adds full owner-private 0700 and path identity checks; do not blindly replace established prefix behavior or modify files/saves recursively. |
| Component management | `component-updates.ts`, `component-update-admission.ts`, runtime/backend local-import tests | XBOKS verifies its own release artifacts and source manifests, with a different backend schema and local install/update flow. | Port admission, outcomes, cancellation and activity gates together with tests. Preserve own publication channels and existing game operations. |
| Backend source | Upstream lock schema 2 pins `domsvoboda/nexus-backend` a80cfa0b822d777b6344971079cdea99e5ebfdf9, version 0.2.15/minimum 0.2.14, `linux-run-v25` | XBOKS lock schema 1 identifies the Xodus source plus a local patch stack, version 0.3.1, `linux-run-v22`, patch ID `linux-run-v40`. These fields describe different contracts. | Audit the separate backend source and exported commands before deciding consolidation. Rebase the required custom licensing/cloud/social changes, run native candidates, and publish an XBOKS-owned release; do not merely substitute the lock or download URL. |
| Featured product composition | `standaloneFeaturedOffer`, `featuredIdentity` and bounded refill in `catalog.ts`; c52b60a | Current XBOKS catalog checks package support but does not apply equivalent standalone-resale composition or official product-group deduplication to Featured. | Adapt the batch-detail and bounded continuation pipeline as one tested catalog change. Preserve edition selection and account-library inventory. This is distinct from the newly reconstructed 2612 Store layout. |
| Public catalog continuation | `computedCollection`, browse cursor contracts and `store-pagination.ts`; 4022cfc | XBOKS supports typed all-PC/top-paid/add-ons paging and rejects repeated cursors; its Featured read is still a bounded one-page trending collection. | Add a continuation tied to the exact feed/page consumed rather than guessing the next source. Test stale market/account requests and cursor loops. |
| DLC bundles and license-only content | SKU hydration/`contentSkus`/`packageChoice`, statuses `bundle`, `license-only`, `verify`; 89b9e80 | XBOKS `contentOffers` directly distinguishes installed/available/unlicensed/unsupported and requires a unique related content package. It lacks the upstream preparation and richer status model. | Port SKU declarations, bundle relationships, license verification and renderer status handling together. Do not turn a non-download license into a downloadable package or infer ownership from a bundle title. |
| Offline play | `offline-permissions.ts`, `offline-access.ts`, `offline-identity.ts` and backend `--license-cache` admission | No equivalent device-designation and durable revocation flow in the inspected XBOKS source. | Require genuine Microsoft device-designation results, account binding and cleanup-on-sign-out/change/refusal before adding offline launches. A UI toggle alone is insufficient. |
| Social transport/read state | `xbox-social.ts`, `xbox-social-transport.ts`, `xbox-chat-socket.ts`, `xbox-chat-reads.ts`, `xbox-chat-windows.ts` | XBOKS already has bounded account-isolated friends/search/inbox/conversation/send and receipt checks in `XboxSocialService`, but no equivalent cross-window viewed-message synchronization/socket path. | Compare DTOs and backend capability negotiation. Add invalidation, account-switch cancellation and live read synchronization while preserving own original-inspired UI. Do not copy an upstream social UI or infer online presence from sign-in. |
| Party/invites | `xbox-party.ts`, `xbox-guide-party.ts`, `xbox-invites.ts`, `xbox-voice-host.ts`, `game-invite-runtime.ts` | Existing XBOKS Guide/audio/voice surfaces and transport work are separate; source existence alone does not establish equivalent remote Xbox party signaling/media. | Port signaling, explicit create/join/accept ownership, invite validation and media teardown together, then test with two actual participants. A REST token or green unit test is not voice-chat acceptance. |
| Runtime compatibility patches | New game-save transaction/upload completion, package-byte progress and user audio patch files are shipped with upstream launcher source | XBOKS retains its own runtime compatibility patches and has local Wine-UWP work for the original client. Patches were not functionally compared line by line in this bounded pass. | Compare the exact pinned runtime sources and run clean/native runtime probes before adopting patches. Preserve actual saves and reject partial upload results. |
| ARM64 | `arch.ts` defines x64/arm64 artifacts and verifies ELF machine IDs; installer/update paths are architecture aware | XBOKS currently targets x64 packaging and its current Wine-UWP candidate is x86_64. Upstream managed experimental families still explicitly reject an unreviewed ARM64 payload contract. | Treat Linux ARM64 launcher/backend delivery as a separate project from game execution. It does not imply Apple Silicon/macOS support or x86 Windows game compatibility. |

## Integration order

1. Keep the original 2612 UI reconstruction independent of upstream renderer branding and presentation.
2. Adapt the self-contained log/diagnostic fixes first; these are the only upstream production changes included in this checkpoint.
3. Audit and test the catalog/DLC model as a bounded follow-up for installation correctness.
4. Design runtime families and durable prefix identity before importing component-management UI.
5. Compare social/party backend contracts and run actual account-bound acceptance after static and synthetic tests.
6. Review the separate backend source/published candidate before changing any source or release pin.

No new account privileges, offline licenses, runtime downloads, package installation or game execution followed from this comparison. No game files, saves, prefixes, diagnostics or credentials were added to Git.

## Local validation

The adapted OSC and bounded authentication diagnostics pass **38 tests across four files**, including existing process and diagnostic persistence tests. Tests explicitly retain structured cloud diagnostics and reject freeform/provider data. The combined affected-file check passes 58 tests across six files. Full application build, service compatibility and native game/voice acceptance remain separate checks for the parent implementation.
