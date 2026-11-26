import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { verifyByline } from "../lib/blyggdrasil.js";
import { archiveSetup, oldDate, origin } from "./republish-archive-fixture.mjs";

const emitCli = fileURLToPath(new URL("../bin/emit-archive.mjs", import.meta.url));
const blygCli = fileURLToPath(new URL("../bin/blyggdrasil.mjs", import.meta.url));
const publishedAt = "2026-11-25T00:00:00Z";
const run = (args) => spawnSync(process.execPath, args, { encoding: "utf8" });
const runConcurrent = promisify(execFile);

function signedSetup(t) {
  const f = archiveSetup(t);
  const key = join(f.workspace, "main.key.json");
  const result = run([blygCli, "keygen", "--out", key]);
  assert.equal(result.status, 0, result.stderr);
  const signer = result.stdout.split("\n")[0];
  const out = join(f.workspace, "output");
  const args = [emitCli, ...f.args.slice(1), "--out", out, "--key", key, "--published-at", publishedAt];
  return { ...f, out, signer, emitArgs: args };
}

test("emission signs exactly the previewed text and preserves original attribution and timestamps", async (t) => {
  const f = signedSetup(t);
  f.put("item", { text: "An imported <tag> & a gap", kind: "reply", reply_to: "https://x.com/someone/status/321" });
  f.put("private", { visibility: "private", text: "PRIVATE_BODY" }, "private");
  const preview = run(f.args);
  assert.equal(preview.status, 0, preview.stderr);
  const [proposal] = JSON.parse(preview.stdout).items;

  const first = run(f.emitArgs);
  assert.equal(first.status, 0, first.stderr);
  assert.deepEqual(JSON.parse(first.stdout), { origin, written: 1, existing: 0 });
  const path = join(f.out, "items", proposal.id + ".json");
  const bytes = readFileSync(path);
  const item = JSON.parse(bytes);
  assert.equal(item.blyg, "0.4");
  assert.equal(item.version, 1);
  assert.equal(item.kind, "thread");
  assert.equal(item.created, oldDate);
  assert.equal(item.updated, publishedAt);
  assert.equal(item.content_md, proposal.content_md);
  assert.equal(item.content_hash, "sha256:" + createHash("sha256").update(proposal.content_md).digest("hex"));
  assert.deepEqual(item.stub_of, { url: "https://x.com/i/web/status/321" });
  assert.deepEqual(item.syndication, proposal.syndication);
  assert.deepEqual(item.changelog, [{ version: 1, at: publishedAt, note: null }]);
  assert.deepEqual(item.transclusions, []);
  assert.deepEqual(item.media, []);
  assert.match(item.content_html, /&lt;tag&gt; &amp; a gap/);
  assert.doesNotMatch(bytes.toString(), /PRIVATE_BODY|privateKey|jwk/);
  assert.deepEqual(await verifyByline(item, [f.signer]), { signed: true, key: f.signer, byTree: true });

  const later = run(f.emitArgs.map((arg) => arg === publishedAt ? "2026-11-26T00:00:00Z" : arg));
  assert.equal(later.status, 0, later.stderr);
  assert.deepEqual(JSON.parse(later.stdout), { origin, written: 0, existing: 1 });
  assert.deepEqual(readFileSync(path), bytes);
});

test("conflicting output blocks the batch before any item is written", (t) => {
  const f = signedSetup(t);
  f.put("first", { url: "https://x.com/river/status/10" });
  f.put("second", { url: "https://x.com/river/status/20" });
  const [, next] = JSON.parse(run(f.args).stdout).items;
  const itemsDir = join(f.out, "items");
  mkdirSync(itemsDir, { recursive: true });
  writeFileSync(join(itemsDir, next.id + ".json"), "{}\n");

  const result = run(f.emitArgs);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /already exists with different data/);
  assert.deepEqual(readdirSync(itemsDir), [next.id + ".json"]);
  assert.equal(readFileSync(join(itemsDir, next.id + ".json"), "utf8"), "{}\n");
});

test("concurrent identical emissions never overwrite, duplicate or leave partial files", async (t) => {
  const f = signedSetup(t);
  f.put("one");
  const copies = await Promise.all([1, 2].map(() => runConcurrent(process.execPath, f.emitArgs)));
  const reports = copies.map(({ stdout }) => JSON.parse(stdout));
  assert.equal(reports.reduce((total, report) => total + report.written, 0), 1);
  assert.equal(reports.reduce((total, report) => total + report.existing, 0), 1);
  assert.deepEqual(readdirSync(f.out), ["items"]);
  assert.equal(readdirSync(join(f.out, "items")).length, 1);
});
