import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { createConnection, createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { selectedWinePath, startXodusBridge, startXodusService, storeContentRuntime } from './xodus-service.js';

it.each(['credential', 'unknown', 'stdout'])('reports only safe service %s errors and cleans its private session directory', async mode => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xboks-service-error-'));
  try {
    const marker = mode === 'unknown' ? 'NEXUS_CREDENTIAL_ERROR_V1 private-secret\n' : 'NEXUS_CREDENTIAL_ERROR_V1 keyring-unavailable\n';
    const body = `#!/usr/bin/env node\nprocess.stderr.write('private-account-token\\n');\nprocess.${mode === 'stdout' ? 'stdout' : 'stderr'}.write(${JSON.stringify(marker)});\nprocess.exitCode=1;\n`;
    await fs.writeFile(path.join(root, 'xboks-engine-service'), body, { mode: 0o700 });
    const error = await startXodusService(path.join(root, 'xboks-engine-backend'), path.join(root, 'profile'), () => {}).then(() => '', error => error.message as string);
    expect(error).toContain(mode === 'credential' ? 'system keyring could not be accessed' : 'xboks Engine account service exited with code 1');
    expect(error).not.toMatch(/private-account|private-secret/);
    expect(await fs.readdir(path.join(root, 'profile/service-sessions'))).toEqual([]);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

it('requires all genuine Store/content/bridge runtime capabilities, not just an installed Wine binary', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-content-runtime-'));
  try {
    const wine = path.join(root, 'files/bin/wine');
    expect(await storeContentRuntime(wine)).toBe(false);
    const features = ['xstore-entitlements-v1', 'xpackage-content-v1', 'xstore-package-license-v1', 'xodus-tcp-bridge-v1', 'cloud-saves-pr28'];
    for (const missing of features) {
      await fs.writeFile(path.join(root, 'XODUS_NEXUS_PATCH.json'), JSON.stringify({ features: features.filter(feature => feature !== missing) }));
      expect(await storeContentRuntime(wine)).toBe(false);
    }
    await fs.writeFile(path.join(root, 'XODUS_NEXUS_PATCH.json'), JSON.stringify({ features }));
    expect(await storeContentRuntime(wine)).toBe(true);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

describe('selectedWinePath', () => {
  const root = '/data/runtimes';
  const active = '/data/runtimes/releases/new/files/bin/wine';

  it('follows the managed runtime pointer when settings still name an older release', () => {
    expect(selectedWinePath('/data/runtimes/releases/old/files/bin/wine', root, active)).toBe(active);
  });

  it('uses one external configured Wine for every game', () => {
    expect(selectedWinePath('/custom/global/wine', root, active)).toBe('/custom/global/wine');
    expect(selectedWinePath('', root, active)).toBe(active);
  });
});

describe('startXodusBridge', () => {
  it('forwards authenticated loopback traffic to the private Unix socket', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'xodus-bridge-test-'));
    const socketPath = path.join(dir, 'backend.sock');
    let connections = 0;
    const backend = createServer((socket) => {
      connections += 1;
      socket.on('data', (chunk) => socket.write(chunk));
    });
    backend.listen(socketPath);
    await once(backend, 'listening');
    const bridge = await startXodusBridge(socketPath);
    try {
      const client = createConnection(bridge.port, '127.0.0.1');
      await once(client, 'connect');
      client.write(`${bridge.key}ping`);
      const [reply] = await once(client, 'data') as [Buffer];
      expect(reply.toString()).toBe('ping');
      client.destroy();

      const rejected = createConnection(bridge.port, '127.0.0.1');
      await once(rejected, 'connect');
      rejected.write(`${'0'.repeat(64)}ping`);
      await once(rejected, 'close');
      expect(connections).toBe(1);
    } finally {
      await bridge.stop();
      await new Promise<void>((resolve) => backend.close(() => resolve()));
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
