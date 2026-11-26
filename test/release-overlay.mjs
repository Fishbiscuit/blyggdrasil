import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const cli = fileURLToPath(new URL("../bin/release-overlay.mjs", import.meta.url));
const pin = "demo/example/blyg/items/1hk3fv43xwpgckk19k4wf3v9ts/v1.json";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function workspace(t) {
  const root = await mkdtemp(join(tmpdir(), "blyggdrasil-release-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const baseline = join(root, "baseline");
  const source = join(root, "source");
  const out = join(root, "out");
  async function write(parent, path, content) {
    const destination = join(parent, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, content);
  }
  await write(baseline, "index.html", "Prior homepage\n");
  await write(baseline, "blyg/items/current.json", "{\"version\": 7}\n");
  await write(baseline, "blyggdrasil/index.html", "Prior Blyggdrasil homepage\n");
  await write(baseline, `blyggdrasil/${pin}`, "{\"version\": 1, \"pinned\": true}\n");
  await write(source, "index.html", "New Blyggdrasil homepage\n");
  const command = () => run(process.execPath, [cli, "--baseline", baseline, "--source", source, "--out", out]);
  return { root, baseline, source, out, write, command };
}

test("the overlay CLI writes a verified public copy and scopes the diff", async (t) => {
  const { baseline, source, out, write, command } = await workspace(t);
  await write(source, "quote/index.html", "Public quote checker\n");
  await write(source, "schemas/post-proof.v1.json", "{\"type\": \"object\"}\n");
  await write(source, "demo/example/blyg/items/current.json", "{\"version\": 2}\n");
  await write(source, "bin/non-web.mjs", "Local script\n");
  await write(source, "archive/private/diary.md", "Local archive\n");
  const { stdout } = await command();
  const receipt = JSON.parse(stdout);
  assert.equal(receipt.baselineFiles, 4);
  assert.equal(receipt.outputFiles, 7);
  assert.equal(receipt.unchangedFiles, 3);
  assert.deepEqual(receipt.changed, [{
    path: "blyggdrasil/index.html",
    sha256: hash("New Blyggdrasil homepage\n"),
  }]);
  assert.deepEqual(receipt.added.map(({ path }) => path).sort(), [
    "blyggdrasil/demo/example/blyg/items/current.json",
    "blyggdrasil/quote/index.html",
    "blyggdrasil/schemas/post-proof.v1.json",
  ]);
  const pinBytes = await readFile(join(baseline, "blyggdrasil", pin));
  assert.deepEqual(receipt.retainedPins, [{ path: `blyggdrasil/${pin}`, sha256: hash(pinBytes) }]);
  for (const path of ["index.html", "blyg/items/current.json", `blyggdrasil/${pin}`]) {
    assert.deepEqual(await readFile(join(out, path)), await readFile(join(baseline, path)));
  }
  assert.equal(await readFile(join(baseline, "blyggdrasil/index.html"), "utf8"), "Prior Blyggdrasil homepage\n");
  await assert.rejects(stat(join(out, "blyggdrasil", "bin")), { code: "ENOENT" });
  await assert.rejects(stat(join(out, "blyggdrasil", "archive")), { code: "ENOENT" });
  await assert.rejects(command(), { stderr: /Output already exists/ });
});

test("a modified published pin fails before any release directory is created", async (t) => {
  const { source, out, write, command } = await workspace(t);
  await write(source, pin, "{\"version\": 1, \"pinned\": true, \"content_md\": \"Changed bytes\"}\n");
  await assert.rejects(command(), { stderr: /cannot change the bytes of an existing pin/ });
  await assert.rejects(stat(out), { code: "ENOENT" });
});

test("custom pinned item paths receive the same byte protection", async (t) => {
  const { baseline, source, out, write, command } = await workspace(t);
  const path = "demo/example/history/original.json";
  const original = {
    pinned: true, id: "1hk3fv43xwpgckk19k4wf3v9ts", origin: "https://example.com/blyg/",
    version: 1, content_hash: "sha256:fixture",
  };
  await write(baseline, `blyggdrasil/${path}`, JSON.stringify(original));
  await write(source, path, JSON.stringify(original, null, 2));
  await assert.rejects(command(), { stderr: /cannot change the bytes of an existing pin/ });
  await assert.rejects(stat(out), { code: "ENOENT" });
});

test("private signing data and runtime symlinks cannot enter a release", async (t) => {
  const { root, source, out, write, command } = await workspace(t);
  const bogusKey = JSON.stringify({ blyggdrasil_key: 1, jwk: { d: "test-only" } });
  await write(source, "demo/example/settings.json", bogusKey);
  await assert.rejects(command(), { stderr: /Refusing a private signing key/ });
  await assert.rejects(stat(out), { code: "ENOENT" });
  await write(source, "demo/example/settings.json", "{}");
  await write(root, "outside/post-proof.failed.json", "{}");
  await mkdir(join(source, "schemas"));
  await symlink(join(root, "outside"), join(source, "schemas/examples"), "dir");
  await assert.rejects(command(), { stderr: /Refusing a non-directory parent/ });
  await assert.rejects(stat(out), { code: "ENOENT" });
});
