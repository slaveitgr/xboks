# MSIX/UWP development

The current production Engine installs and launches Windows.Desktop MSIXVC
games. Ordinary APPX/MSIX packages need a separate delivery, deployment and
activation route. Reading or unpacking their files does not implement that
route. Store installation and launch guards remain unchanged.

## Implemented inspection foundation

After `npm run build`, with Python 3 available:

```sh
npm run inspect:msix -- --package /path/to/game.msixbundle --arch x64
npm run test:msix
```

This account-free command inspects an explicitly selected local file. It does
not download, extract to directories, install, register or execute it.

- The archive reader accepts ordinary APPX/MSIX and bundles with bounded ZIP64
  metadata. It selects an application package for `x64`, `x86` or `arm64`, using
  a neutral application only when appropriate. Resource packages cannot become
  an executable fallback. Logical OPC names and actual encoded ZIP paths remain
  distinct and checked.
- Paths, duplicate names, encrypted/special entries, central-directory extents,
  counts, compressed sizes, XML and nested packages are bounded before use.
  Input opening rejects symlink components and special files. No archive entry
  is written to disk.
- The manifest reader resolves namespace URIs, identity, architecture, declared
  framework versions and target device families. It distinguishes full-trust
  Win32, Win32 AppContainer, UWP and unknown activation. Namespace aliases and
  the presence of an executable do not establish compatibility.
- The JSON report explicitly says `inspectionOnly: true` and
  `gameCompatibilityProven: false`. Signature/block-map presence is reported;
  this command does **not** validate either. Bundle/application identity and
  selected architecture must agree.

Inspection limits are 8 GiB per input, an 8 MiB central directory, 20,000 ZIP
entries, 16 GiB declared expanded data, 1 MiB per metadata file, a 256 MiB
selected nested package, and a maximum expansion ratio of 200. Rejection at
these limits is not a verdict that a larger package is invalid or incompatible.
Encrypted EAPPX is unsupported by this tool.

Code: [archive reader](../../scripts/msix/archive_inspect.py),
[manifest reader](../../src/main/appx-manifest.ts),
[command](../../scripts/msix/inspect.mjs). Synthetic archive/manifest tests run
in CI without accounts or downloaded game content.

## Actual Real Drive Simulator result

The complete command successfully inspected the official bundle, selected its
x64 package and parsed its manifest. It reports UWP/AppContainer activation and
five framework dependencies. The bundle uses ZIP64 and OPC-encoded spaces;
both are handled by the inspector. The [package analysis](real-drive-simulator-package.md)
records the Microsoft source, matching hashes, actual activation class,
.NET Native/XAML requirements and the separate static integrity check.
Game packages, raw manifests, delivery cookies and diagnostic artifacts remain
outside Git.

## Current runtime baseline

The account-free [native probe](../../scripts/runtime-tests/uwp-activation-probe.c)
was compiled as an x64 PE and run in a fresh private prefix using runtime
`11.0-20261020-g8411926d`. No game, account or real display was opened.

| Check | Observed result |
| --- | --- |
| `CoreApplication` through `RoGetActivationFactory` | `0x80040154`, class not registered |
| `CoreWindow` through `RoGetActivationFactory` | `0x80040154`, class not registered |
| XAML `Application` through `RoGetActivationFactory` | `0x80040154`, class not registered |
| Direct `twinapi.appcore` CoreApplication factory | `0x80040111`, class not available |
| Direct `windows.ui.xaml` Application factory | `0x80040111`, class not available |

The direct-provider checks avoid treating missing registration as proof that a
DLL implements nothing. These results diagnose this runtime only. The probe
also contains a bounded failure-only view-source check for runtimes that expose
`ICoreApplication`; factory success or that callback is not a complete UWP
lifecycle, rendering or game-compatibility test.

For reproduction, compile the probe with a MinGW x64 compiler and WinRT headers
(`-std=c11 -O2 -Wall -Wextra -Werror -Wno-cast-function-type`). Run it with an
explicit absolute `WINEPREFIX` in a newly created owner-only directory, a
45-second process deadline and scoped wineserver cleanup. Never reuse an active
game prefix. Preserve the exact compiler, runtime and probe hashes with results.

## Separate runtime candidate and remaining work

The pinned [wine-uwp evaluation](wine-uwp-feasibility.md) provides a concrete
alternative: modified Wine activation/composition plus locally supplied Windows
frameworks. It has not been built or tested with Real Drive Simulator here.
The current runtime's failures do not establish that this separate candidate
cannot work.

The remaining integration needs official package delivery and entitlement,
payload trust/integrity validation, transactional deployment with a verified
architecture/framework graph, and a separate runtime/prefix lifecycle. Require
actual rendered content, input and clean shutdown for the exact game before
changing Store installation support. Keep Engine account/license decisions
independent of the candidate's compatibility stand-ins.
