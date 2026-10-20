import { createHash } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';

// Immutable Microsoft download. The hash is also embedded in the CDN path.
// Do not package or redistribute the Microsoft installer with the AppImage.
export const VC_REDIST_VERSION = '14.44.35211.0';
export const VC_REDIST_SHA256 = 'cc0ff0eb1dc3f5188ae6300faef32bf5beeba4bdd6e8e445a9184072096b713b';
export const VC_REDIST_URL = `https://download.visualstudio.microsoft.com/download/pr/bd1c8d9d-ba95-4eee-bc6e-df1fcc876373/${VC_REDIST_SHA256.toUpperCase()}/VC_redist.x64.exe`;

export function versionAtLeast(actual: string, minimum: string): boolean {
  const left = actual.split('.').map(Number);
  const right = minimum.split('.').map(Number);
  if (left.some((part) => !Number.isInteger(part)) || right.some((part) => !Number.isInteger(part))) return false;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    if ((left[index] ?? 0) !== (right[index] ?? 0)) return (left[index] ?? 0) > (right[index] ?? 0);
  }
  return true;
}

export async function installedVcRuntimeVersion(prefix: string): Promise<string | undefined> {
  const registry = await fs.readFile(path.join(prefix, 'system.reg'), 'utf8').catch(() => '');
  // Wine appends a numeric timestamp after the closing bracket.
  const start = registry.search(/^\[Software\\\\Microsoft\\\\VisualStudio\\\\14\.0\\\\VC\\\\Runtimes\\\\x64\](?:\s|$)/m);
  if (start < 0) return undefined;
  const end = registry.indexOf('\n[', start + 1);
  const section = registry.slice(start, end < 0 ? undefined : end);
  if (!/^"Installed"=dword:00000001$/m.test(section)) return undefined;
  // Microsoft's redistributable may register either 14.x or v14.x.
  return section.match(/^"Version"="v?([0-9.]+)"$/mi)?.[1];
}

async function sha256(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export async function downloadVerifiedVcRedist(
  cacheRoot: string,
  onProgress: (downloaded: number, total?: number) => void,
  signal?: AbortSignal,
): Promise<string> {
  await fs.mkdir(cacheRoot, { recursive: true, mode: 0o700 });
  const destination = path.join(cacheRoot, `vc_redist.x64-${VC_REDIST_VERSION}.exe`);
  if (await sha256(destination).catch(() => '') === VC_REDIST_SHA256) return destination;

  const temporary = `${destination}.part-${process.pid}-${Date.now()}`;
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    const deadline = AbortSignal.timeout(300_000);
    const response = await fetch(VC_REDIST_URL, { signal: signal ? AbortSignal.any([signal, deadline]) : deadline });
    if (!response.ok || !response.body) throw new Error(`Microsoft VC++ download failed (HTTP ${response.status}).`);
    const total = Number(response.headers.get('content-length')) || undefined;
    handle = await fs.open(temporary, 'wx', 0o600);
    const hash = createHash('sha256');
    let downloaded = 0;
    for await (const chunk of response.body) {
      let offset = 0;
      while (offset < chunk.length) {
        const { bytesWritten } = await handle.write(chunk, offset, chunk.length - offset);
        if (bytesWritten === 0) throw new Error('Microsoft VC++ download stopped writing to disk.');
        offset += bytesWritten;
      }
      hash.update(chunk);
      downloaded += chunk.length;
      onProgress(downloaded, total);
    }
    await handle.close();
    handle = undefined;
    if (hash.digest('hex') !== VC_REDIST_SHA256) throw new Error('Microsoft VC++ download failed SHA-256 verification.');
    await fs.rename(temporary, destination);
    return destination;
  } finally {
    await handle?.close().catch(() => undefined);
    await fs.unlink(temporary).catch(() => undefined);
  }
}
