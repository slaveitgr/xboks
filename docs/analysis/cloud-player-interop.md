# Cloud player interoperability checks

Inspected again on **2026-10-22**:

- [Greenlight ef852c3](https://github.com/unknownskl/greenlight/tree/ef852c3b90292def435c8c877feeb1aeaefd8a33).
- [XStreamingDesktop 0e4b661](https://github.com/Geocld/XStreamingDesktop/tree/0e4b661254cdacba2afcecad5fd9ff3068f91beb), which depends on `xstreaming-player` **0.3.4**, not XBOKS's pinned `xbox-xcloud-player` **0.2.11**.
- [`xstreaming-player` 0.3.4](https://github.com/Geocld/XStreaming-player/tree/8e178aef067ec31625311865e5ee51a6924823e2), inspected as a protocol comparison; it was not added as an application dependency.

Both desktop references use the four `input`, `chat`, `control`, and `message`
data channels with protocols `1.0`, `chatV1`, `controlV1`, and `messageV1`.
Their SDP exchange uses the offer's SDP text; the Home/cloud signaling mode is
owned separately in the main process. No account credential is needed by the
renderer adapter.

## Confirmed adapter defects and corrections

The pinned 0.2.11 player `createOffer` helper resolves after calling
`setLocalDescription` without awaiting it; it also omits rejection propagation
from the underlying peer offer. XBOKS now owns and awaits both peer operations,
preserving the pinned stereo preference, before transmitting the SDP to main.
Cancellation or local SDP failure cannot submit an offer or apply a late answer.

The pinned package's CommonJS constructor has different default-export nesting
under native module import and browser bundling. The factory now resolves the
constructor explicitly and verifies it is callable.

The pinned message channel already serializes a transaction payload into its
`content` field. Passing an already serialized string produced double encoding.
XBOKS now passes the result object. It accepts absent unused button labels in a
single-button service prompt and advertises the implemented ShowMessageDialog
capability, rather than advertising an empty capability list while attempting
to handle dialogs.

The renderer exposes only a closed stage enum and `failed`, `timeout`, or
`cancelled` code for failures. It does not forward arbitrary exception text,
SDP, ICE addresses or service response bodies into diagnostics.

## Verification and limits

Thirty-two focused renderer tests pass, including a replay through the actual
pinned package constructor and channel implementations: data-channel protocols,
audio/video directions, message handshake, advertised system UI, transaction
wire JSON, actual gamepad packet encoding, overlay-neutral input and cleanup.
Offer/local-description failures and deadlines are independently exercised.
TypeScript checks pass.

The host also has nine focused regressions covering surfaced typed errors,
safe details, session replacement and diagnostic reset. It discards callbacks
and late player handles after cancellation, displays only allowlisted service
stages and bounded HTTP status, and offers the launcher's existing explicit
diagnostic-log read action. Renderer exceptions are not printed verbatim.

These fixtures establish adapter behavior. Service interoperability was checked
separately with the bounded live acceptance below.

## Live Forza Horizon 5 acceptance

On **2026-10-22**, a private, sandboxed Electron renderer exercised the actual
XBOKS adapter and main-process service using the existing signed-in account.
The player received no account or service credentials. No second sign-in,
browser player or credentials from another application were used.

The main-process investigation confirmed two additional protocol requirements:

- The provider's accepted play response can identify its session through the
  canonical `sessionPath`; `sessionId` is optional.
- `ReadyToConnect` requires a fresh purpose-specific login proof for the owned
  session's `/connect` request. The existing account's native ticket service
  issued the exact login-proof type. A generic streaming token is not used in
  its place. The proof remains in main and is neither persisted nor sent over
  renderer IPC.

A first media test used a temporary purpose helper. It was followed by a fresh
acceptance using the **production bundled companion 0.3.1 for both credential
commands**, with these exact candidates:

| Candidate | SHA-256 |
| --- | --- |
| Bundled companion | `9f2c6f32efe4b8cd4013695ce077bc44c1389afbec10e98cc8144909462d5fbf` |
| Companion source archive | `ee2e5cc06ae7fcce8633bde99e230b745ca5f9aa9d2ef862d08874b52eb00726` |

The production replay explicitly selected the Poland compatibility setting and
Forza Horizon 5. Login and catalog returned HTTP 200, play returned 202, the
purpose proof was accepted, connect returned 202, and the session progressed
through Provisioning to Provisioned. SDP and ICE exchanges completed, followed
by an actual connected peer and decoded video:

| Observed result | Value |
| --- | --- |
| Decoded video frames | 18 |
| Video dimensions | 1920 × 1080 |
| Received video bytes | 796,521 |
| Received audio RTP bytes | 61,407 |
| Owned session DELETE | HTTP 200 |
| Harness exit | 0 |

Input remained neutral throughout. The harness closed its peer and deleted its
owned cloud session; no test session was left running. Private aggregate proof
records the exact harness, renderer, compiled main modules, source and companion
checksums. No account contents, credentials, SDP, ICE addresses or captured
frames were added to the repository.

This proves cloud provisioning, negotiation and decoded video with the tested
candidate. It does not establish audible output, gameplay/controller actions,
reconnection, long-duration stability, every cloud title or console Remote Play
media. Those remain separate acceptance checks.

## Full application provisioning regression

The preceding media harness exercised the service and player adapter directly;
it did not exercise the React application's state-polling effect. A subsequent
0.3.25 application report exposed a race in that effect: main publishes its
updated session before returning the IPC reply. A same-phase Provisioning push
advanced the host revision, so the host correctly discarded the older reply but
also discarded scheduling its next poll. The effect's dependencies had not
changed, leaving the application at Preparing with only keepalives continuing.

Both Cloud and Console hosts now scope the polling loop to the session and its
preparing state. A newer push still supersedes an older reply, but scheduling
uses the current owned session independently of whether that reply was adopted.
Ready, error, closed, replacement and disposal stop the loop. Cloud session
entry also resets video, menu, mute and message state so a new Preparing screen
cannot inherit the prior session's Keep playing menu.

Twenty-two focused component-effect regressions and the nine existing cloud
host tests pass. A separate full application browser fixture passes 21 checks,
including both hosts, session replacement and cancellation. That fixture
reproduces the published 0.3.25 source's one-poll stall and verifies the fixed
source reaches its simulated handshake. Its peer and media events are explicitly
simulated; it is separate from live service acceptance.

### Bounded live full application acceptance

The **final full application replay passed**: decoded frames advanced from 17
to 469 at 1920 × 1080 for 15,426 ms, the loading overlay disappeared, and the
actual host's End session action completed its awaited DELETE with HTTP 200.
The first replay and its cleanup limitation are retained separately below.

#### First full application replay

A further private Electron acceptance used the actual App, actual CloudLibrary
Play with Cloud action, actual CloudStreamHost effect, real player and real
main-process service. Other app sections used sample snapshots. No harness
state-polling loop or simulated player participated. The companion and source
archive are the exact production candidates pinned above. The tested cloud
host source SHA-256 was
`468668eae7f7d805ed7a39bfd4d0c0a82651210629da81c9de208cb25b4c885a`.

| Observed full application result | Value |
| --- | --- |
| Explicit Play actions | 1 |
| Host session-state IPC reads | 8 |
| Same-phase pushes delivered before their replies | 6 |
| SDP / ICE exchanges | 1 / 1 |
| Decoded frames at completion | 468 |
| Video dimensions | 1920 × 1080 |
| Received video / audio RTP bytes | 32,287,673 / 312,091 |
| Sustained advancing decoded video | 15,421 ms |
| Loading overlay removed | Yes |
| Actual host End session action and UI closure | Yes |

All controller input remained neutral; no gameplay or service dialog was
accepted. The private harness exited with code 0, but its own cleanup had a
separate race: the host published Closed while its DELETE promise was pending,
and the harness attempted another stop before awaiting that existing promise.
Consequently, **DELETE completion is unconfirmed for this full application
run**. Its in-memory provider capability was not persisted, so no guessed
recovery request was made. The private harness was corrected to await its
owned stop promise before the separately authorized final replay below. The earlier direct
service/player acceptance's verified DELETE 200 is distinct evidence and does
not prove cleanup of this later session.

Private aggregate proof retains the exact source and bootstrap checksums and
the safe counters above. No screenshot or frame from the signed-in session was
captured or added to the repository.

#### Final full application replay with awaited cleanup

After the service cleanup changes passed their focused tests, one fresh bounded
replay used the final services and the corrected private harness. The Cloud and
Console services retain joinable deletion promises, and shutdown can await
pending cleanup even when an internal terminal-state transition has already
cleared the active session. The harness retains the actual host stop promise
and requires a successful owned DELETE before reporting overall success.

This replay again used the actual App, CloudLibrary action, CloudStreamHost
polling and real player, with a sandboxed narrow IPC bridge to the real main
service. It reused the signed-in account and production companion above. There
was no manual state-polling loop, player factory replacement, additional login
or account transfer from another client.

| Observed final full application result | Value |
| --- | --- |
| Explicit Play actions | 1 |
| Host state reads / same-phase pushes before replies | 5 / 3 |
| SDP / ICE exchanges | 1 / 1 |
| First → final decoded frames | 17 → 469 |
| Sustained advancing decoded video | 15,426 ms |
| Video dimensions | 1920 × 1080 |
| Received video / audio RTP bytes | 11,884,682 / 316,951 |
| Loading overlay removed | Yes |
| Actual host End session and UI closure | Yes |
| Awaited owned DELETE | HTTP 200 |
| Cleanup pending at completion | No |
| Harness exit | 0 |

The host source SHA remains the value above; the tested final cloud service
source SHA-256 is
`765df4a24494df5bbbdeba8c02dff235377bead84a3f8ea9f01483bf05305f3e`.
Private aggregate proof records 30 exact source, compiled-module, bootstrap and
companion checksums. Input remained neutral; no service dialog or gameplay
action was triggered, and no screenshot or video frame was captured.

This final replay verifies its own session's successful cleanup. The earlier
full application run's unconfirmed DELETE remains a separate limitation; no
recovery operation on that prior in-memory capability was attempted. Audible
output, gameplay, reconnection, extended stability and console Remote Play media
remain outside this bounded acceptance.
