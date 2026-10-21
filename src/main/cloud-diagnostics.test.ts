import {expect, it} from 'vitest';
import {CLOUD_DIAGNOSTIC_STAGES, safeCloudDiagnostic} from './cloud-diagnostics';

it('copies fixed protocol metadata while discarding every private response field', () => {
  expect(safeCloudDiagnostic({stage: 'play', outcome: 'http-error', httpStatus: 403, providerCode: 'InvalidCountry',
    url: 'https://secret.invalid/session', token: 'private-token', response: {account: 'private-account'}, sessionId: 'private-id', sdp: 'private-sdp', candidate: 'private-candidate'}))
    .toEqual({stage: 'play', outcome: 'http-error', httpStatus: 403, providerCode: 'InvalidCountry'});
});
it('rejects unknown events instead of preserving arbitrary messages or object properties', () => {
  for (const value of [null, [], 'private', {stage: 'private-token', outcome: 'ok'}, {stage: 'play', outcome: 'private-token'}]) expect(safeCloudDiagnostic(value)).toBeUndefined();
  expect(safeCloudDiagnostic({stage: 'state', outcome: 'http-error', httpStatus: '403', providerCode: 'private-token', serviceState: 'private-session'})).toEqual({stage: 'state', outcome: 'http-error'});
});
it.each(CLOUD_DIAGNOSTIC_STAGES)('allows only fixed HTTP status bounds and state enums at %s', stage => {
  expect(safeCloudDiagnostic({stage, outcome: 'ok', httpStatus: 200, serviceState: 'Provisioned'})).toEqual({stage, outcome: 'ok', httpStatus: 200, serviceState: 'Provisioned'});
  for (const status of [0, 99, 600, Infinity, NaN, 200.5]) expect(safeCloudDiagnostic({stage, outcome: 'http-error', httpStatus: status})).toEqual({stage, outcome: 'http-error'});
});
