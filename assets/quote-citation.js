import { isHttpsUrl } from "../lib/blyggdrasil.js";

export function readQuoteLink(hash) {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const post = params.get("post");
  const rawVersion = params.get("version") || "";
  const version = Number(rawVersion);
  const quote = params.get("quote");
  if (!isHttpsUrl(post) || !/^[1-9]\d*$/.test(rawVersion) ||
      !Number.isSafeInteger(version) || !quote?.trim()) return null;
  return { post, version, quote };
}

export function citationFor({ edition, match }, proofPage, quotePage) {
  if (edition?.status !== "verified" || match?.status !== "matched" || !match.text ||
      !Number.isSafeInteger(edition.version) || edition.version < 1 || !isHttpsUrl(edition.itemUrl)) {
    return null;
  }
  const proof = new URL(proofPage);
  proof.searchParams.set("post", edition.itemUrl);
  proof.searchParams.set("version", edition.version);
  const comparison = new URL(quotePage);
  comparison.search = "";
  comparison.hash = new URLSearchParams({ post: edition.itemUrl, version: edition.version, quote: match.text });
  const version = `Blygger version ${edition.version}${edition.pinned ? " (pinned)" : ""}`;
  return {
    href: proof.href,
    quoteHref: comparison.href,
    text: `“${match.text}”\n${version}\nRecheck quote: ${comparison.href}\nPost proof: ${proof.href}`,
  };
}
