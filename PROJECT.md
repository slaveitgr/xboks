# XBOKS

XBOKS is an independently maintained Linux gaming client with a familiar,
controller-friendly interface, XBOKS Engine integration, Game Bar and an optional
GNOME Fullscreen Experience.

## Product direction

Use the supplied Windows client/package evidence to implement precise layout,
icons and navigation. Keep the compact vertical navigation rail and put Engine
management and diagnostics in Settings. Product controls must reflect actual
Linux capabilities and provider responses.

Current features and roadmap: [README](README.md).
Screenshots of this application: [gallery](docs/screenshots/README.md).
Reference contracts: [UI specification](docs/analysis/windows-ui-spec.md).

## Development

```sh
npm ci
npm run dev
```

Use `XBOKS_DEMO=1 npm run dev` for sample data. It does not establish real account,
streaming or game compatibility. Run `npm run build`, `npm run test:runtime-tools`
and `npm run test:ci-tools` for the relevant checks.

Preserve existing accounts, games, saves, custom paths and private compatibility
protocols. Keep personal diagnostics and private extracted reference packages out
of Git. Required licenses and source notices are documented in
[Third-party notices](THIRD_PARTY_NOTICES.md).
