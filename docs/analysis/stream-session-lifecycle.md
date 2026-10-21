# Native stream session ownership

The Electron main process owns provider credentials, the provider session, its
heartbeat and cleanup. The renderer receives a local session capability and
drives provisioning polls through the Cloud or Console stream host. A pushed
state event can arrive before the corresponding IPC invocation resolves;
receiving the same provisioning phase must not cancel the host's next poll.

## Heartbeats and deadlines

Every owned session has a 20-second heartbeat interval. At most one heartbeat
request may be in flight for that session. A late response from a stopped or
replaced session cannot close a newer session.

The heartbeat independently enforces the existing provisioning limit: 15
minutes for cloud sessions and three minutes for console sessions. These
limits apply while the session is preparing or queued, even if renderer
polling stops. They do not impose an age limit on an already ready stream.
The separate 30-second transfer-stage limit still applies when state polling
continues to report `ReadyToConnect` after an accepted one-use proof.

Heartbeat HTTP 401, 403, 404 or 410 terminates and cleans up the currently owned
session. Cloud diagnostics preserve the fixed `keepalive` failure stage and
HTTP status. A transient network failure or HTTP 5xx does not by itself prove
that playback has ended; the next heartbeat may retry. No response body,
credential, provider session ID, SDP or ICE address is recorded.

Stop, account changes, owner teardown and terminal failure clear the interval.
Cleanup deletes only the session created by that service instance. These
guards add no autonomous provider state polling, console wake operation or
login attempt.

Each service retains its owned deletion promise after publishing Closed.
`cleanupPending` lets application shutdown join that work even when no IPC Stop
wrapper started it. Repeated Stop for an old local ID joins only that deletion;
shutdown Stop without an ID joins all owned pending deletions. An older failure
cannot publish after shutdown or replace a newer operation's state.

## Acceptance boundary

Service tests cover deadlines without further renderer polls, terminal and
transient heartbeat responses, overlap prevention and obsolete completions.
The real main-process lifecycle integration also exercises Quit while a service
is already Closed with an account-change deletion pending, and verifies that
final application exit waits for that same deletion without duplicating it.
Renderer regressions must execute the actual stream-host effects, including
the push-before-invoke-completion ordering. Playback acceptance must also load
the full App, initiate its Cloud Library action and let that host drive polling;
an isolated player with a separate polling loop cannot validate this lifecycle.
