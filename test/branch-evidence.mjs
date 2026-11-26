import { strict as assert } from "node:assert";
import test from "node:test";
import { checkBranch } from "../lib/resolvers.js";

const trunk = "https://publisher.example/blyg/";
const branch = "https://github.com/publisher";
const profile = "https://api.github.com/users/publisher";
const raw = "https://gist.githubusercontent.com/publisher/example/raw/blyggdrasil.txt";
const context = (get) => ({ trunk, get, keys: [] });

test("the GitHub proof link is the public gist that passed the check", async () => {
  const sources = new Map([
    [profile, { ok: true, json: { login: "publisher", bio: "" } }],
    [profile + "/gists?per_page=100", {
      ok: true, json: [{ files: { "blyggdrasil.txt": { filename: "blyggdrasil.txt", raw_url: raw } } }],
    }],
    [raw, { ok: true, text: "My blyg is " + trunk }],
  ]);
  const result = await checkBranch(branch, context((url) => sources.get(url)));
  assert.equal(result.verdict, "verified");
  assert.equal(result.method, "link");
  assert.equal(result.source, raw);
});

test("an unavailable or unchecked link is never presented as proof", async () => {
  const unavailable = await checkBranch(branch, context(() => ({ ok: false, status: 429 })));
  assert.equal(unavailable.verdict, "unreachable");
  assert.equal(unavailable.source, undefined);
  const claimed = await checkBranch("https://x.com/publisher", context(() => {
    assert.fail("profile-only X claims have no live check");
  }));
  assert.equal(claimed.verdict, "claimed");
  assert.equal(claimed.source, undefined);
});

test("GitHub's gist response must name a public GitHub raw source", async () => {
  const result = await checkBranch(branch, context((url) => {
    if (url === profile) return { ok: true, json: { login: "publisher", bio: "" } };
    if (url.startsWith(profile + "/gists?")) return {
      ok: true, json: [{ files: { "blyggdrasil.txt": {
        filename: "blyggdrasil.txt", raw_url: "https://elsewhere.example/file.txt",
      } } }],
    };
    assert.fail("unexpected gist URL");
  }));
  assert.equal(result.verdict, "unreachable");
  assert.equal(result.source, undefined);
});
