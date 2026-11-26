import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parseClaims } from "../lib/blyggdrasil.js";
import { exportPublicBundle } from "../lib/public-bundle/export.js";
import { planBlygMove } from "../lib/public-bundle/move.js";
import { hashResource } from "../lib/public-bundle/surface.js";

const run = promisify(execFile);
const mirror = new URL("../demo/edit-and-pin/blyg/", import.meta.url);
const exportCli = fileURLToPath(new URL("../bin/export-public-bundle.mjs", import.meta.url));
const moveCli = fileURLToPath(new URL("../bin/plan-blyg-move.mjs", import.meta.url));
const { site: origin } = JSON.parse(await readFile(new URL("blyg.json", mirror), "utf8"));
const destination = "https://moved.example/archive/";

function makeBundle(transform = doc => doc) {
  return exportPublicBundle(origin, async url => {
    const doc = JSON.parse(await readFile(new URL(url.slice(origin.length), mirror), "utf8"));
    return JSON.stringify(transform(doc));
  });
}

test("move CLI produces a dry run and retains each original pinned document", async t => {
  const folder = await mkdtemp(join(tmpdir(), "blyg-bundle-move-"));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const filename = join(folder, "bundle.json");
  await run(process.execPath, [exportCli, origin, "--mirror", fileURLToPath(mirror), "--out", filename]);
  const original = await readFile(filename, "utf8");
  const plan = JSON.parse((await run(process.execPath, [moveCli, filename, destination])).stdout);
  assert.equal(plan.status, "planned");
  assert.equal(plan.source, origin);
  assert.equal(plan.destination, destination);
  assert.equal(plan.publish.manifest.url, new URL("blyg.json", destination).href);
  assert.deepEqual(plan.publish.manifest.fields.moved_from, [origin]);
  assert.equal(plan.publish.manifest.fields.blyggdrasil, plan.publish.tree.page);
  const { ok, claims } = parseClaims(plan.publish.tree.unsignedClaims);
  assert.equal(ok, true);
  assert.equal(claims.trunk, destination);
  assert.deepEqual(claims.movedFrom, [origin]);
  assert.equal(claims.key, plan.publish.tree.key);
  assert.ok(plan.publish.documents.some(doc => doc.action === "publish-resigned-tree" && doc.version === 2));
  assert.deepEqual(plan.afterDestinationChecks.redirects[0], {
    status: 308, from: new URL("blyg.json", origin).href, to: new URL("blyg.json", destination).href,
  });
  const pinned = plan.afterDestinationChecks.retain.find(doc => doc.pinned);
  const archived = JSON.parse(original).resources.find(doc => doc.url === pinned.url);
  assert.equal(pinned.sha256, archived.sha256);
  assert.ok(plan.publish.documents.some(doc => doc.from === pinned.url && doc.version === 1 && doc.to.endsWith("/v1.json")));
  assert.ok(!plan.afterDestinationChecks.redirects.some(redirect => redirect.from === pinned.url));
  assert.equal(await readFile(filename, "utf8"), original);
});

test("move planning detects conflicts and refuses a failed source proof", async () => {
  const reusedAddress = await makeBundle(doc => {
    if (doc.kind === "fragment" && !doc.pinned) doc.page = "blyg.json";
    return doc;
  });
  const conflicted = await planBlygMove(reusedAddress, destination);
  assert.equal(conflicted.status, "review-required");
  assert.match(conflicted.blockers.join(" "), /more than one proposed redirect/);
  assert.equal(conflicted.afterDestinationChecks.redirects[0].to, new URL("blyg.json", destination).href);
  await assert.rejects(planBlygMove(reusedAddress, origin), /different from the old/);

  const bundle = await makeBundle();
  const pin = bundle.resources.find(resource => resource.url.endsWith("/v1.json"));
  pin.text = pin.text.replace("closes at five", "closes at seven");
  pin.sha256 = hashResource(pin.text);
  await assert.rejects(planBlygMove(bundle, destination), /source bundle failed verification/);
});
