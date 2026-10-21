# xboks 0.3.12 — xboks Engine

The managed backend/runtime UI now uses **xboks Engine**. Credits for Xodus and Xodus Nexus remain in About, the READMEs and the retained licenses.

- Use owned defaults: `~/Games/Xboks`, `~/.config/xboks/engine` and `~/.local/share/xboks/engine/runtimes` (respecting XDG locations).
- Migrate known managed roots conservatively, preserve custom paths/accounts/game saves/download destinations, and keep legacy aliases/shortcuts compatible. Conflicting directories are never merged.
- Route launcher, engine, runtime and installer consumer downloads to `slaveitgr/xboks`, with checksums, source-pair requirements and explicit GitHub CDN redirects. Missing owned releases do not fall back to upstream binary publishers.
- Use verified owned executable names, retain private runtime/keyring/protocol compatibility, and validate the optional social companion's binary/license/source archive hashes before enabling it.
- Update Steam artwork/tags, generated wrappers, font cache/bootstrap and temporary installation names.

Validation: 1,214 launcher tests, 48 CI tooling checks, 34 runtime tooling checks, 25 renderer navigation/settings checks and 46 social/system renderer checks passed. A local 0.3.12 AppImage was built and booted with an isolated demo profile; packaged companion/source/license hashes were checked.

This source update does not publish engine/runtime binaries. Pinned upstream source inputs remain part of explicit developer/CI builds; see [the download audit](../../docs/engine-downloads.md). The local social binary is an owned-name repack of the existing verified build, with the same source/license, and does not establish broader Linux ABI compatibility or Xbox party voice support.

xboks is an independent, unofficial project. Report xboks issues in [this repository](https://github.com/slaveitgr/xboks/issues).
