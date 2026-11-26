import { isHttpsUrl } from "../lib/blyggdrasil.js";

export function citationFor({ edition, match }, proofPage) {
  if (edition?.status !== "verified" || match?.status !== "matched" || !match.text ||
      !Number.isSafeInteger(edition.version) || edition.version < 1 || !isHttpsUrl(edition.itemUrl)) {
    return null;
  }
  const proof = new URL(proofPage);
  proof.searchParams.set("post", edition.itemUrl);
  proof.searchParams.set("version", edition.version);
  const version = `Blygger version ${edition.version}${edition.pinned ? " (pinned)" : ""}`;
  return { href: proof.href, text: `“${match.text}”\n${version}\n${proof.href}` };
}
