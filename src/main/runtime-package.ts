/** Consumer distribution belongs to xboks. Upstream source/build pins live in
 * scripts/runtime-*.lock.json and never provide an automatic update fallback. */
export const RUNTIME_REPOSITORY = 'slaveitgr/xboks';
export const runtimeReleasesUrl = `https://api.github.com/repos/${RUNTIME_REPOSITORY}/releases?per_page=100`;
export interface EngineRuntimeArtifact {
  version: string; name: string; url: string; checksumName: string; checksumUrl: string;
}

export function runtimeAssetUrl(tag: string, name: string, value: unknown): string {
  const expected = `https://github.com/${RUNTIME_REPOSITORY}/releases/download/${encodeURIComponent(tag)}/${name}`;
  if (value !== expected) throw new Error('Unexpected xboks Engine runtime asset URL.');
  return expected;
}

export function runtimeCandidate(value: unknown): EngineRuntimeArtifact {
  if (!Array.isArray(value)) throw new Error('Invalid xboks Engine runtime release list.');
  // Only runtime tags participate; unrelated newer launcher/backend releases do
  // not hide the current runtime. Commit suffixes are not sortable versions.
  const releases = value.filter(release => release && !release.draft && !release.prerelease &&
    typeof release.tag_name === 'string' && /^runtime-[A-Za-z0-9][A-Za-z0-9._-]*$/.test(release.tag_name));
  releases.sort((a, b) => {
    const publication = (release: typeof a) => typeof release.published_at === 'string' && Number.isFinite(Date.parse(release.published_at)) ? Date.parse(release.published_at) : -Infinity;
    const left = publication(a), right = publication(b);
    return left === right ? 0 : left > right ? -1 : 1;
  });
  const selected = releases[0];
  if (!selected) throw new Error('No xboks Engine runtime release has been published yet.');
  const version = selected.tag_name as string;
  const base = `xboks-engine-runtime-${version.slice('runtime-'.length)}`;
  const name = `${base}-x86_64.tar.xz`, checksumName = `${base}-x86_64.sha512sum`;
  const assets: Array<{ name?: unknown; browser_download_url?: unknown }> = Array.isArray(selected.assets) ? selected.assets : [];
  const asset = (file: string) => {
    const matches = assets.filter(item => item && item.name === file);
    if (matches.length !== 1) throw new Error('The newest xboks Engine runtime release is incomplete.');
    return runtimeAssetUrl(version, file, matches[0].browser_download_url);
  };
  // Matching source is a distribution requirement even though installation only
  // downloads the binary and its checksum. Never silently use upstream assets.
  const url = asset(name), checksumUrl = asset(checksumName);
  asset(`${base}-source.tar.xz`); asset(`${base}-source.sha512sum`);
  return { version, name, url, checksumName, checksumUrl };
}
