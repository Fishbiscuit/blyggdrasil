const itemIdPattern = /^[0-7][0-9a-hjkmnp-tv-z]{25}$/;

export function readEdition(entry) {
  if (typeof entry?.origin !== "string" || typeof entry.remoteId !== "string" ||
      !itemIdPattern.test(entry.remoteId) || !Number.isSafeInteger(entry.version) || entry.version < 1) {
    return null;
  }

  try {
    const origin = new URL(entry.origin);
    if (origin.protocol !== "https:" || origin.username || origin.password ||
        origin.search || origin.hash) return null;
    if (!origin.pathname.endsWith("/")) origin.pathname += "/";
    return { origin: origin.href, id: entry.remoteId, version: entry.version };
  } catch {
    return null;
  }
}

export function proofLink({ origin, id, version }) {
  const url = new URL("https://fishbiscuit.me/blyggdrasil/verify/");
  url.search = new URLSearchParams({ origin, id, version }).toString();
  return url.href;
}

export function copyEditionLink(edition) {
  return {
    title: "Edition proof link",
    description: "Open this link in a browser to check the exact edition.",
    fields: [{ label: "Version", value: String(edition.version) }],
    code: proofLink(edition),
  };
}
