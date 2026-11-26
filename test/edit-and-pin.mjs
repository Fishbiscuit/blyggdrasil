import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { verifyEditAndPin } from "../lib/edit-and-pin.js";

const page = await readFile(new URL("../demo/edit-and-pin/index.html", import.meta.url), "utf8");
const canonical = page.match(/rel="canonical" href="([^"]+)"/)[1];
const origin = new URL("blyg/", canonical).href;
const [pinnedUrl, currentUrl] = [...page.matchAll(/class="edition-data" href="([^"]+)"/g)]
  .map(([, path]) => new URL(path, canonical).href);
const inputs = { pinnedUrl, currentUrl };

async function servePublicFiles(url) {
  if (!url.startsWith(origin)) return { ok: false, status: 404, url };
  const relative = url.slice(origin.length);
  try {
    const bytes = await readFile(new URL(`../demo/edit-and-pin/blyg/${relative}`, import.meta.url));
    return { ok: true, status: 200, url, json: JSON.parse(bytes) };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return { ok: false, status: 404, url };
  }
}

test("both published editions of one post verify using the actual served documents", async () => {
  const result = await verifyEditAndPin(inputs, servePublicFiles);
  assert.equal(result.error, undefined);
  assert.deepEqual(result.pinned.checks, { content: "valid", signature: "valid", signer: "valid" });
  assert.deepEqual(result.current.checks, result.pinned.checks);
  assert.equal(result.pinned.pinned, true);
  assert.equal(result.current.pinned, false);
  assert.equal(result.pinned.version, 1);
  assert.equal(result.current.version, 2);
  assert.equal(result.pinned.signingKey, result.current.signingKey);
  assert.equal(result.pinned.contentMarkdown, "The reading room closes at five.");
  assert.equal(result.current.contentMarkdown, "The reading room closes at six.");
  const published = (await servePublicFiles(currentUrl)).json;
  const original = (await servePublicFiles(pinnedUrl)).json;
  assert.equal(published.changelog[0].pinned, true);
  assert.equal(published.changelog[0].at, original.at);
  assert.notEqual(published.content_hash, original.content_hash);
});

test("the pair preserves a successful pin check when the current text fails", async () => {
  const tampered = async (url) => {
    const response = await servePublicFiles(url);
    if (url === currentUrl) response.json.content_md += " Edited after signing.";
    return response;
  };
  const result = await verifyEditAndPin(inputs, tampered);
  assert.match(result.error, /Both editions/);
  assert.equal(result.pinned.status, "verified");
  assert.equal(result.current.checks.content, "invalid");
  assert.equal(result.current.checks.signature, "valid");
  assert.equal(result.current.contentMarkdown, undefined);
});

test("a missing pin stays unavailable even when the publisher has a verified current item", async () => {
  const withoutPin = (url) => url === pinnedUrl ? { ok: false, status: 404, url } : servePublicFiles(url);
  const result = await verifyEditAndPin(inputs, withoutPin);
  assert.match(result.error, /Both editions/);
  assert.equal(result.pinned.status, "unavailable");
  assert.equal(result.current.status, "verified");
});
