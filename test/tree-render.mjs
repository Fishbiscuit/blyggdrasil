import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const renderer = fileURLToPath(new URL("../bin/render-tree.mjs", import.meta.url));
const origin = "https://publisher.example/blyg/";
const id = "7phxkgdpcecwvxa8xwbfwtq3pm";
const privateId = "493a5689hjzha73vv1da4ptqd6";
const withdrawnId = "6vsdv1zde6a1c8fg830rgtn4sg";

test("renderer creates a script-independent public tree without private or withdrawn content", () => {
  const root = mkdtempSync(join(tmpdir(), "blyggdrasil-render-"));
  try {
    const mirror = join(root, "public");
    const out = join(root, "tree", "publisher", "index.html");
    mkdirSync(join(mirror, "items"), { recursive: true });
    const write = (path, json) => writeFileSync(join(mirror, path), JSON.stringify(json));
    write("blyg.json", {
      blyg: "0.4",
      title: 'Publisher <site>',
      items: "items/index.json?scope=public&format=json",
      author: { links: [
        { url: "https://github.com/publisher", label: "GitHub" },
        { url: "javascript:alert(1)", label: "Invalid" },
      ] },
    });
    write("items/index.json", { items: [
      { id }, { id: privateId }, { id: withdrawnId, kind: "withdrawn" },
    ] });
    write(`items/${id}.json`, {
      id, origin, kind: "thread", version: 2, created: "2026-11-26T13:00:00Z",
      page: `t/${id}/`,
      content_md: "A <title>\n\nA public post. \nNext line.\n\n[Original post by @publisher](https://x.com/publisher/status/12345).",
    });
    write(`items/${privateId}.json`, {
      id: privateId, origin, kind: "thread", visibility: "private", content_md: "Private marker",
    });
    write(`items/${withdrawnId}.json`, {
      id: withdrawnId, origin, kind: "withdrawn", content_md: "Withdrawn marker",
    });
    const run = spawnSync(process.execPath, [renderer, origin, "--mirror", mirror, "--out", out], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /Rendered 1 posts and 1 accounts/);
    const html = readFileSync(out, "utf8");
    assert.match(html, /<h1 id="title">Publisher &lt;site&gt;<\/h1>/);
    assert.match(html, /id="profile">/);
    assert.match(html, /<article>/);
    assert.match(html, /<time datetime="2026-11-26">/);
    assert.match(html, /<link rel="blyg" href="https:\/\/publisher\.example\/blyg\/blyg\.json" type="application\/json">/);
    assert.match(html, /<link rel="archives" href="https:\/\/publisher\.example\/blyg\/items\/index\.json\?scope=public&amp;format=json" type="application\/json">/);
    assert.match(html, new RegExp(`items/${id}\\.json`));
    assert.match(html, /View on X/);
    assert.match(html, /A public post\.\nNext line\./);
    assert.match(html, /github\.com\/publisher/);
    assert.match(html, /src="\.\.\/\.\.\/assets\/tree\.js"/);
    assert.doesNotMatch(html, /Private marker|Withdrawn marker|javascript:|class="signed"/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
