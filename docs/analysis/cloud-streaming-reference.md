# Cloud Gaming: original application and Linux transport

Reviewed on 2026-10-22. This chapter distinguishes the original application's
static contracts, current public catalog responses, and third-party transport
implementations. It does not establish a successful streaming session.

## What the original package actually contains

The supplied Xbox application **2610.1001.20.0 x64** contains a React Native cloud
destination and a native Game Streaming bridge. Its Hermes v96 `index.bundle`
SHA-256 is `4f9f633da95002aeab380f01813bb7da63bc7f938f7f1f26b401c0bb2b180b55`.
Offsets below are decimal and relative to each function. The original bytes,
instruction index and downloaded packages remain in ignored local storage.

| Evidence | Observed contract |
| --- | --- |
| F10548:327/331; F21807:7–29 | Cloud navigation pushes the separate `/xcloud` destination. It is distinct from `/streaming`. |
| F66253:28–112 | `XCloudScreen` reads market support, launcher sign-in, streaming-access entitlement and streaming-user state. |
| F66254:14–26; F66255:30–103 | The screen can request cloud sign-in for the existing application account and show MRU loading. |
| F55060:17–57 | The token helper calls the application's `authManager.getTokenAndSignatureSilently` for `streamingTokenUrl`, with an explicit refresh option. |
| F55064:599–769, 1190–1232, 1402–1461 | The streaming saga checks application authentication, obtains `getStreamingXtoken`, calls `GameStreaming.login`, then fetches streamable titles and MRU. |
| F55066:77–109 | A separate token-refresh handler obtains a fresh streaming token and updates the streaming user. |
| F55068:61–155, 333–410 | Title loading calls `GameStreaming.getTitles`; success and failure have separate actions. |
| F10572:309–321; F10602:51–63 | `GameStreaming` is a `NativeModules` bridge. Title enumeration is not implemented as browser navigation. |
| F66313:7–45 | The cloud feed has its own MRU module. |
| F66313:65–264 | `StreamYourOwnGame` and its separate Fresno variant use cloud SIGLs and cloud platform context. |
| F66313:372–442, 632–700, 758–863 | The feed also defines recently added, popular, EA Play and all-games channels. |

The accompanying `gamestreaming_sdk.winmd` declares `IStreamClient.LoginAsync`,
`GetTitleManagerForUser`, `GetConsoleManagerForUser` and
`CreateSessionRequestAsync`. `IStreamSession` declares connect, pause, resume,
disconnect, quality/statistics, input configuration and gamepad operations.
These signatures corroborate a streaming SDK boundary, but do not reveal the
implementation of that proprietary native SDK or prove runtime behavior.

The two newly supplied screenshots show different cloud layouts: an all-games
collection headed “Stream your own game”, with sorting/filtering, and an older
cloud home with MRU and branded rows. They are separate views, not contradictory
requirements. Their pixels alone do not establish current account entitlements,
server ordering, available games or the correct response to Play.

## Catalog collections recovered from the package

F10531 assigns the following collection identifiers. These are service
identifiers, not account credentials.

| Collection | Identifier | Literal / assignment offsets |
| --- | --- | --- |
| All cloud games | `1bf84c2b-0643-4591-893f-d9edb703f692` | 726 / 730 |
| Stream your own game | `e78d9a61-5ef4-43af-b400-edba1250b18e` | 736 / 740 |
| Most popular on cloud | `6a589fa0-d493-472b-8e20-3813699d7056` | 690 / 694 |
| Recently added | `06323672-b8c8-43cc-b0de-32d5a9834749` | 450 / 454 |
| EA Play games | `27a89da6-0eaf-4dca-8192-85e7f62a5b3f` | 530 / 534 |

Bounded anonymous requests to
`https://catalog.gamepass.com/sigls/v2?id=<collection>&market=US&language=en-US`
returned HTTP 200 for all-cloud, own-game and popular collections during this
review. The JSON array begins with collection metadata (`siglId`, `title`,
`description`), followed by `{id: <Store product ID>}` entries. Collection title
and product count come from the response. Do not hardcode a screenshot's count.
The original package also references a newer `sigls/v3` contract; this public
v2 probe is a usable independently verified endpoint, not a claim that v2 is
the original Windows request.

Product hydration was independently exercised with a three-product public
batch:

```text
POST https://catalog.gamepass.com/v3/products?market=US&language=en-US&hydration=RemoteLowJade0
Content-Type: application/json
Accept: application/json
calling-app-name: Xbox Cloud Gaming Web
calling-app-version: 24.17.63
ms-cv: 0

{"Products":["<Store product ID>"]}
```

The successful response has `Products` keyed by Store ID and `InvalidIds`.
Observed product fields include `ProductTitle`, `PublisherName`, `StoreId`,
`Image_Tile.URL`, `Image_Poster.URL`, `XCloudTitleId`, `Streamability.WithGPU`,
`XCloudOfferings`, `XboxTitleId`, and category arrays. Artwork URLs can be
protocol-relative and must be normalized to HTTPS and validated. `XCloudTitleId`
can be null even when a web offering exists. Resolve a live streaming target
from the authenticated title service; never derive it from the displayed name.

Public collection membership establishes neither ownership nor a subscription
nor permission to launch. In particular, “Stream your own game” is a catalog of
supported purchasable titles, not the current user's owned games.

## How the two open-source projects help

| Project | Inspected revision | Useful boundary | License evidence |
| --- | --- | --- | --- |
| [Greenlight](https://github.com/unknownskl/greenlight/tree/ef852c3b90292def435c8c877feeb1aeaefd8a33) | `ef852c3b90292def435c8c877feeb1aeaefd8a33`, `main-v2` | Separate catalog, account, HTTP signaling and WebRTC player layers; both cloud and console streaming. | [MIT notice](https://github.com/unknownskl/greenlight/blob/ef852c3b90292def435c8c877feeb1aeaefd8a33/LICENSE) |
| [XStreamingDesktop](https://github.com/Geocld/XStreamingDesktop/tree/0e4b661254cdacba2afcecad5fd9ff3068f91beb) | `0e4b661254cdacba2afcecad5fd9ff3068f91beb`, `main` | Current title hydration, streaming-token and session response models, cloud/console controls. | [MIT notice](https://github.com/Geocld/XStreamingDesktop/blob/0e4b661254cdacba2afcecad5fd9ff3068f91beb/LICENSE) |

Both projects supply implementation references beyond displaying the official
website. Their account and HTTP helpers must not be imported wholesale: some
examples log responses/tokens, persist a second account, spoof region headers,
use unbounded retries, or pass tokens through renderer-facing handlers. XBOKS
needs its existing account boundary, bounded requests and own session lifecycle.
This review does not copy their UI or install either application.

Greenlight's desktop package depends on
[`xbox-xcloud-player` 0.2.11](https://github.com/unknownskl/xbox-xcloud-player/blob/34775ed5c4bd85c54a3d50293cd6e1be67675e23/package.json).
The pinned npm metadata identifies MIT, author Jim Kroon, and source revision
`34775ed5c4bd85c54a3d50293cd6e1be67675e23`. The package has no separate LICENSE
file; retain its author, MIT declaration and applicable notice when distributing
it. The reviewed tarball integrity is
`sha512-it21dku4zXA09se2QCLfnE1F8AcP2UBy5UvQskz7bZv08fW49Opy/OmZ/ncsjMT4YjfMCKe+5L4ZkLeWu5+93w==`.
Greenlight also has an experimental monorepo `@greenlight/player` 0.1.0; it is a
different API and must not be treated as the same package/version.

## Same-account implementation boundary

The existing Engine profile adapter already exchanges the signed-in account's
cached legacy credentials for an Xbox user token and a bearer XSTS token. A
separate cloud command can use that exchange with relying party
`http://gssv.xboxlive.com/`, keeping the derived token in process memory. A normal
Xbox social token for `http://xboxlive.com` and the runtime's proof-bound XSTS
token are not interchangeable with this cloud token. Existing login is reused;
missing/expired credentials remain an explicit account state, without launching
another login automatically.

The verified open-source service contract is:

1. POST `https://xgpuweb.gssv-play-prod.xboxlive.com/v2/login/user` with
   `{token: <raw GSSV XSTS>, offeringId: "xgpuweb"}` and
   `x-gssv-client: XboxComBrowser`. A separate free-to-play offering is
   `xgpuwebf2p`; a console-home offering is `xhome`.
2. Validate `gsToken`, `durationInSeconds`, `market` and
   `offeringSettings.regions`. Choose the supplied default region's validated
   HTTPS `baseUri`; do not substitute an arbitrary streaming service URL. The
   separate explicit login-country compatibility setting is described below.
3. Use `Authorization: Bearer <gsToken>` for `/v2/titles` and
   `/v2/titles/mru?mr=25`. Title rows contain `titleId` and `details`, including
   Store `productId`, `hasEntitlement` and supported inputs.
4. Only an explicit Play action creates `/v5/sessions/cloud/play`. Keep the
   returned session ID/path private to the owning main-process session, poll
   its state with a deadline, exchange SDP and ICE, and DELETE that session on
   exit. Keepalive is POST to the session's `/keepalive`; Greenlight's current
   player uses a 30-second interval.
5. React receives normalized catalog/status data and WebRTC SDP/ICE through
   narrow validated methods. It must never receive account tickets, refresh
   tokens, GSSV tokens, cookies, arbitrary authenticated request methods or an
   arbitrary service URL.

Some sessions return `ReadyToConnect` before `Provisioned`. Greenlight's
`streammanager.ts` then sends `/connect` a separately scoped console-transfer
access token (`lpt`). XStreaming's `msal.ts` obtains it with scope
`service::http://Passport.NET/purpose::PURPOSE_XBOX_CLOUD_CONSOLE_TRANSFER_TOKEN`.
The value is an access token, not a raw refresh token or a GSSV/XBL token. That
stage needs its own verified same-account exchange. If unavailable, surface the
unsupported stage rather than polling indefinitely or initiating another login.

The low-level player can create and render a peer connection locally. It does
not require the official website or the library's example HTTP server.
`bind()`, `createOffer()`, `getIceCandidates()`, `setIceCandidates()` and `close()`
are the relevant methods. Its sample backend hardcodes console-home paths and
should not be used for XBOKS cloud signaling.

The 0.2.11 default gamepad driver's recursive timeout is not canceled by
`stop()`. A bounded XBOKS input driver or audited repair is required. Input must
become neutral when focus is lost, an overlay appears, or the session closes;
only one controller-navigation owner should run at a time. Peer connection,
media, event subscriptions, polling and keepalive all need teardown. Do not log
raw SDP/ICE or raw provider response bodies. Unknown system UI requests and
server-initiated disconnects need explicit handling rather than a false
connected state.

The pinned player's packet encoder already converts browser Y-axis direction
to XInput direction. An adapter must preserve browser-axis signs before that
encoder; reversing Y in both places makes vertical controls run backwards.

## Explicit login-country compatibility

The user requested investigation of
[Better xCloud](https://github.com/redphx/better-xcloud/tree/f8397043f6d2148d2345d508902a38c69cf1ee20)
after the current-account offering request returned `InvalidCountry`. Its
[login interceptor](https://github.com/redphx/better-xcloud/blob/f8397043f6d2148d2345d508902a38c69cf1ee20/src/utils/xcloud-interceptor.ts#L49-L54)
adds `X-Forwarded-For` to `/v2/login/user` when a user explicitly chooses a
compatibility country. Its
[fixed mapping](https://github.com/redphx/better-xcloud/blob/f8397043f6d2148d2345d508902a38c69cf1ee20/src/enums/bypass-servers.ts)
contains Poland, United States, Brazil, Japan and Korea. The project is
[MIT licensed](https://github.com/redphx/better-xcloud/blob/f8397043f6d2148d2345d508902a38c69cf1ee20/LICENSE).

XBOKS defaults to `auto`, which sends no country override. Its independent
helper accepts only the five fixed choices and creates a country header only
for the exact paid/free-to-play Microsoft offering-login URLs. A choice does
not connect to the listed address: TLS requests still go directly to Microsoft.
It is not a VPN, does not move media traffic, does not install a proxy, and does
not grant game ownership or a subscription. The streaming origin still must
come from the authenticated offering response and pass its HTTPS-zone checks.

The setting must be visible, optional and reversible. Changing it invalidates
cloud offering/catalog/session state without changing the signed-in launcher
account. There is no arbitrary IP field, custom service URL, third-party token
transfer, or automatic cycling through countries. Local tests verify default
behavior, the finite mapping, malformed-setting rejection and strict endpoint
scoping. Live success or failure belongs in the local acceptance record; this
reference technique alone does not establish that an account can stream.

The borrowed mapping's MIT copyright and permission notice is retained under
`assets/licenses/better-xcloud.txt` and linked from `THIRD_PARTY_NOTICES.md`.

A bounded local acceptance read exercised the existing launcher account with
the explicit Poland choice: offering login, authenticated title enumeration and
MRU each returned HTTP 200. Automatic mode retained the provider's
`InvalidCountry` rejection. The probe did not save a preference, create a game
session, start streaming, store a credential, or launch a second login. Its
private diagnostics remain outside Git. This establishes the account/catalog
path for that selected compatibility choice, not video/audio or game support.

## Evidence still required

Public catalog reads and local protocol fixtures do not demonstrate that the
selected account receives cloud entitlement, a supported region, a provisioned
session, decodable video/audio, controller input or a successful console stream.
Those need live acceptance with the user's account and, for Remote Play, the
Xbox One X. The Windows package's native SDK was inspected statically and was
not executed on Linux. No Microsoft binary code, fonts, account data or private
diagnostics are published with this chapter.
