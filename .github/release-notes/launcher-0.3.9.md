# Xodus Nexus 0.3.9

This is primarily a technical update focused on sign-in, system keyrings, empty libraries and installation reliability.

- Add compact system-keyring checks and an explicit Start service action in setup and account Settings, with clearer KDE Wallet guidance.
- Show the launcher before optional account checks and avoid changing the shared Steam session's graphical environment.
- Add a combined download speed limit, improve interrupted-download recovery and provide clearer account and licensing diagnostics.
- Fix runtime installation failing because of unrelated loader warnings.
- Make the game-detail Manage menu match the library menu, including VC++ installation, settings and shortcuts.
- Copy complete game logs and reveal their files for issue reports. Update notifications now cover the launcher, backend and runtime.

Update the Nexus backend to **0.2.9** in Settings for the accompanying keyring, Store-ticket and download fixes.

Thanks to new contributors @btsouth, @chalkers and @Gustav0ar for their backend and runtime fixes!

> [!CAUTION]
> **Xodus Nexus is an independent, unofficial project built on Xodus. It is not an official project or release from the upstream Xodus developers.**
>
> Please report Xodus Nexus issues only in the [Xodus Nexus repository](https://github.com/domsvoboda/xodus-nexus/issues). A problem in Nexus does not necessarily indicate a problem in upstream Xodus.

## Steam Deck and similar handhelds

Steam Deck and similar handheld support is experimental. I'm currently testing and debugging on virtualized SteamOS, so I can't fully verify how everything behaves on real handheld hardware. Please report any issues you encounter.

I'm looking to buy an older Steam Deck or a similar handheld compatible with Bazzite or SteamOS for development and testing. If you have one you'd be willing to sell, please message me on Reddit at [u/Embarrassed-Hall-617](https://www.reddit.com/user/Embarrassed-Hall-617/). Cosmetic damage and signs of wear don't matter, as long as the device's basic functions work.
