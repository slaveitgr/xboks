# Xbox PC redesign — November 2026 reference

Status: visual reference and migration requirements, recorded 2026-11-06.
The supplied Windows package `2612.1001.23.0` is undergoing static analysis;
interactive behavior on Windows has not been observed. XBOKS 0.3.28 implements
the desktop-shell, persistent-friends and distinct console-Home foundation
described in the [implementation report](redesign-implementation-2026-11-06.md).
The whole UI migration and Windows parity remain incomplete.

## Primary reference

Microsoft announced the refreshed PC app for Xbox Insiders on
[2026-11-05](https://news.xbox.com/en-us/2026/11/05/a-faster-simpler-xbox-experience-is-coming-to-pc-web-and-cloud/).
The announcement describes changes to navigation, Library, search, social, Home
and Settings, but does not give a Windows package version or a general-release
date. Its performance percentages describe Microsoft's tests of its own app;
they are not XBOKS measurements.

The following official PC images were downloaded and visually inspected:

| Reference | Resolution | SHA-256 |
| --- | --- | --- |
| [Home, initial position](https://xboxwire.thesourcemediaassets.com/sites/2/2026/10/XBOXWire_Bastion_Image1_Header_110526-bb33470068546f1dc696-1600x900.png) | 1600 × 900 | `e48f5137c090cbde316e7d376fada4a3a9267c70bc757851e920fbcb2872f37f` |
| [Home, product preview](https://xboxwire.thesourcemediaassets.com/sites/2/2026/10/XBOXWire_Bastion_Image2_110526-a63599224e109dddcc5d.png) | 1920 × 1080 | `6926116d60853793af8aff28749fb4ed3249429457241003f5599f79ec791d59` |

The article's Image3 and Image4 show web/cloud interfaces. Their Library,
desktop mode and high-contrast options must not be presented as observed
Windows PC controls. Local research copies and their download manifest remain
in ignored `work/redesign-2026-11/`; they are references rather than new product
assets.

## Observed PC structure

The top bar spans the full window. It has the brand and a sidebar-collapse
pictogram at the left, Back beside a centered search field, and a bell and round
profile picture at the right. The search placeholder mentions games and people.
The desktop samples show neither a build label nor clock/battery indicators.

The left side contains three distinct rounded surfaces:

1. Main navigation, ordered **Home, Library, Game Pass, Store**.
2. A persistent **Friends** panel with a search/add field, circular gamer pictures,
   gamertags, presence/activity or last-seen text, and compact people/chat/headset
   controls. The images do not prove their exact click behavior.
3. A bottom **Queue** panel showing installation activity.

The two samples do not show Cloud gaming in this navigation. That does not
establish that Microsoft removed cloud access. XBOKS must retain an accessible
cloud entry until its destination in the new app is verified.

The initial Home image contains a wide recent-game hero, recency/friend details,
and a smaller panel of additional recent games. Below it is a horizontal
promotional carousel followed by landscape product rows. The scrolled image
shows price, discount, Game Pass badge and title beneath approximately 16:9 art.

One product has an enlarged floating preview containing video/art, pause,
favorite, price, subscription inclusion, description, friends and an ESRB row.
No Install or Play button appears in this preview. Opening full product details
and launching a game remain separate actions to verify interactively.

At 1920 × 1080, approximate screenshot geometry is:

| Element | Screenshot pixels |
| --- | --- |
| Top bar height | 48 |
| Main navigation panel | x 15, y 63, width 337, height 266 |
| Friends panel | x 15, y 345, width 337, height 632 |
| Queue panel | x 15, y 993, width 337, height 72 |
| Main content left edge | 397 |
| Promotional tile | 547 × 308, 16-pixel gap |
| Search field | approximately 320 × 35 |

These are image coordinates, not established device-independent CSS sizes. The
1600 × 900 reference scales similar elements differently. Actual Windows scale,
window size and collapsed-sidebar observations are needed before fixing layout
tokens across desktop and controller modes.

## XBOKS differences and migration boundaries

The current `src/renderer/App.tsx` puts the account at the top of `Sidebar`,
orders Game Pass before Library, displays recent games in the sidebar, and opens
Friends as a modal `ShellFlyout`. Its top bar belongs only to `content-shell`.
`HomePage` uses a different resume layout and product-card presentation.
`xbox-mode.css` defaults to a narrow rail. Relabeling or recoloring those elements
would not reproduce the new structure.

Implementation should separate the shared top bar, main navigation, persistent
social surface and Queue, while preserving existing game/product routes and
controller return focus. Friends must use account-bound service results;
presence, unread counts, friend activity and party availability must not be
fabricated from sign-in or marketing examples. The new social backend work is
tracked in [the upstream social comparison](nexus-social-2026-11-06.md).

The Home migration should use live catalog and installed-game metadata rather
than hardcoded titles from the reference. Preview media must pause when hidden,
respect reduced motion, and avoid intercepting the details action or controller
navigation. Friends who play, ratings and subscription badges require their
actual data sources.

The supplied package adds important qualifications to the marketing images:
the rich social dock is feature-gated, while a separate Display layout setting
uses Full Screen/Desktop names independently of the operating system's Xbox
mode. [Static package findings](xbox-package-2612.md) record the exact input,
source locators and evidence limits. XBOKS currently chooses the expanded social variant for
desktop and a controller Home for confirmed native fullscreen or an acknowledged
gaming session. Window fullscreen alone does not establish an integrated GNOME
session or a performance improvement.

Before calling the migration visually or behaviorally matched, verify:

- Windows package version/channel and screenshots of Home, Library, Settings,
  social, search results and collapsed navigation.
- The profile, bell, chat, party and product-preview transitions; keyboard,
  pointer and controller focus/Back behavior.
- Desktop and Fullscreen Experience at representative window sizes and display
  scales, including cloud access and settings overlays.
- Account changes, signed-out/loading/error states, and real social responses.
- Measured XBOKS startup/page behavior separately from Microsoft's claims.

Exact Library filters, Settings rows, new chat/party windows, Game Bar and the
Fullscreen Experience switcher are not established by these two PC screenshots.
Their old implementations should not be replaced with guessed controls.
