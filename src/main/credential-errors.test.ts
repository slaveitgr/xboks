import { describe, expect, it } from 'vitest';
import { CredentialErrorReader } from './credential-errors.js';

describe('sanitized credential errors', () => {
  it('accepts only complete allowlisted lines across arbitrary chunk boundaries', () => {
    for (const code of ['keyring-unavailable', 'keyring-invalid-data', 'keyring-write-verification', 'keyring-missing-data', 'device-authentication', 'credential-io']) {
      const bytes = Buffer.from(`private-account-data\nNEXUS_CREDENTIAL_ERROR_V1 ${code}\r\n`);
      for (let split = 0; split <= bytes.length; split++) {
        const reader = new CredentialErrorReader(); reader.push(bytes.subarray(0, split)); reader.push(bytes.subarray(split));
        expect(reader.message).toBeTruthy(); expect(reader.message).not.toContain(code);
        expect(reader.message).not.toContain('private-account-data');
      }
    }
  });
  it('discards raw output, unknown codes, injected prefixes and long or incomplete lines', () => {
    for (const value of ['private-secret\n', 'NEXUS_CREDENTIAL_ERROR_V1 private-secret\n', 'prefix NEXUS_CREDENTIAL_ERROR_V1 keyring-invalid-data\n',
      'NEXUS_CREDENTIAL_ERROR_V1 keyring-invalid-data private-secret\n', 'NEXUS_CREDENTIAL_ERROR_V1 keyring-invalid-data',
      `${'x'.repeat(1000)}NEXUS_CREDENTIAL_ERROR_V1 keyring-invalid-data\n`, '\u00e9NEXUS_CREDENTIAL_ERROR_V1 keyring-invalid-data\n']) {
      const reader = new CredentialErrorReader(); reader.push(Buffer.from(value)); expect(reader.message).toBeUndefined();
    }
  });
  it('recovers after an oversized line and bounds total parsing', () => {
    const reader = new CredentialErrorReader(); reader.push(Buffer.from('x'.repeat(10_000) + '\nNEXUS_CREDENTIAL_ERROR_V1 keyring-invalid-data\n'));
    expect(reader.message).toContain('empty or invalid');
    const limited = new CredentialErrorReader(); limited.push(Buffer.alloc(2 * 1024 * 1024, 120));
    limited.push(Buffer.from('\nNEXUS_CREDENTIAL_ERROR_V1 keyring-invalid-data\n')); expect(limited.message).toBeUndefined();
  });
});
