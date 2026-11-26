import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { itemUrl, pinUrl } from "../lib/blyggdrasil.js";
import { proofLink, resolveEdition } from "../lib/proof-link.js";
import { verifyPost } from "../lib/post-proof.js";

const artifacts = new URL("../demo/edit-and-pin/blyg/", import.meta.url);
const read = async (path) => JSON.parse(await readFile(new URL(path, artifacts), "utf8"));
const manifest = await read("blyg.json");
const archive = await read("items/index.json");
const post = archive.items.find(({ kind }) => kind === "fragment");
const tree = archive.items.find(({ kind }) => kind === "thread");
const currentDoc = await read(`items/${post.id}.json`);
const originalDoc = await read(`items/${post.id}/v1.json`);
const treeDoc = await read(`items/${tree.id}.json`);
const { origin, id } = currentDoc;
const ref = { origin, id, version: 1 };

function data() {
  const customized = {
    ...manifest, item: "https://items.example/store/{id}.json",
    pin: "/snapshots/{id}/edition-{n}.json",
  };
  const current = itemUrl(origin, customized, id);
  const pinned = pinUrl(origin, customized, id, 1);
  const manifestUrl = new URL("blyg.json", origin).href;
  const files = new Map([
    [manifestUrl, customized],
    [itemUrl(origin, customized, tree.id), treeDoc],
    [current, currentDoc],
    [pinned, originalDoc],
  ]);
  const calls = [];
  const get = async (url) => {
    calls.push(url);
    return files.has(url)
      ? { ok: true, status: 200, url, json: files.get(url) }
      : { ok: false, status: 404, url };
  };
  return { current, pinned, manifestUrl, files, calls, get };
}

test("encodes the origin, item ID and canonical version in an exact proof URL", () => {
  const link = proofLink({ ...ref, version: "1" });
  assert.equal(link.pathname, "/blyggdrasil/verify/");
  assert.deepEqual(Object.fromEntries(link.searchParams), { origin, id, version: "1" });
  assert.throws(() => proofLink({ ...ref, origin: origin.slice(0, -1) }), /ending in a slash/);
  assert.throws(() => proofLink({ ...ref, origin: "javascript:1" }), /HTTPS/);
  assert.throws(() => proofLink({ ...ref, id: "../index" }), /item ID/);
  assert.throws(() => proofLink({ ...ref, version: "1e2" }), /whole version number/);
});

test("resolves only the requested current item or a matching pinned copy", async () => {
  const f = data();
  assert.equal(await resolveEdition({ ...ref, version: 2 }, f.get), f.current);
  assert.equal(await resolveEdition(ref, f.get), f.pinned);
  f.files.set(f.pinned, { ...originalDoc, pinned: false });
  await assert.rejects(resolveEdition(ref, f.get), /edition is unavailable/);
});

test("verifies exact editions through custom templates without rediscovering the origin", async () => {
  const f = data();
  const pinned = await verifyPost(undefined, f.get, { edition: { origin, id }, version: "1", includeText: true });
  assert.equal(pinned.status, "verified");
  assert.equal(pinned.version, 1);
  assert.equal(pinned.pinned, true);
  assert.equal(pinned.itemUrl, f.pinned);
  assert.equal(pinned.contentMarkdown, originalDoc.content_md);
  assert.equal(pinned.itemId, id);

  const current = await verifyPost(undefined, f.get, { edition: { origin, id }, version: 2 });
  assert.equal(current.status, "verified");
  assert.equal(current.version, 2);
  assert.equal(current.pinned, false);
  assert.equal(current.itemUrl, f.current);
  assert.equal(f.calls.filter((url) => url.endsWith("/blyg.json")).length, 2);
  assert.ok(f.calls.filter((url) => url.endsWith("/blyg.json")).every((url) => url === f.manifestUrl));

  f.files.delete(f.pinned);
  const unavailable = await verifyPost(undefined, f.get, { edition: { origin, id }, version: 1 });
  assert.equal(unavailable.status, "unavailable");
  assert.equal(unavailable.version, null);
});

test("an exact edition cannot change its blyg through manifest discovery", async () => {
  const f = data();
  const shifted = async (url) => ({ ...await f.get(url), url: new URL("/other/blyg.json", url).href });
  await assert.rejects(resolveEdition(ref, shifted), /named origin/);
  const report = await verifyPost(undefined, shifted, { edition: { origin, id }, version: 1 });
  assert.equal(report.status, "unavailable");
  assert.deepEqual(f.calls, [f.manifestUrl, f.manifestUrl]);
});
