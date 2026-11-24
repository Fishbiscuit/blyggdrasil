// Blyggdrasil 0.1 ingest (SPEC.md §8.1). Node only. Deterministic: the same input
// writes the same files. Public or private comes only from the export's own fields.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

const atToWeb = (uri) => {
  const m = String(uri || "").match(/^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/]+)$/);
  return m ? `https://bsky.app/profile/${m[1]}/post/${m[2]}` : null;
};

// Public posts by one Bluesky account, through the public API. Everything it serves is public.
export async function ingestBluesky(actor, outDir, get) {
  const counts = { public: 0, private: 0 };
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
        write(outDir, { network: "bluesky", id: `repost-${rkey}`, url: atToWeb(p.uri), created: iso(item.reason.indexedAt), kind: "repost", visibility: "public", text: "" }, counts);
        continue;
      }
      if (p.author?.did !== did) continue;
      const parent = atToWeb(p.record?.reply?.parent?.uri);
      write(outDir, {
        network: "bluesky", id: rkey, url: atToWeb(p.uri), created: iso(p.record?.createdAt || p.indexedAt),
        kind: parent ? "reply" : "post", visibility: "public", reply_to: parent, text: p.record?.text || "",
      }, counts);
    }
    cursor = r.json.cursor;
    if (!cursor) break;
  }
  return counts;
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

export function ingestXArchive(dir, outDir) {
  const counts = { public: 0, private: 0 };
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
  for (const { tweet: t } of ytd(dir, "tweets")) write(outDir, tweet(t, protectedNow ? "private" : "public"), counts);
  for (const { tweet: t } of ytd(dir, "deleted-tweets")) write(outDir, tweet(t, "private"), counts);
  for (const { like } of ytd(dir, "like")) if (like?.tweetId) write(outDir, { network: "x", id: `like-${like.tweetId}`, url: like.expandedUrl || `https://x.com/i/status/${like.tweetId}`, created: "1970-01-01T00:00:00Z", kind: "like", visibility: "private", text: "" }, counts);
  for (const { dmConversation } of ytd(dir, "direct-messages")) {
    for (const m of dmConversation?.messages || []) {
      const d = m.messageCreate;
      if (d?.id) write(outDir, { network: "x", id: `dm-${d.id}`, url: `https://x.com/messages/${dmConversation.conversationId}`, created: iso(d.createdAt), kind: "dm", visibility: "private", text: d.text || "" }, counts);
    }
  }
  return counts;
}
