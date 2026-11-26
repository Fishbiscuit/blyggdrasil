const CONTEXT_LENGTH = 240;
const ANCHOR_LENGTH = 40;
const HIGH_SURROGATE = /[\ud800-\udbff]/;
const LOW_SURROGATE = /[\udc00-\udfff]/;
const PARAGRAPH_BREAK = /\r?\n[^\S\r\n]*\r?\n/;

function contextAt(markdown, start, end) {
  let first = Math.max(0, start - CONTEXT_LENGTH);
  let last = Math.min(markdown.length, end + CONTEXT_LENGTH);
  if (first > 0 && LOW_SURROGATE.test(markdown[first])) first--;
  if (last < markdown.length && HIGH_SURROGATE.test(markdown[last - 1])) last++;
  return {
    start,
    before: markdown.slice(first, start),
    text: markdown.slice(start, end),
    after: markdown.slice(end, last),
    truncatedBefore: first > 0,
    truncatedAfter: last < markdown.length,
  };
}

// Match the signed Markdown literally. Offsets use the same units as String#indexOf.
export function matchQuote(markdown, quote) {
  if (typeof markdown !== "string" || typeof quote !== "string" || !quote.trim()) {
    return { status: "unavailable" };
  }
  const start = markdown.indexOf(quote);
  if (start === -1) return { status: "absent" };
  return { status: "matched", ...contextAt(markdown, start, start + quote.length) };
}

function uniqueOffset(markdown, text) {
  const offset = markdown.indexOf(text);
  return offset >= 0 && offset === markdown.lastIndexOf(text) ? offset : -1;
}

// Both editions must already have verified. Only show corresponding text when
// two substantial literal anchors identify one range in both editions.
export function findChangedContext(cited, current, match) {
  const left = Array.from(match.before).slice(-ANCHOR_LENGTH).join("");
  const right = Array.from(match.after).slice(0, ANCHOR_LENGTH).join("");
  if ([left, right].some((anchor) => (anchor.match(/[\p{L}\p{N}]/gu) || []).length < 12)) return;
  if (uniqueOffset(cited, match.text) !== match.start ||
      uniqueOffset(cited, left) !== match.start - left.length ||
      uniqueOffset(cited, right) !== match.start + match.text.length) return;

  const leftOffset = uniqueOffset(current, left);
  const end = uniqueOffset(current, right);
  const start = leftOffset + left.length;
  if (leftOffset < 0 || start > end || end - start > CONTEXT_LENGTH) return;

  const context = contextAt(current, start, end);
  if (PARAGRAPH_BREAK.test(context.text)) return;
  const before = context.before.split(PARAGRAPH_BREAK).at(-1);
  const after = context.after.split(PARAGRAPH_BREAK)[0];
  return {
    ...context,
    before,
    after,
    truncatedBefore: context.truncatedBefore || before !== context.before,
    truncatedAfter: context.truncatedAfter || after !== context.after,
  };
}
