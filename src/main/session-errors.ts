/** Fixed codes only. Never return an arbitrary backend/provider message. */
export const sessionStages = new Set([
  'session-user-unavailable', 'session-user-expired', 'session-user-invalid',
  'session-device-unavailable', 'session-device-invalid', 'session-device-refresh',
  'session-device-refresh-failed', 'session-account-changed',
  'ticket-timeout', 'ticket-connect', 'ticket-network', 'ticket-response', 'ticket-retry', 'ticket-response-received',
  'ticket-request-build', 'ticket-response-parse', 'ticket-response-signature', 'ticket-response-crypto',
  'ticket-interaction-required', 'ticket-refused',
]);

export function ticketFailureDiagnostic(line: string): { stage: string; serviceCode: string } | undefined {
  const match = /^NEXUS_TICKET_DIAGNOSTIC_V1 (ticket-refused|ticket-interaction-required) ([A-F0-9]{8})$/.exec(line);
  return match ? { stage: match[1], serviceCode: match[2] } : undefined;
}

export function sessionFailureMessage(output: string): string | undefined {
  let last: string | undefined;
  let serviceCode: string | undefined;
  for (const line of output.slice(-64_000).split(/\r?\n/)) {
    const ticket = ticketFailureDiagnostic(line);
    if (ticket) { last = ticket.stage; serviceCode = ticket.serviceCode; continue; }
    const match = /^NEXUS_SESSION_DIAGNOSTIC_V1 ([a-z-]{1,60})$/.exec(line);
    if (match?.[1] === 'ticket-response-received') { last = undefined; serviceCode = undefined; }
    else if (match && sessionStages.has(match[1]) && !['ticket-retry', 'session-device-refresh'].includes(match[1])) { last = match[1]; serviceCode = undefined; }
  }
  if (last === 'session-user-unavailable') return 'Stored Microsoft sign-in could not be read. Unlock the system keyring and try Refresh again; if it persists, sign in again in Settings.';
  if (last === 'session-user-expired' || last === 'session-user-invalid') return 'Your Microsoft sign-in has expired or is invalid. Sign in again in Settings. Your saved account has not been deleted.';
  if (last === 'session-device-unavailable' || last === 'session-device-invalid') return 'Microsoft device credentials are unavailable. Check that the system keyring is unlocked, then sign in again in Settings.';
  if (last === 'session-device-refresh-failed') return 'Microsoft device sign-in could not be renewed. Check your connection and try Refresh again. Your saved account has not been deleted.';
  if (last === 'session-account-changed') return 'The Microsoft account changed during this request. Refresh the library again.';
  if (last === 'ticket-timeout') return 'Microsoft Store sign-in timed out. Check your connection and try Refresh again.';
  if (last === 'ticket-connect' || last === 'ticket-network') return 'Could not connect to Microsoft Store sign-in. Check your connection and try Refresh again.';
  if (last === 'ticket-response') return 'Microsoft Store sign-in returned an unusable response. Try Refresh again; if it persists, share the backend diagnostic log.';
  const code = serviceCode ? ` (code 0x${serviceCode})` : '';
  if (last === 'ticket-interaction-required') return `Microsoft requires an interactive sign-in${code}. Sign in again in Settings to complete any required account prompts. Your saved account has not been deleted.`;
  if (last === 'ticket-refused') return `Microsoft refused the stored sign-in${code}. Try signing in again in Settings; if it persists, share the backend diagnostic log. Your saved account has not been deleted.`;
  if (last === 'ticket-request-build') return 'The stored Microsoft sign-in could not be used to build a ticket request. Sign in again in Settings; if it persists, share the backend diagnostic log.';
  if (last === 'ticket-response-parse') return 'Microsoft Store sign-in returned an unreadable response. Check for a captive portal or network filtering, then try Refresh. If it persists, share the backend diagnostic log.';
  if (last === 'ticket-response-signature' || last === 'ticket-response-crypto') return 'Microsoft Store sign-in response verification failed. Access was not granted. Try Refresh; if it persists, share the backend diagnostic log.';
}
