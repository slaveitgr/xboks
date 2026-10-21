import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type SecretServiceProvider = 'kwallet' | 'ksecretd' | 'other' | 'unknown';
const serviceName = 'org.freedesktop.secrets';
const maxBytes = 16_384;

/** Read activation metadata only. Exec is identified, never run or evaluated. */
export function activationProvider(text: string): { name?: string; provider: SecretServiceProvider } {
  if (Buffer.byteLength(text, 'utf8') > maxBytes || text.includes('\0')) return { provider: 'unknown' };
  let section = '', duplicate = false;
  const values = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('[')) {
      section = line;
      continue;
    }
    if (section !== '[D-BUS Service]') continue;
    const match = /^([A-Za-z]+)\s*=(.*)$/.exec(line);
    if (!match || !['Name', 'Exec', 'SystemdService'].includes(match[1])) continue;
    if (values.has(match[1])) duplicate = true;
    values.set(match[1], match[2].trim());
  }
  const name = values.get('Name');
  if (duplicate || !values.get('Exec')) return { name, provider: 'unknown' };
  // D-Bus Exec is not a shell command. Recognize only an ordinary first
  // executable argument, not wrappers, substitutions or compound commands.
  const executable = /^(?:"([^"\\]+)"|([^\s"'\\]+))(?:\s|$)/.exec(values.get('Exec')!);
  if (!executable) return { name, provider: 'unknown' };
  const binary = path.basename(executable[1] ?? executable[2]);
  const provider = binary === 'ksecretd' ? 'ksecretd'
    : /^kwalletd[56]$/.test(binary) ? 'kwallet' : 'other';
  // An explicit systemd unit can override Exec. Do not attribute an unknown
  // unit to KDE based on an otherwise familiar executable.
  const unit = values.get('SystemdService');
  if (unit && ![
    ...(provider === 'ksecretd' ? ['plasma-ksecretd.service'] : []),
    ...(provider === 'kwallet' ? ['plasma-kwalletd5.service', 'plasma-kwalletd6.service'] : []),
  ].includes(unit)) return { name, provider: 'unknown' };
  return { name, provider };
}

async function readActivation(file: string): Promise<string> {
  // Symlinks to a distribution's provider-specific service file are valid.
  // Nonblocking open and fstat keep FIFOs/devices/directories out of this read.
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxBytes) throw Error('Invalid activation metadata');
    const buffer = Buffer.alloc(maxBytes + 1);
    let size = 0;
    while (size < buffer.length) {
      const read = await handle.read(buffer, size, buffer.length - size, null);
      if (!read.bytesRead) break;
      size += read.bytesRead;
    }
    if (size > maxBytes) throw Error('Activation metadata too large');
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size));
  } finally { await handle.close(); }
}

/** Best-effort attribution for an unowned, activatable standard Secret Service.
 * Follow standard session-service directory precedence. A running bus may use
 * custom directories or cached metadata, so unknown/ambiguous results must not
 * block a provider or infer KDE from the desktop or other installed services.
 */
export async function secretServiceProvider(
  environment: NodeJS.ProcessEnv,
  systemDataDirectory = '/usr/share',
): Promise<SecretServiceProvider> {
  const dataHome = environment.XDG_DATA_HOME || path.join(environment.HOME || os.homedir(), '.local/share');
  const bases = [environment.XDG_RUNTIME_DIR, dataHome,
    ...(environment.XDG_DATA_DIRS || '/usr/local/share:/usr/share').split(':'), systemDataDirectory];
  if (bases.length > 32) return 'unknown';
  const seen = new Set<string>();
  for (const base of bases) {
    if (!base || !path.isAbsolute(base)) continue;
    const directory = path.join(base, 'dbus-1/services');
    if (seen.has(directory)) continue;
    seen.add(directory);
    const runtime = base === environment.XDG_RUNTIME_DIR;
    try {
      const files: string[] = [];
      const entries = await fs.opendir(directory);
      let count = 0;
      for await (const entry of entries) {
        if (++count > 1024) return 'unknown';
        if (entry.name.endsWith('.service') && (!runtime || entry.name === `${serviceName}.service`)) files.push(entry.name);
      }
      let match: SecretServiceProvider | undefined;
      for (const file of files) {
        let text: string;
        try { text = await readActivation(path.join(directory, file)); }
        catch { return 'unknown'; }
        const parsed = activationProvider(text);
        if (parsed.name !== serviceName) continue;
        // D-Bus makes no selection guarantee for duplicate names in one dir.
        if (match !== undefined) return 'unknown';
        match = parsed.provider;
      }
      if (match !== undefined) return match;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') return 'unknown';
    }
  }
  return 'unknown';
}
