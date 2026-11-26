import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const renderer = fileURLToPath(new URL("../bin/render-tree.mjs", import.meta.url));

test("the snapshot check detects a new public version without writing the output", (t) => {
  const root = mkdtempSync(join(tmpdir(), "blyggdrasil-freshness-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const origin = "https://publisher.example/blyg/";
  const id = "7phxkgdpcecwvxa8xwbfwtq3pm";
  const mirror = join(root, "public");
  const output = join(root, "tree", "index.html");
  mkdirSync(join(mirror, "items"), { recursive: true });
  const write = (path, value) => writeFileSync(join(mirror, path), JSON.stringify(value));
  write("blyg.json", { blyg: "0.4", title: "Freshness example" });
  const publish = (version, content_md) => {
    write("items/index.json", { items: [{ id, version, kind: "thread" }] });
    write(`items/${id}.json`, { id, origin, kind: "thread", version, content_md });
  };
  const render = (...flags) => spawnSync(
    process.execPath, [renderer, origin, "--mirror", mirror, "--out", output, ...flags], { encoding: "utf8" },
  );

  publish(1, "A public post\n\nFirst edition.");
  assert.equal(render("--check").status, 1);
  assert.equal(existsSync(output), false);
  assert.equal(render().status, 0);
  const original = readFileSync(output, "utf8");
  assert.match(original, /data-item-version="1"/);
  assert.equal(render("--check").status, 0);

  publish(2, "A public post\n\nSecond edition.");
  const check = render("--check");
  assert.equal(check.status, 1);
  assert.match(check.stderr, /snapshot.*is stale/);
  assert.equal(readFileSync(output, "utf8"), original);

  assert.equal(render().status, 0);
  assert.match(readFileSync(output, "utf8"), /data-item-version="2"/);
  assert.equal(render("--check").status, 0);
});
