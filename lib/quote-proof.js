import { itemUrl } from "./blyggdrasil.js";
import { verifyPost } from "./post-proof.js";
import { findChangedContext, matchQuote } from "./quote-match.js";

export async function verifyQuote(input, get, { version, quote, expectedKey } = {}) {
  const report = {
    edition: null,
    current: null,
    match: { status: "unavailable" },
    comparison: "unavailable",
  };
  if (typeof quote !== "string" || !quote.trim()) {
    return { ...report, error: "Enter some text to check against the signed edition." };
  }

  const options = { expectedKey, includeText: true };
  report.edition = await verifyPost(input, get, { ...options, version });
  const edition = report.edition;
  if (edition.status !== "verified") {
    return { ...report, error: edition.error || "The cited edition could not be verified." };
  }
  report.match = matchQuote(edition.contentMarkdown, quote);

  // A verified, unpinned response came from the current item endpoint. For an
  // explicit or discovered pin, use the origin and item ID as discovery hints,
  // so verifyPost reads the current item template rather than the pin again.
  report.current = edition.pinned
    ? await verifyPost(itemUrl(edition.origin, {}, edition.itemId), get, options)
    : edition;
  const current = report.current;
  if (current.status !== "verified" || current.pinned ||
      current.origin !== edition.origin || current.itemId !== edition.itemId ||
      current.version < edition.version ||
      (current.version === edition.version && current.contentMarkdown !== edition.contentMarkdown)) {
    return report;
  }

  report.currentMatch = current === edition ? report.match : matchQuote(current.contentMarkdown, quote);
  if (report.match.status !== "matched") return report;
  report.comparison = report.currentMatch.status === "matched" ? "same" : "changed";
  if (report.comparison === "same" && report.match.start !== report.currentMatch.start) {
    report.positionChanged = true;
  }
  if (report.comparison === "changed") {
    const context = findChangedContext(edition.contentMarkdown, current.contentMarkdown, report.match);
    if (context) report.currentExcerpt = context;
  }
  return report;
}
