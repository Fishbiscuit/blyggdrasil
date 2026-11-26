import { allowLocalDevelopment, itemUrl, loadTree } from "../lib/blyggdrasil.js";
import { checkBranch, makeFetcher } from "../lib/resolvers.js";
import { archiveEntries, archiveUrl, readAccounts, readPost, renderAccount, renderPost, renderSources, safeUrl, signedByTree } from "../lib/tree-page.js";

if (["localhost", "127.0.0.1"].includes(location.hostname)) allowLocalDevelopment();
const $ = (selector) => document.querySelector(selector);
const get = makeFetcher((url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(12_000) }));
const batchSize = 24;
const siteRoot = document.body.dataset.siteRoot;
const verdictLabels = {
  verified: "Verified", failed: "Proof failed", unreachable: "Couldn’t verify",
  claimed: "Claimed", pending: "Checking…",
};
async function inBatches(rows, count, action, onBatch = () => {}) {
  for (let start = 0; start < rows.length; start += count) {
    const batch = rows.slice(start, start + count);
    await Promise.all(batch.map((row, index) => action(row, start + index)));
    onBatch();
  }
}

function openLinkedAccount() {
  const fragment = location.hash.slice(1);
  if (!fragment.startsWith("account-")) return;
  let id;
  try { id = decodeURIComponent(fragment); } catch { return; }
  const evidence = document.getElementById(id)?.closest("#accounts .account-evidence");
  if (!evidence) return;
  evidence.open = true;
  evidence.scrollIntoView({ block: "nearest" });
}

function showAccounts(tree, keys) {
  const branches = readAccounts(tree);
  const note = $("#account-note");
  if (!branches.length || tree.tree?.valid === false) {
    note.textContent = tree.tree?.valid === false ? "The signed account list could not be verified." : "No accounts listed.";
    note.hidden = false;
  }
  const accounts = $("#accounts");
  accounts.innerHTML = branches.map((branch) => renderAccount(branch, verdictLabels.pending)).join("");
  openLinkedAccount();
  const rows = [...accounts.children];
  return inBatches(branches, 4, async (branch, index) => {
    const row = rows[index];
    const status = row.querySelector(".account-status");
    const reason = row.querySelector(".account-reason");
    const retry = row.querySelector(".account-retry");
    const source = row.querySelector(".account-source");
    const listed = safeUrl(branch.url);
    const check = async () => {
      status.textContent = verdictLabels.pending;
      status.classList.remove("verified");
      reason.textContent = "Checking the published link…";
      retry.disabled = true;
      if (source) {
        source.href = listed;
        source.textContent = "Open listed link";
      }

      const result = await checkBranch(branch.url, { keys, trunk: tree.origin, get })
        .catch(() => ({ verdict: "unreachable", detail: "The browser couldn’t check this source." }));
      const warning = result.verdict === "unreachable" ? "The source couldn’t be checked." : "No proof details are available.";
      const match = { key: "Found this tree’s key", link: "Found a link back to this blyg", handle: "Domain matches the Bluesky handle" };
      const detail = result.detail || warning;
      status.textContent = verdictLabels[result.verdict] || verdictLabels.unreachable;
      status.classList.toggle("verified", result.verdict === "verified");
      reason.textContent = result.verdict === "verified" && match[result.method]
        ? `${match[result.method]}. Evidence: ${detail}.`
        : detail;
      const evidence = result.verdict === "verified" && safeUrl(result.source);
      if (source && evidence) {
        source.href = evidence;
        source.textContent = "Open proof source";
      }
      retry.hidden = false;
      retry.disabled = false;
    };
    retry.addEventListener("click", check);
    await check();
  });
}

async function showPosts(tree, keys) {
  const note = $("#post-note");
  const more = $("#more");
  const retry = $("#retry");
  const filters = $("#filters");
  const posts = new Map();
  const snapshotPosts = new Map([...$("#posts").querySelectorAll("[data-item-id]")].map((node) =>
    [node.dataset.itemId, { source: node.hasAttribute("data-x-source"), html: node.outerHTML }]));
  const missing = new Set();
  let filter = "all";
  let offset = 0;
  let busy = false;
  let xTarget = batchSize;
  note.textContent = "Loading posts…";
  const index = archiveUrl(tree);
  const response = index && await get(index);
  if (!response?.ok || !Array.isArray(response.json?.items)) {
    note.textContent = "The post archive couldn’t be loaded.";
    return;
  }
  const entries = archiveEntries(response.json.items, tree);
  filters.hidden = !entries.length;

  function paint() {
    if (!offset && snapshotPosts.size && busy) return;
    const visible = entries.slice(0, offset).map((entry) => posts.get(entry.id) || snapshotPosts.get(entry.id))
      .filter((post) => post && (filter === "all" || post.source));
    $("#posts").innerHTML = visible.map((post) => post.html || renderPost(post, siteRoot)).join("");
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
      snapshotPosts.delete(entry.id);
      if (doc.kind === "withdrawn" || (doc.visibility && doc.visibility !== "public")) return;
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
  const snapshotAddress = document.body.dataset.treeAddress;
  const address = snapshotAddress || new URLSearchParams(location.search).get("blyg")?.trim();
  const loading = $("#loading");
  if (!address) {
    loading.textContent = "Open a blyg from the Blyggdrasil home page.";
    return;
  }
  const tree = await loadTree(address, get);
  if (tree.error) {
    loading.textContent = snapshotAddress ? "Showing a saved copy. Live checks are unavailable." : "This blyg couldn’t be loaded.";
    loading.hidden = false;
    return;
  }
  const origin = $("#origin");
  origin.href = tree.origin;
  origin.textContent = tree.origin.replace(/^https?:\/\//, "").replace(/\/$/, "");
  origin.hidden = false;
  const title = tree.manifest.title || origin.textContent;
  $("#title").textContent = title;
  document.title = `${title} · Blyggdrasil`;
  $("#sources").innerHTML = renderSources(tree);
  $("#sources").hidden = false;
  loading.hidden = true;
  $("#profile").hidden = false;
  const keys = tree.tree?.valid ? tree.tree.keys : [];
  await Promise.all([showAccounts(tree, keys), showPosts(tree, keys)]);
}

openLinkedAccount();
window.addEventListener("hashchange", openLinkedAccount);
showTree().catch(() => {
  const message = $("#profile").hidden ? $("#loading") : $("#post-note");
  message.textContent = "Some of this blyg couldn’t be loaded.";
});
