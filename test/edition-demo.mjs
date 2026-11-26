import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { verifyPost } from "../lib/post-proof.js";
import { loadQuotedEdition } from "../lib/quoted-edition.js";

const project = new URL("../", import.meta.url);
const base = "https://fishbiscuit.me/blyggdrasil/";
const origin = base + "demo/edit-and-pin/blyg/";
const sourceId = "1hk3fv43xwpgckk19k4wf3v9ts";
const currentPage = origin + "f/" + sourceId + "/";
const pinPage = currentPage + "v1/";
const pinItem = origin + "items/" + sourceId + "/v1.json";

async function get(address, { as = "json" } = {}) {
  if (!address.startsWith(base + "demo/")) return { ok: false, status: 404, url: address };
  const path = address.slice(base.length);
  try {
    const text = await readFile(new URL(path.endsWith("/") ? path + "index.html" : path, project), "utf8");
    return as === "text"
      ? { ok: true, url: address, text }
      : { ok: true, url: address, json: JSON.parse(text) };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return { ok: false, status: 404, url: address };
  }
}

test("the readable pinned page links the original data and verifies the exact edition", async () => {
  const { text: html } = await get(pinPage, { as: "text" });
  assert.ok(html.includes(`rel="canonical" href="${currentPage}"`));
  assert.ok(html.includes(`rel="blyg" href="${origin}blyg.json"`));
  assert.ok(html.includes(`rel="alternate" type="application/json" href="${pinItem}"`));
  const { json: pin } = await get(pinItem);
  assert.ok(html.includes(pin.content_html));

  const proof = await verifyPost(pinPage, get, { includeText: true });
  assert.equal(proof.status, "verified");
  assert.equal(proof.itemUrl, pinItem);
  assert.equal(proof.pinned, true);
  assert.equal(proof.version, 1);
  assert.equal(proof.contentMarkdown, pin.content_md);
});

test("the signed cross-origin quote matches pinned v1 and the current v2 changed", async () => {
  const result = await loadQuotedEdition(get);
  assert.equal(result.thread.status, "verified");
  assert.equal(result.error, undefined);
  assert.equal(result.source.match.status, "matched");
  assert.equal(result.source.comparison, "changed");
  assert.equal(result.source.edition.version, 1);
  assert.equal(result.source.current.version, 2);
  assert.notEqual(result.thread.origin, result.source.edition.origin);

  const { json: doc } = await get(result.thread.itemUrl);
  const [citation] = doc.transclusions;
  assert.deepEqual(citation, {
    origin,
    id: sourceId,
    version: 1,
    selector: { exact: result.quote },
  });
  assert.ok(doc.content_html.includes(`data-blyg-origin="${origin}"><p>${result.quote}</p></blockquote>`));
  assert.equal(result.quote, "The reading room closes at five.");
  assert.equal(result.source.current.contentMarkdown, "The reading room closes at six.");
});

test("an altered transclusion version cannot change the signed citation", async () => {
  const altered = async (address, options) => {
    const response = await get(address, options);
    if (response.json?.transclusions?.length) response.json.transclusions[0].version = 2;
    return response;
  };
  const result = await loadQuotedEdition(altered);
  assert.equal(result.thread.status, "verified");
  assert.match(result.error, /does not match the signed citation/);
  assert.equal(result.source, undefined);
});

test("the walkthrough reports an unavailable pin without silently checking the latest edition", async () => {
  const missingPin = (address, options) => address === pinItem
    ? { ok: false, status: 404, url: address }
    : get(address, options);
  const { thread, source } = await loadQuotedEdition(missingPin);
  assert.equal(thread.status, "verified");
  assert.equal(source.edition.status, "unavailable");
  assert.equal(source.current, null);
  assert.equal(source.comparison, "unavailable");
});
