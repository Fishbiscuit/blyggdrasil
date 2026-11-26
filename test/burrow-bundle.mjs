import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const pack = fileURLToPath(new URL("../integrations/burrow/bundle.mjs", import.meta.url));

test("the installable extension starts outside the checkout with its packaged Node program", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "blyggdrasil-burrow-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const destination = join(workspace, "blyggdrasil-proof");
  await run(process.execPath, [pack, destination]);
  const manifest = await readFile(join(destination, "extension.toml"), "utf8");
  const [node, entrypoint] = JSON.parse(/^command = (.+)$/m.exec(manifest)[1]);
  const child = spawn(node, [entrypoint], { cwd: destination, stdio: ["pipe", "pipe", "pipe"] });
  const entry = {
    origin: "https://sample.example/blyg/",
    remoteId: "1hk3fv43xwpgckk19k4wf3v9ts",
    version: 3,
  };
  let stdout = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
  child.stdin.end([
    { id: 1, method: "initialize", params: { protocolVersion: 1, granted: ["reading.read"] } },
    { id: 2, method: "extension/entry.action", params: { action: "verify-edition", entry } },
    { id: 3, method: "shutdown" },
  ].map((request) => JSON.stringify({ jsonrpc: "2.0", ...request })).join("\n") + "\n");
  assert.deepEqual(await once(child, "close"), [0, null]);
  const [, proof] = stdout.trim().split("\n").map(JSON.parse);
  assert.match(proof.result.description, /Allow network access/);
  assert.equal(new URL(proof.result.code).searchParams.get("version"), "3");
  await assert.rejects(run(process.execPath, [pack, destination]), /EEXIST/);
});
