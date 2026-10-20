/** Strict metadata from the downloader, never raw CDN URLs or provider messages. */
export const transferStages = new Set([
  'transfer-headers-timeout', 'transfer-idle-timeout', 'transfer-request', 'transfer-read',
  'transfer-eof', 'transfer-http', 'transfer-range', 'transfer-encoding', 'transfer-size',
  'transfer-io', 'transfer-cancelled',
  'metadata-http', 'metadata-headers-timeout', 'metadata-request', 'metadata-encoding', 'metadata-invalid',
]);
export function transferDiagnostic(line: string): { stage: string; status?: number } | undefined {
  if (line.length > 128 || /[\r\n]/.test(line)) return;
  const match = /^NEXUS_TRANSFER_DIAGNOSTIC_V1 ([a-z-]{1,50}) (0|[1-5][0-9]{2})$/.exec(line);
  if (!match || !transferStages.has(match[1])) return;
  const status = Number(match[2]);
  return { stage: match[1], status: status || undefined };
}
export function transferFailure(log: string[]): string | undefined {
  let record: ReturnType<typeof transferDiagnostic>;
  for (const line of log.slice(-256)) {
    const next = transferDiagnostic(line);
    if (next && next.stage !== 'transfer-cancelled') record = next;
  }
  if (!record) return;
  const resume = 'Partial files are kept. Use Retry installation to refresh the package link and resume.';
  switch (record.stage) {
    case 'metadata-http': case 'transfer-http':
      if (record.status === 401 || record.status === 403) return `The package download link was rejected (HTTP ${record.status}). ${resume}`;
      if (record.status === 429) return `The download server is rate-limiting requests (HTTP 429). Wait before retrying. ${resume}`;
      return `The download server returned an unexpected HTTP response${record.status ? ` (HTTP ${record.status})` : ''}. ${resume}`;
    case 'metadata-headers-timeout': case 'transfer-headers-timeout': return `The download server did not respond in time after repeated attempts. ${resume}`;
    case 'transfer-idle-timeout': return `The download stopped receiving data after repeated attempts. ${resume}`;
    case 'metadata-request': case 'transfer-request': case 'transfer-read': case 'transfer-eof': return `The download connection failed or ended before all data arrived. ${resume}`;
    case 'metadata-encoding': case 'transfer-range': case 'transfer-encoding': case 'transfer-size': return `The server returned an invalid package byte range or encoding. Unsafe data was not accepted. ${resume}`;
    case 'metadata-invalid': return `The package metadata could not be read or is invalid. ${resume}`;
    case 'transfer-io': return `The download could not read or write its files or checkpoints. Check free space and folder permissions. ${resume}`;
  }
}
