import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { archiveSetup, oldDate, origin } from "./republish-archive-fixture.mjs";

const run = (args) => spawnSync(process.execPath, args, { encoding: "utf8" });

test("republishing previews public posts and replies with stable destination URLs without writing", (t) => {
  const f = archiveSetup(t);
  f.put("story");
  f.put("alias", { url: "https://twitter.com/renamed/status/123?s=19" });
  f.put("reply", {
    network: "bluesky", url: "https://bsky.app/profile/river.example/post/abc",
    kind: "reply", reply_to: "https://bsky.app/profile/park.example/post/xyz", text: "A reply",
  });
  const privatePath = f.put("private", { text: "PRIVATE_FOLDER_MARKER" }, "private");
  f.put("protected", { visibility: "private", text: "PROTECTED_MARKER" });
  f.put("liked", { kind: "like", text: "LIKED_MARKER" });
  symlinkSync(privatePath, join(f.archive, "public", "x", "2025", "linked-private.md"));
  const before = readdirSync(f.workspace, { recursive: true }).sort();

  const first = run(f.args);
  assert.equal(first.status, 0, first.stderr);
  assert.doesNotMatch(first.stdout + first.stderr, /PRIVATE_FOLDER_MARKER|PROTECTED_MARKER|LIKED_MARKER/);
  const plan = JSON.parse(first.stdout);
  assert.equal(plan.duplicates, 1);
  assert.equal(plan.items.length, 2);
  const [reply, post] = plan.items;
  assert.deepEqual(reply.stub_of, { url: "https://bsky.app/profile/park.example/post/xyz" });
  assert.equal(reply.kind, "thread");
  assert.deepEqual(post.syndication, [{ url: "https://x.com/i/web/status/123", version: 1 }]);
  assert.equal(post.created, oldDate);
  assert.match(post.content_md, /An archive story\n\n\[Original post on X\]/);
  assert.match(post.id, /^[0-7][0-9abcdefghjkmnpqrstvwxyz]{25}$/);
  assert.equal(post.itemUrl, `${origin}items/${post.id}.json`);
  assert.equal(run(f.args).stdout, first.stdout);
  assert.deepEqual(readdirSync(f.workspace, { recursive: true }).sort(), before);
});

test("republishing rejects conflicting public copies and malformed destinations", (t) => {
  const f = archiveSetup(t);
  f.put("story");
  f.put("conflict", { text: "Different contents" });
  const conflict = run(f.args);
  assert.equal(conflict.status, 1);
  assert.match(conflict.stderr, /Conflicting public archive entries/);
  const other = run(f.args.map((value) => value === origin ? "https://publisher.example/blyg/?query" : value));
  assert.equal(other.status, 1);
  assert.match(other.stderr, /destination must be an HTTPS blyg origin/);
});
