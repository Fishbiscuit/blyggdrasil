import { allowLocalDevelopment, loadTree, claimedLinks, verifyByline, signatureSupport, itemUrl } from "../lib/blyggdrasil.js";
import { checkBranch, makeFetcher } from "../lib/resolvers.js";
import { drawTree, branchLabel } from "./tree.js";

if (["localhost", "127.0.0.1"].includes(location.hostname)) allowLocalDevelopment();
const $ = (s) => document.querySelector(s);
const get = makeFetcher();
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const short = (did) => (did ? `${did.slice(0, 16)}…${did.slice(-6)}` : "");

const LABEL = {
  tree: { verified: "Verified", failed: "Failed", unreachable: "Can't check here", claimed: "Claimed", pending: "Checking" },
  claims: { verified: "Links back", failed: "No link back", unreachable: "Can't check here", claimed: "Claimed", pending: "Checking" },
};
const METHOD = { key: "names this tree's key", link: "links back to the blyg", handle: "its handle is the blyg's own domain" };

let run = 0;

async function show(input) {
  const mine = ++run;
  const status = $("#status");
  const out = $("#result");
  out.hidden = true;
  status.textContent = "Reading the blyg…";
  if (!(await signatureSupport())) {
    status.innerHTML = '<span class="warnbox">This browser can’t check Ed25519 signatures. Try a current Chrome, Safari or Firefox.</span>';
    return;
  }
  const t = await loadTree(input, get);
  if (mine !== run) return;
  if (t.error) {
    status.textContent = `No blyg found at ${input}.`;
    return;
  }
  status.textContent = "";
  const m = t.manifest;
  const hasTree = !!t.tree;
  const valid = hasTree && t.tree.valid;
  const mode = valid ? "tree" : "claims";
  const branches = (valid ? t.tree.claims.branches.map((url) => ({ url })) : claimedLinks(m).map((l) => ({ url: l.url, label: l.label })))
    .map((b) => ({ ...b, verdict: "pending" }));

  $("#trunk-title").textContent = m.title || t.origin;
  $("#trunk-who").innerHTML = `${esc(m.author?.name || "")}${m.author?.name ? " · " : ""}<a href="${esc(t.origin)}">${esc(t.origin.replace(/^https:\/\//, ""))}</a>`;
  const pill = $("#tree-pill");
  pill.className = "pill " + (valid ? "ok" : hasTree ? "bad" : "");
  pill.textContent = valid ? "Signed tree" : hasTree ? "Tree doesn’t check out" : "No tree yet";

  const keyBox = $("#key-box");
  if (valid) {
    const hist = t.tree.history.map((h) => `<div>${h.how === "rotated" ? "Rotated from" : "Recovered from"} <span class="key">${esc(h.key)}</span>${h.by ? `, signed by recovery key <span class="key">${esc(short(h.by))}</span> (pinned ${esc(h.from)})` : ""}</div>`).join("");
    keyBox.innerHTML = `<div class="note">Key</div><div class="key">${esc(t.tree.claims.key)}</div>${hist}<div class="note"><a href="${esc(t.doc?.page ? new URL(t.doc.page, t.origin) : itemUrl(t.origin, m, t.doc.id))}">The tree post</a>, version ${esc(t.doc?.version)}</div>`;
  } else if (hasTree) {
    keyBox.innerHTML = `<div class="warnbox">${esc(t.tree.reason)}. Its branches aren’t checked.</div>`;
  } else {
    keyBox.innerHTML = `<div class="note">This blyg hasn’t planted a tree. These are the links it lists in its profile, checked only for a link back. <a href="new/#blyg=${esc(t.origin.replace(/^https:\/\//, ""))}">Plant a tree for this blyg</a> if it’s yours.</div>`;
  }

  const svg = $("#tree-svg");
  const list = $("#branch-list");
  const paint = () => {
    drawTree(svg, { title: m.title || t.origin, branches });
    list.innerHTML = branches.length ? branches.map((b) => {
      const [net, handle] = branchLabel(b.url);
      const how = b.verdict === "verified" && b.method ? ` — ${METHOD[b.method]}` : "";
      const detail = b.verdict === "verified" ? (b.detail ? `${b.detail}${how}` : how.slice(3)) : b.detail || "";
      return `<li><span class="v ${b.verdict}">${LABEL[mode][b.verdict]}</span><span><a href="${esc(b.url)}" rel="nofollow noopener">${esc(net)} ${esc(handle)}</a><span class="d">${esc(detail)}</span></span></li>`;
    }).join("") : `<li class="empty"><span></span><span class="note">${valid ? "This tree names no branches yet." : "This blyg lists no links in its profile."}</span></li>`;
  };
  out.hidden = false;
  paint();
  window.onresize = () => { if (mine === run) paint(); };

  const keys = valid ? t.tree.keys : [];
  let next = 0;
  const worker = async () => {
    while (next < branches.length) {
      const b = branches[next++];
      const r = await checkBranch(b.url, { keys, trunk: t.origin, get });
      if (mine !== run) return;
      Object.assign(b, r);
      paint();
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);

  if (valid) signedPosts(t, mine);
  else $("#posts").hidden = true;
}

async function signedPosts(t, mine) {
  const box = $("#posts");
  const ix = await get(new URL(t.manifest.items || "items/index.json", t.origin).toString());
  if (mine !== run || !ix.ok || !Array.isArray(ix.json?.items)) { box.hidden = true; return; }
  const recent = ix.json.items.filter((i) => i.kind !== "withdrawn").slice(0, 6);
  const rows = [];
  for (const it of recent) {
    const d = await get(itemUrl(t.origin, t.manifest, it.id));
    if (mine !== run) return;
    if (!d.ok) continue;
    const s = await verifyByline(d.json, t.tree.keys);
    const text = it.id === t.doc?.id ? "The tree post" : String(d.json.content_md || "").replace(/```[\s\S]*?```/g, "").replace(/[#>*_`\[\]]/g, "").trim().split("\n")[0] || "(no text)";
    const page = d.json.page ? new URL(d.json.page, t.origin).toString() : itemUrl(t.origin, t.manifest, it.id);
    rows.push(`<li><span class="v ${s.byTree ? "verified" : "claimed"}">${s.byTree ? "Signed" : s.signed ? "Other key" : "Unsigned"}</span><span><a href="${page}">${esc(text.slice(0, 90))}</a><span class="d">${esc(it.updated.slice(0, 10))}, version ${esc(it.version)}</span></span></li>`);
  }
  box.querySelector("ul").innerHTML = rows.join("");
  box.hidden = !rows.length;
}

function fromHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  return h.get("blyg") || h.get("tree");
}

$("#lookup").addEventListener("submit", (e) => {
  e.preventDefault();
  const v = $("#blyg-input").value.trim();
  if (!v) return;
  const next = `#blyg=${v.replace(/^https:\/\//, "")}`;
  if (location.hash === next) show(v); else location.hash = next;
});
for (const b of document.querySelectorAll("[data-example]")) b.addEventListener("click", () => { $("#blyg-input").value = b.dataset.example; $("#lookup").requestSubmit(); });
window.addEventListener("hashchange", () => { const v = fromHash(); if (v) { $("#blyg-input").value = v; show(v); } });
const initial = fromHash();
if (initial) { $("#blyg-input").value = initial; show(initial); }
