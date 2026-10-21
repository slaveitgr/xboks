#!/usr/bin/env python3
import hashlib
import importlib.util
import io
import json
import tempfile
import unittest
import urllib.error
from email.message import Message
from pathlib import Path

spec = importlib.util.spec_from_file_location('installer_release', Path(__file__).with_name('installer-release.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def fixture():
    data = bytearray(100)
    data[:6], data[8:11], data[18:20] = b'\x7fELF\x02\x01', b'AI\x02', b'\x3e\x00'
    name, tag = 'xboks-9.0.0-x86_64.AppImage', 'v9.0.0'
    assets = [{'name': item, 'size': len(data) if item == name else 200,
               'browser_download_url': f'https://github.com/slaveitgr/xboks/releases/download/{tag}/{item}'}
              for item in (name, name + '.sha512sum')]
    release = {'tag_name': tag, 'assets': assets}
    responses = {module.API: json.dumps([release]).encode(), assets[0]['browser_download_url']: bytes(data),
                 assets[1]['browser_download_url']: f'{hashlib.sha512(data).hexdigest()}  {name}\n'.encode()}
    return release, responses, bytes(data)


class Opener:
    def __init__(self, responses):
        self.responses, self.requested = responses, []

    def open(self, request, timeout):
        self.requested.append(request.full_url)
        response = self.responses[request.full_url]
        if isinstance(response, Exception):
            raise response
        return io.BytesIO(response)


def redirect(location):
    headers = Message()
    headers['Location'] = location
    return urllib.error.HTTPError('https://github.com/fixture', 302, 'Found', headers, io.BytesIO())


class InstallerReleaseTests(unittest.TestCase):
    def test_owned_release_download_verifies_exact_bytes(self):
        release, responses, data = fixture()
        with tempfile.TemporaryDirectory() as root:
            output, opener = Path(root) / 'image', Opener(responses)
            self.assertEqual(module.download(output, opener), release['assets'][0]['name'])
            self.assertEqual(output.read_bytes(), data)
            self.assertEqual(output.stat().st_mode & 0o777, 0o755)
            self.assertEqual(opener.requested[0], module.API)

    def test_foreign_repository_preview_and_wrong_names_are_not_installers(self):
        release, _, _ = fixture()
        for altered in ({**release, 'prerelease': True}, {**release, 'draft': True}, {**release, 'tag_name': 'backend-v9.0.0'}):
            with self.assertRaisesRegex(ValueError, 'No compatible'):
                module.candidate([altered])
        for field, value in [('name', 'Xodus-Nexus-9.0.0-x86_64.AppImage'), ('browser_download_url', 'https://github.com/domsvoboda/xodus-nexus/releases/download/v9.0.0/xboks-9.0.0-x86_64.AppImage')]:
            altered = json.loads(json.dumps(release))
            altered['assets'][0][field] = value
            with self.assertRaisesRegex(ValueError, 'No compatible'):
                module.candidate([altered])

    def test_checksum_size_and_format_failures_remove_only_new_partial_output(self):
        for kind in ('digest', 'filename', 'oversized', 'format'):
            release, responses, _ = fixture()
            image, checksum = release['assets']
            if kind == 'digest':
                responses[checksum['browser_download_url']] = ('0' * 128 + '  ' + image['name']).encode()
            elif kind == 'filename':
                responses[checksum['browser_download_url']] = ('0' * 128 + '  wrong.AppImage').encode()
            elif kind == 'oversized':
                responses[image['browser_download_url']] += b'EXTRA'
            else:
                responses[image['browser_download_url']] = b'X' * image['size']
                responses[checksum['browser_download_url']] = (hashlib.sha512(responses[image['browser_download_url']]).hexdigest() + '  ' + image['name']).encode()
            with tempfile.TemporaryDirectory() as root:
                output = Path(root) / 'partial'
                with self.assertRaises(ValueError):
                    module.download(output, Opener(responses))
                self.assertFalse(output.exists())

    def test_existing_destination_is_preserved(self):
        _, responses, _ = fixture()
        with tempfile.TemporaryDirectory() as root:
            output = Path(root) / 'existing'
            output.write_bytes(b'KEEP')
            with self.assertRaises(FileExistsError):
                module.download(output, Opener(responses))
            self.assertEqual(output.read_bytes(), b'KEEP')

    def test_api_redirect_and_untrusted_asset_redirect_are_rejected(self):
        for asset, location in [(False, 'https://release-assets.githubusercontent.com/asset'),
                                (True, 'http://objects.githubusercontent.com/asset'),
                                (True, 'https://evil.example/asset'),
                                (True, 'https://user:password@objects.githubusercontent.com/asset')]:
            with self.assertRaisesRegex(ValueError, 'redirect'):
                module.open_url('https://github.com/fixture', asset, Opener({'https://github.com/fixture': redirect(location)}))

    def test_allowed_asset_cdn_and_redirect_limit(self):
        origin, cdn = 'https://github.com/fixture', 'https://release-assets.githubusercontent.com/asset'
        opener = Opener({origin: redirect(cdn), cdn: b'asset'})
        with module.open_url(origin, True, opener) as response:
            self.assertEqual(response.read(), b'asset')
        self.assertEqual(opener.requested, [origin, cdn])
        opener = Opener({origin: redirect(cdn), cdn: redirect(cdn)})
        with self.assertRaisesRegex(ValueError, 'redirect'):
            module.open_url(origin, True, opener)
        self.assertEqual(len(opener.requested), 6)

    def test_metadata_and_checksum_are_bounded(self):
        with self.assertRaisesRegex(ValueError, 'size limit'):
            module.bounded(io.BytesIO(b'X' * 4097), 4096)
        release, _, _ = fixture()
        release['assets'][0]['size'] = True
        with self.assertRaisesRegex(ValueError, 'No compatible'):
            module.candidate([release])


if __name__ == '__main__':
    unittest.main()
