# xboks

Independent Linux client derived from [Xodus Nexus](https://github.com/domsvoboda/xodus-nexus), using the Xodus/Nexus backend and runtime foundation.

## Product direction

The user-supplied Windows Xbox app 2610.1001.20.0 screenshots in Xbox mode are the visual source of truth. Target 1:1 appearance and interaction. The reference uses a compact **vertical 68 px icon rail**, not horizontal main navigation. Xodus/Nexus are the backend foundation; keep diagnostics in Settings and omit backend health/development controls from the main top bar.

Current implementation and limitations: [README](README.md).
Detailed reconstruction work: [UI specification](docs/analysis/windows-ui-spec.md).
Package evidence: [analysis](docs/analysis/xbox-2610-initial.md) and [inventory](docs/analysis/xbox-package-inventory.json).

## Development

```sh
npm ci
npm run dev
```

Visual preview: `XODUS_DEMO=1 npm run dev`. Sample data is not account/game validation.
Type checks: `npm run typecheck`. Full validation/build: `npm run build`.
AppImage: `npm run dist` after validation.

## Scope and attribution

Preserve the upstream MIT notice and credit Xodus and Xodus Nexus. xboks is unofficial and independently maintained. Real account authentication, installation and game launch require separate validation. Original Microsoft package files and personal screenshots stay in ignored `work/reference`; they are not distributed.
