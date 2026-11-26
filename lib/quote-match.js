const CONTEXT_LENGTH = 240;
const HIGH_SURROGATE = /[\ud800-\udbff]/;
const LOW_SURROGATE = /[\udc00-\udfff]/;

// Match the signed Markdown literally. The surrounding text remains in source
// order, with the offset measured in the same UTF-16 units as String#indexOf.
export function matchQuote(markdown, quote) {
  if (typeof markdown !== "string" || typeof quote !== "string" || !quote.trim()) {
    return { status: "unavailable" };
  }
  const start = markdown.indexOf(quote);
  if (start === -1) return { status: "absent" };

  const end = start + quote.length;
  let first = Math.max(0, start - CONTEXT_LENGTH);
  let last = Math.min(markdown.length, end + CONTEXT_LENGTH);
  if (first > 0 && LOW_SURROGATE.test(markdown[first])) first--;
  if (last < markdown.length && HIGH_SURROGATE.test(markdown[last - 1])) last++;
  return {
    status: "matched",
    start,
    before: markdown.slice(first, start),
    text: markdown.slice(start, end),
    after: markdown.slice(end, last),
    truncatedBefore: first > 0,
    truncatedAfter: last < markdown.length,
  };
}
