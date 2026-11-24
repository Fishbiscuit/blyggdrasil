import { allowLocalDevelopment, resolveBlyg, generateKey, importKeyFile, serializeClaims, signClaims, treeMarkdown, proofLine, isHttpsUrl, signatureSupport } from "../lib/blyggdrasil.js";
import { makeFetcher } from "../lib/resolvers.js";

if (["localhost", "127.0.0.1"].includes(location.hostname)) allowLocalDevelopment();
const $ = (s) => document.querySelector(s);
const get = makeFetcher();
const state = { trunk: null, title: "", main: null, mainFile: null, recoveryFile: null, recoveryDid: null };

const unlock = (id) => $(id).classList.remove("locked");
const save = (name, text, type = "application/json") => {
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
const copy = async (text, btn) => {
  try { await navigator.clipboard.writeText(text); const t = btn.textContent; btn.textContent = "Copied"; setTimeout(() => (btn.textContent = t), 1400); }
  catch { btn.textContent = "Select and copy it above"; }
};
const host = (u) => u.replace(/^https:\/\//, "");

$("#f1").addEventListener("submit", async (e) => {
  e.preventDefault();
  const v = $("#trunk").value.trim();
  if (!v) return;
  $("#trunk-out").textContent = "Looking…";
  const r = await resolveBlyg(v, get);
  if (r.error) { $("#trunk-out").textContent = `No blyg found at ${v}. Check the address, or start one at blygger.org/start.`; return; }
  state.trunk = r.origin;
  state.title = r.manifest.title || r.origin;
  $("#trunk-out").textContent = `Found ${state.title}${r.manifest.author?.name ? `, by ${r.manifest.author.name}` : ""} at ${host(r.origin)}.`;
  if (!(await signatureSupport())) { $("#trunk-out").textContent += " This browser can’t make Ed25519 keys; try a current Chrome, Safari or Firefox."; return; }
  unlock("#s2");
  refreshProof();
});

function showKeys() {
  $("#keys-out").hidden = false;
  $("#key-did").textContent = `Main key      ${state.main.did}${state.recoveryDid ? `\nRecovery key  ${state.recoveryDid}` : "\nNo recovery key in this file."}`;
  $("#save-recovery").hidden = !state.recoveryFile;
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
    $("#key-did").textContent = `That file isn’t a Blyggdrasil key: ${err.message}`;
    $("#keys-out").hidden = false;
  }
});

$("#save-main").addEventListener("click", () => save(`blyggdrasil-main-key.json`, JSON.stringify(state.mainFile, null, 2) + "\n"));
$("#save-recovery").addEventListener("click", () => save(`blyggdrasil-recovery-key.json`, JSON.stringify(state.recoveryFile, null, 2) + "\n"));
$("#saved").addEventListener("change", (e) => { if (e.target.checked) unlock("#s3"); });

function refreshProof() {
  if (state.main && state.trunk) $("#proof-line").textContent = proofLine({ key: state.main.did, trunk: state.trunk });
}
$("#copy-proof").addEventListener("click", (e) => copy($("#proof-line").textContent, e.target));

function branches() {
  const lines = $("#branches").value.split("\n").map((l) => l.trim()).filter(Boolean);
  const good = [...new Set(lines.map((l) => (/^[a-z]+:\/\//i.test(l) ? l : `https://${l}`)))];
  const bad = good.filter((u) => !isHttpsUrl(u));
  return { good: good.filter(isHttpsUrl), bad };
}
$("#branches").addEventListener("input", () => {
  const { good, bad } = branches();
  $("#branches-out").textContent = bad.length ? `Not usable: ${bad.join(", ")}` : good.length ? `${good.length === 1 ? "One account" : `${good.length} accounts`} listed.` : "";
  if (good.length) unlock("#s4");
});

$("#sign").addEventListener("click", async () => {
  const { good, bad } = branches();
  if (bad.length || !good.length) { $("#branches-out").textContent = "List at least one account, each as an https address."; return; }
  const claims = { trunk: state.trunk, key: state.main.did, branches: good, recovery: state.recoveryDid ? [state.recoveryDid] : [] };
  let body;
  try { body = serializeClaims(claims); } catch (err) { $("#branches-out").textContent = err.message; return; }
  const intro = `These accounts are mine, and this key signs for them. Each one carries the line \`${proofLine(claims)}\`. Check it at <https://fishbiscuit.me/blyggdrasil/#blyg=${host(state.trunk)}>.`;
  $("#tree-md").value = treeMarkdown(body, await signClaims(body, [state.main]), intro);
  $("#tree-out").hidden = false;
  $("#check-link").href = `../#blyg=${host(state.trunk)}`;
});
$("#copy-tree").addEventListener("click", (e) => copy($("#tree-md").value, e.target));
$("#save-tree").addEventListener("click", () => save("blyggdrasil-tree.md", $("#tree-md").value + "\n", "text/markdown"));

const pre = new URLSearchParams(location.hash.slice(1)).get("blyg");
if (pre) { $("#trunk").value = pre; $("#f1").requestSubmit(); }
