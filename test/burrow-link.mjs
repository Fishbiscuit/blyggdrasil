import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const extension = fileURLToPath(new URL("../integrations/burrow/main.mjs", import.meta.url));
const id = "1hk3fv43xwpgckk19k4wf3v9ts";

test("Burrow subprocess copies the selected public edition and shuts down cleanly", async () => {
  const child = spawn(process.execPath, [extension], { stdio: ["pipe", "pipe", "pipe"] });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (data) => { stdout += data; });
  child.stderr.on("data", (data) => { stderr += data; });

  const action = (id, entry) => ({
    jsonrpc: "2.0", id, method: "extension/entry.action",
    params: { action: "copy-proof-link", entry },
  });
  child.stdin.end([
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 1 } },
    { jsonrpc: "2.0", method: "burrow/settingsChanged", params: {} },
    action("selected", { origin: "https://sample.example/my/blyg", remoteId: id, version: 3 }),
    action("invalid", { origin: "https://example.com", remoteId: id, version: 0 }),
    action("secret", { origin: "https://a:b@example.com/blyg", remoteId: id, version: 3 }),
    { jsonrpc: "2.0", id: 4, method: "shutdown" },
  ].map((request) => JSON.stringify(request)).join("\n") + "\n");

  assert.deepEqual(await once(child, "close"), [0, null], stderr);
  assert.equal(stderr, "");
  const [initialized, selected, invalid, secret, shutdown] = stdout.trim().split("\n").map(JSON.parse);
  assert.equal(initialized.result.protocolVersion, 1);
  assert.equal(selected.id, "selected");
  const url = new URL(selected.result.code);
  assert.equal(url.origin + url.pathname, "https://fishbiscuit.me/blyggdrasil/verify/");
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    origin: "https://sample.example/my/blyg/", id, version: "3",
  });
  assert.equal(invalid.error.code, -32602);
  assert.equal(secret.error.code, -32602);
  assert.deepEqual(shutdown, { jsonrpc: "2.0", id: 4, result: null });
});
