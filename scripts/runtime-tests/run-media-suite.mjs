#!/usr/bin/env node
// Native media smoke probe. Never starts a game or accesses account data.
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.argv.length !== 4) throw new Error('Usage: run-media-suite.mjs RUNTIME_DIRECTORY WORK_DIRECTORY');
const runtime = path.resolve(process.argv[2]);
const work = path.resolve(process.argv[3]);
const libraryDir = path.join(runtime, 'files/lib/x86_64-linux-gnu');
const pluginDir = path.join(libraryDir, 'gstreamer-1.0');
const plugin = path.join(pluginDir, 'libgstlibav.so');
await fs.mkdir(work, { recursive: true });
const env = {
  ...process.env,
  LD_LIBRARY_PATH: libraryDir,
  GST_PLUGIN_SYSTEM_PATH_1_0: pluginDir,
  GST_PLUGIN_PATH_1_0: '',
  GST_REGISTRY_FORK: 'no',
  GST_REGISTRY_1_0: path.join(work, 'registry.bin'),
};
const dependencies = execFileSync('ldd', [plugin], { env, encoding: 'utf8' });
if (dependencies.includes('not found')) throw new Error(`Bundled GStreamer libav has missing dependencies:\n${dependencies}`);
for (const soname of ['libavcodec.so.58', 'libavfilter.so.7', 'libavformat.so.58', 'libavutil.so.56']) {
  const line = dependencies.split('\n').find(item => item.includes(`${soname} => `));
  if (!line?.includes(`=> ${libraryDir}/${soname} `)) throw new Error(`${soname} is not resolved from the Nexus runtime.`);
}
const flags = execFileSync('pkg-config', ['--cflags', '--libs', 'gstreamer-1.0'], { encoding: 'utf8' }).trim().split(/\s+/);
const probe = path.join(work, 'media-codecs-probe');
const source = path.join(path.dirname(fileURLToPath(import.meta.url)), 'media-codecs-probe.c');
execFileSync('gcc', ['-O2', '-Wall', source, '-o', probe, ...flags], { stdio: 'inherit' });
const output = execFileSync(probe, [pluginDir], { env, encoding: 'utf8', timeout: 30_000 });
if (!output.includes('Runtime H.264 and AAC GStreamer decoders are available.')) throw new Error('Runtime media probe did not pass.');
await fs.writeFile(path.join(work, 'results.json'), JSON.stringify({ h264: true, aac: true, bundledLibraries: true }, null, 2) + '\n');
console.log(output.trim());
