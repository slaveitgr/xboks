# Original Xbox installer: packaging inventory and implementation plan

Checkpoint: 2026-11-08. This is an inventory and proposed installer layout,
not an executable installer or a release-readiness claim. The current original
client is an experimental, locally prepared Wine-UWP deployment. Its original
Home, menus and native Xbox mode entry have been observed; see the newer
[mode checkpoint](original-xbox-mode-bridge-2026-11-08.md). Earlier pending-state
language in the [reproduction notes](wine-uwp-client2612-reproduction.md) is not
the latest acceptance record. Cloud streaming, game installation/execution,
performance and a clean-machine installer remain separate acceptance gates.

## Package boundary

Build a **separate original-client runtime/installer**, independent of the
XBOKS game engine and its prefixes. The downloadable `.deb` or AppImage can
contain the rebuilt Wine-UWP runtime, our source-backed patches, setup and
supervision code, supported-component manifest, icons we can ship, and the
matching source/license notices. It must not be assembled by copying the
existing working prefix or the entire research directory.

Microsoft inputs are selected/imported on the user's machine:

| Input | Use | Included in our release artifact? |
| --- | --- | --- |
| Original `Microsoft.GamingApp` MSIX bundle | Original executable, UI, metadata, manifests and app assets | No; user supplies it |
| Supported Windows ISO or explicitly supported extracted tree | Harvest the required original Windows components | No; user supplies it |
| Windows DLLs, fonts, MUI resources, WinMD metadata and clean image hives | Prefix setup and native framework dependencies | No; locally harvested |
| VCLibs, XAML and Windows App Runtime packages | Package-aware identity and framework graph | No; locally imported from the supported source |
| Genuine WebView2 runtime | Original CE rendering dependency | No; locally imported and checked |
| Existing account store, Wine prefix, browser state, tokens, saves and private logs | User-specific mutable state | Never copied into a release |
| PDBs/symbol cache, diagnostic screenshots and original game payloads | Research/diagnostics only | No |

The upstream `packaging/build-dist.sh` explicitly assembles a Wine/runtime tree
without Microsoft's files, and its `packaging/README.md` separates local image
harvesting from the distributable runtime. Retain that boundary. This inventory
does not grant redistribution permission for third-party payloads.

## Exact candidate identities

The source baseline is Wine commit
`7298a818b79446bae153b8d5aa27235ab3703bf9` plus the complete
[designgears/wine-uwp overlay](https://github.com/designgears/wine-uwp/tree/ac56cede08bbb99c5b88dd7b54e752f709cd6b47)
at `ac56cede08bbb99c5b88dd7b54e752f709cd6b47`. The reproduction guide names
the ordered patch series. The current portable patch bytes are:

| Patch under `docs/analysis/patches/` | SHA256 |
| --- | --- |
| `wine-uwp-shared-services.patch` | `9731424f70a03ebe015276ef130abd6ac72d81fc2d817ff7c9febc4af644097f` |
| `wine-uwp-process-aumid.patch` | `f660bc4d05281a31a4c31126aba34e88bbf382a893cbfb822aebfcc7ec3a1ee0` |
| `wine-uwp-package-manager3.patch` | `4017ccd58f34686c3b52d3f15e1f6a40e626ca59237ce244ec6ad59addb16fc5` |
| `wine-uwp-gameplatform2612.patch` | `fd43030b310b18404ddeb3328d0a53bb49a60b8287424595608b4bb3aea4dd93` |
| `wine-uwp-auth2612.patch` | `9c23ae99522c9fc7f43872839b1c6b48b5bd9c7320f914f4f580dda8f10bce83` |
| `wine-uwp-media-weakref.patch` | `fee132f743c5f219ab84f8b6a16ebe1a811922f605786ed28f3b0108620751aa` |
| `wine-uwp-activation-broker.patch` | `58fdb23889f5574818aa25d16a3a2c5b8bad38b9c72ab0b16008f1ffc5dbf6a1` |
| `wine-uwp-launch-activation.patch` | `3c77eeb94170168addd501e5b5f8f84efa83c078e010160028cb8f4226f13d44` |
| `wine-uwp-webview-windowed-capture.patch` | `5be0965a01abf6f064afb86b8a658676749bf0a8410f5f95d0f2ef02eb55b03f` |
| `wine-uwp-gaming-experience.patch` | `bb388a7ab912aebba8908d3423667488fb99e9133519fed118924f4856001605` |

The inspected mode distribution contains 988 regular-file entries, including
34 ELF files. That count includes followed file symlinks and is an inventory
aid, **not a complete release manifest**. Key compiled artifacts currently bind
the passing candidate as follows:

| Artifact relative to Wine distribution | SHA256 |
| --- | --- |
| `bin/wine` | `f587f6d81088037b41e776a0931a39ca697f44f4c184caef3ac8f8e8dca6dcb9` |
| `lib/wine/x86_64-windows/wineuwp.dll` | `3e5dddbb5ca744ad52d09f7029db0408813efe53041993f13e58057f5a563ec2` |
| `lib/wine/x86_64-windows/wineuwp-launch.exe` | `fd52b0a22e2a062898fe6a890fb8021b9b917f92292c1ced93ba6d9820cd0b9e` |
| `lib/wine/x86_64-windows/webview2host.dll` | `19056c8bd9e4ab6ccd2443e89061f059414dd057e6cdd999bb73a2579738b032` |
| `lib/wine/x86_64-windows/gamemode.dll` | `4bc4364d7ad13c640b59b348051c65de42e19c28ed7bd241fc4df0092fc0835f` |
| `lib/wine/x86_64-unix/gamemode.so` | `1f42688e4a90e437ca41aeb3697554096647b6faec7c25be5f32a0107dd7b15d` |
| `lib/wine/x86_64-windows/apisetschema.dll` | `6ebcef42573658d3aa17de3e00103c8723d0a6c61e24c10bb3d8bb23bc541298` |
| `lib/wine/x86_64-windows/winegameplatform.dll` | `611200653c652ee30a3a545248e9c27119cd72d1d7614398cf553caf4d32f31e` |
| `lib/wine/x86_64-windows/winexboxauth.dll` | `3117f04a43e376770ed01903820b5884c22f89cda9bde5a45548ccda6748a48f` |
| `lib/wine/x86_64-windows/windows.media.playback.mediaplayer.dll` | `da9886dd0aff8093abdc68692989eb1d54a51744af1a8ef5c890d638a19064a8` |

The tested original inputs include:

| Original Microsoft input | Identity / SHA256 |
| --- | --- |
| GamingApp bundle | `2612.1001.23.0`; `a44c5bb5bc33df73453189e9773485b7da246678ad8574c046c69225142074cb` |
| `XboxPcAppCE.exe` | `dc50e62227838178c6f8b1e42463cd2b4a7f4b4f55dfc4b0e672d71a8fed0d89` |
| Native `ExecModelClient.dll` | `ec4d60736232252bbb48378c75bb3ae683561255835296bf2a91861708ba9c5a` |
| WebView2 `msedgewebview2.exe` | `152.0.4191.66`; `3437ea2f12904b7b7be82c228f137c0631439e9a40cda5da3970615f825d6d74` |
| Genuine WebView2 client DLL, preserved as `EmbeddedBrowserWebView.real.dll` | `8859f59ee9b162f5ad89dfae740a0410b946fe74c14323c310f01b1fd6f996ee` |
| Windows source image | Windows `26300.9457`, x64, en-GB; recorded ISO size `9,061,271,552` bytes |

The inspected WIM-extraction proof records the ISO size, not an ISO SHA256.
Freeze the exact full ISO digest and selected WIM image index before making a
supported-input manifest. A byte size or filename is insufficient.

The exact four selected x64 framework versions are VCLibs `14.0.33519.0`,
VCLibs UWPDesktop `14.0.33728.0`, UI.Xaml.2.8 `8.2511.26001.0`, and
WindowsAppRuntime.2 `2.2.0.0`. Their original manifest hashes were independently
checked in the retained strict-framework proof. Framework-directory discovery
must validate architecture, package identity and minimum version rather than
silently choosing a similarly named package.

## ISO-derived corrections that must become setup code

The current successful setup does more than extract an EXE:

1. Harvest the required original components, manifests and frameworks. The
   private Xbox harvest list has 2,691 non-comment paths/patterns, SHA256
   `1ef75fb322f801cceea3292511d0d600dd6f82f832aa22a4ea0b51d2d4aa833d`.
   It is a research input, not yet a published supported-component manifest.
2. Match localization to the actual image. The private `prepare_config()`
   transforms the upstream UTF-16 globalization registration from en-US to
   en-GB, including keyboard layout and preferred UI language, then copies the
   image's genuine en-GB resources. The 846-line resource-list SHA256 is
   `9b8add963831145fced6a6a7b61b01e4c03d360f3e2f602f670e22fb0b7d2186`.
   Do not rename en-GB resources to en-US or patch Microsoft DLL bytes.
3. Install the genuine missing execution-model provider/registration, while
   retaining the source-backed Wine broker fixes. A Windows DLL alone did not
   fix the earlier native initialization failure.
4. Explicitly install and verify WebView2. Upstream's setup stamp initially
   omitted the optional WebView2 input, so setup returned zero without installing
   it. Invalidate/setup by a complete manifest of all inputs, not that old stamp.
5. Preserve the genuine WebView2 DLL under its `.real.dll` name and install the
   tested Wine proxy at the expected host locations. Verify all bytes after
   setup; never overwrite an unverified symlink target.
6. Regenerate the framework graph and Windows search paths for the chosen data
   directory. The relocated CE stage failed without the Windows App Runtime
   manifest; setting the package-only graph inside the PE launcher's defaults,
   after its initialization, repaired that failure. Applying those search paths
   globally to registry/setup utilities caused a different failure.
7. Install the new Wine `gamemode.dll` into an existing prefix's System32 during
   migration, then verify its hash. Fresh-prefix probe success had masked this
   existing-prefix migration requirement.
8. Generate CE identity and the original new-experience preference through the
   verified activation route. Do not alter the original manifest or executable.

The current locale transformation and orchestration are private Python source,
not part of the ten portable Wine patches. Export them into reviewed, generic
installer modules with fixtures before claiming that the patch series alone
reproduces the installed client.

## Host dependencies and current portability limits

Static `readelf` inspection of the 34 ELF files found a maximum referenced
symbol version of **`GLIBC_2.38`**. This applies to the inspected binaries; it
does not establish a minimum for every possible rebuild. The current build is
**x86_64 only**, configured with `--enable-archs=x86_64 --disable-tests`. It is
not an ARM64 or WoW64 runtime.

Direct ELF dependencies include glibc, libgcc, X11/Xext, ALSA, udev, Kerberos,
Wayland client/EGL, xkbcommon and xkbregistry; `ntdll.so` and `win32u.so` are
provided by Wine itself. Build configuration also names dynamically loaded
libraries, including `libdbus-1.so.3`, GnuTLS, Vulkan, GL/EGL, fontconfig,
FreeType and XComposite/XCursor/XFixes/XInput/Xinerama/XRandR/XRender.
`gamemode.so` loads D-Bus dynamically, so its short ELF `NEEDED` list is not a
complete dependency check. Resolve the full transitive distribution package
list in the actual package build, including these runtime-loaded libraries.

The present launcher additionally uses Python 3, `python3-dbus`, `wmctrl`,
`xprop`, `notify-send`, `gio` and a normal X11/Xwayland display. It validates the
user session bus and runtime directory; the tested CE path explicitly selects
X11 and removes the Wayland display variable. Pure Wayland presentation is not
accepted merely because the Wine tree contains a Wayland driver.

The recorded baseline build disabled C FORTIFY and used `-O2 -g0`; its C++ and
pkg-config search paths referenced private toolchain wrappers. Optional
PulseAudio, GStreamer, FFmpeg and SDL components were unavailable in that build.
Record/reproduce the compiler, sysroot, header/library versions and build flags
in a clean build environment before freezing a distributable runtime. Do not
advertise this local binary as a universal AppImage or validated multimedia/
gameplay runtime.

## Private-launcher dependencies that block a portable installer

The existing desktop launcher is relative to a private `observation/` tree.
Its runner requires specific research result files and prepared-prefix
provenance. None should be copied into a public installer as a substitute for
performing and checking setup:

- Interactive startup requires a previous bounded rendering trial's result
  and matching activation, launcher, mode fixture and client-profile proofs.
- The framework graph is read from the older original stage, not generated
  exclusively from the new installation's inputs.
- WebView2 is read from a fixed cache layout/version and native Windows files
  from the research Windows tree.
- `experimental_profile.py` imports additional old probe/result paths and
  binds both distribution and prefix files. Its apply/restore journal is useful
  behavior, but its current path/proof contract is research-specific.
- Enrollment is imported by walking from the private tree back to the source
  repository. It needs an installed, versioned module instead.
- The supervisor imports cleanup and sign-in modules from the private lab and
  checks a diagnostic capture helper even when interactive screenshots are off.
- Desktop entries and generated `launch.env` files contain absolute research
  paths. Rebuild them for the selected installation root; preserve argument
  boundaries without evaluating shell text supplied by an app package.
- The prepared prefix was copied from an earlier client prefix. That is not
  clean first-run provisioning and cannot be used as a distributable template.

The original-client supervisor must keep its exclusive prefix lock and survive
for the full app session. Registry apply/restore, interrupted-start recovery,
exact PID/start-time enrollment, and owned-prefix cleanup need to remain
transactional when moved out of the lab. A service label or account sign-in
must not be treated as permission to control the desktop.

## Proposed `.deb` layout

Use a new package name such as `original-xbox-runtime` (proposal, not an
existing package), initially `amd64` for explicitly tested distributions:

```text
/opt/original-xbox/runtime/<runtime-id>/       read-only patched Wine distribution
/usr/lib/original-xbox/                      installer, launcher and supervisor
/usr/share/original-xbox/manifests/           signed/versioned input and output rules
/usr/share/doc/original-xbox-runtime/         licenses, source/build provenance
/usr/share/applications/original-xbox.desktop installer/launcher entry

$XDG_DATA_HOME/original-xbox/windows/         locally harvested Microsoft components
$XDG_DATA_HOME/original-xbox/packages/        locally imported app/framework payloads
$XDG_DATA_HOME/original-xbox/prefixes/<id>/   new private per-user prefix
$XDG_CONFIG_HOME/original-xbox/              selected inputs and runtime configuration
$XDG_STATE_HOME/original-xbox/               private transaction journals and logs
$XDG_RUNTIME_DIR/original-xbox/              session locks and short-lived state
```

System installation installs only owned runtime/setup code. Run harvesting,
prefix creation and Microsoft sign-in as the logged-in user, not from a root
post-install script. Mutable private directories require owner-only access.
Use a separately declared optional dependency/integration for Linux Gaming Mode;
ordinary original-client desktop startup should have a defined fallback when
that extension is unavailable. Never overwrite the installed XBOKS engine,
user games or another Wine prefix during setup/removal.

## Proposed AppImage layout

Use the same reviewed installer/supervisor modules and manifests:

```text
AppDir/AppRun
AppDir/usr/bin/original-xbox
AppDir/usr/lib/original-xbox/runtime/<runtime-id>/
AppDir/usr/share/original-xbox/manifests/
AppDir/usr/share/doc/original-xbox-runtime/
```

Keep all mutable Microsoft inputs and prefixes in the same XDG per-user layout,
outside the mounted image. Desktop integration is an explicit user operation;
the AppImage must not assume its temporary mount path remains stable or that it
can update a root-owned GNOME extension. Bundle compatible non-system
dependencies where appropriate and test the target baseline/graphics stack.
An AppImage wrapper does not remove the inspected `GLIBC_2.38` requirement or
provide the host GNOME extension, Xwayland, drivers and session bus.

## Concrete implementation order and gates

1. Freeze a clean, source-only runtime recipe: commits, ten patch hashes,
   toolchain/sysroot, configure/build commands and generated dependency files.
   Run a fresh full build; reverse-patch dry runs and incremental builds are
   not an independent reproducibility test.
2. Publish the supported-input manifest with full ISO digest/index, app-bundle
   digest and per-component/locale/framework/WebView2 identities. Validate archive
   paths, sizes and symlink boundaries before extracting into a new staging
   directory. Initially reject untested source combinations explicitly.
3. Export generic install/profile/locale/supervision modules. Replace lab result
   dependencies with package build attestations plus fresh per-install checks.
   Create a new prefix from empty storage; never import accounts automatically.
4. Test interrupted import/setup, existing-prefix migration, missing WebView2,
   framework graph relocation, paths containing spaces, missing runtime-loaded
   libraries, lock contention, cleanup and rollback without a real account.
5. Build the `.deb` first for the current tested platform, then verify install,
   launch, update, removal and preservation of per-user data on a clean machine.
   Record exact package/runtime/source checksums for manual acceptance.
6. Test user-controlled Microsoft sign-in, original CE menus, mode entry/exit
   and emergency restoration. Keep authentication links and private logs local.
   Test streaming and game operations separately before advertising them.
7. Build/test the AppImage from the same accepted runtime only after choosing a
   supported host baseline. Keep installer and source archives reproducible
   across formats; do not hide platform gaps behind a second package format.

No installer executable, payload archive, account store or runtime release was
created by this inventory. Only source, component identities and static ELF
metadata were inspected; no app was launched or live installation modified.
