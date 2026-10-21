#!/usr/bin/env python3
"""Download a verified XBOKS launcher. Standard library only; no account access."""
import argparse
import hashlib
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

REPOSITORY = 'slaveitgr/xboks'
API = f'https://api.github.com/repos/{REPOSITORY}/releases?per_page=100'
CDNS = {'objects.githubusercontent.com', 'release-assets.githubusercontent.com'}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, file, code, message, headers, newurl):
        return None


def open_url(url, asset=False, opener=None):
    opener = opener or urllib.request.build_opener(NoRedirect())
    current = url
    for hop in range(6):
        try:
            return opener.open(urllib.request.Request(current, headers={
                'User-Agent': 'xboks-installer', 'Accept': 'application/vnd.github+json' if not asset else 'application/octet-stream',
            }), timeout=30)
        except urllib.error.HTTPError as error:
            if error.code not in (301, 302, 303, 307, 308):
                raise ValueError(f'GitHub download returned HTTP {error.code}.') from None
            location = error.headers.get('Location')
            error.close()
            if not asset or not location or hop == 5:
                raise ValueError('Unexpected GitHub redirect.') from None
            following = urllib.parse.urljoin(current, location)
            parsed = urllib.parse.urlsplit(following)
            if (parsed.scheme != 'https' or parsed.hostname not in CDNS or parsed.username or
                    parsed.password or parsed.port not in (None, 443) or parsed.fragment):
                raise ValueError('Unexpected GitHub asset redirect destination.') from None
            current = following
    raise ValueError('Too many GitHub asset redirects.')


def bounded(response, limit):
    parts, size = [], 0
    while True:
        chunk = response.read(min(1024 * 1024, limit + 1 - size))
        if not chunk:
            return b''.join(parts)
        size += len(chunk)
        if size > limit:
            raise ValueError('GitHub metadata exceeds its size limit.')
        parts.append(chunk)


def candidate(value):
    if not isinstance(value, list):
        raise ValueError('Invalid XBOKS release list.')
    releases = [item for item in value if isinstance(item, dict) and not item.get('draft') and
                not item.get('prerelease') and re.fullmatch(r'v\d+\.\d+\.\d+', str(item.get('tag_name', '')))]
    releases.sort(key=lambda item: tuple(map(int, item['tag_name'][1:].split('.'))), reverse=True)
    for release in releases:
        tag = release['tag_name']
        name = f'xboks-{tag[1:]}-x86_64.AppImage'
        assets = release.get('assets')
        if not isinstance(assets, list):
            continue
        image = [a for a in assets if isinstance(a, dict) and a.get('name') == name]
        checksum = [a for a in assets if isinstance(a, dict) and a.get('name') == name + '.sha512sum']
        if len(image) != 1 or len(checksum) != 1:
            continue
        image, checksum = image[0], checksum[0]
        if any(a.get('browser_download_url') != f'https://github.com/{REPOSITORY}/releases/download/{tag}/{a["name"]}' for a in (image, checksum)):
            continue
        if (type(image.get('size')) is not int or not 64 <= image['size'] <= 1024 ** 3 or
                type(checksum.get('size')) is not int or not 1 <= checksum['size'] <= 4096):
            continue
        return image, checksum
    raise ValueError('No compatible complete XBOKS launcher release is published; use a verified local AppImage.')


def verify_appimage(file):
    with Path(file).open('rb') as source:
        header = source.read(64)
    if (len(header) < 64 or header[:6] != b'\x7fELF\x02\x01' or header[8:11] != b'AI\x02' or
            int.from_bytes(header[18:20], 'little') != 62):
        raise ValueError('The file is not an x86_64 AppImage.')


def download(output, opener=None):
    with open_url(API, opener=opener) as response:
        image, checksum = candidate(json.loads(bounded(response, 2_000_000)))
    with open_url(checksum['browser_download_url'], asset=True, opener=opener) as response:
        text = bounded(response, 4096).decode('ascii').strip()
    match = re.fullmatch(r'([a-fA-F0-9]{128})  ([A-Za-z0-9._-]+)', text)
    if not match or match[2] != image['name']:
        raise ValueError('The SHA-512 file does not identify the selected XBOKS AppImage.')
    digest, size = hashlib.sha512(), 0
    output = Path(output)
    created = False
    try:
        with open_url(image['browser_download_url'], asset=True, opener=opener) as response, output.open('xb') as target:
            created = True
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > image['size']:
                    raise ValueError('The AppImage download exceeded its published size.')
                digest.update(chunk)
                target.write(chunk)
        if size != image['size'] or digest.hexdigest() != match[1].lower():
            raise ValueError('AppImage SHA-512 verification failed.')
        verify_appimage(output)
        output.chmod(0o755)
        return image['name']
    except Exception:
        if created:
            output.unlink(missing_ok=True)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--output', help='New download destination; must not exist')
    group.add_argument('--verify-local', help='Validate local x86_64 AppImage header; no network')
    args = parser.parse_args()
    try:
        if args.verify_local:
            verify_appimage(args.verify_local)
        else:
            print(download(args.output))
    except Exception as error:
        # Avoid logging signed redirect URLs or remote response bodies.
        message = str(error) if isinstance(error, ValueError) else 'Could not obtain a verified XBOKS AppImage.'
        parser.exit(1, message + '\n')


if __name__ == '__main__':
    main()
