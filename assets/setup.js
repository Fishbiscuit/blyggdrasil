import { allowLocalDevelopment, resolveBlyg, generateKey, importKeyFile, serializeClaims, signClaims, treeMarkdown, proofLine, isHttpsUrl, signatureSupport } from "../lib/blyggdrasil.js";
import { checkBranch, makeFetcher } from "../lib/resolvers.js";
import { createWorld, webglAvailable } from "./world.js";
import { branchLabel } from "./labels.js";
import { checkPublishedTree } from "../lib/published-tree.js";

if (["localhost", "127.0.0.1"].includes(location.hostname)) allowLocalDevelopment();
const $ = (s) => document.querySelector(s);
const get = makeFetcher();
const getPublicTree = makeFetcher((url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(12_000) }));
const state = { trunk: null, title: "", main: null, mainFile: null, recoveryFile: null, recoveryDid: null, drawn: "", rows: [] };
const WORDS = { verified: "verified", failed: "no proof found yet", unreachable: "can’t check from a browser", claimed: "claimed only", pending: "not checked" };
const PUBLISHED_WORDS = { verified: "Verified", failed: "Proof failed", unreachable: "Couldn’t reach proof", claimed: "Claimed only" };
let publishedDraft = null;
let publicationRun = 0;
const fingerprint = (did) => `${did.slice(8, 24).match(/.{1,4}/g).join(" ")} …${did.slice(-4)}`;
const enc = encodeURIComponent;
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const withScheme = (v) => (/^[a-z]+:\/\//i.test(v) ? v : `https://${v}`);
const host = (u) => u.replace(/^https?:\/\//, "");
const line = () => (state.main && state.trunk ? proofLine({ key: state.main.did, trunk: state.trunk }) : "");
const out = (a) => `<a href="${a.href}" target="_blank" rel="noopener">${a.text}</a>`;

// Each network: what to type, how it becomes a branch address, and where to post the line.
const NETS = {
  x: {
    name: "X", placeholder: "the post’s address: x.com/you/status/…",
    toUrl: (v) => { const m = v.match(/(?:x|twitter)\.com\/([A-Za-z0-9_]+)\/status\/(\d+)/i); return m ? `https://x.com/${m[1]}/status/${m[2]}` : null; },
    how: () => `${out({ href: `https://x.com/intent/post?text=${enc(line())}`, text: "Post the line on X" })} then paste that post’s address here. X profiles can’t be read publicly, so the post is the proof.`,
  },
  bluesky: {
    name: "Bluesky", placeholder: "you.bsky.social, or a post’s address",
    toUrl: (v) => {
      if (/bsky\.app\/profile\//i.test(v)) return withScheme(v).replace(/\/+$/, "");
      const h = v.replace(/^@/, "");
      return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(h) || /^did:plc:[a-z0-9]+$/.test(h) ? `https://bsky.app/profile/${h}` : null;
    },
    how: () => `${out({ href: `https://bsky.app/intent/compose?text=${enc(line())}`, text: "Post the line on Bluesky" })} and paste the post’s address, or put the line in your bio and give your handle.`,
  },
  github: {
    name: "GitHub", placeholder: "your username",
    toUrl: (v) => { const u = v.replace(/^https?:\/\/(www\.)?github\.com\//i, "").replace(/^@/, "").split("/")[0]; return /^[A-Za-z0-9-]{1,39}$/.test(u) ? `https://github.com/${u}` : null; },
    how: () => `${out({ href: "https://github.com/settings/profile", text: "Open your profile" })} and paste the line into your bio, or ${out({ href: "https://gist.github.com/", text: "make a public gist" })} named blyggdrasil.txt.`,
  },
  mastodon: {
    name: "Mastodon", placeholder: "@you@mastodon.social",
    toUrl: (v) => {
      const m = v.match(/^@?([A-Za-z0-9_]+)@([a-z0-9-]+(\.[a-z0-9-]+)+)$/i);
      if (m) return `https://${m[2]}/@${m[1]}`;
      const u = v.match(/^https?:\/\/([^/]+)\/@([A-Za-z0-9_]+)/i);
      return u ? `https://${u[1]}/@${u[2]}` : null;
    },
    how: (v) => {
      const m = v.match(/@([a-z0-9-]+(\.[a-z0-9-]+)+)$/i);
      const post = m ? out({ href: `https://${m[1]}/share?text=${enc(line())}`, text: "Post the line" }) : "Post the line";
      return `${post} or add your blyg as a profile link. Mastodon confirms profile links for you.`;
    },
  },
  medium: {
    name: "Medium", placeholder: "@you",
    toUrl: (v) => { const m = v.match(/medium\.com\/@([A-Za-z0-9_.-]+)/i) || v.match(/^@?([A-Za-z0-9_.-]+)$/); return m ? `https://medium.com/@${m[1]}` : null; },
    how: () => `${out({ href: "https://medium.com/new-story", text: "Write a short story" })} with the line in it. Medium blocks browsers, so this page can’t check it, but <code>blyggdrasil verify</code> on the command line can.`,
  },
  web: {
    name: "Website", placeholder: "https://yoursite.example/",
    toUrl: (v) => (v && isHttpsUrl(withScheme(v)) ? withScheme(v) : null),
    how: () => `Add <code>&lt;a rel="me" href="${esc(state.trunk || "your blyg")}"&gt;</code> to the page, or put the line on it.`,
  },
};

let world = null;
if (webglAvailable()) {
  try { world = createWorld({ canvas: $("#world"), tags: $("#tags"), compact: true, reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches }); } catch { world = null; }
}
if (!world) document.body.classList.add("no-webgl");

const unlock = (id) => $(id).classList.remove("locked");
const save = (name, text, type = "application/json") => {
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
const copy = async (text, btn) => {
  const was = btn.textContent;
  try { await navigator.clipboard.writeText(text); btn.textContent = "Copied"; } catch { btn.textContent = "Select it above to copy"; }
  setTimeout(() => (btn.textContent = was), 1500);
};

// Rows with a usable address, in order. These become the tree's branches.
function branches() {
  const good = [];
  const bad = [];
  for (const r of state.rows) {
    const v = r.value.trim();
    if (!v) continue;
    const url = NETS[r.net].toUrl(v);
    if (url && !good.some((g) => g.url === url)) good.push({ url, row: r }); else if (!url) bad.push(`${NETS[r.net].name}: ${v}`);
  }
  return { good, bad };
}

function draw(force = false) {
  if (!world) return;
  const { good } = branches();
  const key = JSON.stringify([state.trunk, good.map((g) => g.url)]);
  if (!force && key === state.drawn) return;
  state.drawn = key;
  world.setTree({
    seed: state.trunk || "your blyg",
    title: state.title || "your blyg",
    subtitle: state.trunk ? host(state.trunk) : "the trunk",
    branches: good.map(({ url }) => { const [label, sub] = branchLabel(url); return { label, sub, url }; }),
    verdictText: () => WORDS.pending,
  });
  good.forEach(({ row }, index) => {
    if (row.verdict) world.setVerdict(index, row.verdict, WORDS[row.verdict]);
  });
}
draw(true);

function summarize() {
  const { good, bad } = branches();
  const o = $("#branches-out");
  o.className = bad.length ? "note warn" : "note";
  o.textContent = bad.length ? `Not usable yet: ${bad.join(", ")}` : good.length ? `${good.length === 1 ? "One branch" : `${good.length} branches`}. Check them once you’ve posted the line.` : "";
  if (good.length) unlock("#s4");
}

function renderRows() {
  const list = $("#accts");
  list.innerHTML = state.rows.map((r, i) => `<li class="acct" data-i="${i}">
    <span class="net">${NETS[r.net].name}</span>
    <input value="${esc(r.value)}" placeholder="${esc(NETS[r.net].placeholder)}" aria-label="${NETS[r.net].name} account" spellcheck="false" autocapitalize="off">
    <button class="x" type="button" aria-label="Remove ${NETS[r.net].name}">×</button>
    <span class="how">${NETS[r.net].how(r.value)}</span>
    <span class="st ${r.verdict || ""}">${r.verdict ? `${WORDS[r.verdict]}${r.detail ? ` · ${esc(r.detail)}` : ""}` : ""}</span>
  </li>`).join("");
  list.querySelectorAll(".acct").forEach((li) => {
    const r = state.rows[+li.dataset.i];
    li.querySelector("input").addEventListener("input", (e) => {
      r.value = e.target.value;
      r.verdict = null;
      li.querySelector(".how").innerHTML = NETS[r.net].how(r.value);
      li.querySelector(".st").textContent = "";
      summarize();
      clearTimeout(timer);
      timer = setTimeout(() => draw(), 700);
    });
    li.querySelector(".x").addEventListener("click", () => { state.rows.splice(+li.dataset.i, 1); renderRows(); summarize(); draw(); });
  });
}
let timer = 0;
for (const b of document.querySelectorAll("[data-add]")) b.addEventListener("click", () => {
  state.rows.push({ net: b.dataset.add, value: "" });
  renderRows();
  $("#accts").lastElementChild?.querySelector("input")?.focus();
});

$("#f1").addEventListener("submit", async (e) => {
  e.preventDefault();
  const o = $("#trunk-out");
  const v = $("#trunk").value.trim();
  if (!v) { o.className = "note warn"; o.textContent = "Enter your blyg’s address first."; return; }
  o.className = "note";
  o.textContent = "Looking…";
  const r = await resolveBlyg(v, get);
  if (r.error) { o.className = "note warn"; o.textContent = `No blyg answers at ${v}. Check the address, or start one at blygger.org/start.`; return; }
  state.trunk = r.origin;
  state.title = r.manifest.title || host(r.origin);
  o.textContent = `Found ${state.title}${r.manifest.author?.name ? `, by ${r.manifest.author.name}` : ""}.`;
  if (!(await signatureSupport())) { o.className = "note warn"; o.textContent += " This browser can’t make Ed25519 keys; try a current Chrome, Safari or Firefox."; return; }
  unlock("#s2");
  refreshProof();
  draw(true);
});

function showKeys() {
  $("#keys-out").hidden = false;
  $("#key-did").textContent = `main      ${state.main.did}${state.recoveryDid ? `\nrecovery  ${state.recoveryDid}` : "\nno recovery key in this file"}`;
  $("#save-recovery").hidden = !state.recoveryFile;
  $("#hud-key").textContent = `Key · ${fingerprint(state.main.did)}`;
  refreshProof();
}

$("#make-keys").addEventListener("click", async () => {
  state.mainFile = await generateKey("main");
  state.recoveryFile = await generateKey("recovery");
  state.main = await importKeyFile(state.mainFile);
  state.recoveryDid = state.recoveryFile.did;
  $("#saved").checked = false;
  showKeys();
});

$("#load-key").addEventListener("change", async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  try {
    state.mainFile = JSON.parse(await f.text());
    state.main = await importKeyFile(state.mainFile);
    state.recoveryFile = null;
    state.recoveryDid = null;
    $("#saved").checked = true;
    showKeys();
    unlock("#s3");
  } catch (err) {
    $("#keys-out").hidden = false;
    $("#key-did").textContent = `That file isn’t a Blyggdrasil key: ${err.message}`;
  }
});
$("#save-main").addEventListener("click", () => save("blyggdrasil-main-key.json", JSON.stringify(state.mainFile, null, 2) + "\n"));
$("#save-recovery").addEventListener("click", () => save("blyggdrasil-recovery-key.json", JSON.stringify(state.recoveryFile, null, 2) + "\n"));
$("#saved").addEventListener("change", (e) => { if (e.target.checked) { unlock("#s3"); if (!state.rows.length) { state.rows.push({ net: "x", value: "" }); renderRows(); } } });

function refreshProof() {
  if (line()) $("#proof-line").textContent = line();
  if (state.rows.length) renderRows();
}
$("#copy-proof").addEventListener("click", (e) => copy($("#proof-line").textContent, e.target));

$("#check").addEventListener("click", async () => {
  const { good } = branches();
  const o = $("#branches-out");
  if (!good.length || !state.main) { o.className = "note warn"; o.textContent = "Add at least one account first."; return; }
  draw(true);
  o.className = "note";
  o.textContent = "Checking each account…";
  const results = await Promise.all(good.map(async ({ url, row }, i) => {
    const r = await checkBranch(url, { keys: [state.main.did], trunk: state.trunk, get });
    Object.assign(row, { verdict: r.verdict, detail: r.verdict === "verified" ? r.detail : "" });
    world?.setVerdict(i, r.verdict, WORDS[r.verdict]);
    return r;
  }));
  renderRows();
  const dark = results.filter((r) => r.verdict !== "verified").length;
  o.textContent = dark ? `${dark === 1 ? "One branch isn’t" : `${dark} branches aren’t`} lit yet. Post the line there, then check again. Medium can only be checked from the command line.` : "Every branch is lit.";
});

$("#sign").addEventListener("click", async () => {
  const { good, bad } = branches();
  const o = $("#branches-out");
  if (bad.length || !good.length) { o.className = "note warn"; o.textContent = bad.length ? `Fix these first: ${bad.join(", ")}` : "Add at least one account."; return; }
  const claims = { trunk: state.trunk, key: state.main.did, branches: good.map((g) => g.url), recovery: state.recoveryDid ? [state.recoveryDid] : [] };
  let body;
  try { body = serializeClaims(claims); } catch (err) { o.className = "note warn"; o.textContent = err.message; return; }
  const intro = `These accounts are mine, and this key signs for them. Each one carries the line \`${proofLine(claims)}\`. Check it at <https://fishbiscuit.me/blyggdrasil/#blyg=${host(state.trunk)}>.`;
  $("#tree-md").value = treeMarkdown(body, await signClaims(body, [state.main]), intro);
  $("#tree-out").hidden = false;
  publishedDraft = { origin: claims.trunk, key: claims.key, body };
  publicationRun++;
  $("#s5").hidden = false;
  $("#published-status").textContent = "";
  $("#published-accounts").hidden = true;
  $("#published-actions").hidden = true;
  $("#check-published-form button").disabled = false;
});
$("#copy-tree").addEventListener("click", (e) => copy($("#tree-md").value, e.target));
$("#save-tree").addEventListener("click", () => save("blyggdrasil-tree.md", $("#tree-md").value + "\n", "text/markdown"));

$("#published-url").addEventListener("input", () => {
  publicationRun++;
  $("#published-actions").hidden = true;
  $("#published-accounts").hidden = true;
  $("#published-status").textContent = "";
  $("#check-published-form button").disabled = false;
});

$("#check-published-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!publishedDraft) return;
  const run = ++publicationRun;
  const button = event.currentTarget.querySelector("button");
  const status = $("#published-status");
  const accounts = $("#published-accounts");
  const actions = $("#published-actions");
  button.disabled = true;
  status.className = "note";
  status.textContent = "Checking the post and its account proofs…";
  accounts.hidden = true;
  actions.hidden = true;
  const result = await checkPublishedTree(publishedDraft, $("#published-url").value.trim(), getPublicTree)
    .catch(() => ({ error: "The check could not finish. Try again." }));
  if (run !== publicationRun) return;
  button.disabled = false;
  if (result.error) {
    status.className = "note warn";
    status.textContent = result.error;
    return;
  }
  const pending = result.branches.filter(({ verdict }) => verdict !== "verified").length;
  status.textContent = pending
    ? "Your blyg points to the signed tree. Check the account results below."
    : "Your blyg points to the signed tree. All listed account proofs verified.";
  accounts.replaceChildren(...result.branches.map(({ url, verdict, detail }) => {
    const [network, account] = branchLabel(url);
    const row = document.createElement("li");
    row.textContent = [`${network} · ${account}`, PUBLISHED_WORDS[verdict] || "Couldn’t verify", detail].filter(Boolean).join(" — ");
    return row;
  }));
  accounts.hidden = !result.branches.length;
  const byUrl = new Map(result.branches.map((branch) => [branch.url, branch]));
  for (const { url, row } of branches().good) {
    const branch = byUrl.get(url);
    if (branch) Object.assign(row, { verdict: branch.verdict, detail: branch.verdict === "verified" ? branch.detail : "" });
  }
  renderRows();
  draw(true);
  const tree = new URL("../tree/", location.href);
  tree.searchParams.set("blyg", result.origin);
  $("#check-link").href = tree.href;
  actions.hidden = false;
});

$("#copy-tree-link").addEventListener("click", (event) => copy($("#check-link").href, event.currentTarget));

const pre = new URLSearchParams(location.hash.slice(1)).get("blyg");
if (pre) { $("#trunk").value = pre; $("#f1").requestSubmit(); }
