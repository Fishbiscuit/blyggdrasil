import assert from "node:assert/strict";
import { test } from "node:test";
import { generateKey, importKeyFile, serializeClaims, signClaims, treeMarkdown } from "../lib/blyggdrasil.js";
import { checkPublishedTree } from "../lib/published-tree.js";

test("published setup verifies the same tree, discoverability and account evidence", async () => {
  const origin = "https://publisher.example/blyg/";
  const id = "1" + "0".repeat(25);
  const page = `${origin}t/${id}/`;
  const docUrl = `${origin}items/${id}.json`;
  const key = await importKeyFile(await generateKey("test-only"));
  const branch = "https://publisher.example/about/";
  const unavailable = "https://unavailable.example/";
  const claims = serializeClaims({ trunk: origin, key: key.did, branches: [branch, unavailable] });
  const doc = { id, origin, content_md: treeMarkdown(claims, await signClaims(claims, [key])) };
  const manifest = { blyg: "0.4", author: { links: [] } };
  const get = async (url, options) => {
    if (url === origin + "blyg.json") return { ok: true, json: manifest, url };
    if (url === docUrl) return { ok: true, json: doc, url };
    if (url === branch && options?.as === "text") return { ok: true, text: `<a rel="me" href="${origin}">My blyg</a>` };
    if (url === unavailable) return { ok: false, status: 503 };
    return { ok: false, status: 404 };
  };

  const draft = { origin, key: key.did, body: claims };
  assert.match((await checkPublishedTree(draft, page, get)).error, /Add a profile link/);
  manifest.author.links.push({ label: "Blyggdrasil", url: `t/${id}/` });
  const result = await checkPublishedTree(draft, page, get);
  assert.equal(result.origin, origin);
  assert.deepEqual(result.branches.map(({ verdict }) => verdict), ["verified", "unreachable"]);
  assert.match((await checkPublishedTree({ ...draft, key: "another-key" }, page, get)).error, /different signing key/);
  assert.match((await checkPublishedTree({ ...draft, body: claims.replace(branch, "https://other.example/") }, page, get)).error, /signed tree details differ/);
  assert.match((await checkPublishedTree(draft, `https://elsewhere.example/t/${id}/`, get)).error, /on the blyg you used/);
});
