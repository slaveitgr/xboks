# Nexus backend 0.2.1

## Bug fixes

- Add the authenticated package-update query used by Nexus runtime.
- Resolve the Windows package from the Store catalog and compare the installed
  version against actual Xbox package metadata.
- Parse package versions containing a GUID suffix correctly.
- Bound response sizes and query duration, and cancel pending authentication
  tasks when the query is canceled or times out.
- Return explicit errors for unknown, ambiguous or unsupported update states.

This implements the verified current-game no-update case. DLC update queries,
mandatory-update policy and installing updates are not implemented by this API.
