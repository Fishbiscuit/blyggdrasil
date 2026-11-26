import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { readPacket } from "../interop/packet.mjs";

const run = promisify(execFile);
const reader = fileURLToPath(new URL("../interop/blyg_read.py", import.meta.url));
const packet = await readPacket();
const pin = packet.cases.find((entry) => entry.name === "pinned-original");
const pinFile = fileURLToPath(new URL(`../demo/edit-and-pin/blyg/${pin.itemUrl.slice(packet.origin.length)}`, import.meta.url));
const otherKey = "did:key:z6MkhZev5NUBbrDxrHAdKLXcSxyyQ6ZBsD5uTEgKehTp4WhB";
const verify = (...args) => run("python3", [reader, "--file", pinFile, "--json", ...args]);

test("Python verifies the exact pinned edition against a supplied public key", async () => {
  const { stdout } = await verify("--pin", "1", "--expect-key", packet.trustedKey);
  const [report] = JSON.parse(stdout);
  assert.equal(report.status, "verified");
  assert.equal(report.pinned, true);
  assert.equal(report.version, 1);
  assert.equal(report.expectedSigner, "valid");
});

test("Python refuses a different pin version", async () => {
  await assert.rejects(verify("--pin", "2"), (error) =>
    error.code === 2 && /pinned version 2/.test(error.stderr));
});

test("a valid signature from a different key fails the trusted signer check", async () => {
  await assert.rejects(verify("--expect-key", otherKey), (error) => {
    assert.equal(error.code, 1);
    const [report] = JSON.parse(error.stdout);
    assert.equal(report.checks.signature, "valid");
    assert.equal(report.expectedSigner, "invalid");
    return true;
  });
});
