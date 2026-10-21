# Native console Remote Play: account and transport boundary

Reviewed on 2026-10-22. The intended XBOKS flow is an internal console picker
and local WebRTC player using the already signed-in launcher account. It does
not navigate to the Xbox website or share account credentials with a web page.
This chapter records independently inspected contracts and implementation
limits; it does not establish successful video/audio streaming from a console.

## Original Windows application

The supplied Xbox application 2610.1001.20.0 x64 contains an internal console
streaming route and embedded native player. Its Hermes v96 bundle SHA-256 is
`4f9f633da95002aeab380f01813bb7da63bc7f938f7f1f26b401c0bb2b180b55`.
Function offsets are decimal and relative to the named function.

| Evidence | Contract |
| --- | --- |
| F21821:7–44 | `navigationActions.remotePlay` pushes `StreamingRoute` with the selected device. |
| F65996:1683–1753, 3301–3656 | `StreamingScreen` uses route device state, RemotePlay mode, the Home streaming user and a streaming provider. |
| F66020:135–259 | Remote Play configuration has type `console`, the selected device's server ID, console metadata, streaming user and XUID. |
| F35397:3016–3057; F10663:185–248 | The stream host renders the native React Native `GameStreamView`, passing user, stream and audio configuration. |
| F55060:17–57; F55062:638–877 | The original gets a streaming token silently from the application's account manager and starts Home/cloud sign-in for an existing authenticated user. |
| F67169:30–94 | A console without Remote Play enabled follows a setup flow before navigation. |
| F67141:14–56 | Original setup can issue `RemoteAccess / AllowConsoleStreaming` to a selected device; this is a state-changing operation. |

The configuration includes a flight-controlled WebView2 flag. That does not
establish that the inspected client opens an external browser or that the
official web page owns the entire console picker/player. The detailed static
findings remain in [original client ownership](reference/remote-play-ownership.md).
No original Windows implementation code is embedded in the Linux player.

## Same-account authentication

The existing private Engine `cloud-token --json` command derives a short-lived
bearer XSTS ticket for `http://gssv.xboxlive.com/` from the selected launcher's
stored account. The same relying party is used by both the cloud and console
streaming services. A second native command, another login or a copied browser
cookie is therefore unnecessary for the Home offering exchange.

Cloud and console offerings still receive separate service tokens:

```text
POST https://xhome.gssv-play-prod.xboxlive.com/v2/login/user
Content-Type: application/json
x-gssv-client: XboxComBrowser

{"token":"<private GSSV XSTS ticket>","offeringId":"xhome"}
```

The response contains a short-lived `gsToken` and authenticated
`offeringSettings.regions`. Only a validated supplied Home service origin may
be used. Home origins can use the distinct zone
`gssv-play-prodxhome.xboxlive.com`, for example the region-host pattern
`https://<region>.core.gssv-play-prodxhome.xboxlive.com`.

The cloud login-country compatibility helper is deliberately not a global
request interceptor. It does not add forwarded-country hints to Home login,
console requests, Microsoft account authentication or media traffic.

No token, service session identifier, service URL or raw credential response
belongs in renderer IPC, account diagnostics, screenshots or Git. Account or
Engine changes must cancel in-flight operations and invalidate the corresponding
console cache, offering and locally owned session.

## Console enumeration

The Home streaming service's read-only console query is:

```text
GET <validated Home origin>/v6/servers/home?mr=50
Authorization: Bearer <private Home gsToken>
```

The response has a `results` array. The pinned implementations consume fields
including `serverId`, `deviceName`, `consoleType`, `powerState`, and
`outOfHomeWarning`. Only bounded normalized fields should become console cards.
An absent field stays unknown: an account login, a listed console, or a power
state does not prove successful reachability or a connected stream. Empty lists
and service failures must have distinct UI states.

The original client also has an XCCS discovery/setup service. The authenticated
Home list supplies a direct first native implementation without claiming full
setup, rename, enable-Remote-Features, wake or console-management parity.
Do not wake a console, change its remote-feature settings, or create a stream
merely because the picker mounted or refreshed.

A bounded read-only probe on 2026-10-22 reused the existing account's private
GSSV ticket: the fixed Home offering returned HTTP 200, its three returned
regional origins passed the strict Home-host validator, and console discovery
returned HTTP 200 with one console in standby. The probe created **zero stream
sessions**, issued **zero wake or power requests**, and persisted no credentials.
The ignored local aggregate evidence is
`work/console-stream/live-list-result.json`. This verifies same-account native
discovery; it does not verify an actual console connection or media playback.

## Session lifecycle

An explicit connection to a selected returned console can request:

```text
POST <Home origin>/v5/sessions/home/play
Authorization: Bearer <private Home gsToken>

{
  "titleId":"",
  "serverId":"<selected returned console ID>",
  "clientSessionId":"<local session capability>",
  "systemUpdateGroup":"",
  "fallbackRegionNames":[],
  "settings":{ "sdkType":"web", "locale":"<selected locale>", "...":"..." }
}
```

Use the returned provider session only inside the owning main-process service.
Poll its `/state` with deadlines. After `Provisioned`, exchange SDP and ICE
through narrow IPC calls to the same locally owned session, render media in the
XBOKS player, send bounded keepalives, and DELETE only that owned session on exit.
Do not attach to or delete another client's active session.

The cloud and Home paths have the same negotiation structure but different
offering/region/session ownership. Sharing the local peer/input adapter does
not mean sharing a provider bearer or permitting arbitrary endpoint selection.
Controller input must remain neutral while overlays, dialogs, focus loss or
teardown prevent the player from owning controls.

## Protocol details that must not be guessed

The pinned desktop Greenlight and XStreamingDesktop helpers send SDP as
`{messageType:"offer",sdp,configuration}`. Their response handlers parse
`exchangeResponse` and consume its `sdp`; they do not require a `type` field.
A bounded parser can recognize optional `type` or `messageType` answer markers,
reject conflicting or non-answer values, and validate SDP independently. A test
fixture that always invents `type:"answer"` does not prove that the service
returns that field.

For the pinned desktop/player generation, ICE POST uses
`{messageType:"iceCandidate",candidate:[<candidate objects>]}`. A separate
experimental Greenlight monorepo player uses `candidates` with serialized
candidate strings. These are different generations; mixing payloads without
evidence is not an interoperability fix. The known response end marker
`a=end-of-candidates` must be normalized for the browser peer API.

The pinned Greenlight desktop helper also decodes Xbox Teredo addresses in
returned ICE candidates and adds corresponding IPv4 host candidates, including
port 9002 and the decoded UDP port. Passing the original IPv6 candidate alone
does not establish connectivity on a Linux host without Teredo routing.
`src/main/console-ice.ts` independently implements the
[RFC 4380 section 4](https://www.rfc-editor.org/rfc/rfc4380.html#section-4)
address layout and bitwise inversion. It derives routes only from validated
`2001:0000::/32` component-one UDP candidates, checks mapped/server address and
port fields, and preserves the provider's original candidates and priorities.
Added routes use low priority, retain media identifiers, are deduplicated and
stay within the 256-candidate budget; the end marker follows all additions.
Fixtures cover alternate IPv6 notation, byte order, port boundaries, malformed
and non-Teredo addresses, output limits and deduplication. Native LAN/NAT
traversal remains unverified until a real console session is tested.

Some sessions enter `ReadyToConnect` and require `/connect` with a separate
console-transfer access token. Greenlight obtains this as `lpt`, with scope
`service::http://Passport.NET/purpose::PURPOSE_XBOX_CLOUD_CONSOLE_TRANSFER_TOKEN`.
The original package's F65991:20–42 calls
`authManager.getWamWebTokenSilently` with that purpose scope and `XblClientId`.
The separate module initializer F66036 (bundle offset 18669370) loads literal
`000000004424DA1F` at instruction 43 and exports it as `XblClientId` at 49. This
matches the existing Engine account client identifier; no different application's
OAuth client identity is needed to describe the original request.
This proves a Windows account-broker operation, not a corresponding legacy STS
or SOAP grant in the Linux Engine. Never substitute a refresh token, GSSV token
or ordinary Xbox social token. Until a matching same-account exchange is
verified, return a specific unsupported-stage error and release the session
instead of looping indefinitely or starting a new browser login.

## Pinned implementation references

- [Greenlight authentication and offering exchange](https://github.com/unknownskl/greenlight/blob/ef852c3b90292def435c8c877feeb1aeaefd8a33/packages/desktop/main/authentication.ts).
- [Greenlight session and transfer-token handling](https://github.com/unknownskl/greenlight/blob/ef852c3b90292def435c8c877feeb1aeaefd8a33/packages/desktop/main/helpers/streammanager.ts).
- [Greenlight HTTP signaling](https://github.com/unknownskl/greenlight/blob/ef852c3b90292def435c8c877feeb1aeaefd8a33/packages/desktop/main/helpers/xcloudapi.ts).
- [XStreamingDesktop Home list and signaling](https://github.com/Geocld/XStreamingDesktop/blob/0e4b661254cdacba2afcecad5fd9ff3068f91beb/main/helpers/xcloudapi.ts).
- [XStreamingDesktop transfer-token scope](https://github.com/Geocld/XStreamingDesktop/blob/0e4b661254cdacba2afcecad5fd9ff3068f91beb/main/xal/msal.ts).

Both application references are MIT licensed at these revisions. The shared
player's own pinned metadata and license are recorded in
[cloud streaming research](cloud-streaming-reference.md), and any incorporated
code retains its applicable notice. Public protocol descriptions and local
fixtures do not establish a successful Xbox One X stream; live video, audio,
controller gameplay, reconnect, wake and console-transfer acceptance remain
separate checks.
