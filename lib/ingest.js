// Blyggdrasil 0.1 ingest (SPEC.md §8.1). Node only. Deterministic: the same input
// writes the same files. Public or private comes only from the export's own fields.

import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const iso = (d) => new Date(d).toISOString().replace(/\.\d{3}Z$/, "Z");
const stamp = (created) => created.replace(/[-:]/g, "").replace("T", "-").replace("Z", "");

export function archiveFile(entry) {
  const fm = ["---", `network: ${entry.network}`, `url: ${entry.url}`, `created: ${entry.created}`, `kind: ${entry.kind}`, `visibility: ${entry.visibility}`, `reply_to: ${entry.reply_to || ""}`, "---", ""];
  return fm.join("\n") + "\n" + (entry.text || "").replace(/\r\n/g, "\n").trim() + "\n";
}

function write(outDir, entry, counts) {
  const dir = join(outDir, entry.visibility, entry.network, entry.created.slice(0, 4));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${stamp(entry.created)}-${entry.id}.md`), archiveFile(entry));
  counts[entry.visibility]++;
}

// Archive filenames depend on the original date. Use the source identity to also
// find duplicates whose timestamp or X username changed between exports.
export function publicIdentity(network, address) {
  let url;
  try {
    url = new URL(address);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  if (network === "x" && /^(?:www\.)?(?:x|twitter)\.com$/.test(url.hostname)) {
    const match = url.pathname.match(/^\/(?:[\w]+\/status\/|i\/web\/status\/)(\d+)\/?$/);
    return match ? `x:${match[1]}` : null;
  }
  if (network === "bluesky" && url.hostname === "bsky.app") {
    const match = url.pathname.match(/^\/profile\/((?:[\w.:-]|%[\da-fA-F]{2})+)\/post\/([\w.-]+)\/?$/);
    if (!match) return null;
    const actor = match[1].startsWith("did:") ? match[1] : match[1].toLowerCase();
    return `bluesky:${actor}/${match[2]}`;
  }
  return null;
}

function existingPublicIdentities(outDir, network) {
  const sources = new Set();
  if (!outDir) return sources;
  const publicDir = join(outDir, "public");
  const networkDir = join(publicDir, network);
  if (!lstatSync(publicDir, { throwIfNoEntry: false })?.isDirectory()
      || !lstatSync(networkDir, { throwIfNoEntry: false })?.isDirectory()) return sources;
  for (const year of readdirSync(networkDir, { withFileTypes: true })) {
    if (!year.isDirectory() || !/^\d{4}$/.test(year.name)) continue;
    const dir = join(networkDir, year.name);
    for (const file of readdirSync(dir, { withFileTypes: true })) {
      if (!file.isFile() || !file.name.endsWith(".md")) continue;
      const text = readFileSync(join(dir, file.name), "utf8");
      const fields = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/)?.[1];
      if (!fields || !/^visibility: public\r?$/m.test(fields)) continue;
      const address = fields.match(/^url: (\S+)\r?$/m)?.[1];
      const identity = publicIdentity(network, address);
      if (identity) sources.add(identity);
    }
  }
  return sources;
}

function archivePreview(outDir, network) {
  const existing = existingPublicIdentities(outDir, network);
  const seen = new Set();
  const report = { public: 0, private: 0, duplicates: 0, entries: [] };
  const add = (entry) => {
    report[entry.visibility]++;
    if (entry.visibility !== "public") return;
    const identity = publicIdentity(network, entry.url);
    const duplicateInInput = identity !== null && seen.has(identity);
    const alreadyArchived = identity !== null && existing.has(identity);
    if (identity) seen.add(identity);
    if (duplicateInInput || alreadyArchived) report.duplicates++;
    report.entries.push({
      url: identity ? entry.url : null,
      created: entry.created,
      kind: entry.kind,
      duplicateInInput,
      alreadyArchived,
    });
  };
  return { report, add };
}

const atToWeb = (uri) => {
  const m = String(uri || "").match(/^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/]+)$/);
  return m ? `https://bsky.app/profile/${m[1]}/post/${m[2]}` : null;
};

// Public posts by one Bluesky account, through the public API. Everything it serves is public.
async function visitBluesky(actor, get, visit) {
  const profile = await get(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(actor)}`);
  if (!profile.ok) throw new Error(`Bluesky profile ${actor}: ${profile.status || profile.error}`);
  const did = profile.json.did;
  let cursor = "";
  for (let page = 0; page < 50; page++) {
    const r = await get(`https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(did)}&filter=posts_with_replies&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    if (!r.ok) throw new Error(`Bluesky feed: ${r.status || r.error}`);
    for (const item of r.json.feed || []) {
      const p = item.post;
      const rkey = String(p.uri).split("/").pop();
      if (item.reason?.$type === "app.bsky.feed.defs#reasonRepost") {
        visit({ network: "bluesky", id: `repost-${rkey}`, url: atToWeb(p.uri), created: iso(item.reason.indexedAt), kind: "repost", visibility: "public", text: "" });
        continue;
      }
      if (p.author?.did !== did) continue;
      const parent = atToWeb(p.record?.reply?.parent?.uri);
      visit({
        network: "bluesky", id: rkey, url: atToWeb(p.uri), created: iso(p.record?.createdAt || p.indexedAt),
        kind: parent ? "reply" : "post", visibility: "public", reply_to: parent, text: p.record?.text || "",
      });
    }
    cursor = r.json.cursor;
    if (!cursor) break;
  }
}

export async function ingestBluesky(actor, outDir, get) {
  const counts = { public: 0, private: 0 };
  await visitBluesky(actor, get, (entry) => write(outDir, entry, counts));
  return counts;
}

export async function previewBluesky(actor, outDir, get) {
  const { report, add } = archivePreview(outDir, "bluesky");
  await visitBluesky(actor, get, add);
  return report;
}

// The window.YTD.<name>.part0 = [...] files in an X archive download.
function ytd(dir, name) {
  const p = join(dir, "data", `${name}.js`);
  if (!existsSync(p)) return [];
  const text = readFileSync(p, "utf8");
  return JSON.parse(text.slice(text.indexOf("=") + 1).trim().replace(/;$/, ""));
}

function expand(t) {
  let text = t.full_text || t.text || "";
  for (const u of t.entities?.urls || []) if (u.url && u.expanded_url) text = text.split(u.url).join(u.expanded_url);
  for (const m of t.entities?.media || []) if (m.url) text = text.split(m.url).join("").trim();
  return text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function visitXArchive(dir, visit) {
  const account = ytd(dir, "account")[0]?.account;
  if (!account?.username) throw new Error("not an X archive: data/account.js is missing");
  const user = account.username;
  const protectedNow = ytd(dir, "protected-history").map((x) => x.protectedHistory).filter(Boolean).sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1)).at(-1)?.action === "Protect";
  const tweet = (t, visibility) => {
    const isRepost = /^RT @/.test(t.full_text || "");
    const reply = t.in_reply_to_status_id_str ? `https://x.com/${t.in_reply_to_screen_name || "i"}/status/${t.in_reply_to_status_id_str}` : null;
    const rt = isRepost ? (t.entities?.user_mentions?.[0]?.screen_name || "i") : null;
    return {
      network: "x", id: t.id_str, url: `https://x.com/${user}/status/${t.id_str}`, created: iso(t.created_at),
      kind: isRepost ? "repost" : reply ? "reply" : "post", visibility, reply_to: reply, text: isRepost ? `Repost of a post by @${rt}` : expand(t),
    };
  };
  for (const { tweet: t } of ytd(dir, "tweets")) visit(tweet(t, protectedNow ? "private" : "public"));
  for (const { tweet: t } of ytd(dir, "deleted-tweets")) visit(tweet(t, "private"));
  for (const { like } of ytd(dir, "like")) if (like?.tweetId) visit({ network: "x", id: `like-${like.tweetId}`, url: like.expandedUrl || `https://x.com/i/status/${like.tweetId}`, created: "1970-01-01T00:00:00Z", kind: "like", visibility: "private", text: "" });
  for (const { dmConversation } of ytd(dir, "direct-messages")) {
    for (const m of dmConversation?.messages || []) {
      const d = m.messageCreate;
      if (d?.id) visit({ network: "x", id: `dm-${d.id}`, url: `https://x.com/messages/${dmConversation.conversationId}`, created: iso(d.createdAt), kind: "dm", visibility: "private", text: d.text || "" });
    }
  }
}

export function ingestXArchive(dir, outDir) {
  const counts = { public: 0, private: 0 };
  visitXArchive(dir, (entry) => write(outDir, entry, counts));
  return counts;
}

export function previewXArchive(dir, outDir) {
  const { report, add } = archivePreview(outDir, "x");
  try {
    visitXArchive(dir, add);
  } catch {
    // Parser errors can include snippets from private records.
    throw new Error("Could not read the X archive export. Check that it contains a data/account.js file and valid export data.");
  }
  return report;
}
