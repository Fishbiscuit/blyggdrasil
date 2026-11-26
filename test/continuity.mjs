import assert from "node:assert/strict";
import { test } from "node:test";
import { rehearseContinuity } from "../lib/continuity.js";

const reports = await rehearseContinuity();
const byName = Object.fromEntries(reports.map((report) => [report.name, report]));

test("resolves a moved blyg and verifies the unchanged pinned copy and old account proof", () => {
  const { publish, move } = byName;
  assert.notEqual(publish.origin, move.origin);
  assert.equal(move.redirected, true);
  assert.equal(move.signedMove, true);
  assert.equal(move.active.status, "verified");
  assert.deepEqual(move.active.treeIdentity.formerOrigins, [publish.origin]);
  assert.equal(move.active.signingKey, publish.active.signingKey);
  assert.equal(move.pinned.pinned, true);
  assert.equal(move.pinned.version, 1);
  assert.equal(move.samePinnedCopy, true);
  assert.equal(move.branch.verdict, "verified");
  assert.equal(move.branch.method, "key");
});

test("planned rotation accepts the new byline and previous key for the exact first copy", () => {
  const { publish, rotate } = byName;
  assert.equal(rotate.history[0].how, "rotated");
  assert.equal(rotate.history[0].key, publish.active.signingKey);
  assert.notEqual(rotate.active.signingKey, publish.active.signingKey);
  assert.equal(rotate.catalogVersion, 2);
  assert.equal(rotate.active.version, 2);
  assert.equal(rotate.active.status, "verified");
  assert.deepEqual(rotate.active.treeIdentity.keyHistory, rotate.history);
  assert.equal(rotate.pinned.signingKey, publish.active.signingKey);
  assert.equal(rotate.samePinnedCopy, true);
});

test("recovery requires a fetchable pinned tree listing the offline recovery key", () => {
  const { publish, recover, "missing-pin": missingPin } = byName;
  assert.equal(recover.history[0].how, "recovered");
  assert.equal(recover.history[0].key, publish.active.signingKey);
  assert.equal(recover.history[0].from, "v1");
  assert.notEqual(recover.history[0].by, publish.active.signingKey);
  assert.equal(recover.active.status, "verified");
  assert.equal(recover.samePinnedCopy, true);
  assert.equal(missingPin.active.status, "unavailable");
  assert.deepEqual(missingPin.active.checks, { content: "valid", signature: "valid", signer: "unavailable" });
  assert.equal(missingPin.samePinnedCopy, false);
  assert.equal(missingPin.active.treeIdentity, undefined);
});

test("an unrelated key can sign the text but cannot establish within-tree continuity", () => {
  const result = byName["wrong-key"];
  assert.equal(result.active.status, "failed");
  assert.deepEqual(result.active.checks, { content: "valid", signature: "valid", signer: "invalid" });
  assert.equal(result.active.expectedSigner, "invalid");
  assert.equal(result.samePinnedCopy, true);
  assert.equal(result.branch.verdict, "verified");
});
