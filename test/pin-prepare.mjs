import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { preparePin } from "../lib/pins/prepare.js";

const run = promisify(execFile);
const blyg = new URL("../demo/edit-and-pin/blyg/", import.meta.url);
const read = async (relative) => JSON.parse(await readFile(new URL(relative, blyg), "utf8"));
const manifest = await read("blyg.json");
const origin = manifest.site;
const treeId = manifest.blyggdrasil.match(/\/t\/([^/]+)\/$/)[1];
const item = (await read("items/index.json")).items.find(({ kind }) => kind === "fragment");
const currentUrl = new URL(`items/${item.id}.json`, origin).href;
const pinUrl = new URL(`items/${item.id}/v1.json`, origin).href;
const documents = new Map([
  [new URL("blyg.json", origin).href, manifest],
  [new URL(`items/${treeId}.json`, origin).href, await read(`items/${treeId}.json`)],
  [currentUrl, await read(`items/${item.id}.json`)],
  [pinUrl, await read(`items/${item.id}/v1.json`)],
]);
const response = (url, json = documents.get(url)) => json
  ? { ok: true, status: 200, url, json }
  : { ok: false, status: 404, url };
const cli = fileURLToPath(new URL("../bin/pin-prepare.mjs", import.meta.url));

test("pin preparation retains the precise verified document without a second read", async () => {
  let currentReads = 0;
  const current = { ...documents.get(currentUrl), syndication: [{ version: 2, url: "https://example.test/copy" }] };
  const pin = await preparePin(currentUrl, (url) => {
    if (url !== currentUrl) return response(url);
    currentReads++;
    return response(url, currentReads === 1 ? current : { ...current, content_md: "Changed after verification." });
  }, { version: 2 });
  assert.equal(currentReads, 1);
  assert.equal(pin.pinned, true);
  assert.equal(pin.at, current.changelog.at(-1).at);
  assert.equal(pin.content_md, current.content_md);
  assert.deepEqual(pin.author, current.author);
  for (const key of ["media", "syndication", "changelog"]) assert.ok(!(key in pin));
});

test("pin preparation reads an exact older edition and rejects changed text", async () => {
  assert.deepEqual(await preparePin(currentUrl, (url) => response(url), { version: 1 }), documents.get(pinUrl));
  await assert.rejects(
    preparePin(currentUrl, (url) => response(url, url === pinUrl ? { ...documents.get(pinUrl), content_md: "Altered." } : documents.get(url)), { version: 1 }),
    /Cannot prepare pin/,
  );
});

test("pin-preparation CLI preserves an existing snapshot and refuses a conflict", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "blyg-prepare-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const out = join(root, "pin.json");
  const preload = "data:text/javascript," + encodeURIComponent(`
    const documents = new Map(${JSON.stringify([...documents])});
    globalThis.fetch = async (url) => new Response(JSON.stringify(documents.get(url) ?? {}), {
      status: documents.has(url) ? 200 : 404,
    });
  `);
  const invoke = (version) => run(process.execPath, ["--import", preload, cli, currentUrl, "--version", version, "--out", out]);
  await invoke("1");
  const first = await readFile(out, "utf8");
  assert.deepEqual(JSON.parse(first), documents.get(pinUrl));
  await invoke("1");
  await assert.rejects(invoke("2"), /conflicting snapshot/);
  assert.equal(await readFile(out, "utf8"), first);
});
