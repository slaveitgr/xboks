# Original Xbox: New app experience activation checkpoint

Date: 2026-11-08. Status: the original CE **Home frontend visibly rendered** in
an isolated candidate through an experimental WebView2 presentation bridge.
Input, streaming, game operations and Xbox Fullscreen Experience remain
unverified.

A subsequent persistent launch opened the same candidate with window class
`xboxpcappce.exe`. A separate user-local **XBOX — New app experience** desktop
entry focuses that exact private-prefix process on repeated activation. The
supervisor holds an exclusive runtime lock, waits without an automatic deadline,
and disables screenshot observers, frame dumps and verbose presentation traces.
Its cleanup attempts profile restoration even if an earlier cleanup step fails.
The prior original-client session remained open. The user confirmed that the
new Home appeared and its menus responded to the mouse. The persistent session
subsequently ended, its profile journal restored and protected-original-file
checks passed. Its supervisor reported a post-restore cleanup error after an
already stopped Wine server; later cleanup now accepts that outcome only after
verifying no process remains in the exact candidate prefix. Long-duration
stability, keyboard/controller navigation, streaming, games and Xbox mode
remain separate acceptance work.

The profile-menu **New app experience** switch selects the CE client. This is
separate from entering Xbox Fullscreen Experience. The observed AppL request is
`msxbox://config/?XboxPcAppCE=1`, with entry-surface and switch-attempt parameters.
The current diagnostic launcher logs that request instead of dispatching it.

## Failure and correction

Native `ExecModelClient.dll` obtains its activation context through
CoreWindowBroker `QueryService`. It requests service and interface
`4c79fb19-e2a8-4f1a-b477-ad6e7b0bccc9`. The Wine broker previously lacked this
service, causing `GetActivatedEventArgsClient` to fail with
`E_NOINTERFACE` (`0x80004002`).

The [activation broker patch](patches/wine-uwp-activation-broker.patch) adds the
measured IUnknown-derived service ABI and stable process-start activation
arguments. Initial URI activation is represented as Protocol with previous
state NotRunning; later inbox activation retains Running. Output validation,
object ownership and concurrent startup queries are covered by the probe.
Instance registration, enumeration and cross-process redirection remain
explicitly unsupported rather than reporting success.

The [launcher patch](patches/wine-uwp-launch-activation.patch) adds
`--identity FILE` and `--activation-uri URI`. The selected identity takes
precedence over compatibility configuration without rewriting shared
`identity.env`; the URI can be supplied as typed activation input. Malformed
option values are rejected. Subsequent static analysis found that CE also
requires the same configuration URI in its raw executable argument to process
the new-client preference before reading activation context; both handoffs are
needed for that route. This
handoff does not itself implement local protocol dispatch or retargeting.

| Candidate artifact | SHA256 |
| --- | --- |
| Wine `wineuwp.dll` | `3e5dddbb5ca744ad52d09f7029db0408813efe53041993f13e58057f5a563ec2` |
| Wine `wineuwp-launch.exe` | `fd52b0a22e2a062898fe6a890fb8021b9b917f92292c1ced93ba6d9820cd0b9e` |
| Original native `ExecModelClient.dll` | `ec4d60736232252bbb48378c75bb3ae683561255835296bf2a91861708ba9c5a` |
| Original `XboxPcAppCE.exe` | `dc50e62227838178c6f8b1e42463cd2b4a7f4b4f55dfc4b0e672d71a8fed0d89` |

## Executed checks

The [broker probe](probes/wine-uwp-activation-broker-tests.c) exercised six
isolated scenarios: Launch, Protocol, concurrent Launch, concurrent Protocol,
invalid URI and conflicting file/URI activation. It used the registered broker
and genuine native AppInstance factory: **283 checks, zero failures**.
Evidence: `ev_3b0dc8ea8a096f7c0b249d026268f22cb052a51bb5a44e163ea504f69aa50b6f`.

The launcher orchestration and [child probe](probes/wine-uwp-launch-activation-tests.c)
passed **nine checks, zero failures**, including selected-identity precedence
over `launch.env`, URI propagation, rejected inputs and unchanged shared
identity. Build, isolated distribution and isolated-prefix launcher copies
matched the candidate hash above.
Evidence: `ev_59b766f4445d1b5da42bc6e5c39653e9725b0968e2c8971ae24f2d9adda438e7`.

These checks validate the contracts they exercise. They do not establish
successful CE frontend rendering, account workflows, game operations or
Fullscreen Experience.

## First actual CE trial

Evidence: `ev_176c015bbd53e6994fba00fc5308506ab69afd3281b251b900e268f9c8c4d5bd`.
The trial used an independent private prefix cloned from the research prefix
and a separate candidate runtime. The clone was not an atomic snapshot.

- Setup returned 0; the original CE executable returned 0.
- Native `GetActivatedEventArgs` returned `S_OK`; the earlier `0x80004002`
  activation-context failure was absent.
- No application window or valid UI screenshot was observed.
- CE requested `msxboxl://config/?XboxPcAppCE=1` with transition parameters.
  This was logged only. It differs from the earlier plain-root `msxboxl:///`
  fallback and does not prove that AppL received or completed the transition.
- A WIL query observed feature `0x38a32b5` disabled. Its purpose and role in
  the routing decision are not established; it must not be relabelled as a
  confirmed CE or fullscreen switch.
- Candidate-prefix cleanup and experimental-profile restoration passed.
  Protected original files were unchanged, and the original client process
  (PID 301262 at the checkpoint) remained alive.

The result demonstrates progress beyond the missing activation-context service,
while leaving a separate client-selection/protocol-routing problem unresolved.
No candidate was installed into the running original-client prefix or released
as a production runtime. Microsoft binaries, private authentication logs and
account state are not included in these portable Git artifacts.

## Next acceptance step

The CE selection and WebView2 trials, including successful visual Home
rendering, are recorded below. Input and mode transitions still require their
own acceptance checks. Preserve the working original session while testing in
the independent candidate prefix.
Before enabling the profile switch, provide
allowlisted local `msxbox`/`msxboxl` dispatch with the correct per-process
application identity, both URI handoffs required by CE, activation delivery and
acknowledgment.

## Plain CE comparison and preference parser

The second actual CE trial supplied no configuration URI. Evidence:
`ev_a13e2ee7571dea252c93c6b3bd5bd555f7a766206e5147ec3a6b9c9ff7dd7049`.
It returned 0 without an observed application window. `GetActivatedEventArgs`
again returned `S_OK`, but CE requested the plain fallback `msxboxl:///`.
The experimental profile restored, protected original files were unchanged and
the original client process (PID 301262 at this checkpoint) remained alive.
This confirms that repairing the activation-context service alone does not
select the new frontend.

Static inspection then identified the original client's actual preference:

```text
HKCU\Software\Microsoft\Xbox\GamingApp
    XboxPcAppCE    REG_DWORD    1
```

In the unmodified CE executable, configuration parser RVA `0x11b998` consumes
the raw `wWinMain` LPWSTR argument before AppLifecycle activation. The call is
at RVA `0x131aa4` inside the entry routine at `0x131a2c`. The parser recognizes
the `msxbox://config?XboxPcAppCE=1` / `true` configuration value and writes the
preference through `RegSetKeyValueW` at `0x11b3c4`; the preference read is at
`0x325b70`.

This provides an independent reason that the earlier URI environment handoff
was insufficient: typed protocol activation and CE's early configuration
command-line parser consume different inputs. The planned dispatcher must
preserve the same validated URI for both consumers where required, while
retaining the proper Protocol activation context. It must not replace that
context with command-line arguments alone.

Static evidence:

- `ev_3b6e82d48216ec67ce1330c8132b23dd7217cb5bbb9e58126fd08980b23efd40`
- `ev_9d1bbc15447f1256b94fd695a029d96c4bdcf9d6ff280501916aff8fde323a95`
- `ev_ec0b6efcc4aa87dcd1b3284bb4c18b4561454f103aea2b837ff7556f12883d93`

Feature `0x38a32b5` (59388597) remains of unknown purpose and is not being forced
to select the frontend.

## Configuration selection succeeds; WebView2 startup fails

The third trial supplied the same configuration URI as both initial activation
context and raw executable argument. Evidence:
`ev_570918d3a7edff59a91769c188bf98d57fd47a9f3862225c2b418ecf32329264`.

The original CE parser wrote `XboxPcAppCE` as DWORD 1; the exact cloned-prefix
user registry was checked after the run. The client then reached
`ApplicationCore`, `DashboardExperience`,
`WindowManager.CreateRootWebViewWindowAsync` and `Xbox.WebClientFramework`
initialization. A native HWND value of 65656 was recorded, but no valid visible
application window or screenshot was observed. A handle in a trace does not
establish that the frontend rendered.

Startup stopped at WebView2 environment initialization:

```text
CreateWebViewEnvironmentError
HRESULT: 0x80070002 (-2147024894)
ClientDllFound: 0
InstalledRuntime: 1
```

The configuration process returned 99. The trial wrapper consequently returned
1. These observations identify a WebView2 dependency/initialization gap after
successful preference selection and activation-context retrieval; they do not
reproduce the former missing activation-broker failure. The precise missing
file or dependency still requires resolution.

The CE trace also reports `api-ms-win-gaming-experience-l1-1-0` unavailable,
corroborating the separately identified fullscreen API gap. Profile restoration
and protected-original-file comparisons passed, and the original process
(PID 301262 at the checkpoint) remained alive.

The retained Windows image contains a WebView2 152.0.4191.66 runtime tree. It
was extracted to a new ignored private cache (1,401 files, approximately
1.087 GB). Microsoft runtime files are not included in the portable Git
artifacts. The subsequent setup and startup results are recorded below.

## Cached setup and verified WebView2 runtime

The fourth trial ran upstream setup in the cloned prefix. Evidence:
`ev_83d1b492422d00b8bca5e378b787da59a1938bc286cd50652ed45ba8b0bf238f`.
Setup returned 0 but treated the overrides as unchanged; the cache hash does
not include the optional WebView2 runtime. Consequently this run did not
install the newly staged runtime, and CE again returned 99. Setup returning
zero was not sufficient evidence that WebView2 was installed.

For the fifth trial, setup was forced in the independent candidate prefix and
the installed runtime was verified against the retained files. The genuine
runtime remained behind upstream Wine's WebView proxy host:

| Runtime artifact | SHA256 |
| --- | --- |
| Microsoft `msedgewebview2.exe` | `3437ea2f12904b7b7be82c228f137c0631439e9a40cda5da3970615f825d6d74` |
| Microsoft `EmbeddedBrowserWebView.real.dll` | `8859f59ee9b162f5ad89dfae740a0410b946fe74c14323c310f01b1fd6f996ee` |

Fifth-trial evidence:
`ev_3c329c2fae736d47b8dff4521b85491e0aeed590fcf16412e3290bfa605e93ab`.
The run ended at its deliberate 90-second deadline with code 124. It did not
repeat the immediate WebView2 initialization exit. An owned XBOX window
(PID 329299) was observed: an early capture around four seconds showed the
"Preparing new worlds" splash. Main-window captures around 30, 56 and 82
seconds were black. This is not a working-dashboard result.

A safe diagnostic summary records successful native JavaScript navigation,
237 native bridge API starts, 234 completions and three errors:

- `ContentAccess.InvalidateCacheAsync`: `0x87e00196`.
- `User.GetGamerpicAsync`: `0x80004001`, twice.

All three recorded launch-milestone calls completed. No asset-fetch failure
was identified in that summary; the black main-window captures alone do not
establish that the page failed to load. JavaScript execution and native bridge
activity likewise do not prove that the dashboard is visible or usable.

The upstream `webview2host` source documents its presentation workaround for
composition-controller requests and the limitations of ordinary windowed
cross-process child output. Whether the correct owned popup/surface was
captured, and whether CE needs a further windowed-controller presentation
bridge, remained open at the fifth-trial checkpoint. The sixth trial below
tests a separate opt-in presentation candidate.

Both trial checkpoints report successful profile restoration, unchanged
protected original files and the original client process (PID 301262) still
alive. No Microsoft payload, screenshot, private authentication log or account
data from these trials is published with this checkpoint.

## Sixth trial: original CE Home visibly rendered

Evidence:
`ev_bcc84a33035ce2bee40ba07608bbec4056dc5c56a00d6678cdcd1646174c9add`.
The prepared independent candidate prefix retained the verified WebView2
152.0.4191.66 runtime and the original client's CE preference. This trial added
the [windowed WebView capture patch](patches/wine-uwp-webview-windowed-capture.patch)
and enabled only its opt-in `WINE_UWP_WEBVIEW2_WINDOWED_CAPTURE=1` behavior.

| Presentation candidate | SHA256 |
| --- | --- |
| Baseline `webview2host/main.c` | `c6e3455208c55e7337765f500b0e223c4880e72c5d95b41d79c1ae235d1afd69` |
| Patched `webview2host/main.c` | `f73d8d57f3b4e65e04f1f048c4b8411efaed46245da9796aad890c1d51adebaa` |
| Portable source patch | `5be0965a01abf6f064afb86b8a658676749bf0a8410f5f95d0f2ef02eb55b03f` |
| Tested Wine capture-host DLL | `19056c8bd9e4ab6ccd2443e89061f059414dd057e6cdd999bb73a2579738b032` |

The patch routes ordinary windowed-controller creation through upstream's
existing owned-popup/CapturePreview bridge. It returns the normal controller
interface expected by that caller and preserves the previous default path
when the flag is absent. It is a Wine presentation workaround; the Microsoft
frontend and runtime payloads remain original.

Owned X11 captures were obtained around 20, 45 and 70 seconds. Visual inspection
of the 70-second owned popup confirmed the authentic CE Home dashboard. Its
private image includes account and friends content and is deliberately not
published or embedded here. This directly establishes visible Home rendering
in this candidate, beyond the earlier JavaScript/bridge-activity evidence.
It does not establish that menus, input or games work.

The run reached its deliberate deadline and returned 124. Candidate-prefix
`wineserver -k` / `-w` cleanup returned zero; the experimental profile restored,
protected original files were unchanged and the original client process
(PID 301262 at the checkpoint) remained alive. REA verified the owned process
group and removed its temporary root. Host processes whose ownership could
not be inspected are not claimed as owned or terminated by this experiment.

The bridge requests CapturePreview PNG frames on a 120 ms timer, then decodes
and paints them into an owned popup. This interval is not a guaranteed frame
rate; capture/decoding overhead, latency, CPU use and stability have not been
benchmarked. Wrapped ordinary controllers currently expose Controller1–4;
newer/private interface compatibility is not established.

Remaining acceptance includes pointer, keyboard and controller input, menu
navigation, cloud streaming, console Remote Play, game installation/launch and
long-running stability. The gaming-experience API bridge and full Linux Xbox
mode are still separate unfinished work. No production runtime was installed
or released, and no private image, raw authentication log or Microsoft binary
is part of the portable patch publication.

See the [reproduction notes](wine-uwp-client2612-reproduction.md) for the existing
runtime baseline and the [fullscreen activation analysis](original-xbox-fullscreen-activation-2026-11-08.md)
for the distinct gaming-experience API/state work.
