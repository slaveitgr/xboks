# XBOKS screenshots

The launcher and Game Bar images capture **XBOKS's own React renderer**, taken
on 2026-10-21 at 1920 × 1080. The cloud UI was captured in an isolated Electron
browser on 2026-10-22; the native task switcher uses a private GNOME Shell 51
session from that date, as described below. Every
gallery image identifies its sample environment. Accounts,
libraries, installation states, messages, media, devices and performance values
are explicit sample data. The initial launcher gallery's titles and artwork come from anonymous
public Microsoft Store metadata for the exact nine fixture Product IDs. Images
were cached before capture and embedded locally; the capture browser cannot
contact the Store. The Store spotlight also uses an already cached public
Minecraft image.

The screenshots are unmodified PNG exports. They are not screenshots of the
Windows Xbox application, and they do not establish game compatibility, live
account acceptance, physical controller acceptance or integration in the user's desktop.
No real message, purchase, installation, media command, reboot or host device setting
was executed to make them.

## Launcher

Home with sample recent games and featured products.

![XBOKS Home — isolated sample library and catalog](xboks-home.png)

Library with sample installed, imported and incomplete states. These labels do
not report games installed on the capture machine.

![XBOKS Library — isolated sample installation states](xboks-library.png)

Store with the actual XBOKS product grid and navigation. Its returned page and
access labels are fixtures, with exact-ID public titles and artwork; no purchase
or game download occurs.

![XBOKS Store — isolated sample catalog](xboks-store.png)

Game details, launch controls and sample activity. Displayed play time is a
fixture, not measured gameplay.

![XBOKS game details — isolated sample metadata](xboks-game-details.png)

Settings with all nine categories. Changing the fixture's controls cannot change
desktop autostart, the system tray or the installed application's settings.

![XBOKS Settings — isolated renderer controls](xboks-settings.png)

## Cloud gaming

These captures show the actual XBOKS Cloud library and session components,
composed with the production navigation rail and header. They are not captures
of an external website. Fourteen exact-ID public Game Pass metadata/artwork
records were cached anonymously before capture. The fixture's collection
membership/order, account, access rights, input capabilities, recent play and
single sign-on result are samples. They do not establish ownership or cloud
availability for a real account.

![XBOKS Cloud Gaming — public artwork and sample account](xboks-cloud-gaming.png)

![XBOKS Stream your own game — sample cloud collection and access](xboks-cloud-own-games.png)

Cloud settings, with an unsaved sample Poland choice. The country preference
starts at Automatic and is saved only by its explicit Save action. Its fixture
adapter changes no host preference, network route, subscription or real account.

![XBOKS cloud settings — sample country preference, no host or account changes](xboks-cloud-settings.png)

Product-specific details preserve the selected ID, real public title/artwork
and synthetic detail text. Opening a card does not start a session.

![XBOKS cloud game details — exact-ID public artwork and sample detail response](xboks-cloud-game-details.png)

The queue shown below is an explicit fixture response to Play, including its
sample estimated wait. No Xbox stream, service session, SDP/ICE exchange or video
connection was created.

![XBOKS cloud session queue — synthetic session response, no stream](xboks-cloud-session-queue.png)

The isolated smoke run passed 51 checks: catalog failure/retry, cloud search,
sort and input filters, controller selection, product details and Back focus,
entitlement denial, explicit and serialized Play/stop, stale detail/stop results,
signed-out account invalidation and subscription cleanup. Country settings are
also exercised from the Cloud page and the actual Application Settings page:
default choice, nested controller picker/Back, visual stacking, Cancel, rejected
and serialized Save, and invalidated Play readiness during account refresh.
It uses temporary
HOME/XDG paths, disconnected D-Bus and a localhost-only browser network boundary.
These tests do not prove real single sign-on, account-token clearing, game access,
physical controller behavior or end-to-end streaming. See the
[cloud capture provenance](cloud-ui-provenance.json).

The following captures load the complete production `main.tsx` and `App`, with
its normal providers, appearance settings and fullscreen/header effects. They
verify the expanded sidebar does not get covered by fixed Cloud details. The
same shared layout dimensions also align the compact rail and narrow viewports.

![XBOKS full App cloud search — expanded sidebar and sample account](xboks-cloud-search-expanded.png)

![XBOKS full App cloud details — expanded sidebar and public Forza artwork](xboks-cloud-detail-expanded.png)

![XBOKS full App cloud details — compact sidebar](xboks-cloud-detail-compact.png)

![XBOKS full App cloud details — sample Fullscreen Experience state](xboks-cloud-detail-fullscreen.png)

The full-App runner passes 32 checks with cached public artwork and again with
its fresh-checkout generated-art fallback. Account changes back to an earlier identity also require a fresh access check. Search finds a matching title beyond
the initial 60 entries, filters before pagination, debounces typing and shares a
three-request metadata pool across route changes. It also exercises the real
CatalogDetails and installed GameDetails Cloud actions: direct/mapped exact IDs,
current-account entitlement, late-account results, English/Greek labels and
serialized activation. Account rights, native fullscreen/battery state and three
explicit streaming acknowledgements are inert fixture responses. No real
account was read and no Xbox session or game was started. See the
[full-App capture provenance](cloud-layout-provenance.json).

## Game Bar and social

The Game Bar widget directory, shown in Greek. This is the actual overlay
renderer against an empty fixture background, not a capture over a running game.

![XBOKS Game Bar — Greek widget directory fixture](xboks-game-bar.png)

Spotify controls with synthetic track metadata and a pinned Performance widget.
No real player was contacted. CPU/GPU/RAM values are samples; unavailable FPS
remains unknown and is not a benchmark.

![XBOKS Spotify — Greek sample player and metrics](xboks-spotify.png)

Audio controls with sample outputs, microphone and application streams. The
microphone is stopped; no physical device was changed or captured.

![XBOKS audio — Greek sample devices and mixer](xboks-audio.png)

Performance with explicitly synthetic device samples and unknown FPS. This
demonstrates the widget's presentation, not performance gains or game telemetry.

![XBOKS performance — Greek synthetic samples](xboks-performance.png)

Captures gallery with one generated sample image and opaque fixture capture ID.
No desktop screenshot was taken and no user file was opened or deleted.

![XBOKS captures — Greek generated gallery fixture](xboks-captures.png)

Social conversation with synthetic users and returned fixture messages. Deleted
and filtered-message placeholders are shown by the real message component.
No Xbox request or real message delivery occurred.

![XBOKS social — isolated sample conversation](xboks-social.png)

System controls with synthetic network/device state. Their adapters acknowledge
fixture actions only; these screenshots do not show the capture machine's Wi-Fi,
Bluetooth devices or power configuration.

![XBOKS network controls — isolated sample connections](xboks-network.png)

![XBOKS Bluetooth controls — isolated sample device](xboks-bluetooth.png)

Restart confirmation, initially focused on Cancel. No system action occurs.

![XBOKS power confirmation — isolated action adapter](xboks-power.png)

## Console Remote Play

The current native console picker uses the signed-in launcher account and local
console capabilities. The actual component shows returned model and power-state
labels, a separate Connect action, safe retry and automatic quality negotiation.
The account, four consoles and their availability in this capture are explicit
samples; they are not devices discovered on the capture machine.

![XBOKS native console picker — sample account and consoles](xboks-console-remote-play.png)

The actual native stream host after a synthetic provisioning response, followed
by its safe connection-failure recovery. No iframe, web player, console transport
or decoded video is used in these captures.

![XBOKS native console connection — synthetic provisioning response](xboks-console-connecting.png)

![XBOKS native console recovery — synthetic failed response](xboks-console-connection-error.png)

The isolated runner passed 35 checks covering safe list retry, empty/signed-out/
unsupported states, exact console identity and power labels, selection versus
explicit Connect, pending-start cancellation with B, stale account/list/start/
stop responses, modal focus, Game Bar/window-focus takeover, shared input
ownership and listener cleanup. Existing cloud browsing still passed 51 checks.
These checks do not establish real console SSO, standby wake, session creation,
SDP/ICE exchange, decoded video, physical controller or microphone acceptance.
See the [console capture provenance](console-ui-provenance.json).

The previous 0.3.23 web-host entry is retained below as a historical snapshot;
it is not the current native console flow.

![XBOKS previous Remote Play entry — historical sample profile](xboks-remote-play-entry.png)

## Fullscreen Experience

The actual fullscreen renderer with an explicitly synthetic native integration
bridge. This shows the header's fullscreen state; it does not show GNOME panel,
dock, window policy or task-switcher behavior.

![XBOKS fullscreen renderer — synthetic integration bridge](xboks-fullscreen-experience.png)

The actual mode-entry dialog, with safe initial focus and explicit choices.
Restart and fullscreen actions were handled by fixture adapters.

![XBOKS mode entry — isolated restart and fullscreen adapters](xboks-mode-entry.png)

The native task switcher uses the production `XboksSwitcher`, selection, theme
and stylesheet in **real GNOME Shell 51**, with native `St` actors and live
`Clutter.Clone` window previews. The selected window runs the actual XBOKS React
renderer in Electron, natively fullscreen on the private compositor, using the
same sample launcher bridge and cached public artwork as the gallery. Notes and
Music are explicitly sample GTK windows. Their previews are live window content,
not composited images of the Windows app.

![XBOKS native task switcher — private GNOME Shell 51 and sample windows](xboks-task-switcher.png)

The same native component after the private desktop preference changes to light.
The colors change through the production theme adapter; the PNG is not recolored.

![XBOKS native task switcher — private GNOME Shell 51 light preference](xboks-task-switcher-light.png)

The capture uses an isolated headless Wayland compositor with its own Xwayland
display, temporary HOME/XDG directories, and private session/system D-Bus. A
temporary extension entry point opens the unchanged production switcher and adds
the visible provenance label. It does not exercise the production mode-entry
lease, startup/reboot path or physical controller. Only the private display is
captured; no host desktop, account data, user windows or background applications
are read. No extension or setting is changed in the user's desktop. The public
images alone do not establish live desktop acceptance. The
[capture provenance](native-switcher-provenance.json) records component and image
SHA-256 hashes and the isolation boundaries.

## Capture provenance

The main-app fixture uses `scripts/ui/reference-app-smoke.mjs`; this gallery adds
captures at the existing Library and English fullscreen/mode-entry states and
shows package version 0.3.23. The offscreen Electron runner used
`--ozone-platform=headless`, temporary HOME/XDG paths, disconnected session/system
D-Bus addresses and a localhost-only network boundary. Launcher API adapters and
account/install states are fixtures. Before capture, one bounded anonymous request to
Microsoft's [DisplayCatalog product records](https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds=9N26X2PMTWBT%2C9P2N57MC619K%2C9PJTHRNVH62H%2C9N431PX143P8%2C9NPKGVXPFRSX%2C9P74BRFBXXC6%2C9PM3J18QM4Q3%2C9NGLST31DG26%2C9N4PT8HGCDHQ&market=US&languages=en-us%2Cneutral)
matched nine exact Product IDs. Only official `store-images.s-microsoft.com` or
`store-images.microsoft.com` image URLs were accepted, with at most cover and hero
art per product and three Forza screenshots: 21 images, 3,118,729 bytes total.
Provider titles, including edition suffixes, remain bound to those same IDs.
The browser receives cached image data URIs and retains its localhost-only
network boundary. Its 53 renderer checks passed without browser errors
or forbidden API calls.

The widget and social images use `scripts/ui/social-system-smoke.mjs` with its
`widgets` and default fixtures. Those runs passed 37 widget checks and 48
social/system checks. The current `remote` fixture redirects to the native console fixture described
above; its preceding web-host version passed 14 entry/host-control checks. Their launcher adapters perform no host or Xbox actions;
network requests are restricted to their local fixture origin. The temporary
capture reports remain under ignored `work/xboks-gallery-*` directories.
