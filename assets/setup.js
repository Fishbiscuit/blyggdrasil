import { allowLocalDevelopment, resolveBlyg, generateKey, importKeyFile, serializeClaims, signClaims, treeMarkdown, proofLine, isHttpsUrl, signatureSupport } from "../lib/blyggdrasil.js";
import { checkBranch, makeFetcher } from "../lib/resolvers.js";
import { createWorld, webglAvailable } from "./world.js";
import { branchLabel } from "./labels.js";

if (["localhost", "127.0.0.1"].includes(location.hostname)) allowLocalDevelopment();
const $ = (s) => document.querySelector(s);
const get = makeFetcher();
const state = { trunk: null, title: "", main: null, mainFile: null, recoveryFile: null, recoveryDid: null, drawn: "" };
const WORDS = { verified: "verified", failed: "no proof yet", unreachable: "can’t check here", claimed: "claimed only", pending: "not checked" };
const fingerprint = (did) => `${did.slice(8, 24).match(/.{1,4}/g).join(" ")} …${did.slice(-4)}`;

let world = null;
if (webglAvailable()) {
  try { world = createWorld({ canvas: $("#world"), tags: $("#tags"), compact: true, reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches }); } catch { world = null; }
}
if (!world) document.body.classList.add("no-webgl");

const unlock = (id) => $(id).classList.remove("locked");
const host = (u) => u.replace(/^https?:\/\//, "");
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

function branches() {
  const lines = $("#branches").value.split("\n").map((l) => l.trim()).filter(Boolean);
  const all = [...new Set(lines.map((l) => (/^[a-z]+:\/\//i.test(l) ? l : `https://${l}`)))];
  return { good: all.filter(isHttpsUrl), bad: all.filter((u) => !isHttpsUrl(u)) };
}

function draw(force = false) {
  if (!world) return;
  const { good } = branches();
  const key = JSON.stringify([state.trunk, good]);
  if (!force && key === state.drawn) return;
  state.drawn = key;
  world.setTree({
    seed: state.trunk || "your blyg",
    title: state.title || "your blyg",
    subtitle: state.trunk ? host(state.trunk) : "the trunk",
    branches: good.map((url) => { const [label, sub] = branchLabel(url); return { label, sub, url }; }),
    verdictText: () => WORDS.pending,
  });
}
draw(true);

$("#f1").addEventListener("submit", async (e) => {
  e.preventDefault();
  const out = $("#trunk-out");
  const v = $("#trunk").value.trim();
  if (!v) { out.className = "note warn"; out.textContent = "Enter your blyg’s address first."; return; }
  out.className = "note";
  out.textContent = "Looking…";
  const r = await resolveBlyg(v, get);
  if (r.error) { out.className = "note warn"; out.textContent = `No blyg answers at ${v}. Check the address, or start one at blygger.org/start.`; return; }
  state.trunk = r.origin;
  state.title = r.manifest.title || host(r.origin);
  out.textContent = `Found ${state.title}${r.manifest.author?.name ? `, by ${r.manifest.author.name}` : ""}.`;
  if (!(await signatureSupport())) { out.className = "note warn"; out.textContent += " This browser can’t make Ed25519 keys; try a current Chrome, Safari or Firefox."; return; }
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
$("#saved").addEventListener("change", (e) => { if (e.target.checked) unlock("#s3"); });

function refreshProof() {
  if (state.main && state.trunk) $("#proof-line").textContent = proofLine({ key: state.main.did, trunk: state.trunk });
}
$("#copy-proof").addEventListener("click", (e) => copy($("#proof-line").textContent, e.target));

let timer = 0;
$("#branches").addEventListener("input", () => {
  const { good, bad } = branches();
  const out = $("#branches-out");
  out.className = bad.length ? "note warn" : "note";
  out.textContent = bad.length ? `Not usable: ${bad.join(", ")}` : good.length ? `${good.length === 1 ? "One branch" : `${good.length} branches`}. Check them once you’ve posted the line.` : "";
  if (good.length) unlock("#s4");
  clearTimeout(timer);
  timer = setTimeout(() => draw(), 700);
});

$("#check").addEventListener("click", async () => {
  const { good } = branches();
  const out = $("#branches-out");
  if (!good.length || !state.main) { out.className = "note warn"; out.textContent = "List at least one account first."; return; }
  draw(true);
  out.className = "note";
  out.textContent = "Checking each account…";
  const results = await Promise.all(good.map(async (url, i) => {
    const r = await checkBranch(url, { keys: [state.main.did], trunk: state.trunk, get });
    world?.setVerdict(i, r.verdict, WORDS[r.verdict]);
    return r;
  }));
  const dark = results.filter((r) => r.verdict !== "verified").length;
  out.textContent = dark ? `${dark === 1 ? "One branch isn’t" : `${dark} branches aren’t`} lit yet. Post the line on ${dark === 1 ? "that account" : "those accounts"}, then check again.` : "Every branch is lit.";
});

$("#sign").addEventListener("click", async () => {
  const { good, bad } = branches();
  const out = $("#branches-out");
  if (bad.length || !good.length) { out.className = "note warn"; out.textContent = "List at least one account, each as an https address."; return; }
  const claims = { trunk: state.trunk, key: state.main.did, branches: good, recovery: state.recoveryDid ? [state.recoveryDid] : [] };
  let body;
  try { body = serializeClaims(claims); } catch (err) { out.className = "note warn"; out.textContent = err.message; return; }
  const intro = `These accounts are mine, and this key signs for them. Each one carries the line \`${proofLine(claims)}\`. Check it at <https://fishbiscuit.me/blyggdrasil/#blyg=${host(state.trunk)}>.`;
  $("#tree-md").value = treeMarkdown(body, await signClaims(body, [state.main]), intro);
  $("#tree-out").hidden = false;
  $("#check-link").href = `../#blyg=${host(state.trunk)}`;
});
$("#copy-tree").addEventListener("click", (e) => copy($("#tree-md").value, e.target));
$("#save-tree").addEventListener("click", () => save("blyggdrasil-tree.md", $("#tree-md").value + "\n", "text/markdown"));

const pre = new URLSearchParams(location.hash.slice(1)).get("blyg");
if (pre) { $("#trunk").value = pre; $("#f1").requestSubmit(); }
