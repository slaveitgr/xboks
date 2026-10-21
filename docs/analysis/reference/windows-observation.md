# Original Windows behavior observation

Static package analysis cannot prove all state transitions, service responses or feature-flight behavior. The remaining Windows observations are a required part of completing this reference, not an optional polish step. No Windows runtime or physical controller was available to this analysis run.

## Capture conditions

Use the exact original Xbox version when possible, Greek UI, a 1920×1080 primary screen, 100% Windows display scaling and the same Xbox mode as the supplied references. Record package versions, input device and whether the state is signed in/out. Do not resize screenshots after capture; a capture made at a different scale is a different baseline.

The optional helper [capture-reference.ps1](../../../scripts/analysis/windows/capture-reference.ps1) saves a primary-screen PNG, installed package identities, operator action/result and image SHA-256. It does not install/re-register packages, invoke sign-in or change settings. It has been reviewed as source on Linux and **has not been executed/validated on Windows**.

```powershell
# Run only on Windows, after manually arranging the desired original UI state.
# The script prompts, then waits 5 seconds so you can return focus to the Xbox app.
.\scripts\analysis\windows\capture-reference.ps1 `
  -CaseId 'details.library.open.01' `
  -Action 'Activate installed game card from Library with A' `
  -ObservedResult 'Record what actually appeared, including focus and Back destination'
```

Output defaults to the local Documents `xboks-reference` folder. A case ID is never overwritten. Screenshots may contain account/profile information; keep the raw folder local and use only de-identified measurements/contracts in repository documentation. The helper captures the complete primary display, not just the Xbox process; arrange the intended surface accordingly.

## Required interaction cases

| Surface | Capture and observe |
|---|---|
| Home / Game Pass / Store | Focus only, activation, secondary menu, shared Product ID navigation, Back returning to original card/scroll |
| Game details | Not installed, installed, download error/paused/queued, DLC/bundle/subscription/third-party product; hero/media, every lower tab, every action-menu entry |
| Library | Filters and combinations, clear chip, sorting, empty/error/loading, card context menu, Play later/history, keyboard and controller activation |
| Install queue | Menu for running/paused/failed/finished/content/update; pause/resume/cancel confirmation, cleanup choice, details destination |
| Settings | All nine categories, top/bottom scroll positions, account and Store identity combinations, disabled startup in Xbox mode, provider collapsed/expanded/connected/disconnected states, persistence after reopen/restart |
| Flyouts | Account, friends, conversations, notifications; click outside, Escape/B, nested menu focus, unread filter, absent/stale data |
| Fullscreen Experience | Window fullscreen vs Xbox session state, activation/deactivation, controller/mouse transitions, input held while opening |
| Game Bar | Win+G from Xbox and from an unrelated app/game; six tabs, panel switching, OS focus, pin/window behavior, close/back, audio/capture/system submenus |
| Remote Play | Signed out/in, no console/console found, Xbox One X standby, connect/cancel, successful stream, disconnect/reconnect, controller loss, authorization/network error |
| Launch | Preparing, entitlement failure, prerequisites, cloud-save conflict/error if observed, process running vs rendered game window, exit/relaunch |

Each case needs a preceding action and a resulting state; two screenshots without that relationship do not establish a transition. Record an observation exactly, including "nothing happened". Do not fill missing values from expected behavior. Do not capture authorization tokens, cookies or passwords in notes.

## Review and promotion

- `package-static` proves a declaration/path/reference exists in this version.
- `screenshot-observed` proves a visible state/layout, not the action that caused it.
- `windows-runtime-observed` requires an action/result capture tied to version, mode and input.
- `linux-implemented` requires a linked xboks implementation; `linux-verified` requires execution evidence.
- `visual-compared` requires same-size captures and a reviewed comparison. It does not imply services work.

Use [verification-matrix.json](verification-matrix.json) to retain these separate dimensions. Promote one dimension only when its evidence is added. Server-side content/feature flags must be dated and scoped to the observed account/market without publishing personal identity.
