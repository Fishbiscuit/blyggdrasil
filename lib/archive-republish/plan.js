import { createHmac } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { publicIdentity } from "../ingest.js";

const networks = { x: "X", bluesky: "Bluesky" };
const alphabet = "0123456789abcdefghjkmnpqrstvwxyz";
const utcTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

export function isArchiveTimestamp(value) {
  return typeof value === "string" && utcTimestamp.test(value) && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString().replace(".000Z", "Z") === value;
}

function destination(value) {
  const url = URL.canParse(value) ? new URL(value) : null;
  if (!url || url.protocol !== "https:" || url.username || url.password || /[?#]/.test(url.href)
      || !url.pathname.endsWith("/")) {
    throw new Error("The destination must be an HTTPS blyg origin ending in / with no credentials, query or fragment.");
  }
  return url.href;
}

function isDirectory(path) {
  return lstatSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false;
}

function source(network, value) {
  const identity = publicIdentity(network, value);
  if (!identity) throw new Error(`Invalid ${networks[network]} post address.`);
  const target = identity.slice(network.length + 1);
  if (network === "x") return { identity, url: `https://x.com/i/web/status/${target}` };
  const slash = target.lastIndexOf("/");
  return { identity, url: `https://bsky.app/profile/${target.slice(0, slash)}/post/${target.slice(slash + 1)}` };
}

function stableId(seed, origin, identity) {
  const hash = createHmac("sha256", seed)
    .update("blyggdrasil:archive-id:v1\0").update(origin).update("\0").update(identity)
    .digest().subarray(0, 16);
  let bits = BigInt(`0x${hash.toString("hex")}`);
  let id = "";
  for (let shift = 0; shift < 26; shift++) {
    id = alphabet[Number(bits & 31n)] + id;
    bits >>= 5n;
  }
  return id;
}

function parseArchiveFile(file, network, year) {
  const text = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  const header = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
  if (!header) throw new Error("An archive item is missing its metadata.");
  const fields = new Map();
  for (const line of header[1].split("\n")) {
    const match = /^([a-z_]+):[ \t]*(.*)$/.exec(line);
    if (!match || fields.has(match[1])) throw new Error("An archive item has malformed or repeated metadata.");
    fields.set(match[1], match[2].trim());
  }
  if (fields.get("visibility") !== "public" || !["post", "reply"].includes(fields.get("kind"))) return null;
  const created = fields.get("created");
  if (fields.get("network") !== network || !isArchiveTimestamp(created) || created.slice(0, 4) !== year) {
    throw new Error("A public archive item’s network or date does not match its archive folder.");
  }
  const { identity, url } = source(network, fields.get("url"));
  const replyTo = fields.get("kind") === "reply" ? source(network, fields.get("reply_to")).url : null;
  const body = text.slice(header[0].length).trim().normalize("NFC");
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff\p{Surrogate}]/u.test(body)) {
    throw new Error("A public archive item's text contains unsupported characters.");
  }
  return { identity, url, replyTo, body, created, network };
}

export function planArchiveRepublish(archive, { origin: input, seed }) {
  const origin = destination(input);
  if (!(seed instanceof Uint8Array) || seed.length !== 32) {
    throw new Error("Use a private import seed file containing 32 cryptographically random bytes.");
  }
  const publicDir = join(realpathSync(archive), "public");
  if (!isDirectory(publicDir)) throw new Error("The archive has no regular public directory.");

  const sources = new Map();
  let duplicates = 0;
  for (const network of Object.keys(networks)) {
    const networkDir = join(publicDir, network);
    if (!isDirectory(networkDir)) continue;
    for (const year of readdirSync(networkDir, { withFileTypes: true })) {
      if (!year.isDirectory() || !/^\d{4}$/.test(year.name)) continue;
      const yearDir = join(networkDir, year.name);
      for (const file of readdirSync(yearDir, { withFileTypes: true })) {
        if (!file.isFile() || !file.name.endsWith(".md")) continue;
        const post = parseArchiveFile(join(yearDir, file.name), network, year.name);
        if (!post) continue;
        const previous = sources.get(post.identity);
        if (!previous) sources.set(post.identity, post);
        else if (JSON.stringify(previous) === JSON.stringify(post)) duplicates++;
        else throw new Error(`Conflicting public archive entries for ${post.url}.`);
      }
    }
  }

  const items = [...sources.values()]
    .sort((a, b) => a.created.localeCompare(b.created) || a.identity.localeCompare(b.identity))
    .map((post) => {
      const id = stableId(seed, origin, post.identity);
      const link = `[Original post on ${networks[post.network]}](${post.url})`;
      return {
        id, kind: post.replyTo ? "thread" : "fragment", created: post.created, version: 1,
        content_md: post.body ? `${post.body}\n\n${link}` : link,
        syndication: [{ url: post.url, version: 1 }],
        ...(post.replyTo ? { stub_of: { url: post.replyTo } } : {}),
        itemUrl: new URL(`items/${id}.json`, origin).href,
      };
    });
  return { origin, items, duplicates };
}
