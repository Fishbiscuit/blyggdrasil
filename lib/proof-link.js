import { isHttpsUrl, itemUrl, pinUrl } from "./blyggdrasil.js";

const ITEM_ID = /^[0-7][0-9abcdefghjkmnpqrstvwxyz]{25}$/;
const PROOF_PAGE = "https://fishbiscuit.me/blyggdrasil/verify/";

export function editionReference({ origin, id, version }) {
  if (typeof origin !== "string" || !isHttpsUrl(origin)) {
    throw new Error("The edition needs an absolute HTTPS blyg address.");
  }
  const url = new URL(origin);
  if (url.search || url.hash || !url.pathname.endsWith("/")) {
    throw new Error("Use the canonical blyg address ending in a slash.");
  }
  if (typeof id !== "string" || !ITEM_ID.test(id)) {
    throw new Error("The edition link needs a valid Blygger item ID.");
  }
  const number = typeof version === "string" && /^[1-9]\d*$/.test(version) ? Number(version) : version;
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new Error("The edition link needs a positive whole version number.");
  }
  return { origin: url.href, id, version: number };
}

export function proofLink(reference, base = PROOF_PAGE) {
  const { origin, id, version } = editionReference(reference);
  const url = new URL(base);
  if (!isHttpsUrl(url.href)) throw new Error("The verifier needs an absolute HTTPS address.");
  url.search = new URLSearchParams({ origin, id, version });
  url.hash = "";
  return url;
}

export async function editionManifest(origin, get) {
  const url = new URL("blyg.json", origin).href;
  const response = await get(url);
  // A peer claiming the same item ID at another address cannot take over this edition.
  if (!response?.ok || (response.url && response.url !== url) || typeof response.json?.blyg !== "string") {
    throw new Error("The blyg manifest could not be read at the named origin.");
  }
  return response.json;
}

export async function resolveEdition(reference, get) {
  const { origin, id, version } = editionReference(reference);
  const manifest = await editionManifest(origin, get);
  const currentUrl = itemUrl(origin, manifest, id);
  const historicalUrl = pinUrl(origin, manifest, id, version);
  const matches = async (url, pinned) => {
    if (!isHttpsUrl(url)) return false;
    const response = await get(url);
    if (!response?.ok || (response.url && (!isHttpsUrl(response.url) ||
        new URL(response.url).origin !== new URL(url).origin))) return false;
    const doc = response.json;
    return doc?.id === id && doc.origin === origin && doc.version === version &&
      (doc.kind === "fragment" || doc.kind === "thread") && (!pinned || doc.pinned === true);
  };
  if (await matches(currentUrl, false)) return currentUrl;
  if (await matches(historicalUrl, true)) return historicalUrl;
  throw new Error("That edition is unavailable as the current item or a pinned copy.");
}
