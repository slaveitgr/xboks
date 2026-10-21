// Only fixed, backend-owned codes cross the private stderr boundary. Never show
// arbitrary backend stderr, JSON, account identifiers or provider error text.
const messages: Record<string, string> = {
  'keyring-unavailable': 'The system keyring could not be accessed. Check that it is running and unlocked, then try again. On KDE or SteamOS, check that KDE Wallet is enabled. Use Desktop Mode to unlock it without removing its password.',
  'keyring-invalid-data': 'Stored xboks Engine credentials are empty or invalid. Check the system keyring; reinstalling xboks does not repair these credentials.',
  'keyring-write-verification': 'The system keyring did not return the credentials just saved. Check the keyring service before trying sign-in again.',
  'keyring-missing-data': 'Required xboks Engine credentials are missing. Please sign in again.',
  'device-authentication': 'Device authentication did not complete. Check the network connection and try again.',
  'credential-io': 'Stored xboks Engine credentials could not be read or saved.',
};

export class CredentialErrorReader {
  private line = '';
  private discard = false;
  private total = 0;
  message: string | undefined;

  push(bytes: Buffer): void {
    for (const byte of bytes) {
      if (++this.total > 2 * 1024 * 1024) return;
      if (byte === 10) {
        if (!this.discard && !this.message) {
          const match = /^NEXUS_CREDENTIAL_ERROR_V1 ([a-z-]+)\r?$/.exec(this.line);
          if (match && Object.hasOwn(messages, match[1])) this.message = messages[match[1]];
        }
        this.line = ''; this.discard = false;
      } else if (!this.discard) {
        if (this.line.length >= 96 || byte > 127) { this.line = ''; this.discard = true; }
        else this.line += String.fromCharCode(byte);
      }
    }
  }
}
