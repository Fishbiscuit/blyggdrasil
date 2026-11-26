import { isHttpsUrl, itemIdIn, itemUrl, resolveBlyg, treePointer } from "./blyggdrasil.js";
import { verifyPost } from "./post-proof.js";
import { makeFetcher } from "./resolvers.js";

export const DEFAULT_AUDIT_LIMIT = 20;
export const MAX_AUDIT_LIMIT = 50;
const MAX_JSON_BYTES = 8 * 1024 * 1024;
const MAX_AUDIT_BYTES = 24 * 1024 * 1024;
const ITEM_ID = /^[0-7][0-9abcdefghjkmnpqrstvwxyz]{25}$/;

// The archive index is one JSON file. Bound its size as well as the individual
// evidence documents so even a very large blyg cannot stall the reader.
export function makeAuditFetcher(fetchImpl = globalThis.fetch) {
  let totalBytes = 0;
  return makeFetcher(async (url, options) => {
    const response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(8000) });
    const read = async () => {
      if (!response.ok || !response.body) {
        await response.body?.cancel().catch(() => {});
        return "";
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8", { fatal: true });
      let bytes = 0;
      let contents = "";
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) return contents + decoder.decode();
          bytes += value.byteLength;
          totalBytes += value.byteLength;
          if (bytes > MAX_JSON_BYTES || totalBytes > MAX_AUDIT_BYTES) throw new Error("Archive audit response too large.");
          contents += decoder.decode(value, { stream: true });
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    };
    return {
      url: response.url,
      ok: response.ok,
      status: response.status,
      json: async () => JSON.parse(await read()),
      text: read,
    };
  });
}

function boundedFetcher(get, budget) {
  const cache = new Map();
  return async (url, options) => {
    if (!isHttpsUrl(url)) return { ok: false, status: 0 };
    const key = `${options?.as ?? "json"} ${url}`;
    if (cache.has(key)) return cache.get(key);
    if (cache.size >= budget) return { ok: false, status: 0 };
    const response = Promise.resolve().then(() => get(url, options)).then((result) => {
      if (!result || !isHttpsUrl(result.url ?? url)) return { ok: false, status: 0 };
      if (result.json?.visibility && result.json.visibility !== "public") return { ok: false, status: 404 };
      return result;
    }).catch(() => ({ ok: false, status: 0 }));
    cache.set(key, response);
    return response;
  };
}

function editionEntries(items, treeId, limit) {
  const selected = new Map();
  let truncated = false;
  for (const entry of items) {
    if (!ITEM_ID.test(entry?.id ?? "") || entry.id === treeId || selected.has(entry.id)) continue;
    if (entry.kind !== "fragment" && entry.kind !== "thread") continue;
    if (!Number.isSafeInteger(entry.version) || entry.version < 1) continue;
    if (entry.visibility && entry.visibility !== "public") continue;
    if (selected.size === limit) {
      truncated = true;
      break;
    }
    selected.set(entry.id, { id: entry.id, version: entry.version });
  }
  return { entries: [...selected.values()], truncated };
}

// Check the editions identified by the index, including an exact pin if an
// item was updated during the audit. Preserve index order in the output.
export async function auditArchive(input, get, { limit = DEFAULT_AUDIT_LIMIT, onItem } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_AUDIT_LIMIT) {
    throw new Error(`Use a post limit from 1 to ${MAX_AUDIT_LIMIT}.`);
  }
  const address = typeof input === "string" && input.trim();
  if (!address || !isHttpsUrl(/^[a-z]+:\/\//i.test(address) ? address : `https://${address}`)) {
    throw new Error("Use the HTTPS address of a public blyg.");
  }
  const fetchOnce = boundedFetcher(get, limit * 4 + 12);
  const { origin, manifest } = await resolveBlyg(address, fetchOnce);
  if (!isHttpsUrl(origin)) throw new Error("The blyg manifest could not be read.");
  const canonical = new URL(origin);
  if (canonical.search || canonical.hash || !canonical.pathname.endsWith("/")) {
    throw new Error("The manifest did not resolve to a canonical blyg address.");
  }
  let archiveUrl;
  try {
    archiveUrl = new URL(typeof manifest.items === "string" ? manifest.items : "items/index.json", origin).href;
  } catch {
    throw new Error("The manifest archive address is invalid.");
  }
  const index = await fetchOnce(archiveUrl);
  if (!index?.ok || !Array.isArray(index.json?.items)) throw new Error("The public archive index could not be read.");
  let treeId;
  try { treeId = itemIdIn(treePointer(manifest), origin); } catch { /* malformed links do not identify a tree */ }
  const { entries, truncated } = editionEntries(index.json.items, treeId, limit);
  const results = [];
  for (let start = 0; start < entries.length; start += 4) {
    const batch = await Promise.all(entries.slice(start, start + 4).map(async ({ id, version }) => {
      const reference = { origin, id, version };
      let url;
      try {
        const candidate = itemUrl(origin, manifest, id);
        if (isHttpsUrl(candidate)) url = candidate;
      } catch {
        // The verifier reports an invalid item template.
      }
      const proof = await verifyPost(url, fetchOnce, { edition: { origin, id }, version });
      return { ...reference, proof };
    }));
    for (const row of batch) {
      results.push(row);
      if (onItem) await onItem(row);
    }
  }
  return { origin, archiveUrl, truncated, results };
}
