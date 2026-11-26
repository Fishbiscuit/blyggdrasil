import { createHash } from "node:crypto";
import { isHttpsUrl, itemIdIn, itemUrl, pinUrl, treePointer } from "../blyggdrasil.js";

export const BUNDLE_FORMAT = "blyggdrasil/public-bundle";
export const BUNDLE_VERSION = 1;
export const MAX_DOCUMENTS = 6000;
export const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 48 * 1024 * 1024;

const ID = /^[0-7][0-9abcdefghjkmnpqrstvwxyz]{25}$/;
const kinds = new Set(["fragment", "thread", "withdrawn"]);
const isVersion = value => Number.isSafeInteger(value) && value > 0;
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);

export function hashResource(text) {
  return "sha256:" + createHash("sha256").update(text, "utf8").digest("hex");
}

export function blygOrigin(input) {
  if (!isHttpsUrl(input)) throw new Error("Supply an absolute HTTPS blyg origin.");
  const url = new URL(input);
  if (url.search || url.hash) throw new Error("A blyg origin cannot include a query or fragment.");
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url.href;
}

export function publicAddress(value, origin) {
  if (typeof value !== "string" || !value.trim()) throw new Error("The manifest has an invalid document URL.");
  const url = new URL(value, origin);
  if (!isHttpsUrl(url.href) || url.origin !== new URL(origin).origin || url.hash) {
    throw new Error("Bundle documents must use URLs on the blyg's host without fragments.");
  }
  return url.href;
}

export function decodeDocument(text, url) {
  try {
    const doc = JSON.parse(text.replace(/^\uFEFF/, ""));
    if (isObject(doc)) return doc;
  } catch {
    // Keep response bodies out of error messages.
  }
  throw new Error(`Expected a JSON object at ${url}.`);
}

function requirePublic(doc, url) {
  if (doc.private === true || doc.draft === true ||
      (doc.visibility !== undefined && doc.visibility !== "public")) {
    throw new Error(`Explicitly non-public data at ${url}; no bundle was created.`);
  }
  if (doc.kind === "withdrawn" && (doc.content_md || doc.content_html || doc.media?.length)) {
    throw new Error(`Withdrawal at ${url} still contains content.`);
  }
}

function pinnedVersions(doc, url) {
  const pins = new Set();
  for (const change of doc.changelog ?? []) {
    if (change?.pinned !== true) continue;
    if (!isVersion(change.version) || change.version > doc.version || pins.has(change.version) ||
        (doc.kind === "withdrawn" && change.version === doc.version)) {
      throw new Error(`Invalid pin declaration at ${url}.`);
    }
    pins.add(change.version);
  }
  return pins;
}

// Follow the archive index, not the feed. Current withdrawal endcaps can still
// declare earlier pins. Their content must remain reachable without exporting
// any other edition.
export async function readPublicSurface(origin, read) {
  const manifestUrl = new URL("blyg.json", origin).href;
  const manifest = await read(manifestUrl);
  requirePublic(manifest, manifestUrl);
  if (typeof manifest.blyg !== "string") throw new Error("The origin has no Blygger manifest.");
  const treeId = itemIdIn(treePointer(manifest), origin);
  if (!ID.test(treeId ?? "")) throw new Error("The manifest does not identify a Blyggdrasil tree.");

  const indexUrl = publicAddress(manifest.items ?? "items/index.json", origin);
  const index = await read(indexUrl);
  requirePublic(index, indexUrl);
  if (!Array.isArray(index.items) || index.items.length > MAX_DOCUMENTS - 2) {
    throw new Error("The archive index is missing, malformed, or too large to bundle.");
  }

  const seen = new Set();
  for (const entry of index.items) {
    if (!isObject(entry) || !ID.test(entry.id ?? "") || !isVersion(entry.version) ||
        !kinds.has(entry.kind) || seen.has(entry.id)) {
      throw new Error("The archive index lists an invalid or duplicate item.");
    }
    requirePublic(entry, indexUrl);
    seen.add(entry.id);
  }
  if (!seen.has(treeId)) throw new Error("The signed tree is absent from the archive index.");

  const items = [];
  for (const entry of index.items) {
    const url = publicAddress(itemUrl(origin, manifest, entry.id), origin);
    const doc = await read(url);
    requirePublic(doc, url);
    if (doc.origin !== origin || doc.id !== entry.id || doc.version !== entry.version ||
        doc.kind !== entry.kind) {
      throw new Error(`Item at ${url} does not match the archive index. Retry if the publisher just edited it.`);
    }
    if (doc.changelog !== undefined && !Array.isArray(doc.changelog)) {
      throw new Error(`Malformed changelog at ${url}.`);
    }
    const pins = [];
    for (const version of pinnedVersions(doc, url)) {
      const pinAddress = publicAddress(pinUrl(origin, manifest, doc.id, version), origin);
      const pin = await read(pinAddress);
      requirePublic(pin, pinAddress);
      if (pinAddress === url || pin.origin !== origin || pin.id !== doc.id || pin.version !== version ||
          pin.pinned !== true || !kinds.has(pin.kind) || pin.kind === "withdrawn" ||
          (doc.kind !== "withdrawn" && pin.kind !== doc.kind)) {
        throw new Error(`Pinned item does not match its declaration at ${pinAddress}.`);
      }
      pins.push({ url: pinAddress, doc: pin });
    }
    items.push({ url, doc, pins });
  }
  const tree = items.find(item => item.doc.id === treeId);
  if (tree.doc.kind === "withdrawn") throw new Error("The manifest's signed tree was withdrawn.");
  return { manifest, manifestUrl, index, indexUrl, items, tree };
}
