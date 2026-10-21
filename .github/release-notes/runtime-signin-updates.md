# Nexus runtime: startup and shader fixes

- Add app-constrained notification registration needed by Jurassic World Evolution 3. Thanks @Gustav0ar.
- Fix repeated task-queue termination notifications that could prevent clean shutdown. Thanks @Gustav0ar.
- Implement game-process replacement through XLaunchNewGame, addressing the missing relaunch operation reported by Like a Dragon: Infinite Wealth.
- Backport the upstream DXBC-SPIRV constant-comparison fix for the shader-compiler assertion reported by Aniimo, without upgrading the base DXVK version.

Update the launcher to **0.3.9** and the backend to **0.2.9** in Settings. These fixes address specific failure paths; compatibility remains game-dependent.
