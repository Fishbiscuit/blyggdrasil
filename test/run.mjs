// Conformance run: reproduces every vector in test/vectors.json. `node --test test/`
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as B from "../lib/blyggdrasil.js";
import { checkBranch } from "../lib/resolvers.js";
import { archiveFile, ingestXArchive } from "../lib/ingest.js";

const V = JSON.parse(readFileSync(new URL("./vectors.json", import.meta.url), "utf8"));
const hex = (h) => Uint8Array.from(h.match(/../g) || [], (x) => parseInt(x, 16));

test("RFC 8032 test 1: did:key and signature", async () => {
  const t = V.rfc8032_test1;
  assert.equal(B.didFromPublicKey(hex(t.public_hex)), t.did);
  const key = await B.importKeyFile({ blyggdrasil_key: 1, jwk: { kty: "OKP", crv: "Ed25519", x: B.b64url(hex(t.public_hex)), d: B.b64url(hex(t.seed_hex)) } });
  assert.equal(await B.signBytes(key, hex(t.message_hex)), t.signature_b64url);
  assert.equal(await B.verifyBytes(t.did, hex(t.message_hex), t.signature_b64url), true);
});

test("test key files round-trip to their dids", async () => {
  for (const f of Object.values(V.keys)) assert.equal((await B.importKeyFile(f)).did, f.did);
});

test("claims grammar", () => {
  const ok = B.parseClaims(V.trees.valid.body);
  assert.equal(ok.ok, true);
  assert.equal(ok.claims.branches.length, 10);
  const bad = [
    ["blyggdrasil 2\ntrunk https://a.example/\nkey " + V.keys.main.did, "first line"],
    ["blyggdrasil 1\nkey " + V.keys.main.did, "exactly one trunk"],
    ["blyggdrasil 1\ntrunk https://a.example\nkey " + V.keys.main.did, "ending in /"],
    ["blyggdrasil 1\ntrunk http://a.example/\nkey " + V.keys.main.did, "https"],
    ["blyggdrasil 1\ntrunk https://a.example/\nkey did:key:zNope", "did:key"],
    ["blyggdrasil 1\ntrunk https://a.example/\nkey " + V.keys.main.did + "\n\nbranch https://b.example/", "line 4"],
    ["blyggdrasil 1\ntrunk https://a.example/\nkey " + V.keys.main.did + "\nrecovered-from v1", "needs previous"],
  ];
  for (const [body, msg] of bad) {
    const r = B.parseClaims(body);
    assert.equal(r.ok, false, body);
    assert.match(r.error, new RegExp(msg));
  }
  const unknown = B.parseClaims(`blyggdrasil 1\ntrunk https://a.example/\nkey ${V.keys.main.did}\nfuture-field anything`);
  assert.equal(unknown.ok, true);
  assert.deepEqual(unknown.claims.unknown, ["future-field"]);
});

test("serializeClaims reproduces the signed body exactly", () => {
  const c = B.parseClaims(V.trees.valid.body).claims;
  assert.equal(B.serializeClaims(c), V.trees.valid.body);
});

test("tree signatures are reproducible", async () => {
  const main = await B.importKeyFile(V.keys.main);
  const sigs = await B.signClaims(V.trees.valid.body, [main]);
  assert.ok(V.trees.valid.content_md.includes(`sig ${sigs[0].sig}`));
});

test("tree validity, including rotation and recovery", async () => {
  for (const [name, exp] of Object.entries(V.expected_trees)) {
    const t = V.trees[name];
    const fetchPinned = async (n) => (exp.pinned?.[n] ? V.trees[exp.pinned[n]].content_md : null);
    const r = await B.validateTree(t.content_md, t.origin, { fetchPinned });
    assert.equal(r.valid, exp.valid, `${name}: ${r.reason || ""}`);
    if (exp.keys) assert.deepEqual(r.keys, exp.keys, name);
  }
});

test("CRLF in content_md is read as LF", async () => {
  const t = V.trees.valid;
  assert.equal((await B.validateTree(t.content_md.replace(/\n/g, "\r\n"), t.origin)).valid, true);
});

test("branch verdicts from recorded responses", async () => {
  const get = async (url, { as = "json" } = {}) => {
    const r = V.network[url];
    if (!r) return { ok: false, status: 0, error: "network or cross-origin block" };
    if (as === "json" && r.json === undefined) return { ok: false, status: r.status, error: "unexpected response" };
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: r.json, text: r.text ?? JSON.stringify(r.json), url };
  };
  const keys = [V.keys.main.did];
  for (const [url, exp] of Object.entries(V.expected_branches)) {
    const r = await checkBranch(url, { keys, trunk: V.trunk, get });
    assert.equal(r.verdict, exp.verdict, `${url}: ${r.detail}`);
    if (exp.method) assert.equal(r.method, exp.method, url);
  }
});

test("a proof for another key is not a back-reference", () => {
  assert.equal(B.backReference({ texts: [V.stranger_proof_line] }, { keys: [V.keys.main.did], trunk: V.trunk }), null);
  assert.equal(B.backReference({ texts: [V.proof_line] }, { keys: [V.keys.main.did], trunk: V.trunk }).method, "key");
});

test("link matching ignores scheme, www and trailing slash, and nothing else", () => {
  assert.equal(B.linksTo("http://www.blyg.example/blyg", V.trunk), true);
  assert.equal(B.linksTo("https://blyg.example/blyg/t/abc/", V.trunk), true);
  assert.equal(B.linksTo("https://blyg.example/blygger/", V.trunk), false);
  assert.equal(B.linksTo("https://evil.example/blyg.example/blyg/", V.trunk), false);
});

test("signed bylines", async () => {
  const doc = { content_hash: V.byline.content_hash, author: { sig: V.byline.sig } };
  assert.deepEqual(await B.verifyByline(doc, [V.keys.main.did]), { signed: true, key: V.keys.main.did, byTree: true });
  assert.equal((await B.verifyByline({ ...doc, content_hash: doc.content_hash.replace("9f", "00") }, [V.keys.main.did])).signed, false);
  const main = await B.importKeyFile(V.keys.main);
  assert.deepEqual(await B.signByline(main, V.byline.content_hash), V.byline.sig);
});

test("tree pointer discovery", () => {
  assert.equal(B.treePointer({ blyggdrasil: "https://a.example/t/x/" }), "https://a.example/t/x/");
  assert.equal(B.treePointer({ author: { links: [{ label: "Home", url: "https://a.example/" }, { label: " BlyggDrasil ", url: "https://a.example/f/y/" }] } }), "https://a.example/f/y/");
  assert.equal(B.itemIdIn("https://a.example/blyg/t/5ebzqtbtt693jxyxbkz3ndw6m5/"), "5ebzqtbtt693jxyxbkz3ndw6m5");
});

test("X archive ingest keeps public and private apart", () => {
  const dir = mkdtempSync(join(tmpdir(), "bg-x-"));
  try {
    mkdirSync(join(dir, "data"));
    const w = (name, v) => writeFileSync(join(dir, "data", `${name}.js`), `window.YTD.${name}.part0 = ${JSON.stringify(v)}`);
    w("account", [{ account: { username: "treeholder" } }]);
    w("tweets", [
      { tweet: { id_str: "1", created_at: "Wed Mar 02 11:01:00 +0000 2022", full_text: "Hello https://t.co/a", entities: { urls: [{ url: "https://t.co/a", expanded_url: "https://blyg.example/" }] } } },
      { tweet: { id_str: "2", created_at: "Thu Mar 03 11:01:00 +0000 2022", full_text: "@pal yes", in_reply_to_status_id_str: "9", in_reply_to_screen_name: "pal" } },
    ]);
    w("deleted-tweets", [{ tweet: { id_str: "3", created_at: "Fri Mar 04 11:01:00 +0000 2022", full_text: "gone" } }]);
    w("like", [{ like: { tweetId: "77", fullText: "someone else's words", expandedUrl: "https://x.com/i/web/status/77" } }]);
    w("direct-messages", [{ dmConversation: { conversationId: "1-2", messages: [{ messageCreate: { id: "5", createdAt: "2022-03-05T00:00:00.000Z", text: "secret" } }] } }]);
    const out = join(dir, "out");
    assert.deepEqual(ingestXArchive(dir, out), { public: 2, private: 3 });
    const pub = readFileSync(join(out, "public/x/2022/20220302-110100-1.md"), "utf8");
    assert.match(pub, /Hello https:\/\/blyg\.example\//);
    assert.match(readFileSync(join(out, "public/x/2022/20220303-110100-2.md"), "utf8"), /kind: reply\nvisibility: public\nreply_to: https:\/\/x.com\/pal\/status\/9/);
    const like = readFileSync(join(out, "private/x/1970/19700101-000000-like-77.md"), "utf8");
    assert.doesNotMatch(like, /someone else's words/);
    assert.deepEqual(readdirSync(join(out, "private/x/2022")).sort(), ["20220304-110100-3.md", "20220305-000000-dm-5.md"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("archive file format", () => {
  assert.equal(archiveFile({ network: "bluesky", url: "https://bsky.app/profile/d/post/r", created: "2026-01-01T00:00:00Z", kind: "post", visibility: "public", text: "hi" }),
    "---\nnetwork: bluesky\nurl: https://bsky.app/profile/d/post/r\ncreated: 2026-01-01T00:00:00Z\nkind: post\nvisibility: public\nreply_to: \n---\n\nhi\n");
});
