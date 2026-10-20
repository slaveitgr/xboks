# Nexus backend 0.2.2

- Report download progress directly to the launcher without terminal utilities.
- Add Pause / Resume, including recovery from saved checkpoints after restarting the launcher.
- Validate resumed byte ranges and preserve checkpoints after interrupted transfers.
- Report installation failures correctly instead of returning success.
- Resolve Windows executable paths with different letter casing on Linux.
- Provide Xbox gamertags and profile pictures for the launcher account display.
- Show verified Game Pass membership when available, without an extra password prompt.
- Load owned and Game Pass game licenses for the launcher library using the existing sign-in.
