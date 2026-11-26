import { isHttpsUrl } from "../blyggdrasil.js";

const ID = /^[0-7][0-9abcdefghjkmnpqrstvwxyz]{25}$/;
const HASH = /^sha256:[0-9a-f]{64}$/;
const TIMESTAMP = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/;

export function validatePin(pin) {
  if (!pin || pin.pinned !== true || typeof pin.blyg !== "string" || !pin.blyg ||
      !ID.test(pin.id || "") || !Number.isSafeInteger(pin.version) || pin.version < 1 ||
      (pin.kind !== "thread" && pin.kind !== "fragment")) {
    throw new Error("Expected a published fragment or thread with an item ID, version and pinned marker.");
  }
  if (!isHttpsUrl(pin.origin) || new URL(pin.origin).href !== pin.origin ||
      !pin.origin.endsWith("/") || /[?#]/.test(pin.origin)) {
    throw new Error("The pin must have a canonical publisher origin.");
  }
  if (!TIMESTAMP.test(pin.at || "") || !Number.isFinite(Date.parse(pin.at)) ||
      (pin.note != null && typeof pin.note !== "string")) {
    throw new Error("The pin must identify the publication time of the selected version.");
  }
  if (typeof pin.content_md !== "string" || typeof pin.content_html !== "string" ||
      !HASH.test(pin.content_hash || "") || !pin.author?.sig) {
    throw new Error("The pin needs the published text, rendered content, hash and byline signature.");
  }
  if (pin.kind === "thread" && !Array.isArray(pin.transclusions)) {
    throw new Error("A pinned thread must preserve its published transclusions.");
  }
  for (const mutable of ["syndication", "media", "changelog"]) {
    if (Object.hasOwn(pin, mutable)) throw new Error(`A pin cannot carry the current item's ${mutable}.`);
  }
}

export function publicationEntry(item, version) {
  if (!Array.isArray(item.changelog)) return undefined;
  const entries = item.changelog.filter((entry) => entry?.version === version);
  return entries.length === 1 ? entries[0] : undefined;
}

export function snapshotPin(item) {
  if (!item) throw new Error("No verified publication was retained for the pin.");
  const edition = item.pinned === true ? item : publicationEntry(item, item.version);
  if (!edition) throw new Error("The post has no unique changelog entry for the selected version.");
  const result = {
    blyg: item.blyg, id: item.id, kind: item.kind, version: item.version,
    at: edition.at, note: edition.note ?? null, pinned: true, origin: item.origin,
    author: item.author, content_md: item.content_md, content_html: item.content_html, content_hash: item.content_hash,
  };
  for (const key of ["transclusions", "generated", "stub_of", "forked_from", "links"]) {
    if (Object.hasOwn(item, key)) result[key] = item[key];
  }
  validatePin(result);
  return result;
}
