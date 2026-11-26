// Run explicitly with `node --test test/continuity-http.mjs` on a machine that allows loopback listeners.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { test } from "node:test";
import {
  allowLocalDevelopment, generateKey, importKeyFile, itemUrl, loadTree, pinUrl,
  serializeClaims, signByline, signClaims, treeMarkdown,
} from "../lib/blyggdrasil.js";
import { verifyPost } from "../lib/post-proof.js";
import { makeFetcher } from "../lib/resolvers.js";

const treeId = "01jpcyy4qaaaek03ptm4c5g1c3";
const postId = "01jpcyy4qaaaek03ptm4c5g1c2";

async function listen(t) {
  const routes = new Map();
  const server = createServer((request, response) => {
    const route = routes.get(request.url);
    if (route?.redirect) {
      response.writeHead(308, { location: route.redirect }).end();
    } else {
      response.writeHead(route ? 200 : 404, { "content-type": "application/json" });
      response.end(JSON.stringify(route || {}));
    }
  });
  t.after(() => new Promise((resolve, reject) => {
    if (!server.listening) return resolve();
    server.close((error) => error ? reject(error) : resolve());
  }));
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}/blyg/`;
  const put = (url, body) => routes.set(new URL(url, origin).pathname, body);
  const remove = (url) => routes.delete(new URL(url, origin).pathname);
  return { origin, put, remove };
}

async function tree(origin, version, key, claims, others = []) {
  const body = serializeClaims({ ...claims, trunk: origin, key: key.did });
  const content_md = treeMarkdown(body, await signClaims(body, [key, ...others]));
  return { id: treeId, kind: "thread", origin, version, content_md };
}

async function post(origin, version, key, content_md) {
  const content_hash = "sha256:" + createHash("sha256").update(content_md).digest("hex");
  const author = { sig: await signByline(key, content_hash) };
  return { id: postId, kind: "thread", origin, version, content_md, content_hash, author };
}

test("rehearses a real HTTP move and recovery using two loopback origins", async (t) => {
  allowLocalDevelopment();
  t.after(() => allowLocalDevelopment(false));
  const [oldSite, newSite] = await Promise.all([listen(t), listen(t)]);
  const [owner, replacement, recovery] = await Promise.all(["owner", "replacement", "recovery"]
    .map(async (label) => importKeyFile(await generateKey(label))));
  const get = makeFetcher();
  const manifest = { blyg: "0.4", blyggdrasil: `t/${treeId}/` };
  const oldTree = await tree(oldSite.origin, 1, owner, { recovery: [recovery.did] });
  const oldPost = await post(oldSite.origin, 1, owner, "The original post.\n");
  const oldManifestUrl = new URL("blyg.json", oldSite.origin).href;
  oldSite.put(oldManifestUrl, manifest);
  oldSite.put(itemUrl(oldSite.origin, manifest, treeId), oldTree);
  oldSite.put(itemUrl(oldSite.origin, manifest, postId), oldPost);
  assert.equal((await verifyPost(itemUrl(oldSite.origin, manifest, postId), get)).status, "verified");

  const movedFrom = [oldSite.origin];
  const newManifestUrl = new URL("blyg.json", newSite.origin).href;
  const movedTree = await tree(newSite.origin, 1, owner, { recovery: [recovery.did], movedFrom });
  const movedPost = { ...oldPost, origin: newSite.origin };
  const currentTree = itemUrl(newSite.origin, manifest, treeId);
  const currentPost = itemUrl(newSite.origin, manifest, postId);
  const treePin = pinUrl(newSite.origin, manifest, treeId, 1);
  const postPin = pinUrl(newSite.origin, manifest, postId, 1);
  newSite.put(newManifestUrl, { ...manifest, moved_from: movedFrom });
  newSite.put(currentTree, movedTree);
  newSite.put(currentPost, movedPost);
  newSite.put(treePin, { ...movedTree, pinned: true });
  newSite.put(postPin, { ...movedPost, pinned: true });
  oldSite.put(oldManifestUrl, { redirect: newManifestUrl });

  const redirect = await fetch(oldManifestUrl, { redirect: "manual" });
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.get("location"), newManifestUrl);
  const afterMove = await loadTree(oldSite.origin, get);
  assert.equal(afterMove.origin, newSite.origin);
  assert.equal(afterMove.tree.valid, true);
  assert.equal(afterMove.tree.claims.key, owner.did);
  assert.deepEqual(afterMove.tree.claims.movedFrom, movedFrom);
  assert.equal((await verifyPost(currentPost, get, { expectedKey: owner.did })).status, "verified");

  const recovered = await tree(newSite.origin, 2, replacement, {
    movedFrom, previous: owner.did, recoveredFrom: 1,
  }, [recovery]);
  newSite.put(currentTree, recovered);
  newSite.put(currentPost, await post(newSite.origin, 2, replacement, "The current post after recovery.\n"));
  newSite.put("items/index.json", { items: [{ id: postId, kind: "thread", version: 2 }] });
  const catalog = await get(new URL("items/index.json", newSite.origin).href);
  assert.equal(catalog.json.items[0].version, 2);
  const active = await verifyPost(currentPost, get, { expectedKey: replacement.did });
  assert.equal(active.status, "verified");
  assert.deepEqual(active.treeIdentity.keyHistory, [{ how: "recovered", key: owner.did, by: recovery.did, from: "v1" }]);
  const historical = await verifyPost(postPin, get, { expectedKey: owner.did });
  assert.equal(historical.status, "verified");
  assert.equal(historical.pinned, true);
  assert.equal(historical.version, 1);
  assert.deepEqual((await get(postPin)).json, { ...oldPost, origin: newSite.origin, pinned: true });

  newSite.remove(treePin);
  assert.equal((await get(treePin)).status, 404);
  const unavailable = await verifyPost(currentPost, get);
  assert.equal(unavailable.status, "unavailable");
  assert.deepEqual(unavailable.checks, { content: "valid", signature: "valid", signer: "unavailable" });
});
