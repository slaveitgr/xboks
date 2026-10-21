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
