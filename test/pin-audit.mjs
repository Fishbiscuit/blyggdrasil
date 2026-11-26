import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { auditPins } from "../lib/pins/audit.js";

const run = promisify(execFile);
const demo = fileURLToPath(new URL("../demo/edit-and-pin/blyg/", import.meta.url));
const cli = fileURLToPath(new URL("../bin/pin-audit.mjs", import.meta.url));

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), "blyg-audit-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const before = join(root, "before");
  const after = join(root, "after");
  await Promise.all([cp(demo, before, { recursive: true }), cp(demo, after, { recursive: true })]);
  const { id } = JSON.parse(await readFile(join(before, "items/index.json"), "utf8")).items.find(({ kind }) => kind === "fragment");
  return { before, after, id, afterPin: join(after, "items", id, "v1.json") };
}

test("audits an exact pin across an independent publisher build", async (t) => {
  const { before, after, id } = await setup(t);
  const report = JSON.parse((await run(process.execPath, [cli, before, after, "--json"])).stdout);
  assert.equal(report.ok, true);
  assert.equal(report.unchanged, 1);
  assert.equal(report.checked[0].id, id);
  assert.equal(report.checked[0].content, "preserved");
});

test("audit distinguishes a changed byte, missing file and missing changelog flag", async (t) => {
  const { before, after, afterPin, id } = await setup(t);
  const bytes = await readFile(afterPin, "utf8");
  await writeFile(afterPin, bytes + "\n");
  await assert.rejects(run(process.execPath, [cli, before, after, "--json"]), (error) => {
    assert.equal(error.code, 1);
    assert.equal(JSON.parse(error.stdout).checked[0].content, "changed");
    return true;
  });
  await rm(afterPin);
  assert.equal((await auditPins(before, after)).checked[0].content, "missing");

  await writeFile(afterPin, bytes);
  const itemPath = join(after, "items", `${id}.json`);
  const item = JSON.parse(await readFile(itemPath, "utf8"));
  delete item.changelog[0].pinned;
  await writeFile(itemPath, JSON.stringify(item));
  const report = await auditPins(before, after);
  assert.equal(report.ok, false);
  assert.equal(report.checked[0].content, "preserved");
  assert.equal(report.checked[0].declared, false);
});
