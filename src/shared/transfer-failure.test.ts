import { expect, it } from 'vitest';
import { transferDiagnostic, transferFailure, transferStages } from './transfer-failure.js';
import { downloadFailure } from './utils.js';
const line = (stage: string, status = 0) => `NEXUS_TRANSFER_DIAGNOSTIC_V1 ${stage} ${status}`;
it('separates transport, actual HTTP status, range safety and disk failures without blaming ownership', () => {
  for (const [stage, text] of [['transfer-headers-timeout','did not respond'],['transfer-idle-timeout','stopped receiving'],['transfer-request','connection failed'],['transfer-read','connection failed'],['transfer-eof','connection failed'],['transfer-range','Unsafe data'],['transfer-encoding','Unsafe data'],['transfer-size','Unsafe data'],['transfer-io','free space']]) {
    expect(transferFailure([line(stage)])).toContain(text);
  }
  for (const status of [401,403,429,503]) {
    const text = transferFailure([line('transfer-http',status)])!;
    expect(text).toContain(`HTTP ${status}`); expect(text).toContain('Partial files are kept');
    expect(text).not.toMatch(/do not own|license|Sign in/);
  }
  expect(transferFailure([line('transfer-http',429)])).toContain('Wait');
});
it('strictly accepts only bounded complete metadata records', () => {
  for (const raw of [line('unknown'),line('transfer-http',999),line('transfer-http',-1),line('transfer-http',99),line('transfer-http',600),line('transfer-http')+' SECRET','prefix '+line('transfer-http'),line('transfer-http')+'\n','https://signed.example/?token=SECRET']) expect(transferDiagnostic(raw)).toBeUndefined();
  for (const stage of transferStages) expect(transferDiagnostic(line(stage))).toEqual({stage,status:undefined});
});
it('keeps metadata failures distinct from ownership errors and preserves the real HTTP status', () => {
  expect(transferFailure([line('metadata-http', 403)])).toContain('HTTP 403');
  expect(transferFailure([line('metadata-http', 429)])).toContain('Wait');
  expect(transferFailure([line('metadata-headers-timeout')])).toContain('did not respond');
  expect(transferFailure([line('metadata-request')])).toContain('connection failed');
  expect(transferFailure([line('metadata-encoding')])).toContain('Unsafe data');
  expect(transferFailure([line('metadata-invalid')])).toContain('metadata could not be read');
});
it('keeps the real failing cause when sibling transfers are cancelled and bounds old records', () => {
  expect(transferFailure([line('transfer-http',403),line('transfer-cancelled')])).toContain('HTTP 403');
  expect(transferFailure([line('transfer-cancelled')])).toBeUndefined();
  expect(transferFailure([line('transfer-http',503),...Array(256).fill('other')])).toBeUndefined();
  expect(downloadFailure(['NEXUS_CONTENT_LICENSE_DIAGNOSTIC_V1 content-parsed 200',line('transfer-http',503),'raw secret signed url'],1)).toContain('HTTP 503');
  expect(downloadFailure([line('transfer-http',503),'raw secret signed url'],1)).not.toContain('secret');
});
