# Xodus Nexus 0.3.5

- Fix launcher startup and game-shortcut keyring access in Steam Game Mode.
- Add games and Nexus to Steam with library artwork, even while Steam is running, including setups with multiple saved Steam accounts. Requires native Linux Steam; Flatpak Steam is not supported yet.
- Keep portrait Steam covers correctly proportioned.
- Queue multiple installations and download other games while playing. Waiting installations can be cancelled.
- Keep library cards in place when loading more games and fix game options opening with one click or tap. Thanks @Techzilla44 for reporting these issues.
- Prevent automatic display sleep while playing and add an optional **DualSense compatibility mode** in each game's settings. Thanks @slobeksila for the report and workaround. The mode is off by default and may disable advanced haptics and adaptive triggers.
- Support Google Chrome installed through Discover/Flatpak for browser sign-in. Thanks @quentingeorgel for reporting the issue.
- Fix game startup failures during speech initialization.

Update the Nexus runtime in **Settings** for the accompanying game-exit and license compatibility fixes.

## Steam Deck support

Steam Deck support is experimental. I'm currently testing and debugging on virtualized SteamOS, so I can't fully verify how everything behaves on real handheld hardware. Please report any issues you encounter.

If you have an older handheld compatible with Bazzite or SteamOS that you'd be willing to sell, please message me on Reddit at [u/Embarrassed-Hall-617](https://www.reddit.com/user/Embarrassed-Hall-617/). I'm looking for a device for development and testing. Cosmetic damage and signs of wear don't matter, as long as the device's basic functions work.
