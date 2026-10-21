# Product-page Cloud action

Pinned original input: **Microsoft.GamingApp 2610.1001.20.0 x64**, Hermes v96.
This is a bounded static trace. It does not establish every feature flight or
runtime combination of the Windows client.

## Exact resources and action presentation

| Resource | English | Greek |
| --- | --- | --- |
| `Cloud_Play_Button_Label` | Play with Cloud | Αναπαραγωγή με το Cloud |
| `Cloud_Play_Button_Subtitle_With` | Available with {1} | Διαθέσιμο με {1} |
| `Cloud_Play_Button_Subtitle_MultipleServices` | Available with {1} services | Διατίθεται με {1} υπηρεσίες |

F57301 `useCloudPlayCtaOperation`, bundle offset **17118681**, selects the
product's `ProductActionKind.CloudPlay` action (39–70), available streaming
services (106–112), and action program (134–149). It calls the Cloud-play logic
and render-state hooks, then creates an operation with the Cloud icon,
activation handler, disabled state, subtitle and accessibility label (422–582).
The product action's `displayData.title` can override the default localized
label (235–277); the label is not inferred from the Game Pass tier.

F57300 `getCloudPlaySubtitle` distinguishes one available service from multiple
services. It can preserve an action-supplied subtitle, resolve the Xbox Cloud
Gaming or GeForce Now display name, or format the service count (6–213).
XBOKS must not claim another provider is integrated merely because that provider
appears in the original shared action builder.

## Selected product-button visibility

F55600 `useCloudPlayButtonRenderState`, bundle offset **16831283**, reads
installing, uninstalling and installed status, followed by
`useIsCloudStreamingAvailable(productId)` (10–112). Its selected branch is:

1. Return the pending render status when installed status is not ready
   (121–132, 205).
2. Hide during installing or uninstalling, or when normalized installed status
   differs from `InstallState.None` (135–156, 188–203).
3. Otherwise show only when streaming availability is true (164–186).

The separate F55599 `useXCloudPlayRenderState` also reads product streaming
access, account identity mismatch, Cloud-enabled and Cloud-only status. F55373
`XCloudPlayCTA` is a different Cloud-oriented component: it resolves the title
through `streamingId` / `XCLOUDTITLEID` and uses the generic `Button_Play` label
with a Cloud icon. These branches must not be collapsed into a claim that one
button is always visible for every installed, Cloud-only or catalog product.

## Activation and account restrictions

F57295 `useCloudPlayLogic` reads the product summary, default streaming-service
setting, content rating, computed Xbox title ID and allowed-to-play hook
(50–190), and returns a disabled state plus `onCloudPlayPress` (445–449).
F55885 `useIsAllowedToPlayXCloudGame` reads signed-in, adult and family-safety
state, using content rating and computed title identity (35–254).

F57297 validates age for the product before choosing a service (397–411).
Depending on default-service preference and available services, activation may
open a service picker (470–668). The server's title/action availability and
account authorization remain separate from public catalog membership or a
profile's subscription badge. An Ultimate badge alone is not proof of access
to this title, and an unauthenticated public catalog is not an owned-game list.

Raw annotated instructions remain in ignored local evidence. No original
application binary, artwork or extracted implementation is distributed with
this trace.
