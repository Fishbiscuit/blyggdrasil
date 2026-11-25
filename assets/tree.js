import { allowLocalDevelopment, claimedLinks, isHttpsUrl, itemUrl, loadTree, verifyByline } from "../lib/blyggdrasil.js";
import { checkBranch, makeFetcher } from "../lib/resolvers.js";
import { branchLabel } from "./labels.js";

if (["localhost", "127.0.0.1"].includes(location.hostname)) allowLocalDevelopment();
const $ = (selector) => document.querySelector(selector);
const get = makeFetcher((url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(12_000) }));
const dateLabel = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const batchSize = 24;
const encoder = new TextEncoder();
const verdictLabels = {
  verified: "Verified", failed: "Proof failed", unreachable: "Couldn’t verify",
  claimed: "Claimed", pending: "Checking…",
};
const escape = (value) => String(value ?? "").replace(/[&<>"]/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;",
})[character]);

function safeUrl(value, origin) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value, origin).href;
    return isHttpsUrl(url) ? url : null;
  } catch {
    return null;
  }
}

function xPost(url) {
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
    const text = escape(label || autoLink.replace(/^https:\/\//, ""));
    html += escape(markdown.slice(offset, match.index));
    if (autoLink && /\S/.test(markdown[match.index - 1] || "")) html += " ";
    html += href ? `<a href="${escape(href)}" rel="nofollow noopener">${text}</a>` : text;
    offset = match.index + match[0].length;
  }
  return html + escape(markdown.slice(offset));
}

function readPost(doc, origin, fallback) {
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
  };
}

async function signedByTree(doc, keys) {
  if (!keys.length || !doc.author?.sig || typeof doc.content_md !== "string") return false;
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(doc.content_md)));
  const hash = "sha256:" + Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return hash === doc.content_hash && (await verifyByline(doc, keys)).byTree;
}

async function inBatches(rows, count, action, onBatch = () => {}) {
  for (let start = 0; start < rows.length; start += count) {
    const batch = rows.slice(start, start + count);
    await Promise.all(batch.map((row, index) => action(row, start + index)));
    onBatch();
  }
}

function showAccounts(tree, keys) {
  const branches = tree.tree?.valid
    ? tree.tree.claims.branches.map((url) => ({ url }))
    : claimedLinks(tree.manifest);
  const note = $("#account-note");
  if (!branches.length || tree.tree?.valid === false) {
    note.textContent = tree.tree?.valid === false ? "The signed account list could not be verified." : "No accounts listed.";
    note.hidden = false;
  }
  const accounts = $("#accounts");
  accounts.innerHTML = branches.map((branch) => {
    const [network, handle] = branchLabel(branch.url);
    const label = [network, handle.split(" · ")[0]].filter(Boolean).join(" · ");
    const proof = safeUrl(branch.url);
    const profile = xPost(proof) ? proof.replace(/\/status\/\d+.*$/i, "") : proof;
    const account = profile ? `<a href="${escape(profile)}" rel="nofollow noopener">${escape(label)}</a>` : escape(label);
    return `<li>${account}<span class="account-status">${verdictLabels.pending}</span></li>`;
  }).join("");
  const statuses = accounts.querySelectorAll(".account-status");
  return inBatches(branches, 4, async (branch, index) => {
    const node = statuses[index];
    const result = await checkBranch(branch.url, { keys, trunk: tree.origin, get });
    node.textContent = verdictLabels[result.verdict] || verdictLabels.unreachable;
    node.classList.toggle("verified", result.verdict === "verified");
  });
}

async function showPosts(tree, keys) {
  const note = $("#post-note");
  const more = $("#more");
  const retry = $("#retry");
  const filters = $("#filters");
  const posts = new Map();
  const missing = new Set();
  let filter = "all";
  let offset = 0;
  let busy = false;
  let xTarget = batchSize;
  note.textContent = "Loading posts…";
  const index = safeUrl(tree.manifest.items || "items/index.json", tree.origin);
  const response = index && await get(index);
  if (!response?.ok || !Array.isArray(response.json?.items)) {
    note.textContent = "The post archive couldn’t be loaded.";
    return;
  }
  const entries = response.json.items.filter((entry) =>
    /^[0-7][0-9abcdefghjkmnpqrstvwxyz]{25}$/.test(entry?.id) &&
    entry.kind !== "withdrawn" && entry.id !== tree.doc?.id);
  filters.hidden = !entries.length;

  function paint() {
    const visible = entries.slice(0, offset).map((entry) => posts.get(entry.id))
      .filter((post) => post && (filter === "all" || post.source));
    $("#posts").innerHTML = visible.map((post) => {
      const date = /^\d{4}-\d{2}-\d{2}$/.test(post.date) ? new Date(post.date) : null;
      return `<li><p class="post-meta">${date && !Number.isNaN(+date) ? `<time datetime="${post.date}">${dateLabel.format(date)}</time>` : ""}
        ${post.source ? `<a href="${escape(post.source)}" rel="nofollow noopener">View on X</a>` : ""}
        ${post.signed ? '<span class="signed">Signed</span>' : ""}</p>
        <h3><a href="${escape(post.href)}">${escape(post.title)}</a></h3>
        ${post.preview ? `<p class="preview">${post.preview}</p>` : ""}</li>`;
    }).join("");
    note.textContent = busy ? (visible.length ? "" : filter === "x" ? "Finding X posts…" : "Loading posts…")
      : missing.size ? "Some posts couldn’t be loaded."
      : visible.length ? "" : filter === "x" ? "No X posts found." : "No posts to show.";
    more.textContent = filter === "x" ? "Load more X posts" : "Load more";
    more.hidden = busy || offset >= entries.length;
    retry.hidden = busy || !missing.size;
  }

  const xCount = () => [...posts.values()].filter((post) => post.source).length;

  async function fetchPosts(entriesToFetch) {
    await inBatches(entriesToFetch, 6, async (entry) => {
      const url = safeUrl(itemUrl(tree.origin, tree.manifest, entry.id));
      const response = url && await get(url);
      const doc = response?.json;
      if (!response?.ok || doc?.id !== entry.id || doc.origin !== tree.origin) {
        missing.add(entry);
        return;
      }
      missing.delete(entry);
      if (doc.kind === "withdrawn") return;
      const post = readPost(doc, tree.origin, url);
      post.signed = await signedByTree(doc, keys);
      posts.set(entry.id, post);
    }, paint);
  }

  async function loadMore() {
    if (busy) return;
    busy = true;
    paint();
    try {
      do {
        const next = entries.slice(offset, offset + batchSize);
        offset += next.length;
        await fetchPosts(next);
      } while (filter === "x" && offset < entries.length && xCount() < xTarget);
    } finally {
      busy = false;
      paint();
    }
  }
  more.addEventListener("click", () => {
    if (filter === "x") xTarget = xCount() + batchSize;
    loadMore();
  });
  retry.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    paint();
    try {
      await fetchPosts([...missing]);
    } finally {
      busy = false;
      paint();
    }
  });
  filters.addEventListener("click", (event) => {
    if (!event.target.dataset.filter) return;
    filter = event.target.dataset.filter;
    for (const button of filters.querySelectorAll("button")) {
      button.setAttribute("aria-pressed", String(button.dataset.filter === filter));
    }
    paint();
    if (filter === "x" && !busy && offset < entries.length && xCount() < xTarget) loadMore();
  });
  await loadMore();
}

async function showTree() {
  const address = new URLSearchParams(location.search).get("blyg")?.trim();
  const loading = $("#loading");
  if (!address) {
    loading.textContent = "Open a blyg from the Blyggdrasil home page.";
    return;
  }
  const tree = await loadTree(address, get);
  if (tree.error) {
    loading.textContent = "This blyg couldn’t be loaded.";
    return;
  }
  const origin = $("#origin");
  origin.href = tree.origin;
  origin.textContent = tree.origin.replace(/^https?:\/\//, "").replace(/\/$/, "");
  origin.hidden = false;
  const title = tree.manifest.title || origin.textContent;
  $("#title").textContent = title;
  document.title = `${title} · Blyggdrasil`;
  loading.hidden = true;
  $("#profile").hidden = false;
  const keys = tree.tree?.valid ? tree.tree.keys : [];
  await Promise.all([showAccounts(tree, keys), showPosts(tree, keys)]);
}

showTree().catch(() => {
  const message = $("#profile").hidden ? $("#loading") : $("#post-note");
  message.textContent = "Some of this blyg couldn’t be loaded.";
});
