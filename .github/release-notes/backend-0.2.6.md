# Xodus Nexus backend 0.2.6

- Prevent sign-in and installation panics when stored credentials are missing or invalid. Thanks @jordanfaz for reporting the issue.
- Verify saved credentials and preserve the existing device identity when the system keyring fails.
- Include complete dependency sources for offline builds.

Compatible with Xodus Nexus launcher **0.3.6** or newer. Launcher 0.3.6 may still show a generic sign-in message; backend and installation logs provide the specific credential error.
