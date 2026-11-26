import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const extension = fileURLToPath(new URL("../integrations/burrow/main.mjs", import.meta.url));
const origin = "https://fishbiscuit.me/blyggdrasil/demo/edit-and-pin/blyg/";
const remoteId = "1hk3fv43xwpgckk19k4wf3v9ts";

test("Burrow's subprocess verifies the live pinned and current editions", { timeout: 12000 }, async () => {
  const child = spawn(process.execPath, [extension], { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  const action = (version) => ({
    id: 10 + version,
    method: "extension/entry.action", params: { action: "verify-edition", entry: { origin, remoteId, version } },
  });
  child.stdin.end([
    { id: 1, method: "initialize", params: { protocolVersion: 1, granted: ["reading.read", "net"] } },
    action(1), action(2), { id: 4, method: "shutdown" },
  ].map((request) => JSON.stringify({ jsonrpc: "2.0", ...request })).join("\n") + "\n");
  assert.deepEqual(await once(child, "close"), [0, null], stderr);
  const replies = stdout.trim().split("\n").map(JSON.parse);
  for (const version of [1, 2]) {
    const reply = replies.find(({ id }) => id === 10 + version);
    assert.deepEqual(reply.result.fields.map(({ value }) => value), [String(version), "Passed", "Passed", "Passed"],
      reply.result.description);
    assert.equal(new URL(reply.result.code).searchParams.get("version"), String(version));
  }
});
