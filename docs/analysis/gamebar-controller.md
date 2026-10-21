# Background Guide button

The GNOME Fullscreen Experience extension controls desktop presentation. It does
not read gamepads. A keyboard shortcut also cannot supply controller input to a
renderer that is hidden or has not been created by the resident service.

The production main process starts `GameBarController` after initialization.
Its private Python helper admits only readable Linux event nodes with gamepad
buttons, Guide (`BTN_MODE`) and X/Y axes. It rejects relative, keyboard, mouse
and mixed input nodes. After opening read-only/nonblocking with `O_NOFOLLOW`, it
rechecks the descriptor's input-device identity and capabilities through ioctl.
Only a Guide rising edge leaves the helper; other input is discarded. There is
no grab, injection, rumble, device write, permission change or raw-input log.

An initially held button does not activate the Guide. Repeated key events are
ignored, kernel `SYN_DROPPED` triggers state recovery, and scans track hotplug
with a limit of 16 admitted controllers. Stdin EOF and application shutdown
release the helper's descriptors. Demo operation never starts it.

Every activation requires fresh logind evidence of one active, unlocked, local
graphical session belonging to the current user. GNOME also requires its
screensaver to report unlocked. Missing, malformed, timed-out or ambiguous
evidence denies activation. Lock/suspend events pause the helper, close its
devices and hide the Guide; unlock/resume still requires the next activation's
fresh session check. Hiding the Guide cancels a pending renderer load, so it
cannot appear later over the lock screen.

`DesktopSettingsStatus.gameBarController` exposes only a bounded status, device
count and fixed reason. A focused, visible renderer uses browser Gamepad input
as a fallback when the native listener does not own a controller. Ownership and
focus transitions require a neutral button state, preventing a held button from
immediately closing the newly opened Guide.

The helper needs existing device read permission from the desktop's device
policy. The application does not add users to `input` or grant broad device
access. A running service is separate from verified compositor stacking over
external fullscreen games.

Validation:

```sh
python3 scripts/desktop/gamebar-controller.test.py
npx vitest run src/main/gamebar-controller.test.ts src/renderer/guide-button.test.ts \
  src/main/desktop-guide.test.ts src/main/install-integration.test.ts
```

These tests use synthetic event bytes, temporary capability trees, fake
descriptors and mocked lifecycle/session services. They do not press a physical
controller, read host input or establish acceptance over a real game. Test the
installed package from the normal desktop session: launch from the application
menu, use Win+G, close the launcher UI, then use the controller Guide button.
