# Original Xbox 2612: experimental Wine-UWP reproduction

This is a research candidate for the original package's AppL and CE entries,
separate from the installed XBOKS engine. The early AppL milestone was a
signed-out Home screen and Library navigation. A later isolated CE candidate
visibly rendered the original new Home frontend using an experimental WebView2
presentation bridge. CE input, streaming, game operations and full Xbox mode
have not been accepted; native Gaming Services deployment remains unsupported.

The [full report](xbox-proton-feasibility-2026-11-06.md) records package hashes,
runtime evidence, framework requirements, screenshots and limitations.
The [CE activation checkpoint](new-app-experience-activation-2026-11-08.md)
records the later native activation, client selection and visible Home trial,
with exact candidate hashes and private-evidence limitations.

## Source baseline and patches

Use Wine commit `7298a818b79446bae153b8d5aa27235ab3703bf9` with the complete
designgears/wine-uwp overlay at
`ac56cede08bbb99c5b88dd7b54e752f709cd6b47`. Apply these patches inside that
Wine source tree, retaining its existing license notices:

1. [Shared-service exports](patches/wine-uwp-shared-services.patch).
2. [Process AUMID export](patches/wine-uwp-process-aumid.patch).
3. [PackageManager3 interface](patches/wine-uwp-package-manager3.patch).
4. [GamePlatform 2612 adapters](patches/wine-uwp-gameplatform2612.patch).
5. [XboxAuth 2612 adapters](patches/wine-uwp-auth2612.patch).
6. [MediaPlayer weak references](patches/wine-uwp-media-weakref.patch).
7. [Native activation broker](patches/wine-uwp-activation-broker.patch).
8. [Per-launch identity and initial URI](patches/wine-uwp-launch-activation.patch).
9. [Opt-in windowed WebView presentation](patches/wine-uwp-webview-windowed-capture.patch).
10. [Opt-in gaming-experience API/Native1 bridge](patches/wine-uwp-gaming-experience.patch).

Each patch uses paths relative to the Wine source root and can be applied with
`patch -p1`. Reverse-application dry runs passed against the tested combined
source. A fresh Wine configure tracks the new GamePlatform client header;
regenerate dependencies when adding it to an already configured build.
The gaming-experience patch also changes `configure.ac`; regenerate Wine's
generated configure/dependency files before building that new module.

The affected incremental targets in the configured x86_64 build are:

```sh
make -j2 dlls/combase/x86_64-windows/combase.dll \
  dlls/kernelbase/x86_64-windows/kernelbase.dll \
  dlls/kernel32/x86_64-windows/kernel32.dll \
  dlls/appxdeploymentclient/x86_64-windows/appxdeploymentclient.dll \
  dlls/winegameplatform/x86_64-windows/winegameplatform.dll \
  dlls/winexboxauth/x86_64-windows/winexboxauth.dll \
  dlls/windows.media.playback.mediaplayer/x86_64-windows/windows.media.playback.mediaplayer.dll \
  dlls/wineuwp/x86_64-windows/wineuwp.dll \
  programs/wineuwp-launch/x86_64-windows/wineuwp-launch.exe \
  dlls/webview2host/x86_64-windows/webview2host.dll \
  dlls/gamemode/x86_64-windows/gamemode.dll \
  dlls/gamemode/gamemode.so \
  dlls/apisetschema/x86_64-windows/apisetschema.dll
```

The tested build used `-O2 -g0` and disabled host FORTIFY for the Wine C build.
Building these targets assumes the complete overlay, configured toolchain and
generated Wine libraries already exist; these are not standalone DLL projects.

## Independent probes

The [GamePlatform probe](probes/wine-uwp-gameplatform2612-tests.c) and
[XboxAuth probe](probes/wine-uwp-auth2612-tests.c) use independent raw interface
definitions. Their tested cross-compile commands have this form:

```sh
x86_64-w64-mingw32-gcc -O2 -Wall -Wextra \
  -Wno-cast-function-type -Wno-misleading-indentation \
  -Wl,--no-insert-timestamp \
  -o gameplatform2612-tests.exe wine-uwp-gameplatform2612-tests.c
x86_64-w64-mingw32-gcc -O2 -Wall -Wextra \
  -o auth2612-tests.exe wine-uwp-auth2612-tests.c
```

Run them with the exact candidate DLLs in a private package-aware prefix with
no authorized account. The GamePlatform probe expects an empty private game
queue and checks real storage data. The authentication probe exercises silent
no-account operations and switches the process ABI selection explicitly.
Neither probe represents a successful account login or game installation.

The [internal User fixture](probes/wine-uwp-auth2612-user-fixture.c) is separate:
it compiles `identity.c` through the `IDENTITY_SOURCE` macro and links the
provider objects and Wine import libraries. Its account is synthetic and
in-memory; it must not be exposed by the production DLL or copied to a real
account store. The exact tested object list is retained in the fixture build
proof in the existing private lab.

The [MediaPlayer lifetime probe](probes/wine-uwp-media-weakref-tests.c) exercises
the real registered player and weak-reference concurrency. It can run without
authentication and does not play media. After an actual user has signed into
the prefix, do not rerun tests that assume an empty account store against it;
retain those earlier no-account results with their exact runtime identities.

## Existing private lab

The current lab's `observation/run_stage.py` supports these bounded operations:

```sh
python3 "$LAB/observation/run_stage.py" gameplatform2612-tests --label gp-check
python3 "$LAB/observation/run_stage.py" auth2612-tests --label auth-check
python3 "$LAB/observation/run_stage.py" auth2612-user-fixture --label user-fixture
python3 "$LAB/observation/run_stage.py" media-weakref-tests --label media-check
python3 "$LAB/observation/run_stage.py" legacy --label original-ui-check \
  --experimental-client2612 --seconds 150 --trace-dependencies
```

Set `LAB` to the existing private Wine-UWP candidate directory and use a new
label for every UI experiment. The experimental profile requires its bound
probe-result and DLL hashes. It applies a temporary, explicitly identified
Wine client-contract alias after setup, then restores and verifies the
affected registry branches and default CE selection. It does not install
Microsoft's native services/drivers. The UI test closes automatically at its
deadline; exit 124 records that deliberate limit.

For the verified original 2612 metadata, the runner selects
`WINE_UWP_IDENTITY_ABI=2612`. This selects the correct default constructor and
async-result layout; legacy interfaces remain available. The profile is
default-off and is not wired into XBOKS updates or normal application startup.

At an explicit user request, the existing lab also supports
`--interactive-signin` together with `legacy --experimental-client2612`. That
mode has no app deadline and disables automatic screenshots. A host bridge
opens only a newly issued Microsoft sign-in link using the normal desktop
browser environment; the user enters credentials and completes authorization.
Raw link/token diagnostics remain private. The supervising process must remain
alive until app exit to restore the temporary compatibility registration.

## CE activation and presentation candidate

The later CE trials used an independent private prefix and separate candidate
runtime, preserving the working original-client session. The copied prefix was
not an atomic snapshot. The existing AppL interactive command above is not a
CE transition test and must not be treated as one.

The [activation broker probe](probes/wine-uwp-activation-broker-tests.c) checks
Launch/Protocol arguments through both the registered Wine broker and genuine
native AppInstance factory, including concurrent queries and invalid inputs.
Its six isolated scenarios passed 283 checks with zero failures. The
[launcher child probe](probes/wine-uwp-launch-activation-tests.c) checks the
child's AUMID and initial-URI environment; its orchestration passed nine checks
with zero failures. Those results do not alone establish visible UI.

CE's original early configuration parser consumes the raw executable
configuration URI before reading AppLifecycle context. The same validated URI
therefore needs both its raw argument handoff and typed initial activation
context for the tested selection route. The original parser sets
`HKCU\Software\Microsoft\Xbox\GamingApp\XboxPcAppCE` to DWORD 1. A per-launch
generated identity selects `Microsoft.Xbox.App` / `XboxPcAppCE.exe` without
rewriting a shared stage identity. Automatic local protocol dispatch and
cross-process redirection are not supplied by these launcher options.

The visible CE trial also required the genuine WebView2 152.0.4191.66 runtime
from the retained Windows image. Upstream setup initially skipped it because
the override cache hash omits the optional runtime; setup returning zero did
not prove installation. The successful trial forced setup in the independent
candidate prefix and verified the native executable and real WebView client
DLL, preserving upstream's proxy-host placement. The checkpoint records their
hashes; Microsoft payloads are not distributed in this repository.

Set `WINE_UWP_WEBVIEW2_WINDOWED_CAPTURE=1` only in the prepared candidate
process environment to use the opt-in ordinary-controller capture path. The
default remains off. The tested proxy DLL SHA256 was
`19056c8bd9e4ab6ccd2443e89061f059414dd057e6cdd999bb73a2579738b032`.
Owned-popup visual inspection confirmed the authentic CE Home frontend in
evidence `ev_bcc84a33035ce2bee40ba07608bbec4056dc5c56a00d6678cdcd1646174c9add`.
The private image includes account/friends content and is not published.

This bridge captures and decodes PNG previews on a 120 ms timer; it is not a
native cross-process compositor fix or a performance benchmark. Pointer,
keyboard, controller, streaming, gameplay and long-running stability require
separate acceptance. The trial ended at its deliberate deadline with code 124;
its profile rollback and protected-original-file checks passed. It was not
installed into the working original prefix or a production XBOKS release.

## Original Xbox mode bridge candidate

The user subsequently confirmed the original CE Home and menus. The separate
[mode-bridge checkpoint](original-xbox-mode-bridge-2026-11-08.md) records the
API adapter, Native1 enrollment policy, runtime binding and passed isolated
gates: disabled 25/0, unavailable 25/0 and private fixture 128/0. The
[independent probe sources](probes/gaming-experience/README.md) include the raw
C ABI probe and private-bus service/harness, without binaries or diagnostics.

`WINE_UWP_GAMING_EXPERIENCE_BRIDGE=1` opts the candidate process into the
adapter. It does not itself grant mode permission or enter mode. Production
desktop permission requires the enrolled original process and a loaded Native1
extension. The independent mode stage uses a byte-identical CE copy with mode
0755 because the original staged file's 0775 permissions fail the enrollment
policy; the original file is unchanged.

The eleven extension files are installed, but the existing Shell session still
uses its old imported code. A fresh GNOME login and actual original-client
entry/exit test remain pending. The desktop helper falls back to the ordinary
new-client experience when Native1 is absent or unusable. Source tests and
private transport probes are not acceptance of real Xbox mode, game execution
or gaming performance.
