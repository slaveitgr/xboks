# xboks

Independent Linux desktop client based on https://github.com/domsvoboda/xodus-nexus.
The application source and its original MIT license are in `xodus-nexus/`.

## Direction

Reference selected by the user: **Xbox full screen / Xbox mode**.
Official reference: https://news.xbox.com/en-us/2026/04/30/xbox-mode-pc-windows-11/

Match Xbox mode's layout and interaction patterns: dark neutral
surfaces, green active indicators, persistent navigation, global search, game art,
library filters, game details and download management. Use horizontal navigation,
large game cards and controller focus indicators. Keep Nexus authentication,
ownership checks, installation and runtime integration connected to real data.

This is an unofficial project. It does not imply Microsoft affiliation or that
every Windows Xbox feature or game is supported on Linux.

## First implementation

- Cloned the upstream application rather than replacing its backend with mocks.
- Established neutral dark surfaces, green navigation selection, rectangular
  search and a larger home spotlight as the first desktop visual pass.
- Kept upstream licensing and product identity while the new identity is decided.
- Added horizontal Xbox mode navigation, larger controls/cards, controller focus
  outlines, responsive handheld layout and a full screen toggle.

## Development

```sh
cd xboks
npm ci
npm run dev
```

Validation: `npm run build`. AppImage packaging: `npm run dist`.
For upstream sample data: `XODUS_DEMO=1 npm run dev`.
Demo data is for visual review; it does not verify Microsoft login or game launch.

## Remaining work

1. Compare the Xbox mode reference screenshots screen by screen.
2. Rebuild Home, Library, Store and game details to match those references.
3. Validate real account login, owned/Game Pass catalog, queue and supported game launch.
4. Decide scope for friends/chat, cloud gaming and remote play after checking available APIs.
5. Choose project branding and produce a tested Linux package.
