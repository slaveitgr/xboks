# Xodus Nexus backend 0.2.8

- Add read-only Xbox achievements, time played and last activity for supported accounts and games.
- Renew expired device credentials using the existing device identity and avoid conflicting renewals between backend processes.
- Improve profile and library loading with bounded retries for temporary Store-ticket connection failures and clearer sign-in guidance.
- Handle rejected, incomplete or malformed content-license responses without crashing, with clearer installation errors and credential-free diagnostic codes.
