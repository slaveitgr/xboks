# xboks Engine: distribution, downloads and provenance

Code audit: 2026-10-21. This describes the launcher and its pinned build recipes;
it is not a network capture of every game, Wine component or external launcher.

The product calls its managed backend and compatibility runtime **xboks Engine**.
That does not change the authorship or licenses of the Xodus, Nexus, Wine, Proton
and other source projects it incorporates. Their actual source URLs and notices
remain in locks, corresponding-source archives, About and the credits.

## Downloads after installation

| Action | Initial origin and assets | Validation / ownership boundary |
| --- | --- | --- |
| Installer bootstrap | Owned `raw.githubusercontent.com/slaveitgr/xboks/main/scripts/installer-release.py` when running the shell installer without its sibling helper; own repository icon | Python standard library validates stable launcher assets, size, SHA-512 and AppImage header before replacing a previous install; bootstrap/icon redirects refused |
| Launcher update | `api.github.com/repos/slaveitgr/xboks/releases`; stable `v<version>` with `xboks-<version>-x86_64.AppImage` and `.sha512sum` | Exact repository/tag/filename URL, bounded size, SHA-512, x86_64 AppImage header, atomic replacement and previous-image rollback |
| Engine backend install/update | Same repository; `backend-v<version>` with `xboks-engine-backend-<version>-linux-x86_64.tar.xz`, `.manifest.json`, `.sha512sum`, `-source.tar.xz` and `-source.sha512sum` | Stable version at/above launcher minimum; exact URLs; source-pair presence; manifest schema/source/recipe fields; archive SHA-512; per-file SHA-256; regular-file layout; Linux x64 ELF; bounded command-help checks |
| Engine runtime install/update | Same repository; `runtime-<version>` with `xboks-engine-runtime-<version>-x86_64.tar.xz`, matching `.sha512sum`, `-source.tar.xz` and `-source.sha512sum` | Exact URLs and one complete asset set for the newest stable runtime publication; bounded metadata/checksum/archive; SHA-512; archive paths; Wine validation before activation; exclusive new release directory, never trusting/replacing a same-name existing directory |
| Optional social companion | Bundled local `social-backend/xboks-engine` with `manifest.json`, `LICENSE` and `source.tar.xz` | No companion download at startup. Local manifest SHA-256 of binary, source archive and license, bounded regular-file reads and `--help` probe; does not replace the selected game backend |
| Public Store/catalog/artwork | Microsoft `displaycatalog.mp.microsoft.com`, `apps.microsoft.com` and metadata-provided artwork CDNs | Service content remains on the vendor origin; catalog data is not proof of ownership |
| Sign-in, entitlements, licenses and game packages | Microsoft/Xbox service endpoints and authenticated package URLs returned by those services | Existing account/licensing verification remains required. Game payloads are not mirrored or relicensed by xboks |
| Friends, presence, search and messages | `profile.xboxlive.com`, `peoplehub.xboxlive.com`, `usersearch.xboxlive.com`, `xblmessaging.xboxlive.com` through the backend | Account/participant-bound adapter; no GitHub binary fetch and no credentials exposed to the renderer |
| Console Remote Play | Microsoft's `www.xbox.com/play/consoles` web client | Dedicated browser session; this is the official web implementation, not an independently implemented native stream |
| VC++ runtime when required | Pinned Microsoft `download.visualstudio.microsoft.com/.../VC_redist.x64.exe` | Version `14.44.35211.0` and exact SHA-256 in `src/main/vc-runtime.ts`; it remains a Microsoft redistributable |

Electron consumer requests begin at the owned repository. Release API redirects
are rejected; asset redirects are followed explicitly only to HTTPS
`release-assets.githubusercontent.com` or `objects.githubusercontent.com`, with
a five-redirect limit and no account credentials. Downloaded bytes must still
match the published checksums. This is not a signature scheme independent of
the repository publisher.

The launcher no longer automatically installs binaries from
`domsvoboda/xodus-nexus` or upstream `xodus-gaming/Proton` Actions artifacts. Both
runtime actions use the owned release channel, without `gh auth login`. If no
complete compatible xboks release exists, installation reports that condition;
there is no fallback to another publisher or automatic source build. Changing
these channels does not publish any release or establish that a stable binary
is available. Tests use synthetic release data and local archives.

Running a game or opening Steam/EA/Epic/GOG/Ubisoft can itself contact that
publisher, download game dependencies or update its software. The audit does not
claim that all code started by a game uses only xboks-owned servers.

## Managed paths and private compatibility names

- Game default: `~/Games/Xboks`; custom locations are preserved.
- Backend: `<xboks profile>/engine/`, with owned release directories and active
  `xboks-engine` / `xboks-engine-service` executable paths.
- Runtime: `<XDG data home>/xboks/engine/runtimes/`, with
  `xboks-engine-runtime-*` release directories.
- User-selected external source, Wine and executable paths remain truthful and
  are not silently renamed. Legacy managed installs have a compatibility
  migration; existing game files are not moved just to change branding.

Backend archive schema 1 still has the exact file keys `xodus-cli`,
`xodus-service`, `LICENSE`, and Cargo still builds those source package names.
After original-file validation, managed installs create byte-checked owned
executable copies. The validated original and installed alias bytes must agree;
an existing modified alias is rejected. Old local social manifests naming
`xodus-cli` remain readable; newly assembled companions name `xboks-engine`.

The runtime keeps `XODUS_NEXUS_PATCH.json`, `files/bin/wine.nexus-original`,
`files/share/xodus-nexus/compat/` and existing `XODUS_*` bridge/configuration
variables because the pinned native loaders and runtime patches use those
identifiers. Credential keyring services, protocol prefixes and older checkpoint
formats also retain their ABI names. These private interfaces are not product
labels, new download channels or a reason to reset credentials. Renaming them
requires a separately tested protocol migration.

## Immutable build inputs

These are fetched by an explicit developer build or CI, not the normal consumer
update action. The locks are authoritative for complete hashes and versions.

| Input | Source and lock | Retained licensing material |
| --- | --- | --- |
| Backend | `https://github.com/xodus-gaming/xodus.git`, commit `53ea781dcd073e31d7ea68e894134e9c959bff04`; `assets/backend-source.lock.json` binds Rust, Cargo.lock and ordered xboks patch hashes | GPL-3.0 upstream LICENSE, patched source, vendored dependencies and offline Cargo configuration in matching source archive |
| Proton base | `xodus-gaming/Proton`, commit `7c0b435495814349735c913fde78da906aecea52`, exact Actions run/archive SHA-512 and Wine/wineserver SHA-256 in `scripts/runtime-base.lock.json` | Source/base provenance retained; does not become an automatic upstream consumer channel |
| Wine / XGameRuntime | `https://github.com/xodus-gaming/wine.git` and `https://github.com/xodus-gaming/xgameruntime.git`; exact commits and patches in `scripts/runtime-patches.lock.json` | Copied upstream Wine and XGameRuntime licenses plus corresponding source |
| HTTP/2 and shaders | `nghttp2/nghttp2`, `codeberg.org/vkd3d/vkd3d`, Khronos Vulkan/SPIR-V headers; same runtime source lock | Component licenses copied into `files/share/doc/xboks-engine-runtime/` |
| DXVK | `doitsujin/dxvk`, DXBC-SPIRV, DirectX/Vulkan/SPIR-V headers, libdisplay-info, Meson and Ninja; exact repositories/commits in `scripts/runtime-dxvk.lock.json` | Source and component license files retained by the assembly recipe |
| Media | `https://ffmpeg.org/releases/ffmpeg-4.4.8.tar.xz`, SHA-256 in `scripts/runtime-media.lock.json`; LGPL shared-library configuration | FFmpeg source archive and `COPYING.LGPLv2.1`, build options and library manifest |
| Build tools | Locked Rust plus Cargo dependencies, Node/npm lock, compiler/system build packages | Build dependencies are not rebranded as xboks source; their normal notices and dependency source licenses remain |

The 0.3.12 local packaging run renamed the already-built, hash-verified social
companion to `xboks-engine` and retained the same corresponding-source archive
and GPL license. It did not rebuild the Rust code or establish a new native
service capability. The generated bundle manifest records those exact hashes. Runtime validation
checks bounded, regular, non-symlink binary, LICENSE and source archive bytes
against that manifest before enabling the companion; missing or corrupt
licensing/source files disable it. This verifies the supplied archive bytes,
not the completeness of their source contents.

No PlayFab Party native library is currently a shipped/working Xbox party voice
adapter. Downloading a public SDK for research does not make it an app runtime
dependency or establish consumer-party interoperability.

## Building and release acceptance

See [`scripts/BACKEND.md`](../scripts/BACKEND.md),
[`scripts/SHARED_RUNTIME.md`](../scripts/SHARED_RUNTIME.md) and
[`scripts/ci/artifact-manifest.mjs`](../scripts/ci/artifact-manifest.mjs).
The build workflows create `xboks-engine-backend` / `xboks-engine-runtime`
candidates with binary/source checksums and `candidate.json`. Promotion verifies
the exact successful main workflow, source commit, recorded candidate validation
and approved notes; it never rebuilds or replaces an existing release's assets.
The runtime's existing experimental/native acceptance gates remain in force.

An owned filename is insufficient evidence. Before distribution, build from the
pinned source/patches, pass the relevant tests, inspect native shared-library
requirements, verify binary/source hashes and retain corresponding source and
licenses. A locally built OpenSSL 4/glibc 2.38 companion is not proof of Ubuntu
22.04 or all-distribution compatibility. This audit changes no installed account,
keyring, game backend or active runtime by itself.
