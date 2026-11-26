import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { importKeyFile, signByline } from "../lib/blyggdrasil.js";
import { matchQuote } from "../lib/quote-match.js";
import { verifyQuote } from "../lib/quote-proof.js";

const id = "1hk3fv43xwpgckk19k4wf3v9ts";
const demo = new URL("../demo/edit-and-pin/blyg/", import.meta.url);
const original = JSON.parse(await readFile(new URL(`items/${id}/v1.json`, demo), "utf8"));
const input = new URL(`items/${id}.json`, original.origin).href;
const pinned = new URL(`items/${id}/v1.json`, original.origin).href;

async function getPublishedDemo(url) {
  if (url.startsWith(original.origin)) {
    try {
      const file = new URL(url.slice(original.origin.length), demo);
      const json = JSON.parse(await readFile(file, "utf8"));
      return { ok: true, status: 200, url, json };
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "EISDIR") throw error;
    }
  }
  return { ok: false, status: 404, url };
}

test("quote matching preserves literal Markdown, Unicode and whitespace", () => {
  const source = "Before\r\n\r\nA **café** is open. 🍃\nAfter.";
  const quote = "**café** is open. 🍃";
  const match = matchQuote(source, quote);
  assert.equal(match.status, "matched");
  assert.equal(match.text, quote);
  assert.equal(match.before + match.text + match.after, source);
  assert.equal(matchQuote(source, "cafe\u0301").status, "absent");
  assert.equal(matchQuote(source, "Café").status, "absent");
  assert.equal(matchQuote(source, "**café**  is open.").status, "absent");
  assert.equal(matchQuote(source, "\n").status, "unavailable");
});

test("clipping surrounding text preserves complete Unicode characters", () => {
  const quote = "The complete quoted passage.";
  const match = matchQuote(`⌁🍃${"a".repeat(239)}${quote}${"b".repeat(239)}🌿⌁`, quote);
  assert.equal(match.text, quote);
  assert.equal(match.truncatedBefore, true);
  assert.equal(match.truncatedAfter, true);
  assert.ok(match.before.startsWith("🍃"));
  assert.ok(match.after.endsWith("🌿"));
});

test("finds the verified quote in the actual demo's pinned edition after an edit", async () => {
  const report = await verifyQuote(input, getPublishedDemo, { version: 1, quote: "at five" });
  assert.equal(report.edition.itemUrl, pinned);
  assert.equal(report.edition.status, "verified");
  assert.equal(report.match.before, "The reading room closes ");
  assert.equal(report.match.text, "at five");
  assert.equal(report.match.after, ".");
  assert.equal(report.current.itemUrl, input);
  assert.equal(report.current.version, 2);
  assert.equal(report.current.contentMarkdown, "The reading room closes at six.");
  assert.equal(report.currentMatch.status, "absent");
  assert.equal(report.comparison, "changed");
});

test("compares an explicit pin with the current item and distinguishes verbatim text", async () => {
  const report = await verifyQuote(pinned, getPublishedDemo, { quote: "reading room" });
  assert.equal(report.edition.version, 1);
  assert.equal(report.current.version, 2);
  assert.equal(report.match.status, "matched");
  assert.equal(report.currentMatch.status, "matched");
  assert.equal(report.comparison, "same");
  assert.equal(report.positionChanged, undefined);
});

test("a missing pin cannot establish what an older edition said", async () => {
  const get = async (url) => url === pinned ? { ok: false, status: 404, url } : getPublishedDemo(url);
  const report = await verifyQuote(input, get, { version: 1, quote: "reading room" });
  assert.equal(report.edition.status, "unavailable");
  assert.deepEqual(report.match, { status: "unavailable" });
  assert.equal(report.current, null);
  assert.equal(report.comparison, "unavailable");
});

test("tampered bytes are never displayed as quote context in either edition", async () => {
  const tamper = (target) => async (url) => {
    const response = await getPublishedDemo(url);
    if (url === target && response.ok) response.json.content_md = "This is unverified text.";
    return response;
  };
  const badCited = await verifyQuote(pinned, tamper(pinned), { quote: "unverified text" });
  assert.equal(badCited.edition.checks.content, "invalid");
  assert.deepEqual(badCited.match, { status: "unavailable" });
  assert.equal(badCited.edition.contentMarkdown, undefined);

  const badCurrent = await verifyQuote(pinned, tamper(input), { quote: "at five" });
  assert.equal(badCurrent.match.status, "matched");
  assert.equal(badCurrent.current.status, "failed");
  assert.equal(badCurrent.comparison, "unavailable");
  assert.equal(badCurrent.currentMatch, undefined);
});

test("a quote absent from its cited edition cannot be rescued by a newer version", async () => {
  const report = await verifyQuote(pinned, getPublishedDemo, { quote: "at six" });
  assert.equal(report.edition.status, "verified");
  assert.equal(report.match.status, "absent");
  assert.equal(report.currentMatch.status, "matched");
  assert.equal(report.comparison, "unavailable");
});

test("custom templates preserve identity while finding a moved literal quote", async () => {
  const vector = JSON.parse(await readFile(new URL("./vectors.json", import.meta.url), "utf8"));
  const key = await importKeyFile(vector.keys.main);
  const { origin, content_md } = vector.trees.valid;
  const treeID = "01jpcyy4qaaaek03ptm4c5g1c3";
  const hint = new URL(`items/${id}.json`, origin).href;
  const customItem = new URL(`read/${id}.json`, origin).href;
  const customPin = new URL(`revisions/${id}/1.json`, origin).href;
  const makePost = async (version, text, pinned = false) => {
    const hash = "sha256:" + createHash("sha256").update(text).digest("hex");
    return {
      id, origin, kind: "thread", version, content_md: text, content_hash: hash, pinned,
      author: { sig: await signByline(key, hash) },
    };
  };
  const docs = new Map([
    [new URL("blyg.json", origin).href, {
      blyg: "0.4", item: "read/{id}.json", pin: "revisions/{id}/{n}.json", blyggdrasil: `t/${treeID}/`,
    }],
    [new URL(`read/${treeID}.json`, origin).href, { id: treeID, kind: "thread", origin, version: 1, content_md }],
    [customPin, await makePost(1, "A literal quote", true)],
    [customItem, await makePost(2, "A paragraph\n\nA literal quote")],
  ]);
  const get = async (url) => ({
    ok: docs.has(url), status: docs.has(url) ? 200 : 404, url, json: docs.get(url),
  });
  const report = await verifyQuote(hint, get, { version: 1, quote: "literal quote" });
  assert.equal(report.edition.itemUrl, customPin);
  assert.equal(report.current.itemUrl, customItem);
  assert.equal(report.comparison, "same");
  assert.equal(report.positionChanged, true);
});
