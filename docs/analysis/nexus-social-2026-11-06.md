# Upstream social comparison — 2026-11-06

This is a source comparison against XBOKS `a6e0a4e`. It is not a claim that the
new upstream services have been integrated or validated with a live account.

## Exact source candidates

| Source | Commit | Declared compatibility |
| --- | --- | --- |
| [Nexus launcher](https://github.com/domsvoboda/xodus-nexus/commit/ce23ec884882521014fa17a70740adec8e48a974) | `ce23ec884882521014fa17a70740adec8e48a974`, November 4 | package version `0.4.2`; recent integration commits explicitly say source-only |
| [New upstream backend](https://github.com/domsvoboda/nexus-backend/commit/bcb80132d632058372038587bf99a3c6bde1d78c) | `bcb80132d632058372038587bf99a3c6bde1d78c` | version `0.2.15`, minimum `0.2.14`, `linux-run-v25` |
| XBOKS Engine source lock | `xodus-gaming/xodus@53ea781dcd073e31d7ea68e894134e9c959bff04` plus the ordered 40-patch chain | XBOKS `0.3.1`, patch ID `linux-run-v40`, compatibility `linux-run-v22` |

The backend version numbers belong to different release lines. Replacing the
binary or copying the renderer would not reconcile the protocols, account
lifecycle, cloud-token extensions or Engine patches.

## Substantive upstream changes

| Area | Source evidence | XBOKS implication |
| --- | --- | --- |
| Signed outgoing messages | [Messaging-session change](https://github.com/domsvoboda/xodus-nexus/commit/135c7e8112b1cb3ec51f63990591bf48ff1c461c); backend `commands/social_session.rs` and `native_social_session.rs` | The old XBOKS social patch sends a bearer-authenticated POST without the equivalent NSAL/device/SISU/XSTS/signature sequence. A UI change cannot implement that session. |
| Message acceptance and uncertainty | [Receipt reconciliation](https://github.com/domsvoboda/xodus-nexus/commit/db654ec6dd5004334c36cdb3cd0e10a026c5631f); current `shared/social.ts` and `renderer/XboxChat.tsx` | Require an actual message ID and reconcile that exact ID against the selected conversation. Preserve the draft and prevent blind resubmission after ambiguous results. Server acceptance does not prove recipient delivery. |
| People, relationships and profiles | [Separate native API](https://github.com/domsvoboda/xodus-nexus/commit/0a9682929f74c36631825e196c38e20364531ca3), [native social UI](https://github.com/domsvoboda/xodus-nexus/commit/2c461d9af5236f57abd3914835b42912b8386a71); `xbox-native-social.ts`, `XboxPeopleBrowser.tsx`, `XboxPlayerCard.tsx` | Real operations exist for recent/suggested/blocked players, friend requests and relationship actions, profiles, games and achievements. Current XBOKS only exposes friends, people search and one-to-one chats. |
| Desktop conversations and unread state | `xbox-chat-windows.ts`, `xbox-chat-reads.ts`, `XboxChatDesktop.tsx`; [focus/read synchronization](https://github.com/domsvoboda/xodus-nexus/commit/a60dcaf7c73666279f13c8a6a9fa6c977ab248f6) | Independent windows share bounded, account-bound viewed-message IDs and unread presentation with the app and overlay. The viewed ledger is local RAM state; it does not send server-side read receipts. |
| Shared party voice | [Party implementation](https://github.com/domsvoboda/xodus-nexus/commit/c7b24b53a68d021c6e3c41694d3b61f4a9dd08cb), [account/microphone lifecycle](https://github.com/domsvoboda/xodus-nexus/commit/c2e9b87dd6f65c3a7114a46853a58c709ccd1fd4); `xbox-party.ts`, `xbox-chat-socket.ts`, `xbox-voice-host.ts`, `renderer/xbox-voice.ts` | Real party signaling, authenticated notifications, relay SDP/ICE and WebRTC audio exist, with one media owner and explicit microphone controls. These require coordinated IPC, permission and account cleanup, followed by two-device acceptance. |

The reviewed upstream still enables only OneToOne inbox conversations. Group
and system entries are disabled in that UI. Attachments, GIFs and complete
messaging parity are not established by this implementation. Demo social data
is separately simulated and is not evidence of live service operation.

## Protocol and account boundary

XBOKS currently invokes `social <operation> [peer] --json` and parses an
account-bound `{status, capabilities, selfXuid, ...}` envelope. New upstream
uses `native-social <verb>` or a persistent, private line-framed
`native-social listen` broker. Responses carry `{schema, account, kind, items}`
or operation/result fields. An explicit adapter or new IPC contract is needed.

The newer launcher also separates Store licensing identity from the Xbox
player session. That changes token and account-switch ownership. Integrating
it must preserve XBOKS cloud/console sessions and invalidate stale social
results without silently signing out or replacing unrelated credentials.

The launcher contains an MIT notice and the new backend a GPLv3 notice. Source
reuse must retain the applicable notices and source/build provenance; changing
the public XBOKS identity does not remove those source obligations. No upstream
UI or backend binary was imported by this comparison.

## Implemented desktop foundation

The new `FriendsDock` uses the existing XBOKS social API to display actual
friends and search results in the redesigned desktop sidebar. It has separate
account sessions, discards late account/search results, coalesces reads and
refreshes only while visible. Selecting a player opens the existing selected
conversation; the chats shortcut opens its existing tab. Party remains disabled
with an availability explanation until its signaling and media integration is
implemented. The dock does not add/remove friends or send messages itself.

This makes the new sidebar functional with today's Engine while keeping a
clear boundary for the newer relationship and party APIs.

XBOKS also implements a separate receipt/draft correction in
`XboxMessageSubmission` and the existing social parser/composer. Empty receipts
are rejected, pre-send reads are invalidated, automatic refresh cannot release
an unknown submission, and only matching self/peer/message IDs clear its draft.
An explicit successful refresh permits review and another attempt while keeping
unconfirmed text. This corrects the local acceptance behavior; it does not add
the newer backend's authenticated signing session or prove live delivery.

## Verification and remaining integration

The pinned upstream clone passed 77 offline tests across nine files:
native-social parsing, people operations, existing messaging, local chat-read
state, chat socket, party lifecycle/context, voice ownership and broker
transport. The command used the existing local dependencies and did not install
packages, contact Xbox, access credentials or capture a microphone. Those
results concern upstream source, not a working XBOKS integration.

The new XBOKS dock separately passed 13 tests for account disposal, late results,
search races, visibility and capability-based presentation. Final application
integration checks are recorded in the redesign implementation report.

Integration order:

1. Correct message-receipt/draft handling and port the authenticated signing
   session into an explicitly compatible Engine candidate.
2. Add capability-gated native social transport, parsers and IPC for people,
   profile and relationship operations.
3. Share conversation/unread state, then add optional desktop chat windows.
4. Add party signaling and one media owner shared by the app and Game Bar; test
   two-way audio, invitations, mute, device changes, leave and account changes.

Never activate a party button solely because an account is signed in or a
renderer component exists. Do not report all of these steps complete based on
the offline tests above.
