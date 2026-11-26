import { editionReference, proofLink } from "../../lib/proof-link.js";

export function readEdition(entry) {
  if (typeof entry?.origin !== "string" || !Number.isSafeInteger(entry.version)) {
    return null;
  }

  try {
    const origin = new URL(entry.origin);
    if (origin.protocol !== "https:") return null;
    if (!origin.pathname.endsWith("/")) origin.pathname += "/";
    return editionReference({ origin: origin.href, id: entry.remoteId, version: entry.version });
  } catch {
    return null;
  }
}

export function copyEditionLink(edition) {
  return {
    title: "Edition proof link",
    description: "Open this link in a browser to check the exact edition.",
    fields: [{ label: "Version", value: String(edition.version) }],
    code: proofLink(edition).href,
  };
}
