"""Real ZIP fixtures in owned temporary directories; no package execution."""
from pathlib import Path
import hashlib
import importlib.util
import io
import json
import os
import stat
import struct
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import warnings
import zipfile


SCRIPT = Path(__file__).with_name("archive_inspect.py")
SPEC = importlib.util.spec_from_file_location("archive_inspect", SCRIPT)
inspector = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(inspector)
PACKAGE_XML = '<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"><Identity Name="Fixture.Game" Publisher="CN=Fixture" Version="1.2.3.4" ProcessorArchitecture="x64"/><Applications><Application Id="Game" Executable="Game.exe" EntryPoint="Fixture.App"/></Applications></Package>'
BUNDLE_NS = inspector.BUNDLE_NAMESPACE


def package_bytes(manifest=PACKAGE_XML, extra=(), compression=zipfile.ZIP_STORED):
    output = io.BytesIO()
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)
        with zipfile.ZipFile(output, "w", compression=compression) as archive:
            archive.writestr("AppxManifest.xml", manifest)
            for name, value in extra:
                archive.writestr(name, value)
    return output.getvalue()


def bundle_bytes(packages, namespace=BUNDLE_NS, xml=None, extra=()):
    """packages tuples: filename, arch, type, inner ZIP bytes."""
    if xml is None:
        entries = ''.join(f'<Package FileName="{name}" Architecture="{arch}" Type="{kind}" Version="1.2.3.4" Size="{len(data)}"/>' for name, arch, kind, data in packages)
        xml = f'<Bundle xmlns="{namespace}"><Identity Name="Fixture.Game" Publisher="CN=Fixture" Version="9.0.0.0"/><Packages>{entries}</Packages></Bundle>'
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as archive:
        archive.writestr("AppxMetadata/AppxBundleManifest.xml", xml)
        for name, _, _, data in packages:
            archive.writestr(name, data)
        for name, data in extra:
            archive.writestr(name, data)
    return out.getvalue()


def zip64_end(data, extension=b""):
    """Small real ZIP64 archive: retain payload/CD, replace its end records."""
    end_offset = len(data) - 22
    _, _, _, count_disk, count, cd_size, cd_offset, _ = inspector.EOCD.unpack(data[end_offset:])
    record = inspector.ZIP64_END.pack(b"PK\x06\x06", 44 + len(extension), 45, 45, 0, 0, count_disk, count, cd_size, cd_offset) + extension
    locator = inspector.ZIP64_LOCATOR.pack(b"PK\x06\x07", 0, end_offset, 1)
    end = inspector.EOCD.pack(b"PK\x05\x06", 0, 0, 0xffff, 0xffff, 0xffffffff, 0xffffffff, 0)
    return data[:end_offset] + record + locator + end


class ArchiveInspection(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="xboks-msix-inspection-test-")
        self.root = Path(self.temp.name)
        self.file = self.root / "fixture.msix"

    def tearDown(self):
        self.temp.cleanup()

    def inspect(self, data, arch="x64"):
        self.file.write_bytes(data)
        return inspector.inspect_file(self.file, arch)

    def rejected(self, data, reason, arch="x64"):
        with self.assertRaisesRegex(inspector.InspectionError, reason):
            self.inspect(data, arch)

    def test_plain_package_reports_exact_raw_metadata_without_install_claim(self):
        data = package_bytes(extra=[("AppxSignature.p7x", b"not a signature"), ("AppxBlockMap.xml", b"not a block map"), ("Game.exe", b"not executable")])
        result = self.inspect(data)
        self.assertEqual(result["source"], {"sizeBytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
        self.assertEqual(result["selectedPackage"]["manifest"]["xml"], PACKAGE_XML)
        self.assertEqual(result["selectedPackage"]["manifest"]["encoding"], "utf-8")
        self.assertIsNone(result["bundle"])
        self.assertIsNone(result["selectedPackage"]["memberPath"])
        self.assertTrue(result["inspectionOnly"])
        self.assertTrue(result["archive"]["signaturePresent"])
        self.assertTrue(result["archive"]["blockMapPresent"])
        self.assertFalse(result["archive"]["signatureValidated"])
        self.assertFalse(result["archive"]["blockMapValidated"])
        self.assertFalse(result["archive"]["payloadCrcValidated"])
        self.assertEqual(list(self.root.iterdir()), [self.file])

    def test_deflated_package_and_unicode_metadata(self):
        xml = PACKAGE_XML.replace("Fixture.Game", "Δοκιμή.Παιχνίδι")
        result = self.inspect(package_bytes(xml, compression=zipfile.ZIP_DEFLATED))
        self.assertEqual(result["selectedPackage"]["manifest"]["xml"], xml)

    def test_utf8_bom_and_bom_utf16_both_byte_orders(self):
        for encoding, bom, reported in [("utf-8", b"\xef\xbb\xbf", "utf-8"), ("utf-16-le", b"\xff\xfe", "utf-16le"), ("utf-16-be", b"\xfe\xff", "utf-16be")]:
            with self.subTest(encoding=encoding):
                result = self.inspect(package_bytes(bom + PACKAGE_XML.encode(encoding)))
                self.assertEqual(result["selectedPackage"]["manifest"]["xml"], PACKAGE_XML)
                self.assertEqual(result["selectedPackage"]["manifest"]["encoding"], reported)

    def test_exact_architecture_beats_neutral_and_resources(self):
        inner = package_bytes()
        packages = [("neutral.msix", "neutral", "application", inner), ("resource.msix", "x64", "resource", inner), ("x64.msix", "x64", "application", inner), ("x86.msix", "x86", "application", inner)]
        result = self.inspect(bundle_bytes(packages))
        self.assertEqual(result["bundle"]["selectedMember"], "x64.msix")
        self.assertEqual(result["selectedPackage"]["memberPath"], "x64.msix")
        self.assertEqual(result["bundle"]["identity"]["version"], "9.0.0.0")
        self.assertEqual(result["bundle"]["packages"][2]["version"], "1.2.3.4")
        self.assertEqual(result["archive"]["kind"], "bundle")
        self.assertEqual(result["selectedPackage"]["archive"]["kind"], "package")

    def test_neutral_application_is_fallback_and_x86_arm64_are_explicit(self):
        inner = package_bytes()
        data = bundle_bytes([("neutral.msix", "neutral", "application", inner), ("x86.msix", "x86", "application", inner), ("arm64.msix", "arm64", "application", inner)])
        for arch, expected in [("x64", "neutral.msix"), ("x86", "x86.msix"), ("arm64", "arm64.msix")]:
            self.assertEqual(self.inspect(data, arch)["bundle"]["selectedMember"], expected)

    def test_bundle_opc_encoded_filename_keeps_logical_and_archive_paths(self):
        inner = package_bytes()
        xml = f'<Bundle xmlns="{BUNDLE_NS}"><Identity Name="X" Publisher="CN=X" Version="1"/><Packages><Package FileName="Game Δ x64.msix" Architecture="x64" Type="application"/><Package FileName="resource.msix" Type="resource"/></Packages></Bundle>'
        bundle = bundle_bytes([("Game%20%CE%94%20x64.msix", "x64", "application", inner), ("resource.msix", "neutral", "resource", inner)], xml=xml)
        report = self.inspect(bundle)
        self.assertEqual(report["bundle"]["selectedMember"], "Game Δ x64.msix")
        self.assertEqual(report["bundle"]["packages"][0]["archivePath"], "Game%20%CE%94%20x64.msix")
        self.assertEqual(report["selectedPackage"]["memberPath"], "Game%20%CE%94%20x64.msix")
        self.assertEqual(report["bundle"]["packages"][1]["architecture"], "neutral")

    def test_encoded_paths_validate_one_layer_and_reject_aliases(self):
        for name in ["%2e%2e/parent", "part%2fb", "part%5Cb", "C%3a/drive", "part%00", "tail%20", "tail%2e", "%ff", "bad%", "bad%0Z"]:
            with self.subTest(name=name):
                self.rejected(package_bytes(extra=[(name, b"x")]), "path|UTF-8")
        self.rejected(package_bytes(extra=[("Game data", b"x"), ("Game%20data", b"x")]), "Duplicate or case-folded")
        self.rejected(package_bytes(extra=[("data", b"x"), ("%64ata", b"x")]), "Duplicate or case-folded")
        # A literal percent belongs to one encoded layer, with no second decode.
        report = self.inspect(package_bytes(extra=[("literal%252e%252e", b"x")]))
        self.assertEqual(report["archive"]["entryCount"], 2)

    def test_resource_only_and_wrong_architecture_never_fall_back(self):
        inner = package_bytes()
        for packages in [[("resource.msix", "neutral", "resource", inner)], [("x86.msix", "x86", "application", inner), ("x64-resource.msix", "x64", "resource", inner)]]:
            self.rejected(bundle_bytes(packages), "No unique application")

    def test_ambiguous_application_architecture_is_rejected(self):
        inner = package_bytes()
        self.rejected(bundle_bytes([("a.msix", "x64", "application", inner), ("b.msix", "x64", "application", inner)]), "No unique application")

    def test_namespace_identity_index_and_exact_filename_are_required(self):
        inner = package_bytes()
        packages = [("x64.msix", "x64", "application", inner)]
        self.rejected(bundle_bytes(packages, namespace="urn:wrong"), "2013 bundle namespace")
        for xml, reason in [
            (f'<Bundle xmlns="{BUNDLE_NS}"><Packages/></Bundle>', "identity"),
            (f'<Bundle xmlns="{BUNDLE_NS}"><Identity Name="X" Publisher="CN=X" Version="1"/><Packages><Package FileName="missing.msix" Architecture="x64" Type="application"/></Packages></Bundle>', "missing"),
            (f'<Bundle xmlns="{BUNDLE_NS}"><Identity Name="X" Publisher="CN=X" Version="1"/><Packages><Package FileName="X64.msix" Architecture="x64" Type="application"/></Packages></Bundle>', "match its ZIP path"),
        ]:
            self.rejected(bundle_bytes(packages, xml=xml), reason)

    def test_indexed_bundle_size_must_match_actual_member(self):
        inner = package_bytes()
        xml = f'<Bundle xmlns="{BUNDLE_NS}"><Identity Name="X" Publisher="CN=X" Version="1"/><Packages><Package FileName="x64.msix" Architecture="x64" Type="application" Size="1"/></Packages></Bundle>'
        self.rejected(bundle_bytes([("x64.msix", "x64", "application", inner)], xml=xml), "size disagrees")

    def test_duplicate_bundle_member_references_and_nested_bundles_are_rejected(self):
        inner = package_bytes()
        xml = f'<Bundle xmlns="{BUNDLE_NS}"><Identity Name="X" Publisher="CN=X" Version="1"/><Packages><Package FileName="x64.msix" Architecture="x64" Type="application"/><Package FileName="x64.msix" Architecture="x64" Type="resource"/></Packages></Bundle>'
        self.rejected(bundle_bytes([("x64.msix", "x64", "application", inner)], xml=xml), "references are duplicate")
        nested = bundle_bytes([("x64.msix", "x64", "application", inner)])
        self.rejected(bundle_bytes([("nested.msixbundle", "x64", "application", nested)]), "Nested bundles")

    def test_unsafe_paths_are_rejected_even_for_unread_payload(self):
        for name in ["/absolute", "../parent", "a/../parent", "a/./b", "C:/drive", "a\\b", "a//b", "tail.", "tail ", "a./b", "stream:ads", "control\x01"]:
            with self.subTest(name=name):
                self.rejected(package_bytes(extra=[(name, b"payload")]), "path|control")

    def test_nul_central_and_local_member_names_are_rejected_before_zipfile(self):
        data = package_bytes(extra=[("safeZZname", b"payload")]).replace(b"safeZZname", b"safe\x00Zname")
        with patch.object(inspector.zipfile, "ZipFile", side_effect=AssertionError("ZipFile must not see unsafe names")):
            self.rejected(data, "control characters or NUL")

    def test_duplicate_casefold_and_unicode_equivalent_names_are_rejected(self):
        for names in [("data", "DATA"), ("duplicate", "duplicate"), ("caf\u00e9", "cafe\u0301"), ("folder", "folder/")]:
            with self.subTest(names=names):
                self.rejected(package_bytes(extra=[(names[0], b""), (names[1], b"")]), "Duplicate or case-folded")

    def test_symlink_and_special_zip_entries_are_rejected(self):
        for kind in (stat.S_IFLNK, stat.S_IFIFO, stat.S_IFSOCK, stat.S_IFCHR):
            entry = zipfile.ZipInfo("special")
            entry.create_system = 3
            entry.external_attr = (kind | 0o600) << 16
            self.rejected(package_bytes(extra=[(entry, b"target")]), "Symlink or special")

    def test_final_and_parent_input_symlinks_nonregular_and_missing_rejected(self):
        self.file.write_bytes(package_bytes())
        link = self.root / "link.msix"
        link.symlink_to(self.file)
        parent = self.root / "alias"
        parent.symlink_to(self.root, target_is_directory=True)
        for path in [link, parent / self.file.name, parent / ".." / self.file.name, self.root, self.root / "missing"]:
            with self.subTest(path=path):
                with self.assertRaises(inspector.InspectionError): inspector.inspect_file(path, "x64")

    def test_fifo_input_does_not_block_and_null_path_is_rejected(self):
        fifo = self.root / "fifo"
        os.mkfifo(fifo)
        with self.assertRaisesRegex(inspector.InspectionError, "regular file"):
            inspector.inspect_file(fifo, "x64")
        with self.assertRaisesRegex(inspector.InspectionError, "invalid"):
            inspector.inspect_file("invalid\x00path", "x64")

    def test_metadata_limits_and_inner_package_limits(self):
        data = package_bytes()
        with patch.object(inspector, "MAX_METADATA_BYTES", 32): self.rejected(data, "exceeds inspection limits")
        bundle = bundle_bytes([("x64.msix", "x64", "application", data)])
        with patch.object(inspector, "MAX_INNER_BYTES", len(data) - 1): self.rejected(bundle, "exceeds inspection limits")
        with patch.object(inspector, "MAX_PACKAGE_BYTES", len(data) - 1): self.rejected(data, "8 GiB")

    def test_eocd_limits_reject_before_zipfile_initialization(self):
        data = package_bytes(extra=[("data", b"123")])
        for name, value in [("MAX_ENTRIES", 1), ("MAX_CENTRAL_DIRECTORY_BYTES", 10)]:
            with patch.object(inspector, name, value), patch.object(inspector.zipfile, "ZipFile", side_effect=AssertionError("must precheck")):
                self.rejected(data, "central directory exceeds")

    def test_zip64_multidisk_and_invalid_central_count_rejected(self):
        data = package_bytes()
        for field_offset, value, pattern in [(10, 0xffff, "ZIP64"), (4, 1, "Multi-disk"), (8, 2, "Multi-disk")]:
            changed = bytearray(data)
            struct.pack_into("<H", changed, len(changed) - 22 + field_offset, value)
            self.rejected(bytes(changed), pattern)
        changed = bytearray(data)
        struct.pack_into("<HH", changed, len(changed) - 22 + 8, 0, 0)
        self.rejected(bytes(changed), "count or size")

    def test_zip64_extra_fields_rejected(self):
        entry = zipfile.ZipInfo("data")
        entry.extra = struct.pack("<HHQ", 1, 8, 1)
        self.rejected(package_bytes(extra=[(entry, b"x")]), "ZIP64")

    def test_bounded_zip64_package_bundle_inner_and_extensible_record(self):
        inner = zip64_end(package_bytes())
        self.assertTrue(self.inspect(inner)["archive"]["zip64"])
        bundle = zip64_end(bundle_bytes([("x64.msix", "x64", "application", inner)]))
        report = self.inspect(bundle)
        self.assertTrue(report["archive"]["zip64"])
        self.assertTrue(report["selectedPackage"]["archive"]["zip64"])
        extended = zip64_end(package_bytes(), extension=b"bounded extension")
        self.assertEqual(self.inspect(extended)["selectedPackage"]["manifest"]["xml"], PACKAGE_XML)

    def test_zip64_local_size_extra_is_resolved(self):
        out = io.BytesIO()
        with zipfile.ZipFile(out, "w") as archive:
            with archive.open("AppxManifest.xml", "w", force_zip64=True) as manifest:
                manifest.write(PACKAGE_XML.encode())
        report = self.inspect(out.getvalue())
        self.assertEqual(report["selectedPackage"]["manifest"]["xml"], PACKAGE_XML)
        self.assertTrue(report["archive"]["zip64"])

    def test_zip64_central_sizes_and_local_offset_extras_are_resolved(self):
        original = package_bytes()
        end = inspector.EOCD.unpack(original[-22:])
        cd_offset = end[6]
        fields = list(inspector.CENTRAL.unpack_from(original, cd_offset))
        expanded, compressed, local_offset = fields[9], fields[8], fields[16]
        extra = struct.pack("<HHQQQ", 1, 24, expanded, compressed, local_offset)
        fields[8] = fields[9] = fields[16] = 0xffffffff
        fields[11] = len(extra)
        name = original[cd_offset + 46:cd_offset + 46 + fields[10]]
        central = inspector.CENTRAL.pack(*fields) + name + extra
        new_end = list(end)
        new_end[5] = len(central)
        changed = original[:cd_offset] + central + inspector.EOCD.pack(*new_end)
        self.assertEqual(self.inspect(changed)["selectedPackage"]["manifest"]["xml"], PACKAGE_XML)

    def test_zip64_forged_end_metadata_rejected_before_zipfile(self):
        valid = zip64_end(package_bytes())
        record_offset = len(valid) - 22 - 20 - 56
        cases = [(record_offset + 4, "<Q", 4097, "record size"),
                 (record_offset + 4, "<Q", 43, "record size"),
                 (record_offset + 4, "<Q", 45, "record extent"),
                 (record_offset + 24, "<Q", 20001, "Multi-disk"),
                 (record_offset + 32, "<Q", 20001, "Multi-disk"),
                 (record_offset + 40, "<Q", inspector.MAX_CENTRAL_DIRECTORY_BYTES + 1, "central directory exceeds"),
                 (record_offset + 48, "<Q", 2**64 - 1, "bounds"),
                 (len(valid) - 22 - 20 + 4, "<I", 1, "Multi-disk"),
                 (len(valid) - 22 - 20 + 16, "<I", 2, "Multi-disk"),
                 (len(valid) - 22 - 20 + 8, "<Q", 2**64 - 1, "record offset")]
        for offset, fmt, value, reason in cases:
            with self.subTest(offset=offset, value=value):
                changed = bytearray(valid)
                struct.pack_into(fmt, changed, offset, value)
                with patch.object(inspector.zipfile, "ZipFile", side_effect=AssertionError("must precheck ZIP64")):
                    self.rejected(bytes(changed), reason)
        changed = bytearray(valid)
        struct.pack_into("<QQ", changed, record_offset + 24, 20001, 20001)
        with patch.object(inspector.zipfile, "ZipFile", side_effect=AssertionError("must precheck ZIP64")):
            self.rejected(bytes(changed), "central directory exceeds")

    def test_zip64_legacy_fields_must_match_unless_sentinel(self):
        changed = bytearray(zip64_end(package_bytes()))
        struct.pack_into("<I", changed, len(changed) - 22 + 12, 1)
        self.rejected(bytes(changed), "legacy end directory fields disagree")

    def test_encrypted_and_unsupported_compression_rejected(self):
        data = bytearray(package_bytes())
        central = data.index(b"PK\x01\x02")
        struct.pack_into("<H", data, 6, 1)
        struct.pack_into("<H", data, central + 8, 1)
        self.rejected(bytes(data), "Encrypted ZIP")
        self.rejected(package_bytes(compression=zipfile.ZIP_BZIP2), "compression method")

    def test_encrypted_eappx_magics_rejected_independent_of_extension(self):
        for magic in inspector.EAPPX_MAGICS:
            self.rejected(magic + b"\0" * 40, "EAPPX")
            self.rejected(magic, "EAPPX")

    def test_expansion_ratio_total_declared_and_xml_complexity_limits(self):
        self.rejected(package_bytes(extra=[("bomb", b"0" * 100_000)], compression=zipfile.ZIP_DEFLATED), "expansion ratio")
        data = package_bytes()
        with patch.object(inspector, "MAX_DECLARED_BYTES", 32): self.rejected(data, "expanded archive size")
        with patch.object(inspector, "MAX_XML_DEPTH", 2): self.rejected(data, "XML structure")
        with patch.object(inspector, "MAX_XML_ELEMENTS", 2): self.rejected(data, "XML structure")

    def test_dtd_entities_bad_encoding_and_malformed_xml_rejected(self):
        for xml in ['<!DOCTYPE Package [<!ENTITY x "value">]><Package>&x;</Package>', '<!ENTITY x "value"><Package/>', '<Package>\0</Package>', '<Package>', '<?xml version="1.0" encoding="iso-8859-1"?><Package/>', b"<Package>\xff</Package>"]:
            self.rejected(package_bytes(xml), "DTD|encoding|malformed|UTF-8")
        xml = '<!DOCTYPE Package [<!ENTITY x "value">]><Package>&x;</Package>'
        self.rejected(package_bytes(b"\xff\xfe" + xml.encode("utf-16-le")), "DTD")

    def test_read_metadata_crc_failure_and_nested_package_crc_failure(self):
        data = package_bytes()
        self.rejected(data.replace(b"Fixture.Game", b"Broken!.Game", 1), "CRC")
        inner = package_bytes()
        bundle = bundle_bytes([("x64.msix", "x64", "application", inner)])
        # Rewriting one inner byte without rewriting outer CRC must be rejected.
        location = bundle.index(inner)
        changed = bytearray(bundle)
        changed[location + 40] ^= 1
        self.rejected(bytes(changed), "CRC")

    def test_corrupt_deflate_stream_has_safe_error(self):
        changed = bytearray(package_bytes(compression=zipfile.ZIP_DEFLATED))
        start = 30 + struct.unpack_from("<H", changed, 26)[0] + struct.unpack_from("<H", changed, 28)[0]
        changed[start] = 7  # BFINAL=1, reserved BTYPE=3.
        self.rejected(bytes(changed), "ZIP/CRC")

    def test_local_central_name_flag_size_and_data_bounds_disagreement(self):
        data = package_bytes()
        for offset, value, pattern in [(6, 8, "headers disagree"), (18, 1, "sizes or CRC"), (26, 65000, "overlaps")]:
            changed = bytearray(data)
            struct.pack_into("<H" if offset in (6, 26) else "<I", changed, offset, value)
            self.rejected(bytes(changed), pattern)
        changed = bytearray(data)
        changed[30] = ord("B")
        self.rejected(bytes(changed), "names disagree")

    def test_truncated_trailing_missing_manifest_and_ambiguous_kind_rejected(self):
        data = package_bytes()
        self.rejected(data[:-1], "end directory")
        self.rejected(data + b"trailing", "trailing data")
        self.rejected(b"not a package", "not a supported")
        out = io.BytesIO()
        with zipfile.ZipFile(out, "w") as archive: archive.writestr("payload", b"x")
        self.rejected(out.getvalue(), "no package or bundle manifest")
        self.rejected(package_bytes(extra=[("AppxMetadata/AppxBundleManifest.xml", "<Bundle/>")]), "ambiguously")

    def test_cli_success_and_error_channels_are_json_and_bounded(self):
        self.file.write_bytes(package_bytes())
        good = subprocess.run([sys.executable, str(SCRIPT), str(self.file), "--arch", "x64"], capture_output=True, text=True, check=False)
        self.assertEqual(good.returncode, 0)
        self.assertEqual(good.stderr, "")
        self.assertTrue(json.loads(good.stdout)["inspectionOnly"])
        self.file.write_bytes(b"invalid")
        bad = subprocess.run([sys.executable, str(SCRIPT), str(self.file), "--arch", "x64"], capture_output=True, text=True, check=False)
        self.assertEqual(bad.returncode, 2)
        self.assertEqual(bad.stdout, "")
        self.assertEqual(json.loads(bad.stderr)["error"]["code"], "inspection-rejected")
        self.assertNotIn("Traceback", bad.stderr)
        arguments = subprocess.run([sys.executable, str(SCRIPT), str(self.file)], capture_output=True, text=True, check=False)
        self.assertEqual(arguments.returncode, 2)
        self.assertEqual(arguments.stdout, "")
        self.assertEqual(json.loads(arguments.stderr)["error"]["code"], "invalid-arguments")


if __name__ == "__main__":
    unittest.main()
