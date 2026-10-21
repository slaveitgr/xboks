# Settings behavior recovered beyond the screenshots

Reference: GamingApp **2610.1001.20.0 x64**, Hermes v96. This chapter follows actual property assignments, register values, conditions and calls for Application and Install Settings. The raw annotated functions are private under `work/reference/library/traces/settings/`, except constructor F48194 at `work/reference/library/traces/settings-general.json`. It establishes bounded static behavior; it does not verify Windows execution, persistence results or native service success.

## Application: Compact mode is a shell-state action

The constructor F48194 binds `toggleCompactModeSetting` at offset98 to F48195 and `toggleShowBatteryPercentageSetting` at109 to F48196. In F48201 `renderGeneralSection`, the compact switch gets its **value** from `props.isInHandheldMode` (offsets272–283) and its `onValueChange` from the compact handler (287–293).

F48195 reads that same mode at12 and negates it at18. If the new value is true, offsets128–146 call `closeAnySocialHubWindow`. Offsets150–211 choose the enabled/disabled accessibility announcement, then offsets216–231 call `props.setHandheldMode(newValue)`. Telemetry construction is separate from the state-changing call.

**Implementation contract:** keep Compact mode state separate from Fullscreen Experience and ordinary window fullscreen. Close incompatible social surfaces when entering the mode and expose a corresponding accessibility announcement. Do not equate the callback with changing a single sidebar width: the downstream shell reactions still need their own reconstruction. The current xboks expanded-sidebar behavior was an implementation choice, not proof of all original mode effects.

## Battery percentage depends on Compact mode

F48201 loads `isInHandheldMode` at336, negates it at342 and assigns the result to the battery switch's `disabled` property at345. The battery switch's `value` is independently read from `isShowingBatteryPercentage` at414 and assigned at420. Its handler is assigned at430.

F48196 reads the previous battery-display preference at12, negates it at18 and calls `setShowBatteryPercentage(newValue)` at113. F48215 calls the shell action creator at29, then the captured dispatch at36.

The rule is:

```text
battery_control.disabled = !compact_mode
battery_control.value = stored_battery_display_preference
```

Disabling the control is not proof that the underlying preference is cleared. A Linux sysfs battery reader can provide the value, but must not erase this UI state relationship. A desktop without battery support adds a Linux capability condition, tracked separately from the original rule.

## Offline permissions requires the Store identity role

F48209 `mapStateToProps` calls `userSelectors.hasStoreIdentity` at163 and assigns its result to `isMsaSignedIn`. F48203 reads that property at7 and branches directly to its return at13 when false. When true, it constructs the heading and `OfflinePermissionsModule` (call237).

This is a **conditional section**, not a permanently visible preference backed by the current Xbox profile. Preserve gaming and Store identity roles. Linux has not implemented Microsoft's offline-device authorization merely by rendering this section.

## Startup: exact disabled conditions

F48355 registers the `SettingsGeneralTabStartupSettings` component; its memoized function is F48358. Selector results in F48358 are:

| Result | Register / defining call |
|---|---|
| Fullscreen Experience active | r15, call110 to selector `getIsInFullScreenExperienceMode` |
| Auto launch enabled | r12, call136 to `getAutoLaunchSetting` |
| Launch in background enabled | r22, call158 to `getLaunchInBackgroundSetting` |
| System tray enabled | r17, call180 to `getSystraySetting` |
| Auto launch can be set | r13, call202 to `getAutoLaunchSettable` |

The register operations and short-circuit jumps establish:

| Control | Exact static `disabled` expression | Assignment |
|---|---|---|
| Start Xbox at login | `!autoLaunchSettable || fullscreenExperience` | F48358 offsets624–633 |
| Start in background | `!autoLaunchEnabled || fullscreenExperience` | F48358 offsets828–837 |
| Minimize to tray on close | `fullscreenExperience` | F48358 offset1222 |

An information banner is gated by the FSE result at456 and uses the startup-disabled heading/body keys. The background-start row is mounted through an animation helper tied to the auto-launch selector; this trace does not recover the helper's transition duration or every intermediate mount state. Do not replace that condition with unconditional row visibility.

Separate handlers F48361/F48362/F48363 call the corresponding settings action creators at105 and dispatch at112. They are not one shared cosmetic checkbox. F48364 opens the settings deep link through `openURLWithTelemetry` at50; the Linux equivalent needs an explicit platform destination, not an attempt to launch a Windows URI unchanged.

**Linux adapter contract:** XDG autostart, background/tray behavior and distribution FSE state are separate providers. Report settable/capability state, apply the operation and retain failure/rollback behavior. The current app-level fullscreen flag must not masquerade as a system gaming-session flag.

## Install options is composed from provider containers

F48375 renders the Install heading/details and two distinct components: `InstallOptionsContainer` at287 and `CustomizationOptionsContainer` at314. The screenshot's dropdown does not prove that every machine has the same install volumes/provider options.

The customization read paths are asynchronous:

- F48382 calls `getProviderUpdatesDuringGameplaySettingAsync` at45; successful content is published at76/81 and an error state at192/197.
- F48385 calls `getProviderNetworkThrottlingSettingAsync` at45; successful content is published at76/81, failures are converted/reported and exposed as an error state at242/247.

Their constructed request objects include provider identity and product fields. These calls are provider-scoped interfaces, not proof that the Linux backend implements those settings globally.

The corresponding writes preserve error paths:

| Function | Operation | Observed static stages |
|---|---|---|
| F48395 | Updates/downloads during gameplay | Existing-content check39; request payload `enabled = !arg1` at61–67; optimistic local content update85/90; native setter125; failure conversion264; restoration282/287; localized error385/390 |
| F48400 | Network throttling | Existing-content check44 and numeric validation82; native setter133; successful content165/170; failure conversion310; restoration444/449; localized error478/483 |

These offsets prove distinct success/error/update branches. They do not recover the provider's internal persistence or exact promise scheduling. An xboks adapter must not leave an optimistic preference looking successful when its backend rejects the write.

## Download speed units do not set the bandwidth cap

F48405 receives the selected unit as `arg1`. It resolves `DownloadSpeedUnit.BitsPerSecond` at141 and compares at147. The unequal branch chooses `BytesPerSecond` (151–167), while the equal branch chooses `BitsPerSecond` (169–179). It calls `settingsActions.setDownloadSpeedUnit` at185 and dispatches at190.

This is a display-unit setting with separate enum alternatives. This handler does not divide rates, convert storage sizes or invoke the network-throttling setter. The bandwidth limit path separately names `maxNetworkBandwidthMbps` and validates/parses the numeric text in F48403. Keep these fields and units separate in the Linux data contract.

## Regression cases derived from these traces

1. Compact off disables the battery preference while retaining its stored value; compact on re-enables it.
2. Entering Compact mode closes an incompatible social surface before applying the new shell mode.
3. Offline permissions is gated by Store identity availability, independently of Xbox profile identity.
4. FSE disables startup/tray controls according to the expressions above; an unsettable autostart state remains disabled outside FSE too.
5. Background startup cannot be enabled when auto launch is off; row animation is verified separately.
6. A failed provider setting write restores/exposes actual state and a localized error.
7. Changing bits/bytes display units does not change the configured download cap or install root.

These are acceptance requirements for future xboks implementations. They have not been run against the original Windows app or claimed as passing Linux app tests.
