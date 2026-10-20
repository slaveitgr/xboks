#!/usr/bin/env python3
"""Account-free regression for GNOME Keyring's plaintext serialization.

Uses only in-memory GKeyFiles and synthetic data. Does not connect to D-Bus,
read a keyring, or start an authentication flow. Requires libglib-2.0.

GNOME Keyring 50.0, pkcs11/secret-store/gkm-secret-textual.c:
  generate_item: g_key_file_set_value(..., "secret", ...)
  parse_item:    g_key_file_get_string(..., "secret", ...)

Run alongside xodus's credential_encoding_* Rust tests, which exercise the
actual backend codec. This test establishes why its ASCII envelope is needed.
"""
import base64
import ctypes as c
import ctypes.util
import json
import unittest

LIBRARY = ctypes.util.find_library("glib-2.0")
if not LIBRARY:
    raise SystemExit("libglib-2.0 is required for the in-memory keyring regression")
glib = c.CDLL(LIBRARY)
glib.g_key_file_new.restype = c.c_void_p
glib.g_key_file_set_value.argtypes = [c.c_void_p, c.c_char_p, c.c_char_p, c.c_char_p]
glib.g_key_file_get_string.argtypes = [c.c_void_p, c.c_char_p, c.c_char_p, c.POINTER(c.c_void_p)]
glib.g_key_file_get_string.restype = c.c_void_p
glib.g_key_file_to_data.argtypes = [c.c_void_p, c.POINTER(c.c_size_t), c.POINTER(c.c_void_p)]
glib.g_key_file_to_data.restype = c.c_void_p
glib.g_key_file_load_from_data.argtypes = [c.c_void_p, c.c_void_p, c.c_size_t, c.c_int, c.POINTER(c.c_void_p)]
glib.g_key_file_load_from_data.restype = c.c_int
glib.g_key_file_free.argtypes = [c.c_void_p]
glib.g_free.argtypes = [c.c_void_p]
glib.g_error_free.argtypes = [c.c_void_p]
PREFIX = b"XODUS_KEYRING_BASE64_V1:"


def reload_secret(value):
    """Match the keyring writer/reader, including serialization and reload."""
    writer, reader = glib.g_key_file_new(), glib.g_key_file_new()
    data = result = None
    error = c.c_void_p()
    try:
        glib.g_key_file_set_value(writer, b"synthetic", b"secret", value)
        size = c.c_size_t()
        data = glib.g_key_file_to_data(writer, c.byref(size), c.byref(error))
        if not data or error.value:
            raise AssertionError("Synthetic GKeyFile serialization failed")
        if not glib.g_key_file_load_from_data(reader, data, size.value, 0, c.byref(error)):
            raise AssertionError("Synthetic GKeyFile reload failed")
        result = glib.g_key_file_get_string(reader, b"synthetic", b"secret", c.byref(error))
        return None if error.value else c.string_at(result)
    finally:
        if error.value:
            glib.g_error_free(error)
        if result:
            glib.g_free(result)
        if data:
            glib.g_free(data)
        glib.g_key_file_free(reader)
        glib.g_key_file_free(writer)


class KeyringTextualRoundtrip(unittest.TestCase):
    def test_plain_json_control(self):
        value = json.dumps({"token": "synthetic"}).encode()
        self.assertEqual(reload_secret(value), value)

    def test_raw_xml_json_is_rejected(self):
        value = json.dumps({"token": '<EncryptedData Id="synthetic"/>'}).encode()
        self.assertIsNone(reload_secret(value))

    def test_raw_json_newline_is_silently_changed(self):
        value = json.dumps({"token": "synthetic\nvalue"}).encode()
        self.assertNotEqual(reload_secret(value), value)

    def test_envelope_preserves_all_fixtures(self):
        fixtures = [
            json.dumps({"token": '<EncryptedData Id="synthetic"/>'}).encode(),
            json.dumps({"token": "synthetic\nvalue\\path\t"}).encode(),
            "synthetic-\u00e9".encode(),
            bytes(range(256)),
            b"",
        ]
        for value in fixtures:
            with self.subTest(size=len(value)):
                encoded = PREFIX + base64.b64encode(value)
                reloaded = reload_secret(encoded)
                self.assertEqual(reloaded, encoded)
                self.assertEqual(base64.b64decode(reloaded[len(PREFIX):], validate=True), value)


if __name__ == "__main__":
    unittest.main()
