# Nexus upstream integration — 2026-10-21

Compared the previously integrated Nexus commit `8411926d` with upstream
[`957a03c7393117439db68ae34c01100dbc017ae9`](https://github.com/domsvoboda/xodus-nexus/commit/957a03c7393117439db68ae34c01100dbc017ae9).
This records a source integration into xboks, not a stable release or live-account acceptance.

The six missing backend patches were added in upstream dependency order, before
the existing optional profile-details and social patches. The xboks Engine lock
retains its own backend version, source commit and complete ordered SHA-256 chain.

| Patch | Result |
| --- | --- |
| `xodus-encrypted-resume.patch` | Preserve complete ciphertext pages during resume; Repair targets incomplete images without replacing unrelated files. |
| `xodus-launch-image-errors.patch` | Reject incomplete launch images with bounded actionable errors and preserve inherited image descriptors. |
| `xodus-keyring-unlock.patch` | Use the provider's native parented prompt with bounded cancellation, provider-owner checks and metadata-only status. |
| `xodus-keyring-session-stop.patch` | Stop only a verified launcher-owned wallet provider with matching process, user and service scope. |
| `xodus-keyring-persistence.patch` | Flush optional KWallet writes through an owned watched session; leave other providers and their lock state alone. |
| `xodus-keyring-create.patch` | Explicit first-wallet setup uses the native provider prompt and preserves existing collections. |

The launcher now connects these capabilities to visible, current wallet requests.
Startup preparation is attempted once only for an eligible visible Game Mode
window; late account/backend/window changes discard stale results. Explicit
sign-in, install and shortcut preparation reveal a parent window when needed.
Cancellation keeps account state intact. The account service maps only recognized
credential diagnostic codes to fixed messages; raw stderr and account data are
not displayed. Existing nonblocking launcher startup and xboks executable wrappers
remain in place.

The runtime-lock diff was only upstream's `development` → `release` status change.
The xboks runtime retains its own development status and provenance; this audit
does not replace, rebuild or validate a Proton runtime.

xboks branding, Engine paths and public product identity remain independent.
Owned wallet service units use `xboks-keyring-…`. Internal upstream crate/binary
names, patch filenames, diagnostic markers such as `NEXUS_CREDENTIAL_ERROR_V1`,
and existing credential protocol identifiers remain compatibility boundaries.
The integration neither renames stored credentials nor substitutes a second
backend provider.

## Offline verification

The pinned source and complete 40-patch chain applied in a disposable build tree.
`work/engine-v40/build.log` records a locked offline optimized backend build,
command/help checks, binary provenance and a corresponding-source archive.
The successful filtered runs recorded these counts:

| Run | Passed |
| --- | ---: |
| CLI | 97 |
| Credential persistence | 23 |
| Content licensing | 10 |
| Ticket diagnostics | 1 |
| Service Store logic | 15 |
| Streaming | 23 |
| Cached streaming metadata | 5 |
| Serial bandwidth probes | 2 |
| Package metadata | 6 |

These are **182 passing test executions**, with overlap between filtered runs;
they are not a count of unique regressions. Two bandwidth tests skipped by the
broad streaming filter ran successfully in the explicit serial ignored-test run.
The four serial native-wallet filters also passed against disposable private D-Bus services: unlock 9, owned-session stop 7, persistence 5 and creation 3 (24 additional executions). Their test bus and synthetic fixtures never accessed the signed-in desktop wallet. Backend policy checks verify all six new patches, their boundaries and the owned service prefix.

No live account authentication, real wallet migration, game launch, cloud-save
round trip or production download was used to establish this build result.
