"""Read Blygger 0.4 items and independently check Ed25519 bylines."""

import argparse
import base64
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import urljoin, urlsplit

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey


ITEM_ID = re.compile(r"[0-7][0-9abcdefghjkmnpqrstvwxyz]{25}")
CONTENT_HASH = re.compile(r"sha256:[0-9a-f]{64}")
SIGNATURE = re.compile(r"[A-Za-z0-9_-]{86}")
BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
ED25519_CODEC = b"\xed\x01"


def decode_key(did):
    prefix = "did:key:z"
    if not isinstance(did, str) or not did.startswith(prefix):
        raise ValueError("expected an Ed25519 did:key")
    encoded = did[len(prefix):]
    if len(encoded) != 47:
        raise ValueError("invalid Ed25519 public key length")
    number = 0
    for character in encoded:
        number = number * 58 + BASE58.index(character)
    decoded = number.to_bytes((number.bit_length() + 7) // 8, "big")
    if len(decoded) != 34 or decoded[:2] != ED25519_CODEC:
        raise ValueError("invalid Ed25519 public key")
    return Ed25519PublicKey.from_public_bytes(decoded[2:])


def hash_verdict(item):
    stored = item.get("content_hash")
    markdown = item.get("content_md")
    if stored is None:
        return "unavailable"
    if not isinstance(stored, str) or not CONTENT_HASH.fullmatch(stored):
        return "invalid"
    if not isinstance(markdown, str):
        return "unavailable"
    digest = "sha256:" + hashlib.sha256(markdown.encode("utf-8")).hexdigest()
    return "valid" if stored == digest else "invalid"


def byline_verdict(item):
    author = item.get("author")
    if author is None or isinstance(author, dict) and "sig" not in author:
        return "unsigned", None
    signature = author.get("sig") if isinstance(author, dict) else None
    if not isinstance(signature, dict):
        return "invalid", None
    try:
        did = signature["key"]
        key = decode_key(did)
        encoded = signature["value"]
        if not isinstance(encoded, str) or not SIGNATURE.fullmatch(encoded):
            return "invalid", None
        value = base64.urlsafe_b64decode(encoded + "==")
    except (KeyError, ValueError):
        return "invalid", None

    stored = item.get("content_hash")
    if not isinstance(stored, str) or not CONTENT_HASH.fullmatch(stored):
        return "unavailable", did
    try:
        key.verify(value, stored.encode("ascii"))
    except InvalidSignature:
        return "invalid", did
    return "valid", did


def verify_item(item, expected_key):
    if not isinstance(item, dict) or not ITEM_ID.fullmatch(item.get("id") or ""):
        raise ValueError("expected an item document with a valid ID")
    version = item.get("version")
    if type(version) is not int or version < 1:
        raise ValueError("expected an item document with a positive version")
    if item.get("kind") not in {"fragment", "thread"}:
        raise ValueError("expected a published fragment or thread")

    content = hash_verdict(item)
    signature, did = byline_verdict(item)
    checks = {"content": content, "signature": signature}
    result = {
        "id": item["id"],
        "origin": item.get("origin"),
        "version": version,
        "pinned": item.get("pinned") is True,
        "signingKey": did,
        "checks": checks,
    }
    values = list(checks.values())
    if expected_key is not None:
        if did is None:
            expected = signature
        else:
            expected = "valid" if did == expected_key else "invalid"
        result["expectedSigner"] = expected
        values.append(expected)
    for verdict, status in (("invalid", "failed"), ("unavailable", "unavailable"), ("unsigned", "unsigned")):
        if verdict in values:
            result["status"] = status
            break
    else:
        result["status"] = "verified"
    return result


def fetch_json(origin, path):
    url = urljoin(origin, path)
    target = urlsplit(url)
    if target.scheme != "https" or target.netloc != urlsplit(origin).netloc or target.fragment:
        raise ValueError(f"expected an HTTPS endpoint on {origin}")
    response = subprocess.run(
        ["curl", "--fail", "--silent", "--show-error", "--max-time", "12",
         "--max-filesize", "4194304", "--proto", "=https", "--", url],
        check=True, capture_output=True,
    )
    return json.loads(response.stdout)


def require_pin(item, version):
    if item.get("pinned") is not True or type(item.get("version")) is not int or item["version"] != version:
        raise ValueError(f"the publisher did not return pinned version {version}")
    return item


def find_item(origin, item_id, path):
    if not ITEM_ID.fullmatch(item_id):
        raise ValueError("invalid item ID")
    item = fetch_json(origin, path)
    if item.get("id") != item_id or item.get("origin") != origin:
        raise ValueError("item ID or origin does not match the requested item")
    return item


def read_blyg(origin, selected_item, limit, pin):
    target = urlsplit(origin)
    if (target.scheme != "https" or not target.hostname or target.username is not None
            or target.query or target.fragment):
        raise ValueError("supply a canonical HTTPS blyg URL")
    origin = origin.rstrip("/") + "/"
    manifest = fetch_json(origin, "blyg.json")
    if manifest["blyg"] != "0.4":
        raise ValueError("this reader expects Blygger 0.4")

    if pin is not None:
        template = manifest.get("pin", "items/{id}/v{n}.json")
        if not isinstance(template, str) or "{id}" not in template or "{n}" not in template:
            raise ValueError("the pin URL template requires {id} and {n}")
        path = template.replace("{id}", selected_item).replace("{n}", str(pin))
        yield require_pin(find_item(origin, selected_item, path), pin)
        return

    archive = fetch_json(origin, manifest.get("items", "items/index.json"))["items"]
    ids = [item["id"] for item in archive]
    if selected_item:
        if selected_item not in ids:
            raise ValueError("the requested item is missing from the archive index")
        ids = [selected_item]

    template = manifest.get("item", "items/{id}.json")
    for item_id in ids[:limit]:
        yield find_item(origin, item_id, template.replace("{id}", item_id))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("origin", nargs="?", help="canonical HTTPS blyg URL")
    source.add_argument("--file", type=Path, help="check a saved item JSON file offline")
    parser.add_argument("--item", help="select one item from the live blyg")
    parser.add_argument("--pin", type=int, help="require this exact pinned version")
    parser.add_argument("--limit", type=int, default=5, help="maximum live items to read")
    parser.add_argument("--expect-key", help="check which public key signed the byline")
    parser.add_argument("--json", action="store_true", help="emit an array of byline reports")
    args = parser.parse_args()
    if args.limit < 1 or (args.item and not args.origin):
        parser.error("--limit must be positive and --item requires an origin")
    if args.item and not ITEM_ID.fullmatch(args.item):
        parser.error("--item must be a valid item ID")
    if args.pin is not None and (args.pin < 1 or (args.origin and not args.item)):
        parser.error("--pin requires a positive version and either --file or an origin with --item")
    if args.expect_key is not None:
        try:
            decode_key(args.expect_key)
        except ValueError as error:
            parser.error(str(error))

    try:
        if args.file:
            item = json.loads(args.file.read_text(encoding="utf-8"))
            items = [item if args.pin is None else require_pin(item, args.pin)]
        else:
            items = read_blyg(args.origin, args.item, args.limit, args.pin)
        reports = [verify_item(item, args.expect_key) for item in items]
    except (OSError, TypeError, AttributeError, ValueError, KeyError, subprocess.CalledProcessError) as error:
        detail = error.stderr.decode(errors="replace").strip() if isinstance(error, subprocess.CalledProcessError) else error
        print(f"Could not read blyg: {detail}", file=sys.stderr)
        return 2

    if args.json:
        print(json.dumps(reports))
    else:
        for report in reports:
            status = report["status"].upper()
            pinned = " pinned" if report["pinned"] else ""
            checks = ", ".join(f"{name}={value}" for name, value in report["checks"].items())
            if "expectedSigner" in report:
                checks += f", expectedSigner={report['expectedSigner']}"
            print(f"{status} {report['id']} v{report['version']}{pinned} ({checks})")
    return 0 if reports and all(report["status"] == "verified" for report in reports) else 1


if __name__ == "__main__":
    sys.exit(main())
