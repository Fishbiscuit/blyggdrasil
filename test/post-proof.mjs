import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { importKeyFile, serializeClaims, signByline, signClaims, treeMarkdown } from "../lib/blyggdrasil.js";
import { verifyPost } from "../lib/post-proof.js";

const vector = JSON.parse(readFileSync(new URL("./vectors.json", import.meta.url), "utf8"));
const main = await importKeyFile(vector.keys.main);
const another = await importKeyFile(vector.keys.recovery);
const id = "01JPCYY4QAAAEK03PTM4C5G1C2".toLowerCase();
const treeId = "01JPCYY4QAAAEK03PTM4C5G1C3".toLowerCase();
const origin = "https://blyg.example/blyg/";
const cli = fileURLToPath(new URL("../bin/blyggdrasil.mjs", import.meta.url));
const run = promisify(execFile);
const hash = (value) => "sha256:" + createHash("sha256").update(value).digest("hex");

async function makeFixture(at = origin) {
  const current = new URL(`items/${id}.json`, at).href;
  const pin = new URL(`items/${id}/v1.json`, at).href;
  const page = new URL(`t/${id}/`, at).href;
  const treeUrl = new URL(`items/${treeId}.json`, at).href;
  const manifestUrl = new URL("blyg.json", at).href;
  const manifest = { blyg: "0.4", blyggdrasil: new URL(`t/${treeId}/`, at).href };
  const claims = serializeClaims({ trunk: at, key: main.did });
  const tree = {
    id: treeId, kind: "thread", origin: at, version: 1,
    content_md: treeMarkdown(claims, await signClaims(claims, [main])),
  };
  const markdown = "first line \n\nCafé ⟡\n";
  const contentHash = hash(markdown);
  const post = {
    id, kind: "thread", origin: at, version: 2, page,
    content_md: markdown, content_hash: contentHash,
    author: { sig: await signByline(main, contentHash) },
    syndication: [{ version: 1, url: "https://source.example/1" }, { version: 2, url: "https://source.example/2" }],
  };
  const pinDoc = { ...post, version: 1, pinned: true };
  const documents = new Map([[manifestUrl, manifest], [treeUrl, tree], [current, post], [pin, pinDoc]]);
  const get = async (url, { as = "json" } = {}) => {
    if (!documents.has(url)) return { ok: false, status: 404, url };
    const body = documents.get(url);
    if (typeof body === "string") return { ok: as === "text", status: 200, url, text: body };
    return { ok: true, status: 200, url, json: body };
  };
  return { current, pin, page, treeUrl, manifestUrl, manifest, tree, post, pinDoc, documents, get };
}

test("verified bytes, signature, and canonical signer are distinct checks", async () => {
  const f = await makeFixture();
  const good = await verifyPost(f.page, f.get, { version: 2, expectedKey: main.did });
  assert.deepEqual(good.checks, { content: "valid", signature: "valid", signer: "valid" });
  assert.equal(good.status, "verified");
  assert.equal(good.expectedSigner, "valid");
  assert.equal(good.sourceUrl, "https://source.example/2");
  assert.equal(good.manifestUrl, f.manifestUrl);
  assert.equal(good.treeUrl, f.treeUrl);
  assert.equal(good.pinned, false);
  assert.equal(good.contentMarkdown, undefined);
  assert.equal((await verifyPost(f.current, f.get, { includeText: true })).contentMarkdown, f.post.content_md);

  f.post.content_md = f.post.content_md.trimEnd();
  const staleHash = await verifyPost(f.current, f.get, { includeText: true });
  assert.equal(staleHash.status, "failed");
  assert.deepEqual(staleHash.checks, { content: "invalid", signature: "valid", signer: "valid" });
  assert.equal(staleHash.contentMarkdown, undefined);

  f.post.content_hash = hash(f.post.content_md);
  const edited = await verifyPost(f.current, f.get);
  assert.deepEqual(edited.checks, { content: "valid", signature: "invalid", signer: "valid" });

  f.post.author.sig = await signByline(another, f.post.content_hash);
  const wrongSigner = await verifyPost(f.current, f.get);
  assert.equal(wrongSigner.status, "failed");
  assert.deepEqual(wrongSigner.checks, { content: "valid", signature: "valid", signer: "invalid" });

  f.post.author.sig = await signByline(main, f.post.content_hash);
  const mismatch = await verifyPost(f.current, f.get, { expectedKey: another.did });
  assert.equal(mismatch.status, "failed");
  assert.equal(mismatch.checks.signer, "valid");
  assert.equal(mismatch.expectedSigner, "invalid");
});

test("the selected version must exist and carry its pinned marker", async () => {
  const f = await makeFixture();
  const historical = await verifyPost(f.pin, f.get);
  assert.equal(historical.status, "verified");
  assert.equal(historical.version, 1);
  assert.equal(historical.sourceUrl, "https://source.example/1");
  assert.equal(historical.pinned, true);

  assert.equal((await verifyPost(f.pin, f.get, { version: 2 })).status, "unavailable");
  assert.equal((await verifyPost(f.current, f.get, { version: 3 })).status, "unavailable");

  f.post.kind = "withdrawn";
  assert.equal((await verifyPost(f.current, f.get)).status, "unavailable");
  assert.equal((await verifyPost(f.current, f.get, { version: 1 })).status, "verified");

  delete f.pinDoc.pinned;
  assert.equal((await verifyPost(f.pin, f.get)).status, "failed");
});

test("handles HTML discovery, unavailable authority, unsigned content, and invalid origin", async () => {
  const f = await makeFixture();
  const article = "https://blyg.example/notes/article";
  f.documents.set(article, `<link href='${f.current}' type="application/json" rel="alternate">`);
  assert.equal((await verifyPost(article, f.get)).status, "verified");

  f.documents.delete(f.treeUrl);
  const missing = await verifyPost(f.current, f.get);
  assert.equal(missing.status, "unavailable");
  assert.deepEqual(missing.checks, { content: "valid", signature: "valid", signer: "unavailable" });

  f.post.author = {};
  const unsigned = await verifyPost(f.current, f.get);
  assert.equal(unsigned.status, "unsigned");
  assert.deepEqual(unsigned.checks, { content: "valid", signature: "unsigned", signer: "unsigned" });

  f.post.origin = "https://another.example/blyg/";
  assert.equal((await verifyPost(f.current, f.get)).status, "failed");
  assert.equal((await verifyPost("http://blyg.example/blyg/", f.get)).status, "unavailable");
});

test("verify-post CLI returns verified, failed, unavailable, and usage exit codes", async () => {
  const fixture = await makeFixture();
  const preload = `data:text/javascript,${encodeURIComponent(`
    const documents = new Map(JSON.parse(process.env.BLYGGDRASIL_TEST_RESPONSES));
    globalThis.fetch = async (url) => new Response(JSON.stringify(documents.get(url) ?? {}), {
      status: documents.has(url) ? 200 : 404,
      headers: { "content-type": "application/json" },
    });
  `)}`;
  const verify = (...args) => run(process.execPath, ["--import", preload, cli, "verify-post", fixture.current, "--json", ...args], {
    env: { ...process.env, BLYGGDRASIL_TEST_RESPONSES: JSON.stringify([...fixture.documents]) },
  });
  const good = await verify("--version", "1", "--expect-key", main.did);
  assert.equal(JSON.parse(good.stdout).status, "verified");

  fixture.post.content_md += "edited";
  await assert.rejects(verify(), (error) => error.code === 1 && JSON.parse(error.stdout).status === "failed");
  await assert.rejects(verify("--version", "4"), (error) => error.code === 1 && JSON.parse(error.stdout).status === "unavailable");
  await assert.rejects(verify("--version", "0"), (error) => error.code === 2 && /positive whole number/.test(error.stderr));
});
