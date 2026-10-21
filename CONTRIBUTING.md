# Contributing to XBOKS

Open focused feature or fix pull requests against `main`. Describe the concrete
behavior, reproduction steps, validation and remaining limitations. Source checks
and a merged change do not by themselves establish release or game readiness.

Keep the English and Greek README current. User guides explain setup and use;
release notes describe changes. Put technical reference material under `docs/`.

```sh
npm ci
npm run build
npm run test:runtime-tools
npm run test:ci-tools
```

Keep package versions synchronized. Engine and compatibility-runtime artifacts
have separate versions and locked source manifests. Use disposable fixtures for
accounts, native services and games. Never modify a user's active installation,
wallet, saves or runtime during automated checks. Keep credentials, raw account
diagnostics and private working notes out of Git.

UI changes should include actual application screenshots and keyboard/controller
checks. Distinguish sample data, real service responses and physical-device
acceptance. Preserve compatibility IDs, existing custom paths and required
[third-party notices](THIRD_PARTY_NOTICES.md).

Only main builds distribution candidates. Stable publication requires explicit
maintainer approval of the exact tested artifact, with no rebuild after
validation; the approval record is
[release-validation.json](.github/release-validation.json). Runtime build and
source/license instructions are in [scripts/SHARED_RUNTIME.md](scripts/SHARED_RUNTIME.md).
