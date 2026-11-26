import { claimedLinks, isHttpsUrl, verifyByline } from "./blyggdrasil.js";
import { branchLabel } from "../assets/labels.js";

const dateLabel = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const encoder = new TextEncoder();

export const escape = (value) => String(value ?? "").replace(/[&<>"]/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;",
})[character]);

export function safeUrl(value, origin) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value, origin).href;
    return isHttpsUrl(url) ? url : null;
  } catch {
    return null;
  }
}

export function xPost(url) {
  return typeof url === "string" && /^https:\/\/(?:www\.)?(?:x|twitter)\.com\/[\w]+\/status\/\d+(?:[/?#]|$)/i.test(url);
}

function plainText(markdown) {
  return markdown.replace(/```[\s\S]*?```/g, "")
    .replace(/!?\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/<https?:\/\/[^>]+>/g, "")
    .replace(/^#{1,6}\s+|^>\s?/gm, "")
    .replace(/[ \t]+\n/g, "\n").trim();
}

function previewHtml(markdown, origin) {
  markdown = markdown.replace(/([.!?])(?=@\w)/g, "$1 ");
  let html = "";
  let offset = 0;
  for (const match of markdown.matchAll(/!?\[([^\]]+)\]\(([^)\s]+)\)|<(https:\/\/[^>\s]+)>/g)) {
    const [, label, address, autoLink] = match;
    const href = safeUrl(address || autoLink, origin);
    const text = escape(label ?? autoLink?.replace(/^https:\/\//, "") ?? "");
    html += escape(markdown.slice(offset, match.index));
    if (autoLink && /\S/.test(markdown[match.index - 1] || "")) html += " ";
    html += href ? `<a href="${escape(href)}" rel="nofollow noopener">${text}</a>` : text;
    offset = match.index + match[0].length;
  }
  return html + escape(markdown.slice(offset));
}

export function readPost(doc, origin, fallback) {
  // Backfilled X posts use a source footer. Other publishers can use syndication.
  const markdown = typeof doc.content_md === "string" ? doc.content_md : "";
  const footer = markdown.match(/\n+\[Original post by @\w+\]\((https:\/\/[^)\s]+)\)\.?\s*$/);
  const archiveSource = xPost(footer?.[1]) ? footer[1] : null;
  const names = Array.isArray(doc.syndication) ? doc.syndication : [];
  const copy = names.find((entry) => entry?.version === doc.version && xPost(entry?.url));
  const source = safeUrl(archiveSource || copy?.url);
  const visible = archiveSource ? markdown.slice(0, footer.index) : markdown;
  const text = visible.replace(/```[\s\S]*?```/g, "").trim();
  const [heading = "", ...rest] = text.split("\n");
  const body = rest.join("\n").trim();
  const summary = plainText(body).split(/\n\s*\n/)[0];
  const date = String(doc.created || doc.updated || "").slice(0, 10);
  return {
    title: plainText(heading) || "Untitled post",
    preview: source ? previewHtml(body, origin) : escape(summary.length > 260 ? summary.slice(0, 257).trimEnd() + "…" : summary),
    href: safeUrl(doc.page, origin) || fallback,
    source, date, signed: false,
    itemId: doc.id, itemData: fallback, version: doc.version,
  };
}

export async function signedByTree(doc, keys) {
  if (!keys.length || !doc.author?.sig || typeof doc.content_md !== "string") return false;
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(doc.content_md)));
  const hash = "sha256:" + Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return hash === doc.content_hash && (await verifyByline(doc, keys)).byTree;
}

export function archiveUrl(tree) {
  return safeUrl(tree.manifest.items || "items/index.json", tree.origin);
}

export function archiveEntries(items, tree) {
  return items.filter((entry) =>
    /^[0-7][0-9abcdefghjkmnpqrstvwxyz]{25}$/.test(entry?.id) &&
    entry.kind !== "withdrawn" && entry.id !== tree.doc?.id);
}

export function readAccounts(tree) {
  return tree.tree?.valid ? tree.tree.claims.branches.map((url) => ({ url })) : claimedLinks(tree.manifest);
}

export function renderAccount(branch, status) {
  const [network, handle] = branchLabel(branch.url);
  const label = [network, handle.split(" · ")[0]].filter(Boolean).join(" · ");
  const proof = safeUrl(branch.url);
  const profile = xPost(proof) ? proof.replace(/\/status\/\d+.*$/i, "") : proof;
  const account = profile
    ? `<a href="${escape(profile)}" rel="nofollow noopener">${escape(label)}</a>`
    : escape(label);
  return `<li>${account}<span class="account-status">${escape(status)}</span></li>`;
}

export function renderPost(post, siteRoot) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(post.date) ? new Date(post.date) : null;
  const time = date && !Number.isNaN(+date)
    ? `<time datetime="${post.date}">${dateLabel.format(date)}</time>` : "";
  const source = post.source
    ? `<a href="${escape(post.source)}" rel="nofollow noopener">View on X</a>` : "";
  const query = new URLSearchParams({ post: post.itemData });
  if (Number.isSafeInteger(post.version) && post.version > 0) query.set("version", String(post.version));
  const proof = post.signed
    ? `<a class="signed" href="${escape(siteRoot + "verify/?" + query)}" aria-label="${escape("Verify signature for " + post.title)}">Signed</a>`
    : "";
  return `<li data-item-id="${escape(post.itemId)}" data-item-version="${escape(post.version)}"${post.source ? " data-x-source" : ""}><article>
    <p class="post-meta">${time} ${source} ${proof}
      <a class="item-data" href="${escape(post.itemData)}" type="application/json" aria-label="${escape("Live item data for " + post.title)}">Item data</a>
    </p>
    <h3><a href="${escape(post.href)}">${escape(post.title)}</a></h3>
    ${post.preview ? `<p class="preview">${post.preview}</p>` : ""}
  </article></li>`;
}

export function renderSources(tree) {
  const manifest = safeUrl("blyg.json", tree.origin);
  const archive = archiveUrl(tree);
  return [
    manifest && `<a href="${escape(manifest)}" type="application/json">Blygger manifest</a>`,
    archive && `<a href="${escape(archive)}" type="application/json">Post archive</a>`,
  ].filter(Boolean).join(" · ");
}
