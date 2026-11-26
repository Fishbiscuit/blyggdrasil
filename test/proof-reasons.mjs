import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { importKeyFile, signByline } from "../lib/blyggdrasil.js";
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
const currentUrl = new URL(`items/${id}.json`, origin).href;
const pinUrl = new URL(`items/${id}/v1.json`, origin).href;
const treeUrl = new URL(`items/${tree.id}.json`, origin).href;
const manifestUrl = new URL("blyg.json", origin).href;
const vectors = JSON.parse(await readFile(new URL("./vectors.json", import.meta.url), "utf8"));
const unrelated = await importKeyFile(vectors.keys.main);

function fixture() {
  const files = new Map([
    [manifestUrl, manifest], [currentUrl, { ...currentDoc }], [pinUrl, originalDoc], [treeUrl, treeDoc],
  ]);
  const statuses = new Map();
  const get = async (url) => {
    const status = statuses.get(url) ?? (files.has(url) ? 200 : 404);
    return { ok: status === 200, status, url, json: files.get(url) };
  };
  return { files, statuses, get };
}

test("a missing pin is distinct from the publisher or history service failing", async () => {
  const f = fixture();
  f.files.delete(pinUrl);
  const missing = await verifyPost(currentUrl, f.get, { version: 1 });
  assert.equal(missing.status, "unavailable");
  assert.equal(missing.reason, "pin-not-found");

  f.statuses.set(pinUrl, 503);
  const retryable = await verifyPost(pinUrl, f.get);
  assert.equal(retryable.status, "unavailable");
  assert.equal(retryable.reason, "publisher-unavailable");

  f.statuses.delete(pinUrl);
  f.statuses.set(currentUrl, 503);
  const uncertain = await verifyPost(currentUrl, f.get, { version: 2 });
  assert.equal(uncertain.reason, "publisher-unavailable");

  f.statuses.set(currentUrl, 404);
  assert.equal((await verifyPost(currentUrl, f.get)).reason, "post-not-found");
});

test("invalid input, malformed items, withdrawal, and success retain their previous statuses", async () => {
  const f = fixture();
  const verified = await verifyPost(currentUrl, f.get);
  assert.equal(verified.status, "verified");
  assert.equal(Object.hasOwn(verified, "reason"), false);
  assert.equal((await verifyPost(currentUrl, f.get, { version: -1 })).reason, "invalid-input");

  f.files.set(currentUrl, { ...currentDoc, kind: "withdrawn" });
  const withdrawn = await verifyPost(currentUrl, f.get);
  assert.equal(withdrawn.status, "unavailable");
  assert.equal(withdrawn.reason, "withdrawn");
  assert.equal((await verifyPost(pinUrl, f.get)).status, "verified");

  f.files.set(currentUrl, { ...currentDoc, id: tree.id });
  const invalid = await verifyPost(currentUrl, f.get);
  assert.equal(invalid.status, "failed");
  assert.equal(invalid.reason, "malformed-post");
});

test("proof failures explain which cryptographic or authority check failed", async () => {
  const f = fixture();
  f.files.set(currentUrl, { ...currentDoc, author: {} });
  const unsigned = await verifyPost(currentUrl, f.get);
  assert.equal(unsigned.status, "unsigned");
  assert.equal(unsigned.reason, "unsigned");

  f.files.set(currentUrl, { ...currentDoc, content_md: "Different text" });
  assert.equal((await verifyPost(currentUrl, f.get)).reason, "content-mismatch");

  const { sig } = currentDoc.author;
  f.files.set(currentUrl, { ...currentDoc, author: { sig: { ...sig, value: "A".repeat(86) } } });
  assert.equal((await verifyPost(currentUrl, f.get)).reason, "signature-invalid");

  f.files.set(currentUrl, {
    ...currentDoc, author: { sig: await signByline(unrelated, currentDoc.content_hash) },
  });
  const unauthorized = await verifyPost(currentUrl, f.get);
  assert.equal(unauthorized.checks.signature, "valid");
  assert.equal(unauthorized.checks.signer, "invalid");
  assert.equal(unauthorized.reason, "signer-unauthorized");

  f.files.set(currentUrl, currentDoc);
  const wrongKey = await verifyPost(currentUrl, f.get, { expectedKey: unrelated.did });
  assert.equal(wrongKey.checks.signer, "valid");
  assert.equal(wrongKey.reason, "trusted-key-mismatch");

  f.statuses.set(treeUrl, 503);
  const missingTree = await verifyPost(currentUrl, f.get);
  assert.equal(missingTree.status, "unavailable");
  assert.equal(missingTree.reason, "signing-tree-unavailable");
});
