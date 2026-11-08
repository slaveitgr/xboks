# Independent gaming-experience ABI probes

These source files test the experimental Wine adapter without accounts, games
or GNOME Shell actions. The [checkpoint](../../original-xbox-mode-bridge-2026-11-08.md)
records the exact tested candidate, source hashes and completed runtime evidence.

- `gaming-experience-tests.c` resolves all six names and measured Windows
  ordinals from both `gamemode.dll` and the API set. Modes are `disabled`,
  `unavailable` and `fixture`.
- `private-native1-fixture.py` implements the Native1 wire protocol on a fresh
  private bus. Its Test1 interface is synthetic test control, not a production
  authorization or GNOME policy implementation.
- `run-private-fixture.py` owns that private bus, drives probe handshakes and
  stops only its own processes and explicitly disposable prefix server.
- `fixture-smoke.py` checks only the private service, without Wine.

Copy this source directory into a new ignored private lab directory before
preparing a prefix or running it. Keep binaries, prefixes, generated fixture
logs and result JSON outside the published source tree. The harness requires
Python with dbus/PyGObject, `dbus-daemon`, an already prepared candidate runtime
and an account-free disposable prefix beneath the copied probe directory.
It does not install or initialize a runtime or prefix.

Compile the raw probe in that copied private directory with the available
x86_64 MinGW compiler:

```sh
x86_64-w64-mingw32-gcc -O2 -Wall -Wextra -Werror \
  -Wno-cast-function-type -Wl,--no-insert-timestamp \
  gaming-experience-tests.c -o gaming-experience-tests.exe
```

The prefix and its `.native1-probe-only` marker must be owned by the current
user with no group/other permissions. The marker contains the prefix's
canonical absolute path. The harness rejects an existing process in that
prefix, a prefix outside its private probe directory and a reused output
directory. Example shape, using already prepared paths:

```sh
python3 run-private-fixture.py --wine /absolute/candidate/bin/wine \
  --prefix /absolute/private-probes/test-prefix \
  --output /absolute/private-probes/new-fixture-result --mode fixture
```

Each mode needs a new output directory. The fixture overrides the child bus
address with its own owner-only temporary socket; it never connects to the
desktop session bus. Passing these tests establishes the exercised ABI and
transport contracts, not original-client rendering or real desktop mode.
