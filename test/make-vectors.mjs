// Generates test/vectors.json once. The keys in it are TEST KEYS ONLY, published on purpose.
// Ed25519 is deterministic, so every signature here is reproducible by any implementation.
// Re-running replaces the keys and every signature: pass --force to do that deliberately.

import { existsSync, writeFileSync } from "node:fs";
import { generateKey, importKeyFile, serializeClaims, signClaims, treeMarkdown, signByline, proofLine } from "../lib/blyggdrasil.js";

const out = new URL("./vectors.json", import.meta.url);
if (existsSync(out) && !process.argv.includes("--force")) { console.error("vectors.json exists; pass --force to regenerate"); process.exit(1); }

const keys = {};
for (const label of ["main", "next", "recovery", "stranger"]) keys[label] = await generateKey(`test-${label}`);
const k = {};
for (const [l, f] of Object.entries(keys)) k[l] = await importKeyFile(f);

const TRUNK = "https://blyg.example/blyg/";
const branches = [
  "https://github.com/treeholder",
  "https://bsky.app/profile/treeholder.example",
  "https://bsky.app/profile/blyg.example",
  "https://bsky.app/profile/treeholder.example/post/3lproofpost",
  "https://social.example/@treeholder",
  "https://social.example/@treeholder/1099",
  "https://x.com/treeholder/status/1990000000000000001",
  "https://x.com/treeholder",
  "https://www.linkedin.com/in/treeholder",
  "https://video.example/@treeholder",
];

const trees = {};
const make = async (name, claims, signers, intro) => {
  const body = serializeClaims(claims);
  trees[name] = { origin: TRUNK, body, content_md: treeMarkdown(body, await signClaims(body, signers), intro) };
};
await make("valid", { trunk: TRUNK, key: k.main.did, branches, recovery: [k.recovery.did] }, [k.main], "These accounts are mine.");
await make("rotated", { trunk: TRUNK, key: k.next.did, branches, previous: k.main.did }, [k.next, k.main]);
await make("rotated_unsigned_by_previous", { trunk: TRUNK, key: k.next.did, branches, previous: k.main.did }, [k.next]);
await make("recovered", { trunk: TRUNK, key: k.next.did, branches, previous: k.main.did, recoveredFrom: 1 }, [k.next, k.recovery]);
await make("recovered_by_stranger", { trunk: TRUNK, key: k.next.did, branches, previous: k.main.did, recoveredFrom: 1 }, [k.next, k.stranger]);
trees.wrong_trunk = { ...trees.valid, origin: "https://elsewhere.example/blyg/" };
trees.tampered = { ...trees.valid, content_md: trees.valid.content_md.replace("https://github.com/treeholder", "https://github.com/impostor") };

const proof = proofLine({ key: k.main.did, trunk: TRUNK });
const strangerProof = proofLine({ key: k.stranger.did, trunk: "https://other.example/" });
const hash = "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

const network = {
  "https://api.github.com/users/treeholder": { status: 200, json: { login: "treeholder", bio: `I make things. ${proof}`, blog: "" } },
  "https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=treeholder.example": { status: 200, json: { did: "did:plc:treeholder", handle: "treeholder.example", description: "No proof here, just vibes." } },
  "https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=blyg.example": { status: 200, json: { did: "did:plc:domainholder", handle: "blyg.example", description: "" } },
  "https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts?uris=at%3A%2F%2Fdid%3Aplc%3Atreeholder%2Fapp.bsky.feed.post%2F3lproofpost": {
    status: 200, json: { posts: [{ author: { did: "did:plc:treeholder" }, record: { text: "My blyg: blyg.example/blyg", facets: [{ features: [{ $type: "app.bsky.richtext.facet#link", uri: "https://blyg.example/blyg/" }] }] } }] },
  },
  "https://social.example/api/v1/accounts/lookup?acct=treeholder": {
    status: 200, json: { acct: "treeholder", note: "<p>Writer.</p>", fields: [{ name: "Blyg", value: '<a href="https://blyg.example/blyg/" rel="nofollow noopener me">blyg.example/blyg</a>', verified_at: "2026-11-20T00:00:00.000Z" }] },
  },
  "https://social.example/api/v1/statuses/1099": { status: 200, json: { account: { acct: "someoneelse" }, content: `<p>${proof}</p>` } },
  "https://publish.x.com/oembed?url=https%3A%2F%2Fx.com%2Ftreeholder%2Fstatus%2F1990000000000000001&omit_script=1&dnt=true": {
    status: 200, json: { author_url: "https://twitter.com/treeholder", html: `<blockquote class="twitter-tweet"><p lang="en" dir="ltr">${proof.replace("https://blyg.example/blyg/", '<a href="https://t.co/abc">blyg.example/blyg/</a>')}</p>&mdash; Tree Holder (@treeholder)</blockquote>` },
  },
  "https://video.example/api/v1/accounts/lookup?acct=treeholder": { status: 200, text: "<!doctype html><title>video</title>" },
  "https://video.example/@treeholder/blyg.json": { status: 404, text: "not found" },
  "https://video.example/@treeholder": { status: 200, text: `<!doctype html><a rel="me" href="https://blyg.example/blyg/">my blyg</a>` },
};

const vectors = {
  note: "TEST KEYS ONLY. Never use these keys for anything real.",
  rfc8032_test1: {
    seed_hex: "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
    public_hex: "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
    did: "did:key:z6MktwupdmLXVVqTzCw4i46r4uGyosGXRnR3XjN4Zq7oMMsw",
    message_hex: "",
    signature_b64url: "5VZDAMNgrHKQhuLMgG6CioSHfx645dl02HPgZSJJAVVfuIIVkKM7rMYeOXAc-bRr0lv18FlbviRlUUFDjnoQCw",
  },
  keys,
  trunk: TRUNK,
  proof_line: proof,
  stranger_proof_line: strangerProof,
  trees,
  expected_trees: {
    valid: { valid: true, keys: [k.main.did] },
    rotated: { valid: true, keys: [k.next.did, k.main.did] },
    rotated_unsigned_by_previous: { valid: false },
    recovered: { valid: true, keys: [k.next.did, k.main.did], pinned: { 1: "valid" } },
    recovered_by_stranger: { valid: false, pinned: { 1: "valid" } },
    wrong_trunk: { valid: false },
    tampered: { valid: false },
  },
  network,
  expected_branches: {
    "https://github.com/treeholder": { verdict: "verified", method: "key" },
    "https://bsky.app/profile/treeholder.example": { verdict: "failed" },
    "https://bsky.app/profile/blyg.example": { verdict: "verified", method: "handle" },
    "https://bsky.app/profile/treeholder.example/post/3lproofpost": { verdict: "verified", method: "link" },
    "https://social.example/@treeholder": { verdict: "verified", method: "link" },
    "https://social.example/@treeholder/1099": { verdict: "failed" },
    "https://x.com/treeholder/status/1990000000000000001": { verdict: "verified", method: "key" },
    "https://x.com/treeholder": { verdict: "claimed" },
    "https://www.linkedin.com/in/treeholder": { verdict: "claimed" },
    "https://video.example/@treeholder": { verdict: "verified", method: "link" },
    "https://unreachable.example/": { verdict: "unreachable" },
  },
  byline: { content_hash: hash, sig: await signByline(k.main, hash) },
};

writeFileSync(out, JSON.stringify(vectors, null, 2) + "\n");
console.log("wrote test/vectors.json");
