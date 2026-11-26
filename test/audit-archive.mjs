import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { auditArchive, makeAuditFetcher } from "../lib/archive-audit.js";

const origin = "https://fishbiscuit.me/blyggdrasil/demo/edit-and-pin/blyg/";
const signedId = "1hk3fv43xwpgckk19k4wf3v9ts";
const treeId = "7p4qap9qgjkaa0yxv1dcae6rx3";
const unsignedId = "01jpcyy4qaaaek03ptm4c5g1c2";
const missingId = "01jpcyy4qaaaek03ptm4c5g1c3";
const hiddenId = "01jpcyy4qaaaek03ptm4c5g1c4";
const fixtureDirectory = new URL("../demo/edit-and-pin/blyg/", import.meta.url);
const archivePath = "items/index.json";
const itemPath = (id) => `items/${id}.json`;
const paths = ["blyg.json", archivePath, itemPath(signedId), itemPath(treeId), `items/${signedId}/v1.json`];

async function fixture() {
  return Object.fromEntries(await Promise.all(paths.map(async (path) => [
    origin + path, JSON.parse(await readFile(new URL(path, fixtureDirectory), "utf8")),
  ])));
}

test("reports ordered archive editions, retains the exact pin, and skips non-post entries", async () => {
  const files = await fixture();
  const entry = (id, kind = "fragment", version = 1, extra) => ({ id, kind, version, ...extra });
  files[origin + archivePath].items = [
    entry(signedId), entry(signedId, "fragment", 2), entry(treeId, "thread"),
    entry(hiddenId, "fragment", 1, { visibility: "private" }), entry(hiddenId, "withdrawn"),
    entry(missingId, "unknown"), entry(unsignedId), entry(missingId),
  ];
  const { content_md, content_hash } = files[origin + itemPath(signedId)];
  files[origin + itemPath(unsignedId)] = { id: unsignedId, origin, kind: "fragment", version: 1, content_md, content_hash };
  const calls = new Map();
  const emitted = [];
  const report = await auditArchive(origin, async (url) => {
    calls.set(url, (calls.get(url) ?? 0) + 1);
    return { ok: !!files[url], status: files[url] ? 200 : 404, url, json: files[url] };
  }, { limit: 2, onItem: (row) => emitted.push(row) });
  assert.equal(report.truncated, true);
  assert.deepEqual(report.results, emitted);
  assert.deepEqual(emitted.map(({ id, proof }) => [id, proof.status]), [[signedId, "verified"], [unsignedId, "unsigned"]]);
  assert.equal(emitted[0].proof.pinned, true);
  assert.equal(emitted[0].proof.version, 1);
  assert.equal(emitted[1].proof.contentMarkdown, undefined);
  assert.equal(calls.get(origin + "blyg.json"), 1);
  assert.equal(calls.get(origin + itemPath(treeId)), 1);
  assert(!calls.has(origin + itemPath(hiddenId)));
  assert(!calls.has(origin + itemPath(missingId)));
  assert(!JSON.stringify(report).includes(content_md));
});

test("rejects invalid limits and oversized responses before parsing or emitting", async () => {
  await assert.rejects(auditArchive(origin, () => assert.fail("unexpected fetch"), { limit: 51 }), /post limit/);
  const get = makeAuditFetcher(async () => new Response(new Uint8Array(8 * 1024 * 1024 + 1)));
  assert.equal((await get(origin + archivePath)).ok, false);
});

test("the CLI prints machine-readable lines for public posts", async () => {
  const files = await fixture();
  const bootstrap = `const files = ${JSON.stringify(files)}; globalThis.fetch = async url => {
    const doc = files[String(url)];
    return new Response(doc ? JSON.stringify(doc) : "Not found", {status: doc ? 200 : 404});
  };`;
  const cli = fileURLToPath(new URL("../bin/audit-blyg.mjs", import.meta.url));
  const run = spawnSync(process.execPath, ["--import", "data:text/javascript," + encodeURIComponent(bootstrap), cli, origin, "--limit", "1"], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const lines = run.stdout.trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].id, signedId);
  assert.equal(lines[0].version, 2);
  assert.equal(lines[0].proof.status, "verified");
  const bad = spawnSync(process.execPath, [cli, origin, "--limit", "0"], { encoding: "utf8" });
  assert.equal(bad.status, 1);
  assert.equal(bad.stdout, "");
  assert.match(bad.stderr, /post limit/);
});
