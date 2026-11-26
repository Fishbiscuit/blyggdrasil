import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { inspectEdition } from "../integrations/burrow/inspect.mjs";
import { isPublicAddress, publicJson } from "../integrations/burrow/public-json.mjs";

const origin = "https://fishbiscuit.me/blyggdrasil/demo/edit-and-pin/blyg/";
const id = "1hk3fv43xwpgckk19k4wf3v9ts";
const demoBlyg = new URL("../demo/edit-and-pin/blyg/", import.meta.url);

async function servedEdition(url) {
  assert.ok(url.startsWith(origin));
  try {
    const json = JSON.parse(await readFile(new URL(url.slice(origin.length), demoBlyg), "utf8"));
    return { ok: true, url, status: 200, json };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return { ok: false, url, status: 404 };
  }
}

test("Burrow's sheet independently shows three checks for the held pinned edition", async () => {
  const edition = { origin, id, version: 1 };
  const original = (await servedEdition(origin + "items/" + id + "/v1.json")).json.content_md;
  const result = await inspectEdition(edition, { get: servedEdition, shownMarkdown: original });
  assert.deepEqual(Object.fromEntries(result.fields.map(({ label, value }) => [label, value])), {
    Version: "1",
    "Content hash": "Passed",
    "Post signature": "Passed",
    "Signer authorized by tree": "Passed",
    "Copy shown in Burrow": "Matches",
  });
  assert.equal(new URL(result.code).searchParams.get("version"), "1");
});

test("Burrow can distinguish the verified source from a different local copy", async () => {
  const edition = { origin, id, version: 1 };
  const result = await inspectEdition(edition, { get: servedEdition, shownMarkdown: "An altered reading copy." });
  assert.equal(result.fields.at(-1).value, "Different text");
  assert.match(result.description, /text held by Burrow differs/);
});

test("Burrow shows unavailable for a missing pinned edition", async () => {
  const edition = { origin, id, version: 1 };
  const missingPin = async (url) => url.endsWith("/v1.json")
    ? { ok: false, status: 404, url }
    : servedEdition(url);
  const result = await inspectEdition(edition, { get: missingPin });
  assert.deepEqual(result.fields.slice(1).map(({ value }) => value),
    ["Unavailable", "Unavailable", "Unavailable"]);
  assert.equal(new URL(result.code).searchParams.get("version"), "1");
});

test("the desktop reader confines reads to the selected public HTTPS authority", async () => {
  const get = publicJson(origin);
  assert.equal((await get("https://elsewhere.example/items.json")).ok, false);
  assert.equal((await publicJson("https://127.0.0.1/")("https://127.0.0.1/items.json")).ok, false);
  for (const address of ["0.0.0.1", "10.12.0.1", "169.254.1.1", "::1", "::ffff:127.0.0.1", "fc00::1"]) {
    assert.equal(isPublicAddress(address), false, address);
  }
  assert.equal(isPublicAddress("93.184.215.14"), true);
  assert.equal(isPublicAddress("2606:4700::1111"), true);
});
