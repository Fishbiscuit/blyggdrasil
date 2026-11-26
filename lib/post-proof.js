import {
  htmlText, isDidKey, isHttpsUrl, itemIdIn, itemUrl, loadTreeAt, pinUrl,
  resolveBlyg, signatureSupport, treePointer, verifyByline,
} from "./blyggdrasil.js";

const ID = /^[0-7][0-9abcdefghjkmnpqrstvwxyz]{25}$/;
const HASH = /^sha256:[0-9a-f]{64}$/;
const encoder = new TextEncoder();
const positiveVersion = (value) => Number.isSafeInteger(value) && value > 0;

function address(value, base) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value, base).href;
    return isHttpsUrl(url) ? url : null;
  } catch {
    return null;
  }
}

function originAddress(value) {
  const url = address(value);
  if (!url) return null;
  const parsed = new URL(url);
  return !parsed.search && !parsed.hash && parsed.pathname.endsWith("/") ? url : null;
}

function postIdentity(doc, origin, id) {
  return doc?.id === id && originAddress(doc.origin) === origin && positiveVersion(doc.version);
}

function itemKind(doc) {
  return doc?.kind === "fragment" || doc?.kind === "thread";
}

function postSource(doc) {
  const entries = Array.isArray(doc.syndication) ? doc.syndication : [];
  for (const entry of entries) {
    if (entry?.version !== doc.version) continue;
    const url = address(entry.url);
    if (url) return { sourceUrl: url, sourceKind: "syndication" };
  }
  const footer = typeof doc.content_md === "string"
    ? doc.content_md.match(/\n+\[Original post by @(\w+)\]\((https:\/\/[^)\s]+)\)\.?\s*$/)
    : null;
  if (!footer) return {};
  const url = address(footer[2]);
  if (!url) return {};
  const { hostname, pathname } = new URL(url);
  if (/^(?:www\.)?(?:x|twitter)\.com$/i.test(hostname) &&
      new RegExp(`^/${footer[1]}/status/\\d+/?$`, "i").test(pathname)) {
    return { sourceUrl: url, sourceKind: "archive-footer" };
  }
  return {};
}

function alternateItem(html, base) {
  for (const tag of String(html ?? "").matchAll(/<link\b[^>]*>/gi)) {
    const attributes = Object.fromEntries([...tag[0].matchAll(/([^\s=<>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)]
      .map((match) => [match[1].toLowerCase(), match[2] ?? match[3] ?? match[4]]));
    if (!attributes.rel?.toLowerCase().split(/\s+/).includes("alternate") ||
        attributes.type?.toLowerCase() !== "application/json" || !attributes.href) continue;
    try {
      const alternate = address(htmlText(attributes.href), base);
      if (alternate && new URL(alternate).origin === new URL(base).origin) return alternate;
    } catch {
      // An invalid encoded link cannot establish post identity.
    }
  }
  return null;
}

async function locate(input, get) {
  const id = itemIdIn(input);
  if (ID.test(id || "")) {
    const blyg = await resolveBlyg(input, get);
    const origin = originAddress(blyg.origin);
    if (origin) return { origin, manifest: blyg.manifest, id };
  }
  // Custom pages can advertise their canonical JSON counterpart via HTML discovery.
  let response = await get(input);
  let discovered = input;
  let page;
  if (!response.ok || !ID.test(response.json?.id || "")) {
    const html = await get(input, { as: "text" });
    if (!html.ok) return {};
    page = address(html.url || input);
    discovered = alternateItem(html.text, page);
    if (!discovered) return {};
    response = await get(discovered);
  }
  const doc = response.json;
  const origin = originAddress(doc?.origin);
  if (!response.ok || !ID.test(doc?.id || "") || !origin || !positiveVersion(doc.version) ||
      new URL(origin).origin !== new URL(input).origin) return {};
  const blyg = await resolveBlyg(origin, get);
  if (originAddress(blyg.origin) !== origin) return {};
  const manifest = blyg.manifest;
  const currentUrl = itemUrl(origin, manifest, doc.id);
  const historicalUrl = pinUrl(origin, manifest, doc.id, doc.version);
  const finalUrl = address(response.url || discovered);
  if (finalUrl !== currentUrl && finalUrl !== historicalUrl) return {};
  return { origin, manifest, id: doc.id, page, pin: finalUrl === historicalUrl ? doc.version : null };
}

function pinnedVersion(url, origin, manifest, id) {
  const marker = "5140268397";
  const template = pinUrl(origin, manifest, id, marker);
  const first = template.indexOf(marker);
  if (first !== -1) {
    const before = template.slice(0, first);
    const after = template.slice(first + marker.length);
    if (url.startsWith(before) && url.endsWith(after)) {
      const raw = url.slice(before.length, after.length ? -after.length : undefined);
      if (/^[1-9]\d*$/.test(raw)) return Number(raw);
    }
  }
  const path = new URL(url).pathname;
  const suffix = path.match(new RegExp(`/${id}/v([1-9]\\d*)(?:\\.json)?/?$`));
  return suffix ? Number(suffix[1]) : null;
}

function unavailable(report, error) {
  return { ...report, status: "unavailable", error };
}

async function hashMarkdown(markdown) {
  const bytes = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", encoder.encode(markdown)));
  return "sha256:" + Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function authorizeSigner(origin, manifest, signingKey, get) {
  const pointer = treePointer(manifest);
  const id = itemIdIn(address(pointer, origin));
  if (!ID.test(id || "")) return { verdict: "unavailable", error: "The blyg does not publish a signed tree." };
  const treeUrl = itemUrl(origin, manifest, id);
  let missing = false;
  const checked = await loadTreeAt(origin, manifest, async (url) => {
    const result = await get(url);
    if (!result.ok) {
      missing = true;
      return result;
    }
    const doc = result.json;
    const identityMatches = postIdentity(doc, origin, id);
    const pinMatches = url === treeUrl || (doc?.pinned === true && url === pinUrl(origin, manifest, id, doc.version));
    if (!identityMatches || !pinMatches || (!itemKind(doc) && doc.kind !== "withdrawn")) {
      return { ok: false, status: 0 };
    }
    return result;
  }, address(pointer, origin));
  if (missing) return { verdict: "unavailable", treeUrl, error: "The signed tree or its recovery record could not be fetched." };
  if (!checked.tree?.valid) return { verdict: "invalid", treeUrl, error: checked.tree?.reason || "The signed tree is invalid." };
  return { verdict: checked.tree.keys.includes(signingKey) ? "valid" : "invalid", treeUrl };
}

// Trust the manifest at the post's origin for the item, historical versions, and tree.
// The optional expected key is an independent check against an externally known key.
export async function verifyPost(input, get, { version, expectedKey } = {}) {
  const checks = { content: "unavailable", signature: "unavailable", signer: "unavailable" };
  const report = {
    input, origin: null, itemUrl: null, pageUrl: null, itemId: null, version: null,
    signingKey: null, sourceUrl: null, pinned: false, checks,
  };
  const url = address(input);
  if (!url) return unavailable(report, "Use an absolute HTTPS Blygger post URL.");
  if (version !== undefined && !positiveVersion(version)) return unavailable(report, "A version must be a positive whole number.");
  if (expectedKey !== undefined && !isDidKey(expectedKey)) return unavailable(report, "The expected key must be an Ed25519 did:key.");
  const base = new URL(url);
  base.hash = "";
  // Keep redirects within the requested authority. A custom item template can use
  // another HTTPS host explicitly, but the final fetch must stay on that host.
  const safeGet = async (target, options) => {
    const requested = address(target);
    if (!requested) return { ok: false, status: 0 };
    try {
      const result = await get(requested, options);
      const final = address(result?.url || requested);
      if (!final || new URL(final).origin !== new URL(requested).origin) return { ok: false, status: 0 };
      return result ?? { ok: false, status: 0 };
    } catch {
      return { ok: false, status: 0 };
    }
  };

  let doc;
  let manifest;
  try {
    const located = await locate(base.href, safeGet);
    const { origin, id, page } = located;
    if (!origin) return unavailable(report, "No canonical Blygger post could be found.");
    manifest = located.manifest;
    Object.assign(report, { origin, itemId: id, manifestUrl: new URL("blyg.json", origin).href });
    const explicitPin = located.pin ?? pinnedVersion(base.href, origin, manifest, id);
    if (explicitPin !== null && (!positiveVersion(explicitPin) || (version !== undefined && version !== explicitPin))) {
      return unavailable(report, "The URL and requested version do not identify the same post version.");
    }
    const requestedVersion = version ?? explicitPin;
    report.itemUrl = explicitPin === null ? itemUrl(origin, manifest, id) : pinUrl(origin, manifest, id, explicitPin);
    let response = await safeGet(report.itemUrl);
    if (explicitPin === null && requestedVersion !== null &&
        (!response.ok || response.json?.version !== requestedVersion)) {
      report.itemUrl = pinUrl(origin, manifest, id, requestedVersion);
      response = await safeGet(report.itemUrl);
    }
    if (!response.ok || !response.json) return unavailable(report, "The post or requested version could not be fetched.");
    doc = response.json;
    report.pinned = explicitPin !== null || report.itemUrl !== itemUrl(origin, manifest, id);
    if (!postIdentity(doc, origin, id) || (requestedVersion !== null && doc.version !== requestedVersion) ||
        (report.pinned && doc.pinned !== true)) {
      return { ...report, status: "failed", error: "The returned data does not match the canonical post and version." };
    }
    report.version = doc.version;
    if (doc.kind === "withdrawn") return unavailable(report, "The post was withdrawn.");
    if (!itemKind(doc)) return { ...report, status: "failed", error: "The returned data is not a Blygger post." };
    report.pageUrl = address(doc.page, origin) || page || null;
    Object.assign(report, postSource(doc));
  } catch {
    return unavailable(report, "The publisher's post metadata could not be read.");
  }

  const hasHash = typeof doc.content_hash === "string" && HASH.test(doc.content_hash);
  if (hasHash && typeof doc.content_md === "string") {
    try { checks.content = (await hashMarkdown(doc.content_md)) === doc.content_hash ? "valid" : "invalid"; } catch {
      // A reader without Web Crypto cannot check the content.
    }
  } else if (doc.content_hash !== undefined && !hasHash) {
    checks.content = "invalid";
  }
  const signature = doc.author?.sig;
  if (signature === undefined) {
    checks.signature = checks.signer = "unsigned";
  } else if (!isDidKey(signature?.key) || typeof signature?.value !== "string" || !/^[A-Za-z0-9_-]{86}$/.test(signature.value)) {
    checks.signature = checks.signer = "invalid";
  } else {
    report.signingKey = signature.key;
    if (hasHash) {
      const result = await verifyByline(doc, []);
      if (result.signed) checks.signature = "valid";
      else if (await signatureSupport()) checks.signature = "invalid";
    }
    try {
      const { verdict, treeUrl, error } = await authorizeSigner(report.origin, manifest, signature.key, safeGet);
      checks.signer = verdict;
      if (treeUrl && address(treeUrl)) report.treeUrl = treeUrl;
      if (error) report.error = error;
    } catch {
      report.error = "The signed tree metadata could not be read.";
    }
  }
  if (expectedKey !== undefined) {
    report.expectedKey = expectedKey;
    report.expectedSigner = report.signingKey === expectedKey ? "valid" : report.signingKey ? "invalid" : checks.signature;
  }
  const values = [...Object.values(checks), ...(report.expectedSigner ? [report.expectedSigner] : [])];
  report.status = values.includes("invalid") ? "failed"
    : values.includes("unavailable") ? "unavailable"
      : values.includes("unsigned") ? "unsigned" : "verified";
  return report;
}
