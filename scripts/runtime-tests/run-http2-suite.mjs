#!/usr/bin/env node
// Loopback TLS/H2 only; installs its test CA only in a fresh private prefix.
import fs from 'node:fs/promises';
import path from 'node:path';
import http2 from 'node:http2';
import { gzipSync, deflateRawSync } from 'node:zlib';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const [runtimeArg, workArg] = process.argv.slice(2);
if (!runtimeArg || !workArg || process.argv.length !== 4) throw new Error('Usage: run-http2-suite.mjs RUNTIME WORK_PARENT');
const files = path.join(await fs.realpath(runtimeArg), 'files');
const root = await fs.mkdtemp(path.join(await fs.realpath(workArg), 'runtime-http2-'));
await fs.chmod(root, 0o700);
const prefix = path.join(root, 'pfx');
const executable = path.join(root, 'http2-suite.exe');
const source = path.join(path.dirname(fileURLToPath(import.meta.url)), 'http2-suite.c');
execFileSync('x86_64-w64-mingw32-gcc', ['-O2', '-Wall', source, '-o', executable, '-lwinhttp', '-lcrypt32'], { stdio: 'inherit' });
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-keyout', path.join(root, 'server.key'), '-out', path.join(root, 'server.pem'), '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost', '-addext', 'extendedKeyUsage=serverAuth'], { stdio: 'ignore' });
execFileSync('openssl', ['x509', '-in', path.join(root, 'server.pem'), '-outform', 'DER', '-out', path.join(root, 'server.der')]);
await fs.chmod(path.join(root, 'server.key'), 0o600);
const body = Buffer.from(Array.from({ length: 200000 }, (_, i) => 97 + i % 26));
const gzip = gzipSync(body), deflate = deflateRawSync(body);
const noise = Buffer.from(Array.from({ length: body.length }, (_, i) => {
  let n = i >>> 0;
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return (n ^ (n >>> 16)) & 255;
}));
const largeGzip = gzipSync(noise);
const server = http2.createSecureServer({ key: await fs.readFile(path.join(root, 'server.key')), cert: await fs.readFile(path.join(root, 'server.pem')), allowHTTP1: true });
const sessions = new Set();
server.on('session', session => { sessions.add(session); session.on('error', () => {}); session.on('close', () => sessions.delete(session)); });
server.on('request', (request, response) => {
  request.on('error', () => {}); response.on('error', () => {});
  const send = (code, data = Buffer.alloc(0), extra = {}) => {
    if (response.destroyed) return;
    response.writeHead(code, { 'content-length': data.length, ...extra }); response.end(data);
  };
  if (request.url === '/echo') {
    const parts = []; let count = 0;
    request.on('data', part => { count += part.length; if (count <= 300000) parts.push(part); else request.destroy(); });
    request.on('end', () => send(201, Buffer.concat(parts)));
  } else if (request.url.startsWith('/gzip') || request.url === '/deflate') {
    const encoding = request.url === '/deflate' ? 'deflate' : 'gzip';
    const bytes = request.url === '/gzip-large' ? largeGzip : request.url === '/gzip-empty' ? gzipSync(Buffer.alloc(0)) :
      request.url === '/gzip-invalid' ? Buffer.from('invalid compressed response') :
      request.url === '/gzip-truncated' ? gzip.subarray(0, gzip.length - 8) : encoding === 'deflate' ? deflate : gzip;
    if (request.url === '/gzip-chunked') {
      response.writeHead(200, { 'content-encoding': encoding });
      for (let offset = 0; offset < bytes.length; offset += 7) response.write(bytes.subarray(offset, offset + 7));
      response.end();
    } else send(200, bytes, { 'content-encoding': encoding });
  } else if (request.url === '/chunked') {
    response.writeHead(200, { 'content-type': 'application/octet-stream' });
    let offset = 0;
    const write = () => {
      if (response.destroyed) return;
      if (offset < body.length) {
        response.write(body.subarray(offset, offset + 5000)); offset += 5000;
        setImmediate(write);
      } else {
        if (request.httpVersionMajor === 1) response.addTrailers({ 'x-test-trailer': 'present' });
        response.end();
      }
    };
    write();
  } else if (request.url === '/encoding') send(request.headers['accept-encoding'] === 'gzip' ? 200 : 400, body);
  else if (request.url === '/body') send(200, body);
  else if (request.url === '/head') send(405);
  else if (request.url === '/error') send(503);
  else if (request.url === '/redirect') send(307, Buffer.alloc(0), { location: '/body' });
  else if (request.url === '/downgrade') send(302, Buffer.alloc(0), { location: 'http://localhost/body' });
  else if (request.url === '/slow') setTimeout(() => send(200, body), 2000);
  else send(404);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const env = { ...process.env, WINEPREFIX: prefix, XODUS_RUNTIME_TEST_PREFIX: prefix, WINEARCH: 'win64', WINEDEBUG: '-all,err+all',
  LD_LIBRARY_PATH: `/usr/lib:${path.join(files, 'lib/x86_64-linux-gnu')}`, WINEDLLPATH: path.join(files, 'lib/wine'),
  WINEDLLOVERRIDES: 'winemenubuilder.exe=d;mshtml=;mscoree=;winhttp=b;libnghttp2=n' };
for (const key of Object.keys(env)) if (/^(XUSER_|XODUS_(?!RUNTIME_TEST_PREFIX)|STEAM_COMPAT_|http_proxy$|https_proxy$|all_proxy$|no_proxy$)/i.test(key)) delete env[key];
const wine = path.join(files, 'bin/wine');
const wineServer = path.join(files, 'bin/wineserver');
function run(args, timeout = 45000) {
  return new Promise((resolve, reject) => {
    const child = spawn(wine, args, { env, stdio: ['ignore', 'pipe', 'pipe'] }); let output = '', timedOut = false;
    const collect = b => { if (output.length < 512000) output += b.toString().slice(0, 512000 - output.length); };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    const timer = setTimeout(() => { timedOut = true; try { execFileSync(wineServer, ['-k'], { env, timeout: 5000, stdio: 'ignore' }); } catch { child.kill('SIGKILL'); } }, timeout);
    child.once('error', e => { clearTimeout(timer); reject(e); });
    child.once('close', code => { clearTimeout(timer); resolve({ code, output, timedOut }); });
  });
}
try {
  const boot = await run(['wineboot', '--init']);
  await fs.writeFile(path.join(root, 'wineboot.log'), boot.output, { mode: 0o600 });
  if (boot.code || boot.timedOut) throw new Error(`Disposable wineboot failed; see ${root}`);
  for (const name of ['winhttp.dll', 'libnghttp2.dll']) {
    const target = path.join(prefix, 'drive_c/windows/system32', name);
    await fs.copyFile(path.join(files, 'lib/wine/x86_64-windows', name), `${target}.new`, fs.constants.COPYFILE_EXCL);
    await fs.rename(`${target}.new`, target);
  }
  const result = await run([executable, String(server.address().port), path.join(root, 'server.der')]);
  await fs.writeFile(path.join(root, 'result.log'), result.output, { mode: 0o600 });
  const summary = result.output.split(/\r?\n/).filter(line => /^(FAIL |CASE |CHECKS |SUMMARY )/.test(line));
  await fs.writeFile(path.join(root, 'results.json'), JSON.stringify({ code: result.code, timedOut: result.timedOut, summary }, null, 2) + '\n', { mode: 0o600 });
  console.log(summary.join('\n'));
  if (result.code !== 0 || result.timedOut) throw new Error(`HTTP/2 suite failed; see ${root}`);
} finally {
  try { execFileSync(wineServer, ['-k'], { env, timeout: 5000, stdio: 'ignore' }); } catch { /* own prefix only */ }
  for (const session of sessions) session.destroy();
  server.closeAllConnections?.(); server.close();
  console.log(`Private HTTP/2 results: ${root}`);
}
