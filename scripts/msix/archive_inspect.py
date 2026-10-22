#!/usr/bin/env python3
"""Bounded, offline MSIX/APPX inspection. Never extract, install or execute.

ZIP64 end records are bounded before ZIP parsing; multi-disk archives are
rejected. The input must be a regular file without symlink path components,
at most 8 GiB. Central
directories are limited to 8 MiB / 20,000 members, declared expanded data to
16 GiB, individual metadata to 1 MiB and a selected nested package to 256 MiB.
Only stored/deflated ZIP members with an expansion ratio <= 200 are accepted.
These are inspection limits, not statements about valid packages or support.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import re
import stat
import struct
import sys
import unicodedata
import xml.etree.ElementTree as ET
import zipfile
import zlib


MAX_PACKAGE_BYTES = 8 * 1024**3
MAX_CENTRAL_DIRECTORY_BYTES = 8 * 1024**2
MAX_ENTRIES = 20_000
MAX_DECLARED_BYTES = 16 * 1024**3
MAX_INNER_BYTES = 256 * 1024**2
MAX_METADATA_BYTES = 1024**2
MAX_EXPANSION_RATIO = 200
MAX_XML_ELEMENTS = 20_000
MAX_XML_DEPTH = 32
MAX_NAME_BYTES = 4096
BUNDLE_NAMESPACE = "http://schemas.microsoft.com/appx/2013/bundle"
ARCHITECTURES = ("x64", "x86", "arm64")
EAPPX_MAGICS = (b"EXPH", b"EXSH", b"EXBH")
EOCD = struct.Struct("<4s4H2IH")
CENTRAL = struct.Struct("<4s6H3I5H2I")
LOCAL = struct.Struct("<4s5H3I2H")
ZIP64_LOCATOR = struct.Struct("<4sIQI")
ZIP64_END = struct.Struct("<4sQ2H2I4Q")


class InspectionError(ValueError):
    """A bounded, user-safe reason why inspection cannot proceed."""


def fail(message: str) -> None:
    raise InspectionError(message)


def _read_at(source, offset: int, length: int) -> bytes:
    source.seek(offset)
    value = source.read(length)
    if len(value) != length:
        fail("Archive data is truncated.")
    return value


def _extra_fields(extra: bytes) -> dict[int, bytes]:
    offset = 0
    fields = {}
    while offset < len(extra):
        if offset + 4 > len(extra):
            fail("ZIP extra fields are truncated.")
        kind, length = struct.unpack_from("<HH", extra, offset)
        offset += 4
        if offset + length > len(extra):
            fail("ZIP extra fields are truncated.")
        if kind == 1 and (kind in fields or length > 28):
            fail("ZIP64 member extra metadata is ambiguous or exceeds limits.")
        fields[kind] = extra[offset:offset + length]
        offset += length
    return fields


def _zip64_values(values, sentinels, widths, extra: dict[int, bytes]):
    required = sum(width for value, sentinel, width in zip(values, sentinels, widths) if value == sentinel)
    body = extra.get(1, b"")
    if len(body) != required:
        fail("ZIP64 member extra metadata is missing or inconsistent.")
    offset = 0
    resolved = []
    for value, sentinel, width in zip(values, sentinels, widths):
        if value == sentinel:
            value = int.from_bytes(body[offset:offset + width], "little")
            offset += width
        resolved.append(value)
    return resolved


def _member_name(raw: bytes, flags: int) -> tuple[str, str]:
    if not raw or len(raw) > MAX_NAME_BYTES:
        fail("Archive member names exceed inspection limits.")
    try:
        name = raw.decode("utf-8" if flags & 0x800 else "cp437", errors="strict")
    except UnicodeError:
        fail("Archive member name encoding is invalid.")
    return name, _safe_path(_decoded_opc_path(name))


def _safe_path(name: str) -> str:
    if not name or len(name.encode("utf-8")) > MAX_NAME_BYTES:
        fail("Archive member names exceed inspection limits.")
    if name.startswith("/") or "\\" in name or any(c in '<>:"|?*' for c in name):
        fail("Unsafe absolute, drive or backslash archive member path.")
    if any(unicodedata.category(c) == "Cc" for c in name):
        fail("Archive member paths contain control characters or NUL.")
    parts = name[:-1].split("/") if name.endswith("/") else name.split("/")
    if any(not part or part in (".", "..") or part.endswith((".", " ")) for part in parts):
        fail("Unsafe traversal, empty, dot or trailing-space archive member path.")
    return unicodedata.normalize("NFC", "/".join(parts)).casefold()


def _decoded_opc_path(name: str) -> str:
    """Decode one OPC filename layer, never URLs or recursively encoded paths.

    MSIX bundle FileName attributes are logical names; ZIP members may encode
    spaces and non-ASCII characters, as in Microsoft's MSIX SDK Encoding.cpp.
    Validate both representations and forbid encoded path separators entirely.
    """
    _safe_path(name)
    if "%" not in name:
        return name
    output = bytearray()
    position = 0
    while position < len(name):
        if name[position] == "%":
            if position + 2 >= len(name) or not re.fullmatch("[0-9A-Fa-f]{2}", name[position + 1:position + 3]):
                fail("Invalid OPC percent-encoded archive member path.")
            byte = int(name[position + 1:position + 3], 16)
            if byte in (ord("/"), ord("\\"), ord(":")):
                fail("Unsafe OPC encoded separator or drive archive member path.")
            output.append(byte)
            position += 3
        else:
            output.extend(name[position].encode("utf-8"))
            position += 1
    try:
        decoded = output.decode("utf-8", errors="strict")
    except UnicodeError:
        fail("OPC percent-encoded member paths must contain valid UTF-8.")
    _safe_path(decoded)
    return decoded


def _precheck(source, size: int) -> dict:
    """Bound the central directory before ZipFile allocates or decodes it."""
    if size >= 4 and _read_at(source, 0, 4) in EAPPX_MAGICS:
        fail("Encrypted EAPPX/EAPPXBUNDLE inspection is unsupported.")
    if size < EOCD.size:
        fail("Input is not a supported ZIP MSIX/APPX archive.")
    magic = _read_at(source, 0, 4)
    if magic not in (b"PK\x03\x04", b"PK\x05\x06"):
        fail("Input is not a supported ZIP MSIX/APPX archive.")
    tail_offset = max(0, size - (EOCD.size + 65535))
    tail = _read_at(source, tail_offset, size - tail_offset)
    position = len(tail)
    end = None
    while True:
        position = tail.rfind(b"PK\x05\x06", 0, position)
        if position < 0:
            break
        if position + EOCD.size <= len(tail):
            candidate = EOCD.unpack_from(tail, position)
            if position + EOCD.size + candidate[-1] == len(tail):
                end = candidate
                break
    if end is None:
        fail("ZIP end directory is missing, truncated or has trailing data.")
    _, disk, directory_disk, disk_count, count, directory_size, directory_offset, _ = end
    end_offset = tail_offset + position
    zip64 = end_offset >= ZIP64_LOCATOR.size and _read_at(source, end_offset - ZIP64_LOCATOR.size, 4) == b"PK\x06\x07"
    directory_end = end_offset
    if zip64:
        locator_offset = end_offset - ZIP64_LOCATOR.size
        _, record_disk, record_offset, total_disks = ZIP64_LOCATOR.unpack(_read_at(source, locator_offset, ZIP64_LOCATOR.size))
        if record_disk or total_disks != 1:
            fail("Multi-disk ZIP64 archives are unsupported.")
        if record_offset > locator_offset - ZIP64_END.size:
            fail("ZIP64 end record offset is outside archive bounds.")
        header = _read_at(source, record_offset, 12)
        signature, record_size = struct.unpack("<4sQ", header)
        if signature != b"PK\x06\x06" or not 44 <= record_size <= 4096:
            fail("ZIP64 end record size or signature exceeds inspection limits.")
        if record_offset + 12 + record_size != locator_offset:
            fail("ZIP64 end record extent is inconsistent.")
        record = ZIP64_END.unpack(_read_at(source, record_offset, ZIP64_END.size))
        _, _, _, _, disk64, directory_disk64, disk_count64, count64, directory_size64, directory_offset64 = record
        if disk64 or directory_disk64 or disk_count64 != count64:
            fail("Multi-disk ZIP64 archives are unsupported.")
        if disk or directory_disk:
            fail("Multi-disk ZIP archives are unsupported.")
        for legacy, actual, sentinel in [(disk_count, disk_count64, 0xFFFF), (count, count64, 0xFFFF),
                                         (directory_size, directory_size64, 0xFFFFFFFF), (directory_offset, directory_offset64, 0xFFFFFFFF)]:
            if legacy != sentinel and legacy != actual:
                fail("ZIP64 and legacy end directory fields disagree.")
        disk_count, count, directory_size, directory_offset = disk_count64, count64, directory_size64, directory_offset64
        directory_end = record_offset
    elif 0xFFFF in (disk_count, count) or 0xFFFFFFFF in (directory_size, directory_offset):
        fail("ZIP64 end directory locator is missing.")
    if disk or directory_disk or disk_count != count:
        fail("Multi-disk ZIP archives are unsupported.")
    if count > MAX_ENTRIES or directory_size > MAX_CENTRAL_DIRECTORY_BYTES:
        fail("ZIP central directory exceeds inspection limits.")
    if directory_offset + directory_size != directory_end:
        fail("ZIP central directory bounds are inconsistent.")
    central = _read_at(source, directory_offset, directory_size)
    offset = 0
    seen = set()
    entries = []
    total = 0
    for _ in range(count):
        if offset + CENTRAL.size > len(central):
            fail("ZIP central directory is truncated.")
        fields = CENTRAL.unpack_from(central, offset)
        if fields[0] != b"PK\x01\x02":
            fail("ZIP central directory member is invalid.")
        (_, _, _, flags, method, _, _, crc, compressed, expanded,
         name_length, extra_length, comment_length, member_disk, _, attributes, local_offset) = fields
        if flags & 0x2041:
            fail("Encrypted ZIP members are unsupported.")
        if method not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
            fail("ZIP compression method is unsupported for inspection.")
        next_offset = offset + CENTRAL.size + name_length + extra_length + comment_length
        if next_offset > len(central):
            fail("ZIP central directory member is truncated.")
        raw_name = central[offset + CENTRAL.size:offset + CENTRAL.size + name_length]
        name, key = _member_name(raw_name, flags)
        if key in seen:
            fail("Duplicate or case-folded archive member paths are ambiguous.")
        seen.add(key)
        extras = _extra_fields(central[offset + CENTRAL.size + name_length:offset + CENTRAL.size + name_length + extra_length])
        zip64 = zip64 or 1 in extras
        expanded, compressed, local_offset, member_disk = _zip64_values(
            [expanded, compressed, local_offset, member_disk], [0xFFFFFFFF, 0xFFFFFFFF, 0xFFFFFFFF, 0xFFFF], [8, 8, 8, 4], extras)
        if member_disk:
            fail("Multi-disk ZIP members are unsupported.")
        kind = stat.S_IFMT(attributes >> 16)
        directory = name.endswith("/")
        if kind not in (0, stat.S_IFREG, stat.S_IFDIR):
            fail("Symlink or special archive entries are unsupported.")
        if (kind == stat.S_IFDIR or attributes & 0x10) and not directory:
            fail("Archive directory attributes and path disagree.")
        if (kind == stat.S_IFREG and directory) or (directory and (expanded or compressed)):
            fail("Archive directory entries contain file data or conflicting attributes.")
        if expanded and (not compressed or expanded > compressed * MAX_EXPANSION_RATIO):
            fail("ZIP member expansion ratio exceeds inspection limits.")
        total += expanded
        if total > MAX_DECLARED_BYTES:
            fail("Declared expanded archive size exceeds inspection limits.")
        entries.append((name, flags, method, crc, compressed, expanded, local_offset, raw_name))
        offset = next_offset
    if offset != len(central):
        fail("ZIP central directory count or size is inconsistent.")
    # Validate local names/flags for every member, including unread payloads.
    spans = []
    for name, flags, method, crc, compressed, expanded, local_offset, raw_name in entries:
        if local_offset + LOCAL.size > directory_offset:
            fail("ZIP local member bounds are inconsistent.")
        local = LOCAL.unpack(_read_at(source, local_offset, LOCAL.size))
        if local[0] != b"PK\x03\x04" or local[2] != flags or local[3] != method:
            fail("ZIP local and central member headers disagree.")
        metadata_end = local_offset + LOCAL.size + local[9] + local[10]
        if metadata_end + compressed > directory_offset:
            fail("ZIP member data overlaps the central directory.")
        local_name = _read_at(source, local_offset + LOCAL.size, local[9])
        _member_name(local_name, flags)
        if local_name != raw_name:
            fail("ZIP local and central member names disagree.")
        local_extras = _extra_fields(_read_at(source, local_offset + LOCAL.size + local[9], local[10]))
        zip64 = zip64 or 1 in local_extras
        local_expanded, local_compressed = _zip64_values([local[8], local[7]], [0xFFFFFFFF, 0xFFFFFFFF], [8, 8], local_extras)
        if not flags & 8 and (local[6], local_compressed, local_expanded) != (crc, compressed, expanded):
            fail("ZIP local and central member sizes or CRC disagree.")
        spans.append((local_offset, metadata_end + compressed))
    spans.sort()
    if any(current[1] > following[0] for current, following in zip(spans, spans[1:])):
        fail("ZIP member ranges overlap.")
    return {"entryCount": count, "declaredUncompressedBytes": total, "zip64": zip64}


def _open_archive(source, size: int):
    metadata = _precheck(source, size)
    source.seek(0)
    try:
        archive = zipfile.ZipFile(source, mode="r")
    except (ValueError, OSError, zipfile.BadZipFile):
        fail("ZIP central directory could not be read.")
    members = {_safe_path(_decoded_opc_path(info.filename)): info for info in archive.infolist()}
    if len(members) != metadata["entryCount"]:
        archive.close()
        fail("ZIP directory member count is inconsistent.")
    metadata.update(signaturePresent="appxsignature.p7x" in members and not members["appxsignature.p7x"].is_dir(),
                    blockMapPresent="appxblockmap.xml" in members and not members["appxblockmap.xml"].is_dir(),
                    signatureValidated=False, blockMapValidated=False,
                    payloadCrcValidated=False)
    return archive, members, metadata


def _read_member(archive, info, maximum: int) -> bytes:
    if info.is_dir() or info.file_size > maximum:
        fail("Selected package or metadata exceeds inspection limits.")
    try:
        with archive.open(info, "r") as member:
            data = member.read(maximum + 1)
        if len(data) != info.file_size or len(data) > maximum:
            fail("Selected package or metadata size is inconsistent.")
        return data
    except (ValueError, OSError, RuntimeError, zipfile.BadZipFile, EOFError, zlib.error):
        fail("Selected package or metadata failed ZIP/CRC validation.")


def _xml_metadata(archive, info) -> tuple[dict, ET.Element]:
    raw = _read_member(archive, info, MAX_METADATA_BYTES)
    if raw.startswith(b"\xff\xfe"):
        codec, encoding = "utf-16", "utf-16le"
    elif raw.startswith(b"\xfe\xff"):
        codec, encoding = "utf-16", "utf-16be"
    else:
        codec, encoding = "utf-8-sig", "utf-8"
    try:
        xml = raw.decode(codec, errors="strict")
    except UnicodeError:
        fail("Metadata must be bounded UTF-8 or BOM-marked UTF-16.")
    if "\x00" in xml or re.search(r"<!\s*(?:DOCTYPE|ENTITY)\b", xml, re.IGNORECASE):
        fail("DTD, entities or NUL are unsupported in package metadata.")
    declaration = re.match(r"\s*<\?xml\s+[^?]*?encoding\s*=\s*['\"]([^'\"]+)['\"]", xml, re.IGNORECASE)
    allowed = {"utf-8", "utf8"} if encoding == "utf-8" else {"utf-16", encoding}
    if declaration and declaration.group(1).lower() not in allowed:
        fail("Metadata encoding declaration is unsupported or contradicts its BOM.")
    try:
        root = ET.fromstring(xml)
    except (ET.ParseError, ValueError):
        fail("Package metadata XML is malformed.")
    pending = [(root, 1)]
    count = 0
    while pending:
        node, depth = pending.pop()
        count += 1
        if depth > MAX_XML_DEPTH or count > MAX_XML_ELEMENTS:
            fail("Package metadata XML structure exceeds inspection limits.")
        pending.extend((child, depth + 1) for child in node)
    return {"path": info.filename, "xml": xml, "encoding": encoding}, root


def _bundle_metadata(archive, members, info, architecture: str):
    manifest, root = _xml_metadata(archive, info)
    ns = "{" + BUNDLE_NAMESPACE + "}"
    if root.tag != ns + "Bundle":
        fail("Bundle metadata must use the Microsoft 2013 bundle namespace.")
    identities = root.findall(ns + "Identity")
    containers = root.findall(ns + "Packages")
    if len(identities) != 1 or len(containers) != 1:
        fail("Bundle identity or package index is missing or ambiguous.")
    identity = {}
    for key in ("Name", "Publisher", "Version"):
        value = identities[0].get(key)
        if not value or len(value.encode("utf-8")) > 4096 or any(unicodedata.category(c) == "Cc" for c in value):
            fail("Bundle identity attributes are missing or exceed inspection limits.")
        identity[key.lower()] = value
    packages = []
    indexed = set()
    for node in containers[0]:
        if node.tag != ns + "Package":
            fail("Bundle package index contains an unsupported element.")
        filename = node.get("FileName", "")
        key = _safe_path(filename)
        if filename.endswith("/") or key in indexed:
            fail("Bundle member references are duplicate or ambiguous.")
        indexed.add(key)
        member = members.get(key)
        if member is None or _decoded_opc_path(member.filename) != filename or member.is_dir():
            fail("Indexed bundle member is missing or does not match its ZIP path.")
        package_type, arch = node.get("Type", ""), node.get("Architecture", "neutral")
        if package_type not in ("application", "resource") or arch not in ("neutral", "x64", "x86", "arm", "arm64"):
            fail("Bundle member type or architecture is unsupported.")
        package = {"fileName": filename, "archivePath": member.filename, "architecture": arch, "type": package_type}
        for key_name in ("Version", "Size"):
            value = node.get(key_name)
            if value is not None:
                if key_name == "Size":
                    if not re.fullmatch(r"[0-9]{1,20}", value) or int(value) != member.file_size:
                        fail("Indexed bundle package size disagrees with the archive.")
                    package["size"] = int(value)
                else:
                    if len(value) > 128:
                        fail("Indexed bundle package version exceeds inspection limits.")
                    package["version"] = value
        packages.append(package)
    exact = [p for p in packages if p["type"] == "application" and p["architecture"] == architecture]
    neutral = [p for p in packages if p["type"] == "application" and p["architecture"] == "neutral"]
    candidates = exact or neutral
    if len(candidates) != 1:
        fail("No unique application package matches the requested architecture; resource packages are not a fallback.")
    selected = candidates[0]
    return {"manifest": manifest, "identity": identity, "packages": packages,
            "selectedMember": selected["fileName"]}, members[_safe_path(selected["fileName"])]


def _inspect_open(source, size: int, architecture: str) -> dict:
    archive, members, metadata = _open_archive(source, size)
    try:
        bundle_info = members.get("appxmetadata/appxbundlemanifest.xml")
        package_info = members.get("appxmanifest.xml")
        if bundle_info is not None and package_info is not None:
            fail("Archive ambiguously contains package and bundle manifests.")
        bundle = None
        if bundle_info is not None:
            metadata["kind"] = "bundle"
            bundle, selected = _bundle_metadata(archive, members, bundle_info, architecture)
            inner_bytes = _read_member(archive, selected, MAX_INNER_BYTES)
            inner, inner_members, inner_meta = _open_archive(io.BytesIO(inner_bytes), len(inner_bytes))
            try:
                if "appxmetadata/appxbundlemanifest.xml" in inner_members:
                    fail("Nested bundles are unsupported.")
                manifest_info = inner_members.get("appxmanifest.xml")
                if manifest_info is None:
                    fail("Selected package has no AppxManifest.xml.")
                manifest, _ = _xml_metadata(inner, manifest_info)
                inner_meta["kind"] = "package"
                selected_package = {"memberPath": selected.filename, "sizeBytes": len(inner_bytes),
                                    "archive": inner_meta, "manifest": manifest}
            finally:
                inner.close()
        elif package_info is not None:
            metadata["kind"] = "package"
            manifest, _ = _xml_metadata(archive, package_info)
            selected_package = {"memberPath": None, "sizeBytes": size,
                                "archive": dict(metadata), "manifest": manifest}
        else:
            fail("Archive has no package or bundle manifest.")
        return {"schemaVersion": 1, "inspectionOnly": True, "requestedArchitecture": architecture,
                "archive": metadata, "bundle": bundle, "selectedPackage": selected_package,
                "limitations": ["No extraction, installation, native execution or network access was performed.",
                                "Signature, block map and unread payload CRCs were not validated.",
                                "Manifest declarations do not establish runtime compatibility or ownership.",
                                "Archive size, metadata, expansion ratio and ZIP64 records are bounded; multi-disk archives are unsupported."]}
    finally:
        archive.close()


def inspect_file(path: str | Path, architecture: str) -> dict:
    if architecture not in ARCHITECTURES:
        fail("Requested architecture must be x64, x86 or arm64.")
    value = os.fspath(path)
    if not isinstance(value, str) or "\x00" in value:
        fail("Input path is invalid.")
    absolute = Path(value)
    if not absolute.is_absolute():
        absolute = Path.cwd() / absolute
    # Walk held directory descriptors, so replacing a parent with a symlink
    # between checks cannot redirect the final open. Nonblocking open avoids a
    # FIFO/device replacement hanging before the regular-file fstat check.
    directory_fd = None
    try:
        if not absolute.name:
            fail("Input must be a regular file.")
        directory_flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_DIRECTORY
        directory_fd = os.open(absolute.anchor, directory_flags)
        for component in absolute.parts[1:-1]:
            next_fd = os.open(component, directory_flags, dir_fd=directory_fd)
            os.close(directory_fd)
            directory_fd = next_fd
        fd = os.open(absolute.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK, dir_fd=directory_fd)
    except OSError:
        fail("Input could not be opened as a regular file without symlinks.")
    finally:
        if directory_fd is not None:
            os.close(directory_fd)
    try:
        opened = os.fstat(fd)
        if not stat.S_ISREG(opened.st_mode):
            fail("Input must be a regular file.")
        if opened.st_size > MAX_PACKAGE_BYTES:
            fail("Package exceeds the 8 GiB phase-one inspection limit.")
    except BaseException:
        os.close(fd)
        raise
    with os.fdopen(fd, "rb") as source:
        result = _inspect_open(source, opened.st_size, architecture)
        source.seek(0)
        digest = hashlib.sha256()
        remaining = opened.st_size
        while remaining:
            chunk = source.read(min(1024**2, remaining))
            if not chunk:
                fail("Input changed during inspection.")
            digest.update(chunk)
            remaining -= len(chunk)
        after = os.fstat(source.fileno())
        if (opened.st_size, opened.st_mtime_ns, opened.st_ctime_ns) != (after.st_size, after.st_mtime_ns, after.st_ctime_ns):
            fail("Input changed during inspection.")
        result["source"] = {"sizeBytes": opened.st_size, "sha256": digest.hexdigest()}
        return result


def main(argv=None) -> int:
    class JsonArgumentParser(argparse.ArgumentParser):
        def error(self, message):
            print(json.dumps({"schemaVersion": 1, "error": {"code": "invalid-arguments", "message": "Provide an explicit file and --arch x64, x86 or arm64."}}), file=sys.stderr)
            self.exit(2)

    parser = JsonArgumentParser(description=__doc__)
    parser.add_argument("file", help="Explicit offline .msix/.appx or bundle file; nothing is extracted")
    parser.add_argument("--arch", choices=ARCHITECTURES, required=True)
    args = parser.parse_args(argv)
    try:
        result = inspect_file(args.file, args.arch)
    except (InspectionError, OSError, zipfile.BadZipFile, NotImplementedError) as error:
        message = str(error) if isinstance(error, InspectionError) else "Archive inspection failed safely."
        print(json.dumps({"schemaVersion": 1, "error": {"code": "inspection-rejected", "message": message}}, ensure_ascii=True), file=sys.stderr)
        return 2
    print(json.dumps(result, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
