# Xbox Windows package 2612.1001.23.0

Recorded 2026-11-06 from the user-supplied local MSIX bundle. This is a targeted
static inspection for the redesign, social hosting, settings and Xbox-mode
state contract. Microsoft application code was not installed or executed.

## Exact inputs

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `Microsoft.GamingApp_2612.1001.23.0_neutral_~_8wekyb3d8bbwe.Msixbundle` | 526,497,234 | `a44c5bb5bc33df73453189e9773485b7da246678ad8574c046c69225142074cb` |
| x64 `Bundle/index.bundle` | 19,304,480 | `3379d87f7a2c94e731954c5b9b3234f204bf5088035b7c2549dd947c7903a080` |
| x64 `resources.pri` | 2,639,944 | `1b508e2e3c7db6770b9b9f0e88d05988d92db73c33d53244e463561ad5e55daf` |
| Packaged `Play.Xbox.20261101-1137.zip` | 36,569,992 | `abcaaa4cc6cd1ee7baddd52be30da1f0c77b9cb890047ee38a382948dd3b1e8b` |

The archive manifests declare `Microsoft.GamingApp`, version `2612.1001.23.0`.
This establishes the supplied archive's declared identity and byte identity;
AppX publisher trust/signature validation was not completed. The earlier small
CDN link contained a CAB-wrapped BlockMap, not the application itself.

The bundle has 66 outer entries. The x64 package retains both the CE desktop
entry point and the legacy application entry point. `XboxPcAppCE.exe` existed
in the old package too; its presence is not new-architecture proof.

## New packaged web UI and retained legacy UI

The web archive is absent from the bounded old 2610 inventory and contains
1,426 extracted files, 103,442,010 bytes in total. Its `app.version` is
`main-1.0.2611.0101`. The legacy Hermes v96 bundle also remains. Legacy function
56540 calls the app-experience update/restart bridge, with Bastion-switch error
paths; new PRI labels describe that handoff.

These facts support a new packaged experience alongside the legacy UI. They do
not prove which experience a particular Windows account or experiment selects,
or establish the native CE loader's exact archive-to-renderer call path.

## Targeted source findings

Offsets below are byte offsets in the exact UTF-8 files inside the pinned web
archive. They are source evidence, not observed Windows interactions.

| Question | Observed declaration/flow | Locator |
| --- | --- | --- |
| Navigation | Concrete Home, Remote Play, Game Pass, Store, Library, Queue and Search handlers; visible arrangement still depends on configuration and host. | `assets/Shell-n50awoo2.js`, byte 8858 |
| Persistent Friends | Rich social in the left navigation defaults off. A visible dock and enabled rich-social flag select side-panel hosting; otherwise Friends opens the guide's people route. Certain auxiliary Bastion surfaces have additional panel rules. | `assets/SecondaryPanelSystem-fxlsvq5f.js`, bytes 912, 1214, 7812; `Shell-n50awoo2.js`, byte 13096 |
| Display layout versus OS mode | The Display setting's Full Screen/Desktop values select low/high layout density. Native Xbox-mode activity influences the default density unless overridden. This preference is distinct from entering the operating system's gaming mode. | `assets/SettingsDialog-fcedlpya.js`, byte 346990; `entry.client-lsuj6d01.js`, byte 903742 |
| Xbox-mode entry/exit | The coordinator owns a pending target, rejects conflicting requests, requests native mode changes and completes against matching native state/events. Destruction cancels its pending work. | `assets/XboxModeCoordinator-gudwyf0o.js`, bytes 1736, 2177; `Xbox.Web.winmd` Xbox-mode API declarations |
| Status indicators | Both the status-indicator configuration and native `isInXboxMode` must permit them. | `assets/entry.client-lsuj6d01.js`, byte 910998 |
| Settings V2 | Sidebar categories include Account, Devices & connections, System, Play & social, Apps and Accessibility. Apps is Bastion-gated; Recommended is mobile-only. Subscription is an Account detail for Bastion. | `assets/SettingsDialog-fcedlpya.js`, bytes 562021–567519 |

Settings detail declarations include Display, Xbox mode, audio, languages,
storage, app startup, notifications, developer options and About under System;
streaming and conditional Remote Play are under Play & social. Some content
has additional platform, sign-in or completion predicates. A declared route
does not establish that every platform renders a complete, working control.

The marketing reference's persistent Friends view is consequently a supported
variant rather than an unconditional layout. XBOKS chooses that desktop variant
explicitly. Its controller Home uses the user's dashboard references as a
design input; the images do not establish that this exact layout is selected
by every 2612 Windows installation.

## Evidence and limits

REA exported package/archive inventories and two selected JavaScript passes.
The 11 selected JavaScript files parsed without syntax failures; four selected
files reached semantic retention limits. The large shared entry was additionally
read through exact, inert text contexts, not a complete semantic graph. Native
CE loading, actual feature flags, service responses and Windows interaction
remain unobserved. This is not complete reverse engineering of the app.

Local ignored evidence includes `package-findings.json`, `final-source-pins.json`,
the exported `rea-*-evidence.json` records and original artifact hashes under
`work/xbox-2612/`. Relevant retained identities before session closure were:

- Outer inventory: `ev_1d67d70fc0d2f5ffafbeb4355baad357672f7b1bc3a6d87669c06138461ac032`.
- x64 inventory: `ev_14e33acf9d0e9af9b9dbea75d0b54f714068fb90ca04e3a3b30f97e9311dc2c4`.
- Web archive: `ev_e8a67cdf58094d9843dfac55cc42c6e655d4692f09434556757ed9be2ed364ad`.
- Selected JavaScript: `ev_246c286492023b7daef705235144befaf89b335ff29a3b41d16a686d239ba913` and `ev_67575fe29a211bb64e59abb92b459034c04852767f193b3b6863a7a864dd07ff`.

The REA session was closed after export; use the local exported records rather
than assuming the closed session's references remain queryable. Proprietary
packages, resources and JavaScript stay outside Git. The repository records
factual contracts and independently implemented XBOKS changes.
