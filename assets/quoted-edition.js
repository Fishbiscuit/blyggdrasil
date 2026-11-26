import { loadQuotedEdition } from "../lib/quoted-edition.js";
import { makeFetcher } from "../lib/resolvers.js";
import { citationFor } from "./quote-citation.js";

const get = makeFetcher((url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(8_000) }));
const status = document.querySelector("#quote-edition-status");
const original = document.querySelector("#published-quote");
const current = document.querySelector("#current-source");

function showText(element, text) {
  element.textContent = text;
  element.hidden = false;
}

try {
  const { quote, source, error } = await loadQuotedEdition(get);
  if (quote) showText(original, quote);
  if (source) {
    const citation = citationFor(source, new URL("../../verify/", location.href), new URL("../../quote/", location.href));
    if (citation) {
      const link = document.querySelector("#recheck-published-quote");
      link.href = citation.quoteHref;
      link.hidden = false;
    }
  }
  if (source?.comparison === "changed" || source?.comparison === "same") {
    showText(current, source.current.contentMarkdown);
  }
  if (source?.comparison === "changed" && source.match.status === "matched") {
    status.textContent = `The quote matches signed, pinned v${source.edition.version}. The wording changed in current v${source.current.version}.`;
  } else if (source?.comparison === "same") {
    status.textContent = "The signed cited edition and current source both contain the quote.";
  } else {
    status.textContent = error || source?.error || "The cited and current editions could not be compared.";
  }
} catch {
  status.textContent = "The edition comparison is unavailable.";
}
