import {
  BUNDLE_FORMAT, BUNDLE_VERSION, MAX_DOCUMENTS, MAX_DOCUMENT_BYTES, MAX_TOTAL_BYTES,
  blygOrigin, decodeDocument, hashResource, readPublicSurface,
} from "./surface.js";

// readText(url) supplies the response text for an exact canonical URL.
export async function exportPublicBundle(input, readText) {
  const origin = blygOrigin(input);
  const resources = new Map();
  let totalBytes = 0;
  await readPublicSurface(origin, async url => {
    if (resources.has(url)) return decodeDocument(resources.get(url).text, url);
    if (resources.size >= MAX_DOCUMENTS) throw new Error("The archive exceeds the bundle document limit.");
    const text = await readText(url);
    if (typeof text !== "string") throw new Error(`Cannot read public document ${url}.`);
    const bytes = Buffer.byteLength(text);
    totalBytes += bytes;
    if (bytes > MAX_DOCUMENT_BYTES || totalBytes > MAX_TOTAL_BYTES) {
      throw new Error("The archive exceeds the bundle size limit.");
    }
    const doc = decodeDocument(text, url);
    resources.set(url, { url, sha256: hashResource(text), text });
    return doc;
  });
  return { format: BUNDLE_FORMAT, version: BUNDLE_VERSION, origin, resources: [...resources.values()] };
}
