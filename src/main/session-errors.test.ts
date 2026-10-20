import { expect, it } from 'vitest';
import { sessionFailureMessage, sessionStages, ticketFailureDiagnostic } from './session-errors.js';

const line = (stage: string) => `NEXUS_SESSION_DIAGNOSTIC_V1 ${stage}\n`;
it('distinguishes refusal, interactive prompts and verification/format errors without exposing payloads', () => {
  const frame = 'NEXUS_TICKET_DIAGNOSTIC_V1 ticket-interaction-required 800488AB';
  expect(ticketFailureDiagnostic(frame)).toEqual({ stage: 'ticket-interaction-required', serviceCode: '800488AB' });
  expect(sessionFailureMessage(frame)).toContain('interactive sign-in (code 0x800488AB)');
  expect(sessionFailureMessage(frame)).toContain('has not been deleted');
  expect(sessionFailureMessage('NEXUS_TICKET_DIAGNOSTIC_V1 ticket-refused 800488AB')).toContain('Microsoft refused');
  expect(sessionFailureMessage(line('ticket-request-build'))).toContain('build a ticket request');
  expect(sessionFailureMessage(line('ticket-response-parse'))).toContain('unreadable response');
  expect(sessionFailureMessage(line('ticket-response-signature'))).toContain('verification failed');
  expect(sessionFailureMessage(frame + '\n' + line('ticket-response-received'))).toBeUndefined();
  expect(sessionFailureMessage(frame + '\n' + line('ticket-timeout'))).not.toContain('800488AB');
  for (const raw of [frame + ' secret', 'prefix ' + frame, frame.replace('800488AB', '800488AZ'), frame.replace('800488AB', '800488ab'),
    frame.replace('800488AB', 'secret@example.test'), frame.replace('800488AB', '800488A'), frame.replace('800488AB', '800488ABC')]) {
    expect(ticketFailureDiagnostic(raw)).toBeUndefined(); expect(sessionFailureMessage(raw)).toBeUndefined();
  }
});
it('distinguishes expired sign-in, transient transport and renewal failures using fixed text', () => {
  expect(sessionFailureMessage(line('session-user-expired'))).toContain('Sign in again');
  expect(sessionFailureMessage(line('session-user-expired'))).toContain('has not been deleted');
  expect(sessionFailureMessage(line('ticket-timeout'))).toContain('timed out');
  expect(sessionFailureMessage(line('ticket-connect'))).toContain('connection');
  expect(sessionFailureMessage(line('session-device-refresh-failed'))).toContain('could not be renewed');
  expect(sessionFailureMessage(line('session-account-changed'))).toContain('account changed');
});
it('never displays arbitrary output, unknown codes, injected lines or incomplete markers', () => {
  for (const raw of ['private@example.test t=SECRET&p=SECRET', line('secret'),
    'prefix ' + line('session-user-expired'), line('ticket-timeout').trimEnd() + ' SECRET\n',
    'NEXUS_SESSION_DIAGNOSTIC_V1', line('ticket-retry'), line('session-device-refresh'),
    'NEXUS_SESSION_DIAGNOSTIC_V1 ' + 'x'.repeat(1000)]) expect(sessionFailureMessage(raw)).toBeUndefined();
  for (const code of sessionStages) expect(sessionFailureMessage(`user@example.test\n${line(code)}raw-secret`) ?? '').not.toMatch(/example\.test|raw-secret/);
});
it('uses the last actionable classification and bounds the inspected output', () => {
  expect(sessionFailureMessage(line('ticket-timeout') + line('ticket-retry') + line('ticket-connect'))).toContain('Could not connect');
  expect(sessionFailureMessage(line('ticket-timeout') + line('ticket-retry') + line('ticket-response-received') + 'entitlements rejected')).toBeUndefined();
  expect(sessionFailureMessage(line('session-user-expired') + 'x'.repeat(70_000))).toBeUndefined();
});
