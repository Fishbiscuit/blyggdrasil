import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { exportPublicBundle } from "../lib/public-bundle/export.js";
import { hashResource } from "../lib/public-bundle/surface.js";

const run = promisify(execFile);
const mirror = new URL("../demo/edit-and-pin/blyg/", import.meta.url);
const cli = fileURLToPath(new URL("../bin/export-public-bundle.mjs", import.meta.url));
const manifest = JSON.parse(await readFile(new URL("blyg.json", mirror), "utf8"));
const origin = manifest.site;
const index = JSON.parse(await readFile(new URL("items/index.json", mirror), "utf8"));
const item = index.items.find(entry => entry.kind === "fragment");
const tree = index.items.find(entry => entry.kind === "thread");
const current = new URL(`items/${item.id}.json`, origin).href;
const pin = new URL(`items/${item.id}/v1.json`, origin).href;
const archive = new URL("items/index.json", origin).href;
const manifestUrl = new URL("blyg.json", origin).href;

function readMirror(url) {
  return readFile(new URL(url.slice(origin.length), mirror), "utf8");
}

test("export CLI snapshots the public surface, including a pin, without replacing an existing file", async t => {
  const folder = await mkdtemp(join(tmpdir(), "blyg-public-export-"));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const output = join(folder, "bundle.json");
  const args = [cli, origin, "--mirror", fileURLToPath(mirror), "--out", output];
  await run(process.execPath, args);
  const bundle = JSON.parse(await readFile(output, "utf8"));
  assert.equal(bundle.origin, origin);
  assert.deepEqual(new Set(bundle.resources.map(({ url }) => url)), new Set([
    manifestUrl, archive, current, pin, new URL(`items/${tree.id}.json`, origin).href,
  ]));
  for (const resource of bundle.resources) {
    assert.equal(resource.text, await readMirror(resource.url));
    assert.equal(resource.sha256, hashResource(resource.text));
  }
  await writeFile(output, "keep this");
  await assert.rejects(run(process.execPath, args), /file already exists/i);
  assert.equal(await readFile(output, "utf8"), "keep this");
});

test("export keeps earlier listed pins after withdrawal and never requests other historical versions", async () => {
  const observed = [];
  const bundle = await exportPublicBundle(origin, async url => {
    observed.push(url);
    const doc = JSON.parse(await readMirror(url));
    if (url === archive) {
      const entry = doc.items.find(entry => entry.id === item.id);
      entry.version = 3;
      entry.kind = "withdrawn";
    }
    if (url === current) {
      Object.assign(doc, { kind: "withdrawn", version: 3, content_md: "", content_html: "", media: [] });
      doc.changelog.push({ version: 3 });
    }
    return JSON.stringify(doc);
  });
  assert.ok(observed.includes(pin));
  assert.ok(!observed.some(url => /\/v[23]\.json$/.test(url)));
  assert.equal(JSON.parse(bundle.resources.find(resource => resource.url === current).text).content_md, "");
});

test("export rejects stale index data, explicit private data and foreign endpoints", async () => {
  for (const [override, notice] of [
    [{ version: item.version + 1 }, /does not match the archive index/],
    [{ visibility: "private", content_md: "private evidence marker" }, /non-public data/],
  ]) {
    await assert.rejects(exportPublicBundle(origin, async url => {
      const doc = JSON.parse(await readMirror(url));
      return JSON.stringify(url === current ? { ...doc, ...override } : doc);
    }), error => notice.test(error.message) && !error.message.includes("private evidence marker"));
  }
  const observed = [];
  await assert.rejects(exportPublicBundle(origin, async url => {
    observed.push(url);
    return JSON.stringify({ ...manifest, items: "https://different.example/archive.json" });
  }), /on the blyg's host/);
  assert.deepEqual(observed, [manifestUrl]);
});
