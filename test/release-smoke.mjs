import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { generateKey, importKeyFile, serializeClaims, signClaims, treeMarkdown } from "../lib/blyggdrasil.js";
import { checkRelease } from "../scripts/release/smoke.mjs";

const cli = fileURLToPath(new URL("../bin/release-smoke.mjs", import.meta.url));
const invoke = promisify(execFile);
const origin = "https://fishbiscuit.me";
const mirror = "https://stage.example";
const demoPrefix = "/blyggdrasil/demo/edit-and-pin/blyg/";
const item = "1hk3fv43xwpgckk19k4wf3v9ts";
const treeItem = "7p4qap9qgjkaa0yxv1dcae6rx3";

async function readOnlySite({ breakCheck, requests = [] } = {}) {
  const treeAddress = `${origin}/blyg/`;
  const key = await importKeyFile(await generateKey("release-smoke-test"));
  const claims = serializeClaims({ trunk: treeAddress, key: key.did });
  const treeContent = treeMarkdown(claims, await signClaims(claims, [key]));
  // Demo responses come from the same signed files served by the public demo.
  const files = new Map();
  for (const path of ["blyg.json", `items/${treeItem}.json`, `items/${item}.json`, `items/${item}/v1.json`]) {
    const bytes = await readFile(new URL(`../demo/edit-and-pin/blyg/${path}`, import.meta.url), "utf8");
    files.set(`${demoPrefix}${path}`, bytes);
  }
  files.set("/blyggdrasil/tree/fishbiscuit/", `<body data-tree-address="${treeAddress}"><article>Post</article></body>`);
  files.set("/blyg/blyg.json", JSON.stringify({ blyg: "0.4", blyggdrasil: `t/${treeItem}/` }));
  files.set(`/blyg/items/${treeItem}.json`, JSON.stringify({ content_md: treeContent }));

  const current = `${demoPrefix}items/${item}.json`;
  if (breakCheck === "editing") {
    const item = JSON.parse(files.get(current));
    item.content_md += " Unverified change.";
    files.set(current, JSON.stringify(item));
  }
  if (breakCheck === "missing") files.set(`${demoPrefix}items/${item}/v3.json`, "{}");
  return async (url, options) => {
    const target = new URL(url);
    assert.equal(target.origin, mirror);
    assert.equal(options.credentials, "omit");
    assert.equal(options.redirect, "error");
    requests.push(target.pathname);
    const text = files.get(target.pathname);
    const status = text === undefined ? 404 : 200;
    return new Response(text ?? "", { status });
  };
}

test("release smoke checks canonical signed editions against an HTTPS mirror", async () => {
  const requests = [];
  const result = await checkRelease({ mirror, fetchImpl: await readOnlySite({ requests }) });
  assert.equal(result.checkedAt, mirror);
  assert.equal(result.passed, true);
  assert.equal(result.checks.length, 5);
  assert.deepEqual(result.checks.map(({ passed }) => passed), [true, true, true, true, true]);
  assert.ok(requests.includes(`${demoPrefix}items/${item}/v1.json`));
  assert.ok(requests.includes(`${demoPrefix}items/${item}.json`));
  assert.ok(requests.includes(`${demoPrefix}items/${item}/v3.json`));
});

test("release smoke fails separately for tampering and a published missing-pin URL", async () => {
  const edited = await checkRelease({ mirror, fetchImpl: await readOnlySite({ breakCheck: "editing" }) });
  assert.equal(edited.passed, false);
  assert.deepEqual(edited.checks.map(({ passed }) => passed), [true, true, true, false, true]);
  const unexpectedPin = await checkRelease({ mirror, fetchImpl: await readOnlySite({ breakCheck: "missing" }) });
  assert.equal(unexpectedPin.passed, false);
  assert.deepEqual(unexpectedPin.checks.map(({ passed }) => passed), [true, true, true, true, false]);
  assert.equal(unexpectedPin.checks.at(-1).status, 200);
});

test("the smoke CLI refuses a mirror that is not an HTTPS site origin", async () => {
  await assert.rejects(invoke(process.execPath, [cli, "--mirror", "http://stage.example"]), {
    stderr: /absolute HTTPS site origin/,
  });
  await assert.rejects(invoke(process.execPath, [cli, "--mirror", `${mirror}/another-route`]), {
    stderr: /with no route/,
  });
});
