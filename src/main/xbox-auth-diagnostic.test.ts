import { expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BackendDiagnosticReader, BackendDiagnostics } from './backend-diagnostics.js';
import { xboxAuthDiagnostic, xboxAuthOperations } from './xbox-auth-diagnostic.js';

it('accepts fixed authentication outcomes for both wire-compatible and branded engine frames', () => {
  for (const prefix of ['NEXUS', 'XBOKS']) {
    expect(xboxAuthDiagnostic(`${prefix}_XBOX_AUTH_DIAGNOSTIC_V1 xbox-xsts-http 401 8015DC12`)).toEqual({ stage: 'xbox-xsts-http', status: 401, serviceCode: '8015DC12' });
    expect(xboxAuthDiagnostic(`${prefix}_XBOX_AUTH_DIAGNOSTIC_V1 xbox-user-response 200 00000000`)).toEqual({ stage: 'xbox-user-response', status: 200, serviceCode: undefined });
    for (const stage of ['connect', 'timeout', 'request']) expect(xboxAuthDiagnostic(`${prefix}_XBOX_AUTH_DIAGNOSTIC_V1 xbox-user-${stage} 0 00000000`)).toEqual({ stage: `xbox-user-${stage}`, status: undefined, serviceCode: undefined });
  }
});

it('rejects mismatched status classes, freeform suffixes, identifiers, lowercase or nonnumeric service codes', () => {
  const prefix = 'NEXUS_XBOX_AUTH_DIAGNOSTIC_V1 ';
  for (const value of ['xbox-user-http 200 8015DC12', 'xbox-user-response 401 00000000', 'xbox-user-connect 200 00000000',
    'xbox-user-timeout 0 8015DC12', 'xbox-user-http 401 8015dc12', 'xbox-user-http 401 private!', 'xbox-user-http 401 8015DC12 SECRET',
    'xbox-user-unknown 401 8015DC12', 'xbox-xsts-http 401 https://private.test/?token=SECRET', 'xbox-user-http 999 8015DC12'])
    expect(xboxAuthDiagnostic(prefix + value), value).toBeUndefined();
});

it('frames byte-split input, rejects non-ASCII/oversized lines and keeps operation admission separate', () => {
  for (const operation of ['run', 'profile', 'library', 'streaming', 'download', 'license', 'service', 'social']) {
    const events: unknown[] = [], reader = new BackendDiagnosticReader(operation, event => events.push(event));
    const input = 'NEXUS_XBOX_AUTH_DIAGNOSTIC_V1 xbox-xsts-http 403 8015DC12\r\n';
    for (const byte of Buffer.from(input)) reader.push(Buffer.from([byte]));
    reader.push(Buffer.from('NEXUS_XBOX_AUTH_DIAGNOSTIC_V1 xbox-xsts-http 403 8015DC12 ' + 'SECRET'.repeat(100) + '\n'));
    reader.push(Buffer.from('NEXUS_XBOX_AUTH_DIAGNOSTIC_V1 xbox-xsts-http 403 8015DC12é\n'));
    expect(events).toHaveLength(1); expect(events[0]).toMatchObject({ operation, stage: 'xbox-xsts-http', status: 403, serviceCode: '8015DC12' });
  }
  for (const operation of ['login', 'logout', 'probe', 'account', 'cloud-stream']) {
    const events: unknown[] = [];
    new BackendDiagnosticReader(operation, event => events.push(event)).push(Buffer.from('NEXUS_XBOX_AUTH_DIAGNOSTIC_V1 xbox-user-http 401 8015DC12\n'));
    expect(events).toEqual([]); expect(xboxAuthOperations.has(operation)).toBe(false);
  }
});

it('persists only bounded stage/status/code and preserves the independent cloud diagnostic contract', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xboks-auth-diagnostic-'));
  try {
    const log = new BackendDiagnostics(root);
    const reader = new BackendDiagnosticReader('run', record => log.record(record));
    reader.push(Buffer.from('XBOKS_XBOX_AUTH_DIAGNOSTIC_V1 xbox-xsts-http 401 8015DC12\n'));
    reader.push(Buffer.from('NEXUS_XBOX_AUTH_DIAGNOSTIC_V1 xbox-xsts-http 401 https://private.test?token=SECRET\n'));
    log.record({ operation: 'run', event: 'diagnostic', stage: 'xbox-user-request', serviceCode: '8015DC12' });
    log.record({ operation: 'cloud-stream', event: 'diagnostic', cloud: { stage: 'play', outcome: 'ok', httpStatus: 202, serviceState: 'Provisioning' } });
    const { content } = await log.read(), rows = content.trim().split('\n').map(line => JSON.parse(line));
    expect(rows).toHaveLength(3); expect(rows[0]).toMatchObject({ operation: 'run', stage: 'xbox-xsts-http', status: 401, serviceCode: '8015DC12' });
    expect(rows[1].serviceCode).toBeUndefined(); expect(rows[2]).toMatchObject({ operation: 'cloud-stream', stage: 'play', outcome: 'ok', status: 202, serviceState: 'Provisioning' });
    expect(content).not.toMatch(/SECRET|private.test|token=|NEXUS_XBOX_AUTH|XBOKS_XBOX_AUTH/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
