import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ingestXArchive, previewBluesky, previewXArchive } from "../lib/ingest.js";

function xExport(t) {
  const archive = mkdtempSync(join(tmpdir(), "blyggdrasil-preview-"));
  t.after(() => rmSync(archive, { force: true, recursive: true }));
  mkdirSync(join(archive, "data"));
  const writeExport = (name, value) => writeFileSync(join(archive, "data", `${name}.js`),
    `window.YTD.${name}.part0 = ${JSON.stringify(value)}`);
  writeExport("account", [{ account: { username: "first_name" } }]);
  return { archive, writeExport };
}

function tweet(id, createdAt, fields = {}) {
  return { tweet: { id_str: id, created_at: createdAt, full_text: "Workshop test post", ...fields } };
}

test("X preview reports repeated and previously archived public posts without writing files", (t) => {
  const { archive, writeExport } = xExport(t);
  const target = join(archive, "existing");
  const old = tweet("123", "2025-12-31T15:00:00Z");
  writeExport("tweets", [old]);
  assert.deepEqual(ingestXArchive(archive, target), { public: 1, private: 0 });
  const originalFile = join(target, "public", "x", "2025", "20251231-150000-123.md");
  const original = readFileSync(originalFile, "utf8");

  const current = tweet("123", "2026-01-01T15:00:00Z");
  writeExport("account", [{ account: { username: "new_name" } }]);
  writeExport("tweets", [current, current, tweet("456", "2026-01-02T15:00:00Z", { in_reply_to_status_id_str: "333" })]);
  writeExport("deleted-tweets", [tweet("777", "2026-01-03T15:00:00Z", { full_text: "DELETED_PRIVATE_MARKER" })]);
  writeExport("like", [{ like: { tweetId: "888", expandedUrl: "https://x.com/another_private_marker/status/888" } }]);
  writeExport("direct-messages", [{ dmConversation: {
    conversationId: "dm-private-marker",
    messages: [{ messageCreate: { id: "999", createdAt: "2026-01-05T15:00:00Z", text: "DM_PRIVATE_MARKER" } }],
  } }]);

  const found = previewXArchive(archive, target);
  const archived = { url: "https://x.com/new_name/status/123", created: "2026-01-01T15:00:00Z", kind: "post", duplicateInInput: false, alreadyArchived: true };
  assert.deepEqual(found, {
    public: 3, private: 3, duplicates: 2, entries: [
      archived,
      { ...archived, duplicateInInput: true },
      { url: "https://x.com/new_name/status/456", created: "2026-01-02T15:00:00Z", kind: "reply", duplicateInInput: false, alreadyArchived: false },
    ],
  });
  assert.doesNotMatch(JSON.stringify(found), /private.marker|\/status\/777|\/status\/888|\/messages\//i);
  assert.equal(readFileSync(originalFile, "utf8"), original);
  assert.equal(existsSync(join(target, "public", "x", "2026")), false);
  assert.equal(existsSync(join(target, "private")), false);

  const missingTarget = join(archive, "not-created");
  assert.equal(previewXArchive(archive, missingTarget).duplicates, 1);
  assert.equal(existsSync(missingTarget), false);
});

test("X preview counts protected posts without revealing any per-post data", (t) => {
  const { archive, writeExport } = xExport(t);
  writeExport("protected-history", [{ protectedHistory: { action: "Protect", createdAt: "2026-01-01T00:00:00Z" } }]);
  writeExport("tweets", [tweet("123", "2026-01-02T15:00:00Z")]);
  assert.deepEqual(previewXArchive(archive), { public: 0, private: 1, duplicates: 0, entries: [] });
});

test("X preview errors omit snippets from malformed private data", (t) => {
  const { archive } = xExport(t);
  writeFileSync(join(archive, "data", "direct-messages.js"), "window.YTD.direct-messages.part0 = INVALID_PRIVATE_MARKER");
  assert.throws(() => previewXArchive(archive), (err) => {
    assert.match(err.message, /Could not read the X archive/);
    assert.doesNotMatch(err.message, /INVALID_PRIVATE_MARKER/);
    return true;
  });
});

test("the ingest CLI previews an X export without requiring or writing an output directory", (t) => {
  const { archive, writeExport } = xExport(t);
  writeExport("tweets", [tweet("101", "2026-01-02T15:00:00Z"), tweet("101", "2026-01-02T15:00:00Z")]);
  writeExport("deleted-tweets", [tweet("900", "2026-01-03T14:00:00Z", { full_text: "CLI_PRIVATE_MARKER" })]);
  const cli = fileURLToPath(new URL("../bin/blyggdrasil.mjs", import.meta.url));
  const flags = [cli, "ingest", "x", archive, "--preview", "--json"];
  const expected = previewXArchive(archive);
  const result = spawnSync(process.execPath, flags, { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), expected);
  assert.doesNotMatch(result.stdout + result.stderr, /CLI_PRIVATE_MARKER|\/status\/900/);

  const out = join(archive, "dry-run");
  const withOutput = spawnSync(process.execPath, [...flags, "--out", out], { encoding: "utf8" });
  assert.equal(withOutput.status, 0, withOutput.stderr);
  assert.deepEqual(JSON.parse(withOutput.stdout), expected);
  assert.equal(existsSync(out), false);

  writeExport("tweets", [tweet("101", "2026-01-02T15:00:00Z")]);
  const saved = spawnSync(process.execPath, [cli, "ingest", "x", archive, "--out", out], { encoding: "utf8" });
  assert.equal(saved.status, 0, saved.stderr);
  assert.match(saved.stdout, /Wrote 1 public and 1 private archive files/);
  const post = join(out, "public", "x", "2026", "20260102-150000-101.md");
  const original = readFileSync(post, "utf8");

  writeExport("tweets", [tweet("101", "2026-01-02T15:00:00Z"), tweet("101", "2026-01-02T15:00:00Z")]);
  const human = spawnSync(process.execPath, [cli, "ingest", "x", archive, "--preview", "--out", out], { encoding: "utf8" });
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, /2 public, 1 private, 2 duplicate\. No files written\./);
  assert.match(human.stdout, /2026-01-02T15:00:00Z  post  https:\/\/x\.com\/first_name\/status\/101  \(repeated in source, already archived\)/);
  assert.doesNotMatch(human.stdout + human.stderr, /CLI_PRIVATE_MARKER|\/status\/900/);
  assert.equal(readFileSync(post, "utf8"), original);
});

test("Bluesky preview uses the same paginated public feed parsing, reports duplicate sources and ignores other authors", async () => {
  const did = "did:web:owner.example%3A8443:profile";
  const post = {
    uri: `at://${did}/app.bsky.feed.post/abc`,
    record: { createdAt: "2026-01-02T15:00:00Z", text: "public text stays out of report" },
    author: { did },
  };
  const get = async (input) => {
    const url = new URL(input);
    if (url.pathname.endsWith("getProfile")) return { ok: true, json: { did } };
    assert.equal(url.searchParams.get("actor"), did);
    return url.searchParams.get("cursor") === "next"
      ? { ok: true, json: { feed: [{ post }, { post: { ...post, author: { did: "did:plc:other" } } }] } }
      : { ok: true, json: { feed: [{ post }], cursor: "next" } };
  };

  const result = await previewBluesky("owner.example", undefined, get);
  const first = { url: `https://bsky.app/profile/${did}/post/abc`, created: "2026-01-02T15:00:00Z", kind: "post", duplicateInInput: false, alreadyArchived: false };
  assert.deepEqual(result, {
    public: 2, private: 0, duplicates: 1, entries: [first, { ...first, duplicateInInput: true }],
  });
});
