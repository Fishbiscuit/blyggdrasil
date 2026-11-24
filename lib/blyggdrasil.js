// Blyggdrasil 0.1 core: keys, claims, signatures, tree validity and discovery.
// One ES module for browsers and Node 20+. No dependencies: WebCrypto only.
// The spec is SPEC.md beside this folder; section numbers below refer to it.

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();

export const VERSION_LINE = "blyggdrasil 1";
export const CLAIMS_FENCE = "```blyggdrasil";
export const SIG_FENCE = "```blyggdrasil-signature";
const CLOSE_FENCE = "```";
const ID_RE = /[0-9abcdefghjkmnpqrstvwxyz]{26}/g;
const LIMITS = { lines: 256, branch: 64, recovery: 4, previous: 1, "recovered-from": 1, "moved-from": 8, trunk: 1, key: 1 };

// ---------- encodings ----------

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58btcEncode(bytes) {
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) { carry += digits[i] << 8; digits[i] = carry % 58; carry = (carry / 58) | 0; }
    while (carry) { digits.push(carry % 58); carry = (carry / 58) | 0; }
  }
  let out = "";
  for (const byte of bytes) { if (byte === 0) out += "1"; else break; }
  for (let i = digits.length - 1; i >= 0; i--) out += B58[digits[i]];
  return out;
}

export function base58btcDecode(text) {
  const bytes = [0];
  for (const ch of text) {
    const v = B58.indexOf(ch);
    if (v < 0) throw new Error("not base58btc");
    let carry = v;
    for (let i = 0; i < bytes.length; i++) { carry += bytes[i] * 58; bytes[i] = carry & 0xff; carry >>= 8; }
    while (carry) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  for (const ch of text) { if (ch === "1") bytes.push(0); else break; }
  return Uint8Array.from(bytes.reverse());
}

export function b64url(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64url(text) {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error("not base64url");
  const pad = text.length % 4 ? "=".repeat(4 - (text.length % 4)) : "";
  const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

// ---------- keys (§3) ----------

export function didFromPublicKey(raw) {
  if (raw.length !== 32) throw new Error("an Ed25519 public key is 32 bytes");
  return "did:key:z" + base58btcEncode(Uint8Array.from([0xed, 0x01, ...raw]));
}

export function publicKeyFromDid(did) {
  if (typeof did !== "string" || !did.startsWith("did:key:z")) throw new Error("not a did:key");
  const bytes = base58btcDecode(did.slice(9));
  if (bytes.length !== 34 || bytes[0] !== 0xed || bytes[1] !== 0x01) throw new Error("not an Ed25519 did:key");
  return bytes.slice(2);
}

export const isDidKey = (s) => { try { publicKeyFromDid(s); return true; } catch { return false; } };

// A key file is the private JWK plus its did. It never leaves the owner's machine.
export async function generateKey(label = "main") {
  const pair = await subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const jwk = await subtle.exportKey("jwk", pair.privateKey);
  return { blyggdrasil_key: 1, label, did: didFromPublicKey(fromB64url(jwk.x)), jwk: { kty: "OKP", crv: "Ed25519", x: jwk.x, d: jwk.d } };
}

export async function importKeyFile(file) {
  if (!file || file.blyggdrasil_key !== 1 || !file.jwk?.d) throw new Error("not a Blyggdrasil key file");
  const did = didFromPublicKey(fromB64url(file.jwk.x));
  if (file.did && file.did !== did) throw new Error("key file did does not match its key");
  const privateKey = await subtle.importKey("jwk", { ...file.jwk, key_ops: ["sign"], ext: true }, { name: "Ed25519" }, false, ["sign"]);
  return { did, label: file.label || "main", privateKey };
}

export async function signBytes(key, bytes) {
  return b64url(new Uint8Array(await subtle.sign({ name: "Ed25519" }, key.privateKey, bytes)));
}

export async function verifyBytes(did, bytes, sig) {
  try {
    const pub = await subtle.importKey("raw", publicKeyFromDid(did), { name: "Ed25519" }, false, ["verify"]);
    return await subtle.verify({ name: "Ed25519" }, pub, fromB64url(sig), bytes);
  } catch {
    return false;
  }
}

export async function signatureSupport() {
  try { await subtle.generateKey({ name: "Ed25519" }, false, ["sign"]); return true; } catch { return false; }
}

// ---------- claims (§4.2) ----------

export function parseClaims(body) {
  const lines = body.split("\n");
  if (lines[0] !== VERSION_LINE) return { ok: false, error: `the first line must be "${VERSION_LINE}"` };
  if (lines.length > LIMITS.lines) return { ok: false, error: "more than 256 lines" };
  const fields = { trunk: [], key: [], branch: [], recovery: [], previous: [], "recovered-from": [], "moved-from": [] };
  const unknown = [];
  for (const [i, line] of lines.slice(1).entries()) {
    const m = line.match(/^([a-z][a-z0-9-]*) (\S+)$/);
    if (!m) return { ok: false, error: `line ${i + 2} is not "<field> <value>"` };
    if (fields[m[1]]) fields[m[1]].push(m[2]); else unknown.push(m[1]);
  }
  for (const [name, list] of Object.entries(fields)) {
    if (list.length > LIMITS[name]) return { ok: false, error: `too many ${name} lines` };
  }
  if (fields.trunk.length !== 1) return { ok: false, error: "exactly one trunk is required" };
  if (fields.key.length !== 1) return { ok: false, error: "exactly one key is required" };
  const trunk = fields.trunk[0];
  if (!isHttpsUrl(trunk) || !trunk.endsWith("/")) return { ok: false, error: "trunk must be an https URL ending in /" };
  for (const k of [...fields.key, ...fields.recovery, ...fields.previous]) if (!isDidKey(k)) return { ok: false, error: `${k} is not an Ed25519 did:key` };
  for (const u of [...fields.branch, ...fields["moved-from"]]) if (!isHttpsUrl(u)) return { ok: false, error: `${u} is not an https URL` };
  const rf = fields["recovered-from"][0];
  if (rf && !/^v[1-9][0-9]*$/.test(rf)) return { ok: false, error: "recovered-from must be v<n>" };
  if (rf && !fields.previous.length) return { ok: false, error: "recovered-from needs previous" };
  return {
    ok: true,
    claims: {
      trunk, key: fields.key[0], branches: fields.branch, recovery: fields.recovery,
      previous: fields.previous[0] || null, recoveredFrom: rf ? Number(rf.slice(1)) : null, movedFrom: fields["moved-from"], unknown,
    },
  };
}

export function serializeClaims(c) {
  const lines = [VERSION_LINE, `trunk ${c.trunk}`, `key ${c.key}`];
  for (const b of c.branches || []) lines.push(`branch ${b}`);
  for (const r of c.recovery || []) lines.push(`recovery ${r}`);
  if (c.previous) lines.push(`previous ${c.previous}`);
  if (c.recoveredFrom) lines.push(`recovered-from v${c.recoveredFrom}`);
  for (const m of c.movedFrom || []) lines.push(`moved-from ${m}`);
  const body = lines.join("\n");
  const check = parseClaims(body);
  if (!check.ok) throw new Error(check.error);
  return body;
}

// Splits content_md into the claims body and signature blocks (§4.2, §4.3).
export function extractBlocks(md) {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const claims = [];
  const sigs = [];
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i];
    if (open !== CLAIMS_FENCE && open !== SIG_FENCE) continue;
    const body = [];
    let j = i + 1;
    while (j < lines.length && lines[j] !== CLOSE_FENCE) body.push(lines[j++]);
    if (j >= lines.length) return { ok: false, error: "a blyggdrasil block is not closed" };
    if (open === CLAIMS_FENCE) claims.push(body.join("\n"));
    else {
      const k = body[0]?.match(/^key (\S+)$/);
      const s = body[1]?.match(/^sig ([A-Za-z0-9_-]+)$/);
      if (body.length !== 2 || !k || !s) return { ok: false, error: "a signature block must be exactly a key line and a sig line" };
      sigs.push({ key: k[1], sig: s[1] });
    }
    i = j;
  }
  if (claims.length !== 1) return { ok: false, error: claims.length ? "more than one claims block" : "no claims block" };
  return { ok: true, body: claims[0], signatures: sigs };
}

export async function signClaims(body, keys) {
  const bytes = enc.encode(body);
  const out = [];
  for (const k of keys) out.push({ key: k.did, sig: await signBytes(k, bytes) });
  return out;
}

export function treeMarkdown(body, signatures, intro = "") {
  const blocks = [`${CLAIMS_FENCE}\n${body}\n${CLOSE_FENCE}`, ...signatures.map((s) => `${SIG_FENCE}\nkey ${s.key}\nsig ${s.sig}\n${CLOSE_FENCE}`)];
  return (intro.trim() ? `${intro.trim()}\n\n` : "") + blocks.join("\n\n");
}

export const proofLine = (claims) => `Blyggdrasil: ${claims.key} ${claims.trunk}`;

// ---------- tree validity (§4.4, §7) ----------

// fetchPinned(n) returns the content_md of pinned version n of the same item, or null.
export async function validateTree(md, origin, { fetchPinned } = {}) {
  const blocks = extractBlocks(md);
  if (!blocks.ok) return { valid: false, reason: blocks.error };
  const parsed = parseClaims(blocks.body);
  if (!parsed.ok) return { valid: false, reason: parsed.error };
  const c = parsed.claims;
  if (normOrigin(c.trunk) !== normOrigin(origin)) return { valid: false, reason: `the tree names ${c.trunk} but was published at ${origin}`, claims: c };
  const bytes = enc.encode(blocks.body);
  const signedBy = new Set();
  for (const s of blocks.signatures) if (await verifyBytes(s.key, bytes, s.sig)) signedBy.add(s.key);
  if (!signedBy.has(c.key)) return { valid: false, reason: "no valid signature by the tree's key", claims: c };
  const keys = [c.key];
  const history = [];
  if (c.previous) {
    if (c.recoveredFrom) {
      if (!fetchPinned) return { valid: false, reason: "recovery needs the pinned earlier tree, and this reader can't fetch it", claims: c };
      const old = await fetchPinned(c.recoveredFrom);
      if (!old) return { valid: false, reason: `pinned version v${c.recoveredFrom} is not available`, claims: c };
      const prior = await validateTree(old, origin, {});
      if (!prior.valid) return { valid: false, reason: `pinned version v${c.recoveredFrom} is not a valid tree: ${prior.reason}`, claims: c };
      if (prior.claims.key !== c.previous) return { valid: false, reason: `pinned version v${c.recoveredFrom} has a different key`, claims: c };
      const rk = prior.claims.recovery.find((r) => signedBy.has(r));
      if (!rk) return { valid: false, reason: "no valid signature by a recovery key from the pinned tree", claims: c };
      history.push({ how: "recovered", key: c.previous, by: rk, from: `v${c.recoveredFrom}` });
    } else {
      if (!signedBy.has(c.previous)) return { valid: false, reason: "a rotated tree must also be signed by its previous key", claims: c };
      history.push({ how: "rotated", key: c.previous });
    }
    keys.push(c.previous);
  }
  return { valid: true, claims: c, keys, history, signedBy: [...signedBy] };
}

// ---------- signed bylines (§6) ----------

export async function signByline(key, contentHash) {
  return { key: key.did, value: await signBytes(key, enc.encode(contentHash)) };
}

export async function verifyByline(doc, keys) {
  const sig = doc?.author?.sig;
  if (!sig || typeof sig.key !== "string" || typeof sig.value !== "string") return { signed: false };
  const ok = await verifyBytes(sig.key, enc.encode(String(doc.content_hash)), sig.value);
  return { signed: ok, key: sig.key, byTree: ok && keys.includes(sig.key) };
}

// ---------- URLs and back-references (§5.1) ----------

// Local development only (Blygger §12.1 lets readers permit http: for local work): when switched on,
// http://localhost and http://127.0.0.1 count as https. Off unless a page on localhost or the CLI asks.
let devLocal = false;
export function allowLocalDevelopment(on = true) { devLocal = !!on; }

export function isHttpsUrl(s) {
  try {
    const u = new URL(s);
    if (u.username || u.password || !u.host) return false;
    if (u.protocol === "https:") return true;
    return devLocal && u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}

export function normOrigin(s) {
  const u = new URL(s);
  return `${u.protocol}//${u.host.toLowerCase()}${u.pathname}`;
}

export function matchForm(s) {
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(s) ? s : `https://${s}`);
    return (u.host.toLowerCase().replace(/^www\./, "") + u.pathname).replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export function linksTo(url, trunk) {
  const a = matchForm(url);
  const t = matchForm(trunk);
  return !!a && !!t && (a === t || a.startsWith(t + "/"));
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export function htmlText(html) {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&([a-z]+);/gi, (m, e) => ENTITIES[e.toLowerCase()] ?? m);
}

export function htmlHrefs(html) {
  return [...String(html || "").matchAll(/href\s*=\s*"([^"]*)"|href\s*=\s*'([^']*)'/gi)].map((m) => htmlText(m[1] ?? m[2]));
}

// Finds a back-reference in text and links. Returns { method, key? } or null.
export function backReference({ texts = [], links = [] }, { keys, trunk }) {
  for (const t of texts) for (const k of keys) if (t && t.includes(k)) return { method: "key", key: k };
  const urlsInText = texts.flatMap((t) => String(t || "").match(/(?:https?:\/\/)?[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s<>"')\]]*)?/gi) || []);
  for (const l of [...links, ...urlsInText]) if (linksTo(l, trunk)) return { method: "link" };
  return null;
}

// ---------- discovery (§4.5) ----------

export const itemIdIn = (url) => { try { return (new URL(url).pathname.match(ID_RE) || []).at(-1) || null; } catch { return null; } };

export function treePointer(manifest) {
  if (typeof manifest?.blyggdrasil === "string") return manifest.blyggdrasil;
  const link = (manifest?.author?.links || []).find((l) => String(l?.label || "").trim().toLowerCase() === "blyggdrasil");
  return link?.url || null;
}

export function itemUrl(origin, manifest, id) {
  const t = typeof manifest?.item === "string" ? manifest.item : "items/{id}.json";
  return new URL(t.replace("{id}", id), origin).toString();
}

export function pinUrl(origin, manifest, id, n) {
  const t = typeof manifest?.pin === "string" ? manifest.pin : "items/{id}/v{n}.json";
  return new URL(t.replace("{id}", id).replace("{n}", String(n)), origin).toString();
}

// Resolves an input to { origin, manifest } with Blygger §12's direct and conventional probes.
export async function resolveBlyg(input, getJson) {
  let u;
  try { u = new URL(/^[a-z]+:\/\//i.test(input) ? input : `https://${input}`); } catch { return { error: "not a URL" }; }
  u.hash = ""; u.search = "";
  const candidates = [];
  const path = u.pathname.endsWith("/") ? u.pathname : u.pathname + "/";
  const id = itemIdIn(u.toString());
  const base = id ? path.slice(0, path.search(/(?:items\/|[ft]\/)?[0-9a-z]{26}/)) : path;
  candidates.push(`${u.origin}${base}`);
  if (base !== path) candidates.push(`${u.origin}${path}`);
  candidates.push(`${u.origin}/blyg/`, `${u.origin}/`);
  const tried = [];
  for (const c of [...new Set(candidates)]) {
    tried.push(c);
    const r = await getJson(`${c}blyg.json`);
    if (r.ok && r.json && typeof r.json.blyg === "string") {
      const origin = r.url ? r.url.replace(/blyg\.json$/, "") : c;
      return { origin, manifest: r.json, itemId: id };
    }
  }
  return { error: "no blyg found", tried };
}

// Loads and validates the tree for a blyg. getJson(url) → { ok, status, json, url }.
export async function loadTree(input, getJson) {
  const blyg = await resolveBlyg(input, getJson);
  if (blyg.error) return blyg;
  return loadTreeAt(blyg.origin, blyg.manifest, getJson, blyg.itemId ? input : null);
}

// Same as loadTree once the blyg is resolved: one fetch for the tree, one per pinned version.
export async function loadTreeAt(origin, manifest, getJson, pointerOverride = null) {
  const pointer = pointerOverride || treePointer(manifest);
  const id = pointer ? itemIdIn(pointer) : null;
  if (!id) return { origin, manifest, tree: null };
  const r = await getJson(itemUrl(origin, manifest, id));
  if (!r.ok || !r.json) return { origin, manifest, tree: { valid: false, reason: `the tree post could not be fetched (${r.status || "network"})` } };
  const doc = r.json;
  if (doc.kind === "withdrawn") return { origin, manifest, doc, tree: { valid: false, reason: "the tree was withdrawn" } };
  const fetchPinned = async (n) => {
    const p = await getJson(pinUrl(origin, manifest, id, n));
    return p.ok && typeof p.json?.content_md === "string" ? p.json.content_md : null;
  };
  const tree = await validateTree(String(doc.content_md || ""), origin, { fetchPinned });
  return { origin, manifest, doc, tree };
}

// Links a blyg claims without a tree: manifest author.links and https author.ids (§4.5).
export function claimedLinks(manifest) {
  const out = [];
  for (const l of manifest?.author?.links || []) if (isHttpsUrl(l?.url) && String(l.label || "").toLowerCase() !== "blyggdrasil") out.push({ url: l.url, label: l.label || "" });
  for (const id of manifest?.author?.ids || []) if (isHttpsUrl(id) && !out.some((o) => o.url === id)) out.push({ url: id, label: "" });
  return out;
}
