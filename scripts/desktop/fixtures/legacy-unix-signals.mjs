import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Exercise the real legacy GLib signal API with the platform namespace absent.
 * The rest of the production helper executes unchanged on the private test bus. */
export async function helperForUnixSignals(source, directory, legacyOnly) {
  if (!legacyOnly) return source;
  const contents = await readFile(source, 'utf8');
  const declaration = "import GLibUnix from 'gi://GLibUnix';";
  assert.equal(contents.split(declaration).length, 2, 'replace only the platform namespace import');
  const target = path.join(directory, path.basename(source));
  await writeFile(target, contents.replace(declaration, 'const GLibUnix = Object.freeze({});'), { flag: 'wx', mode: 0o600 });
  return target;
}
