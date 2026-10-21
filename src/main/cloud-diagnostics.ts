/** Fixed protocol metadata only. Never accept URLs, IDs, headers or response text. */
export const CLOUD_DIAGNOSTIC_STAGES = ['credential', 'transfer-credential', 'connect', 'login', 'catalog', 'recent', 'play', 'state', 'sdp-send', 'sdp-receive', 'ice-send', 'ice-receive', 'keepalive', 'stop'] as const;
export type CloudDiagnosticStage = typeof CLOUD_DIAGNOSTIC_STAGES[number];
export const CLOUD_DIAGNOSTIC_OUTCOMES = ['ok', 'pending', 'http-error', 'network-error', 'invalid-response', 'timeout', 'unsupported'] as const;
export const CLOUD_SERVICE_STATES = ['Provisioning', 'Provisioned', 'ReadyToConnect', 'Queued', 'WaitingForResources', 'Failed', 'Terminated', 'Canceled', 'Disconnected', 'Error'] as const;
export const CLOUD_PROVIDER_CODES = ['InvalidCountry', 'BadRequest', 'InvalidArgument', 'InvalidDeviceInfo', 'UnsupportedDevice', 'InvalidClient', 'Unauthorized', 'NotAuthorized', 'Forbidden', 'AccessDenied', 'NotFound', 'TitleNotFound', 'GameNotEntitled', 'EntitlementNotFound', 'NoSubscription', 'ConcurrentSession', 'ServiceUnavailable'] as const;
export interface CloudDiagnosticEvent {
  stage: CloudDiagnosticStage;
  outcome: typeof CLOUD_DIAGNOSTIC_OUTCOMES[number];
  httpStatus?: number;
  providerCode?: typeof CLOUD_PROVIDER_CODES[number];
  serviceState?: typeof CLOUD_SERVICE_STATES[number];
}
export function safeCloudDiagnostic(value: unknown): CloudDiagnosticEvent | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const row = value as Record<string, unknown>;
  if (!(CLOUD_DIAGNOSTIC_STAGES as readonly unknown[]).includes(row.stage) || !(CLOUD_DIAGNOSTIC_OUTCOMES as readonly unknown[]).includes(row.outcome)) return;
  return {stage: row.stage as CloudDiagnosticStage, outcome: row.outcome as CloudDiagnosticEvent['outcome'],
    ...(Number.isInteger(row.httpStatus) && Number(row.httpStatus) >= 100 && Number(row.httpStatus) <= 599 ? {httpStatus: Number(row.httpStatus)} : {}),
    ...((CLOUD_PROVIDER_CODES as readonly unknown[]).includes(row.providerCode) ? {providerCode: row.providerCode as CloudDiagnosticEvent['providerCode']} : {}),
    ...((CLOUD_SERVICE_STATES as readonly unknown[]).includes(row.serviceState) ? {serviceState: row.serviceState as CloudDiagnosticEvent['serviceState']} : {})};
}
