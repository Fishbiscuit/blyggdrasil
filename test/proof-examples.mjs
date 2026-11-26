import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { verifyExample } from "../lib/proof-examples.js";

const packet = JSON.parse(readFileSync(new URL("../demo/proof/examples.json", import.meta.url), "utf8"));

test("the original and edited examples use the same recorded hash and signature", async () => {
  const original = await verifyExample(packet, "original");
  const edited = await verifyExample(packet, "edited");
  assert.equal(original.status, "verified");
  assert.deepEqual(original.checks, { content: "valid", signature: "valid", signer: "valid" });
  assert.equal(original.pinned, true);
  assert.equal(edited.status, "failed");
  assert.deepEqual(edited.checks, { content: "invalid", signature: "valid", signer: "valid" });
  assert.equal(original.signingKey, edited.signingKey);
  assert.throws(() => verifyExample(packet, "constructor"), /Unknown proof example/);
});
