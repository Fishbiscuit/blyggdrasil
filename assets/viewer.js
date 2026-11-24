import { allowLocalDevelopment, loadTree, claimedLinks, verifyByline, signatureSupport, itemUrl } from "../lib/blyggdrasil.js";
import { checkBranch, makeFetcher } from "../lib/resolvers.js";
import { createWorld, webglAvailable } from "./world.js";
import { branchLabel } from "./labels.js";

if (["localhost", "127.0.0.1"].includes(location.hostname)) allowLocalDevelopment();
const $ = (s) => document.querySelector(s);
const get = makeFetcher();
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
export const fingerprint = (did) => (did ? `${did.slice(8, 24).match(/.{1,4}/g).join(" ")} …${did.slice(-4)}` : "");

const WORDS = {
  tree: { verified: "verified", failed: "failed", unreachable: "can’t check here", claimed: "claimed only", pending: "checking" },
  claims: { verified: "links back", failed: "no link back", unreachable: "can’t check here", claimed: "claimed only", pending: "checking" },
};
const METHOD = { key: "names this tree’s key", link: "links back to the blyg", handle: "handle is the blyg’s own domain" };

let world = null;
if (webglAvailable()) {
  try { world = createWorld({ canvas: $("#world"), tags: $("#tags"), reducedMotion: reduced }); } catch { world = null; }
}
if (!world) document.body.classList.add("no-webgl");

function example() {
  if (!world) return;
  const demo = [
    ["GitHub", "bio names the key", "verified"],
    ["Bluesky", "handle is the domain", "verified"],
    ["X", "proof post", "verified"],
    ["Mastodon", "link checked by server", "pending"],
    ["LinkedIn", "no public check", "claimed"],
  ];
  world.setTree({ seed: "blyggdrasil", title: "your blyg", subtitle: "the trunk", branches: demo.map(([label, sub]) => ({ label, sub })), verdictText: () => WORDS.tree.pending });
  demo.forEach(([, , v], i) => setTimeout(() => world.setVerdict(i, v, WORDS.tree[v]), 2200 + i * 450));
}

let run = 0;
async function show(input) {
  const mine = ++run;
  const status = $("#status");
  status.className = "status";
  status.textContent = "Reading the blyg…";
  if (!(await signatureSupport())) {
    status.className = "status warn";
    status.textContent = "This browser can’t check Ed25519 signatures. Try a current Chrome, Safari or Firefox.";
    return;
  }
  const t = await loadTree(input, get);
  if (mine !== run) return;
  if (t.error) { status.className = "status warn"; status.textContent = `No blyg answers at ${input}.`; return; }
  const m = t.manifest;
  const hasTree = !!t.tree;
  const valid = hasTree && t.tree.valid;
  const mode = valid ? "tree" : "claims";
  const branches = (valid ? t.tree.claims.branches.map((url) => ({ url })) : claimedLinks(m).map((l) => ({ url: l.url })))
    .map((b) => ({ ...b, verdict: "pending" }));
  const host = t.origin.replace(/^https?:\/\//, "");

  status.textContent = valid ? "Signed tree found. Checking each branch…" : hasTree ? `The tree doesn’t check out: ${t.tree.reason}.` : "No tree planted yet. Checking the links it lists…";
  $("#hud-mode").innerHTML = `${esc(m.title || host)}<br>${valid ? "Signed tree" : hasTree ? "Tree doesn’t check out" : "No tree yet · links it claims"}`;
  $("#hud-key").textContent = valid ? `Key · ${fingerprint(t.tree.claims.key)}` : "Key · none";

  world?.setTree({
    seed: t.origin, title: m.title || host, subtitle: host,
    branches: branches.map((b) => { const [label, sub] = branchLabel(b.url); return { label, sub, url: b.url }; }),
    verdictText: () => WORDS[mode].pending,
  });

  $("#trunk-title").textContent = m.title || host;
  $("#trunk-who").innerHTML = `${esc(m.author?.name || "")}${m.author?.name ? " · " : ""}<a href="${esc(t.origin)}">${esc(host)}</a>`;
  const pill = $("#tree-pill");
  pill.className = "pill " + (valid ? "ok" : hasTree ? "bad" : "");
  pill.textContent = valid ? "● Signed tree" : hasTree ? "Tree doesn’t check out" : "No tree yet";
  const keyBox = $("#key-box");
  if (valid) {
    const hist = t.tree.history.map((h) => `<p>${h.how === "rotated" ? "Rotated from" : "Recovered from"} <span class="mono">${esc(fingerprint(h.key))}</span>${h.by ? `, signed by a recovery key from pinned ${esc(h.from)}` : ""}.</p>`).join("");
    const postUrl = t.doc?.page ? new URL(t.doc.page, t.origin).toString() : itemUrl(t.origin, m, t.doc.id);
    keyBox.innerHTML = `<p class="label">Key</p><b>${esc(t.tree.claims.key)}</b>${hist}<p style="margin-top:14px"><a href="${esc(postUrl)}">The tree post</a>, version ${esc(t.doc?.version)}.</p>`;
  } else if (hasTree) {
    keyBox.innerHTML = `<p class="note warn">${esc(t.tree.reason)}. Its branches aren’t checked.</p>`;
  } else {
    keyBox.innerHTML = `<p>This blyg hasn’t planted a tree. These are the links in its profile, checked only for a link back. If it’s yours, <a href="new/#blyg=${esc(host)}">plant one</a>.</p>`;
  }

  const list = $("#branch-list");
  const paint = () => {
    list.innerHTML = branches.length ? branches.map((b) => {
      const [label, sub] = branchLabel(b.url);
      const how = b.verdict === "verified" && b.method ? METHOD[b.method] : "";
      const detail = [b.verdict === "verified" ? b.detail : b.detail, how].filter(Boolean).join(" — ");
      return `<li><span class="v ${b.verdict}">${WORDS[mode][b.verdict]}</span><span><a href="${esc(b.url)}" rel="nofollow noopener">${esc(label)} · ${esc(sub)}</a><span class="d">${esc(detail)}</span></span></li>`;
    }).join("") : `<li><span class="v">—</span><span class="d">${valid ? "This tree names no branches yet." : "This blyg lists no links in its profile."}</span></li>`;
  };
  paint();
  $("#result").hidden = false;

  const keys = valid ? t.tree.keys : [];
  let next = 0;
  const worker = async () => {
    while (next < branches.length) {
      const i = next++;
      const r = await checkBranch(branches[i].url, { keys, trunk: t.origin, get });
      if (mine !== run) return;
      Object.assign(branches[i], r);
      world?.setVerdict(i, r.verdict, WORDS[mode][r.verdict]);
      paint();
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  if (mine !== run) return;
  status.textContent = valid ? "Every branch checked." : "Done.";
  if (valid) signedPosts(t, mine); else $("#posts").hidden = true;
}

async function signedPosts(t, mine) {
  const box = $("#posts");
  const ix = await get(new URL(t.manifest.items || "items/index.json", t.origin).toString());
  if (mine !== run || !ix.ok || !Array.isArray(ix.json?.items)) { box.hidden = true; return; }
  const rows = [];
  for (const it of ix.json.items.filter((i) => i.kind !== "withdrawn").slice(0, 6)) {
    const d = await get(itemUrl(t.origin, t.manifest, it.id));
    if (mine !== run) return;
    if (!d.ok) continue;
    const s = await verifyByline(d.json, t.tree.keys);
    const text = it.id === t.doc?.id ? "The tree post" : String(d.json.content_md || "").replace(/```[\s\S]*?```/g, "").replace(/[#>*_`\[\]]/g, "").trim().split("\n")[0] || "(no text)";
    const page = d.json.page ? new URL(d.json.page, t.origin).toString() : itemUrl(t.origin, t.manifest, it.id);
    rows.push(`<li><span class="v ${s.byTree ? "verified" : ""}">${s.byTree ? "signed" : s.signed ? "other key" : "unsigned"}</span><span><a href="${esc(page)}">${esc(text.slice(0, 90))}</a><span class="d">${esc(it.updated.slice(0, 10))} · version ${esc(it.version)}</span></span></li>`);
  }
  box.querySelector("ul").innerHTML = rows.join("");
  box.hidden = !rows.length;
}

const fromHash = () => { const h = new URLSearchParams(location.hash.slice(1)); return h.get("blyg") || h.get("tree"); };
$("#lookup").addEventListener("submit", (e) => {
  e.preventDefault();
  const v = $("#blyg-input").value.trim();
  if (!v) { $("#status").textContent = "Enter a blyg address first, such as fishbiscuit.me/blyg."; return; }
  const next = `#blyg=${v.replace(/^https:\/\//, "")}`;
  if (location.hash === next) show(v); else location.hash = next;
});
for (const b of document.querySelectorAll("[data-example]")) b.addEventListener("click", () => { $("#blyg-input").value = b.dataset.example; $("#lookup").requestSubmit(); });
window.addEventListener("hashchange", () => { const v = fromHash(); if (v) { $("#blyg-input").value = v; show(v); } });
const initial = fromHash();
if (initial) { $("#blyg-input").value = initial; show(initial); } else example();
