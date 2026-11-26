import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { exportPublicBundle } from "../lib/public-bundle/export.js";
import { hashResource } from "../lib/public-bundle/surface.js";
import { verifyPublicBundle } from "../lib/public-bundle/verify.js";

const run = promisify(execFile);
const mirror = new URL("../demo/edit-and-pin/blyg/", import.meta.url);
const exportCli = fileURLToPath(new URL("../bin/export-public-bundle.mjs", import.meta.url));
const verifyCli = fileURLToPath(new URL("../bin/verify-public-bundle.mjs", import.meta.url));
const { site: origin } = JSON.parse(await readFile(new URL("blyg.json", mirror), "utf8"));
const unrelatedKey = JSON.parse(await readFile(new URL("./vectors.json", import.meta.url), "utf8")).keys.stranger.did;

function makeBundle() {
  return exportPublicBundle(origin, url => readFile(new URL(url.slice(origin.length), mirror), "utf8"));
}

test("verify CLI checks the same signed v1 and v2 offline and supports a trusted public key", async t => {
  const folder = await mkdtemp(join(tmpdir(), "blyg-bundle-check-"));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const output = join(folder, "bundle.json");
  await run(process.execPath, [exportCli, origin, "--mirror", fileURLToPath(mirror), "--out", output]);
  const result = JSON.parse((await run(process.execPath, [verifyCli, output])).stdout);
  assert.equal(result.status, "verified");
  assert.equal(result.tree.status, "verified");
  const original = result.posts.find(post => post.pinned);
  const edited = result.posts.find(post => post.id === original.id && !post.pinned);
  assert.equal(original.version, 1);
  assert.equal(edited.version, 2);
  assert.deepEqual(original.checks, { content: "valid", signature: "valid", signer: "valid" });
  assert.deepEqual(edited.checks, original.checks);
  const checkedKey = JSON.parse((await run(process.execPath, [
    verifyCli, output, "--expect-key", result.tree.claims.key,
  ])).stdout);
  assert.equal(checkedKey.expectedKeyMatches, true);
  await assert.rejects(run(process.execPath, [
    verifyCli, output, "--expect-key", unrelatedKey,
  ]), error => error.code === 1 && JSON.parse(error.stdout).expectedKeyMatches === false);
});

test("detects raw and rehashed item changes, missing pins and undeclared extra data", async () => {
  const bundle = await makeBundle();
  const original = bundle.resources.find(resource => resource.url.endsWith("/v1.json"));
  const pin = JSON.parse(original.text);
  pin.content_md += " changed";
  original.text = JSON.stringify(pin);
  await assert.rejects(verifyPublicBundle(bundle), /Stored digest does not match/);
  original.sha256 = hashResource(original.text);
  const rehashed = await verifyPublicBundle(bundle);
  assert.equal(rehashed.status, "failed");
  assert.equal(rehashed.posts.find(post => post.pinned).checks.content, "invalid");
  assert.equal(rehashed.posts.find(post => post.pinned).checks.signature, "valid");

  bundle.resources = bundle.resources.filter(resource => resource !== original);
  await assert.rejects(verifyPublicBundle(bundle), /Missing document/);

  const withExtra = await makeBundle();
  withExtra.resources.push({
    url: new URL("items/undeclared.json", origin).href, text: "{}", sha256: hashResource("{}"),
  });
  await assert.rejects(verifyPublicBundle(withExtra), /outside the public manifest/);
});
