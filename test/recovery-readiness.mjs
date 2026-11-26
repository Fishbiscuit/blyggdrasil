import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";
import {
  generateKey, importKeyFile, itemUrl, pinUrl, serializeClaims, signClaims, treeMarkdown,
} from "../lib/blyggdrasil.js";
import { checkRecoveryReadiness } from "../lib/recovery-readiness.js";

const id = "01jpcyy4qaaaek03ptm4c5g1c3";
const origin = "https://readiness.example/blyg/";
const manifest = {
  blyg: "0.4", blyggdrasil: `t/${id}/`, item: "posts/{id}/head.json", pin: "pinned/{id}/{n}.json",
};
const manifestUrl = new URL("blyg.json", origin).href;
const current = itemUrl(origin, manifest, id);
const prior = pinUrl(origin, manifest, id, 1);
const cli = fileURLToPath(new URL("../bin/recovery-readiness.mjs", import.meta.url));
const run = promisify(execFile);

async function fixture() {
  const [main, recovery, rotated] = await Promise.all(["owner", "offline", "replacement"]
    .map(async (label) => importKeyFile(await generateKey(label))));
  const signed = async (version, key, claims = {}, cosigners = []) => {
    const payload = serializeClaims({ trunk: origin, key: key.did, recovery: [recovery.did], ...claims });
    return { id, origin, kind: "thread", version, content_md: treeMarkdown(payload, await signClaims(payload, [key, ...cosigners])) };
  };
  const tree = await signed(2, main, { branches: ["https://profiles.example/profile"] });
  const pin = { ...await signed(1, main), pinned: true };
  const docs = new Map([[manifestUrl, manifest], [current, tree], [prior, pin]]);
  const get = async (url) => ({ ok: docs.has(url), status: docs.has(url) ? 200 : 404, url, json: docs.get(url) });
  return { main, recovery, rotated, signed, docs, get, pin };
}

test("an older verified pin can protect the still-current main key", async () => {
  const { get, main, recovery } = await fixture();
  const report = await checkRecoveryReadiness(origin, get, { version: 1, recoveryKey: recovery.did });
  assert.equal(report.status, "ready");
  assert.equal(report.origin, origin);
  assert.equal(report.treeId, id);
  assert.equal(report.currentVersion, 2);
  assert.equal(report.currentKey, main.did);
  assert.equal(report.pinUrl, prior);
  assert.deepEqual(report.recoveryKeys, [recovery.did]);
});

test("a verified pin of the previous main key is stale after a rotation", async () => {
  const { get, main, rotated, signed, docs } = await fixture();
  docs.set(current, await signed(2, rotated, { previous: main.did }, [main]));
  const report = await checkRecoveryReadiness(origin, get, { version: 1 });
  assert.equal(report.status, "stale-pin");
  assert.equal(report.currentKey, rotated.did);
  assert.deepEqual(report.recoveryKeys, []);
});

test("a selected or retired recovery key must be configured on both trees", async () => {
  const { get, main, recovery, rotated, signed, docs } = await fixture();
  const selected = await checkRecoveryReadiness(origin, get, { version: 1, recoveryKey: rotated.did });
  assert.equal(selected.status, "missing-recovery-key");
  docs.set(current, await signed(2, main, { recovery: [] }));
  assert.equal((await checkRecoveryReadiness(origin, get, { version: 1, recoveryKey: recovery.did })).status, "missing-recovery-key");
  assert.equal((await checkRecoveryReadiness(origin, get, { version: 1 })).status, "missing-recovery-key");
});

test("the pin requires its own exact version, identity, pinned marker, and valid signature", async () => {
  const { get, docs, pin } = await fixture();
  const check = () => checkRecoveryReadiness(origin, get, { version: 1 });
  for (const changed of [
    { pinned: false }, { version: 2 }, { origin: "https://elsewhere.example/blyg/" },
    { id: "01jpcyy4qaaaek03ptm4c5g1c2" }, { kind: "withdrawn" }, { content_md: "Changed tree text" },
  ]) {
    docs.set(prior, { ...pin, ...changed });
    assert.equal((await check()).status, "invalid-pin");
  }
  docs.delete(prior);
  assert.equal((await check()).status, "unpinned");
  const errorFetch = (url) => url === prior ? { ok: false, status: 503, url } : get(url);
  assert.equal((await checkRecoveryReadiness(origin, errorFetch, { version: 1 })).status, "unavailable");
});

test("a recovered current tree still needs an authentic earlier recovery record", async () => {
  const { get, docs, pin, signed, main, rotated, recovery } = await fixture();
  docs.set(current, await signed(2, rotated, { previous: main.did, recoveredFrom: 1 }, [recovery]));
  assert.equal((await checkRecoveryReadiness(origin, get, { version: 1 })).status, "stale-pin");
  docs.set(prior, { ...pin, pinned: false });
  assert.equal((await checkRecoveryReadiness(origin, get, { version: 1 })).status, "invalid-tree");
  docs.delete(prior);
  assert.equal((await checkRecoveryReadiness(origin, get, { version: 1 })).status, "unavailable");
});

test("recovery-readiness CLI reports JSON and exit codes at its normal entry point", async () => {
  const { docs, recovery } = await fixture();
  const preload = `data:text/javascript,${encodeURIComponent(`
    const documents = new Map(JSON.parse(process.env.BLYGGDRASIL_READINESS_DOCUMENTS));
    globalThis.fetch = async (url) => new Response(JSON.stringify(documents.get(url) ?? {}), {
      status: documents.has(url) ? 200 : 404,
      headers: { "content-type": "application/json" },
    });
  `)}`;
  const inspect = (...args) => run(process.execPath, ["--import", preload, cli, origin, ...args], {
    env: { ...process.env, BLYGGDRASIL_READINESS_DOCUMENTS: JSON.stringify([...docs]) },
  });
  const good = await inspect("--version", "1", "--recovery-key", recovery.did, "--json");
  assert.equal(JSON.parse(good.stdout).status, "ready");
  assert.deepEqual(JSON.parse(good.stdout).recoveryKeys, [recovery.did]);
  docs.delete(prior);
  await assert.rejects(inspect("--version", "1", "--json"),
    (error) => error.code === 1 && JSON.parse(error.stdout).status === "unpinned");
  await assert.rejects(inspect("--version", "1", "--recovery-key", "/tmp/key.json"),
    (error) => error.code === 2 && /Ed25519 did:key/.test(error.stderr));
});
