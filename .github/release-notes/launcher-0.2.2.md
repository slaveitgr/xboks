# Xodus Nexus 0.2.2

## Bug fixes

- Fix launching game paths and titles containing quotes.
- Fix blank sign-in windows on Wayland and improve window placement.
- Resolve the download terminal helper by its absolute path; use direct process
  spawning when the helper is unavailable.
- Require Nexus backend 0.2.1 or newer for the updated runtime's Store queries.

The launcher downloads the Nexus backend and runtime separately. Install the
matching backend and runtime updates to receive the shared compatibility fixes.
