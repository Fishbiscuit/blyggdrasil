import { isDidKey, validateTree, verifyByline } from "../blyggdrasil.js";
import { verifyPost } from "../post-proof.js";
import {
  BUNDLE_FORMAT, BUNDLE_VERSION, MAX_DOCUMENTS, MAX_DOCUMENT_BYTES, MAX_TOTAL_BYTES,
  blygOrigin, decodeDocument, hashResource, publicAddress, readPublicSurface,
} from "./surface.js";

export async function openPublicBundle(bundle) {
  if (bundle?.format !== BUNDLE_FORMAT || bundle.version !== BUNDLE_VERSION ||
      typeof bundle.origin !== "string" || !Array.isArray(bundle.resources) ||
      bundle.resources.length > MAX_DOCUMENTS) {
    throw new Error("Unsupported or malformed public bundle.");
  }
  const { origin } = bundle;
  if (origin !== blygOrigin(origin)) throw new Error("The bundle needs a canonical blyg origin.");

  const resources = new Map();
  let totalBytes = 0;
  for (const entry of bundle.resources) {
    if (!entry || typeof entry.url !== "string" || typeof entry.text !== "string" ||
        entry.url !== publicAddress(entry.url, origin) || resources.has(entry.url)) {
      throw new Error("The bundle lists an invalid or duplicate document.");
    }
    const bytes = Buffer.byteLength(entry.text);
    totalBytes += bytes;
    if (bytes > MAX_DOCUMENT_BYTES || totalBytes > MAX_TOTAL_BYTES) {
      throw new Error("The bundle exceeds the size limit.");
    }
    if (entry.sha256 !== hashResource(entry.text)) {
      throw new Error(`Stored digest does not match the document at ${entry.url}.`);
    }
    resources.set(entry.url, { ...entry, doc: decodeDocument(entry.text, entry.url) });
  }

  const used = new Set();
  const surface = await readPublicSurface(origin, async url => {
    const entry = resources.get(url);
    if (!entry) throw new Error(`Missing document at ${url}.`);
    used.add(url);
    return entry.doc;
  });
  if (used.size !== resources.size) {
    throw new Error("The bundle contains documents outside the public manifest, archive, or declared pins.");
  }

  const get = async (url, { as = "json" } = {}) => {
    const entry = resources.get(url);
    if (!entry) return { ok: false, status: 404, url };
    return as === "text" ? { ok: true, status: 200, url, text: entry.text }
      : { ok: true, status: 200, url, json: entry.doc };
  };
  return { origin, surface, resources, get };
}

export async function verifyOpenedPublicBundle(opened, { expectedKey } = {}) {
  if (expectedKey !== undefined && !isDidKey(expectedKey)) {
    throw new Error("The expected key must be a public Ed25519 did:key.");
  }
  const { origin, surface, get } = opened;
  const tree = await validateTree(String(surface.tree.doc.content_md ?? ""), origin, {
    fetchPinned: async version => surface.tree.pins.find(pin => pin.doc.version === version)?.doc.content_md ?? null,
  });
  const expectedKeyMatches = expectedKey === undefined ? undefined : tree.valid && tree.claims.key === expectedKey;
  const posts = [];
  for (const item of surface.items) {
    for (const entry of [item, ...item.pins]) {
      const { url, doc } = entry;
      if (doc.kind === "withdrawn") {
        const emptyHash = doc.content_hash === undefined || doc.content_hash === hashResource("");
        const signature = doc.author?.sig === undefined ||
          (typeof doc.content_hash === "string" && (await verifyByline(doc, tree.keys ?? [])).byTree);
        posts.push({ url, id: doc.id, version: doc.version, pinned: false,
          status: emptyHash && signature ? "withdrawn" : "failed" });
        continue;
      }
      const pinned = entry !== item;
      const report = await verifyPost(url, get, { version: doc.version });
      const matchesEdition = report.itemUrl === url && report.version === doc.version && report.pinned === pinned;
      posts.push({
        url, id: doc.id, version: doc.version, pinned, checks: report.checks, signingKey: report.signingKey,
        status: report.status === "verified" && !matchesEdition ? "failed" : report.status,
        ...(report.error ? { error: report.error } : {}),
      });
    }
  }
  const status = !tree.valid || expectedKeyMatches === false || posts.some(post => post.status === "failed") ? "failed"
    : posts.every(post => post.status === "verified" || post.status === "withdrawn") ? "verified" : "incomplete";
  return {
    origin, status, manifestUrl: surface.manifestUrl, archiveUrl: surface.indexUrl,
    ...(expectedKey === undefined ? {} : { expectedKey, expectedKeyMatches }),
    tree: tree.valid
      ? { status: "verified", url: surface.tree.url, claims: tree.claims, acceptedKeys: tree.keys }
      : { status: "failed", url: surface.tree.url, error: tree.reason },
    posts,
  };
}

export async function verifyPublicBundle(bundle, options) {
  return verifyOpenedPublicBundle(await openPublicBundle(bundle), options);
}
