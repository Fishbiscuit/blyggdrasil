import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { installPin } from "../lib/pins/install.js";
import { snapshotPin } from "../lib/pins/snapshot.js";

const run = promisify(execFile);
const demo = fileURLToPath(new URL("../demo/edit-and-pin/blyg/", import.meta.url));
const cli = fileURLToPath(new URL("../bin/pin-install.mjs", import.meta.url));

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), "blyg-install-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const publisher = join(root, "publisher");
  await cp(demo, publisher, { recursive: true });
  const archive = JSON.parse(await readFile(join(publisher, "items", "index.json"), "utf8"));
  const { id } = archive.items.find(({ kind }) => kind === "fragment");
  const itemPath = join(publisher, "items", `${id}.json`);
  const oldPinPath = join(publisher, "items", id, "v1.json");
  const item = JSON.parse(await readFile(itemPath, "utf8"));
  delete item.changelog.find(({ version }) => version === 1).pinned;
  await writeFile(itemPath, JSON.stringify(item, null, 2) + "\n");
  const bytes = await readFile(oldPinPath, "utf8");
  const pin = JSON.parse(bytes);
  const prepared = join(root, "prepared.json");
  await writeFile(prepared, bytes);
  return { publisher, id, item, itemPath, pin, oldPinPath, bytes, prepared };
}

test("pin installation CLI adds a signed historical snapshot and sets its flag once", async (t) => {
  const demo = await setup(t);
  const beforeFeed = await readFile(join(demo.publisher, "feed.xml"));
  await rm(demo.oldPinPath);
  const cliInstall = async () => JSON.parse((await run(process.execPath, [cli, demo.prepared, "--publisher", demo.publisher])).stdout);
  assert.deepEqual(await cliInstall(), { id: demo.id, version: 1, created: true, changelogUpdated: true });
  assert.equal(await readFile(demo.oldPinPath, "utf8"), demo.bytes);
  const item = JSON.parse(await readFile(demo.itemPath, "utf8"));
  assert.equal(item.content_md, demo.item.content_md);
  assert.equal(item.changelog.find(({ version }) => version === 1).pinned, true);
  assert.deepEqual(await cliInstall(), { id: demo.id, version: 1, created: false, changelogUpdated: false });
  assert.deepEqual(await readFile(join(demo.publisher, "feed.xml")), beforeFeed);
});

test("pin installation repairs a flag left missing after the pin was linked", async (t) => {
  const demo = await setup(t);
  const result = await installPin(demo.publisher, demo.pin);
  assert.equal(result.created, false);
  assert.equal(result.changelogUpdated, true);
  assert.equal(await readFile(demo.oldPinPath, "utf8"), demo.bytes);
});

test("validates the signer, existing bytes and version before announcing a pin", async (t) => {
  const demo = await setup(t);
  await assert.rejects(installPin(demo.publisher, { ...demo.pin, content_md: "Changed." }), /Cannot prepare pin/);
  const conflictingBytes = JSON.stringify({ ...demo.pin, content_html: "Different rendering." });
  await writeFile(demo.oldPinPath, conflictingBytes);
  await assert.rejects(installPin(demo.publisher, demo.pin), /conflicting snapshot/);
  assert.equal(await readFile(demo.oldPinPath, "utf8"), conflictingBytes);
  const latest = snapshotPin(demo.item);
  const result = await installPin(demo.publisher, latest);
  assert.equal(result.version, demo.item.version);
  const item = JSON.parse(await readFile(demo.itemPath, "utf8"));
  assert.equal(item.changelog.at(-1).pinned, true);
  assert.equal(item.changelog[0].pinned, undefined);
});

test("a concurrent installer cannot change the same publisher", async (t) => {
  const demo = await setup(t);
  const lock = join(demo.publisher, ".blyggdrasil-pin-install");
  await mkdir(lock);
  await assert.rejects(installPin(demo.publisher, demo.pin), /Another pin installation/);
  assert.equal(await readFile(demo.oldPinPath, "utf8"), demo.bytes);
});
