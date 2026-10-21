# XBOKS screenshots

These are captures of **XBOKS's own React renderer**, taken on 2026-10-21 at
1920 × 1080. Every gallery image retains a visible fixture watermark. Accounts,
libraries, installation states, messages, media, devices and performance values
are explicit sample data. Main-app game titles and artwork come from anonymous
public Microsoft Store metadata for the exact nine fixture Product IDs. Images
were cached before capture and embedded locally; the capture browser cannot
contact the Store. The Store spotlight also uses an already cached public
Minecraft image.

The screenshots are unmodified PNG exports. They are not screenshots of the
Windows Xbox application, and they do not establish game compatibility, live
account acceptance, physical controller acceptance or operating-system integration.
No real message, purchase, installation, media command, reboot or device setting
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

Remote Play's entry dialog, shown in Greek with the built-in demo profile.
The official player may require a separate sign-in. This fixture does not contact
a console, authenticate or start a stream.

![XBOKS Remote Play entry — isolated demo profile](xboks-remote-play-entry.png)

## Fullscreen Experience

The actual fullscreen renderer with an explicitly synthetic native integration
bridge. This shows the header's fullscreen state; it does not show GNOME panel,
dock, window policy or task-switcher behavior.

![XBOKS fullscreen renderer — synthetic integration bridge](xboks-fullscreen-experience.png)

The actual mode-entry dialog, with safe initial focus and explicit choices.
Restart and fullscreen actions were handled by fixture adapters.

![XBOKS mode entry — isolated restart and fullscreen adapters](xboks-mode-entry.png)

There is no native task-switcher screenshot in this gallery. A bounded private
headless GNOME Shell 51 session could not initialize without system login/time
services. The attempt used temporary HOME/XDG directories and a private D-Bus
session; it did not enable an extension or change settings in the user's desktop.
Native behavior is covered separately by the project's isolated Shell actor and
protocol tests, not by these renderer images.

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
social/system checks. The separate `remote` fixture passed 14 entry/host-control
checks without contacting a console. Their launcher adapters perform no host or Xbox actions;
network requests are restricted to their local fixture origin. The temporary
capture reports remain under ignored `work/xboks-gallery-*` directories.
