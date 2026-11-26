import { allowLocalDevelopment, isHttpsUrl } from "../lib/blyggdrasil.js";
import { verifyQuote } from "../lib/quote-proof.js";
import { makeFetcher } from "../lib/resolvers.js";
import { citationFor } from "./quote-citation.js";

if (["localhost", "127.0.0.1"].includes(location.hostname)) allowLocalDevelopment();

const $ = (id) => document.getElementById(id);
const form = $("quote-form");
const post = $("quote-post");
const version = $("quote-version");
const excerpt = $("quote-excerpt");
const state = $("quote-status");
const result = $("quote-result");
const title = $("quote-result-title");
const copyStatus = $("quote-copy-status");
const copyFallback = $("quote-copy-fallback");
const proofPage = new URL("../verify/", location.href);

let active;
let citation;

function clearResult() {
  active?.abort();
  active = undefined;
  citation = undefined;
  result.hidden = true;
  copyFallback.hidden = true;
  copyStatus.textContent = "";
  state.textContent = "";
}

function showContext(id, match) {
  const context = $(id);
  context.hidden = match?.status !== "matched";
  context.replaceChildren();
  if (context.hidden) return;

  const highlight = document.createElement("mark");
  highlight.textContent = match.text;
  context.append(match.truncatedBefore ? "…" : "", match.before || "", highlight,
    match.after || "", match.truncatedAfter ? "…" : "");
}

function showReport(report, requestedVersion) {
  const { edition, current, match, currentMatch, comparison, positionChanged } = report;
  const matched = match?.status === "matched" && edition?.status === "verified";
  const absent = match?.status === "absent" && edition?.status === "verified";
  const unavailable = edition?.status === "unavailable" || !edition;
  title.textContent = matched ? "Quote verified" : absent ? "No exact match"
    : unavailable ? "Cited edition unavailable" : "Cited edition unverified";
  $("quote-result-note").textContent = matched
    ? "The cited edition’s text, signature and tree signing key passed verification."
    : absent
      ? "The edition’s signature verified. Its signed text has no exact match for this excerpt."
      : unavailable
        ? "A past edition may need a public pin from its publisher."
        : "The quote needs a verified signature from this publisher’s tree.";

  const citedVersion = edition?.version || requestedVersion;
  $("quote-cited-title").textContent = citedVersion
    ? `Cited edition · v${citedVersion}${edition?.pinned ? " · pinned" : ""}`
    : "Cited edition";
  showContext("quote-context", matched ? match : null);
  const citedNote = $("quote-cited-note");
  citedNote.textContent = !matched && !absent ? report.error || edition?.error || "" : "";
  citedNote.hidden = !citedNote.textContent;

  const currentVerified = current?.status === "verified" && Boolean(currentMatch);
  $("quote-current-title").textContent = currentVerified ? `Current edition · v${current.version}` : "Current edition";
  const currentNote = $("quote-current-note");
  const currentContext = $("quote-current-context");
  showContext("quote-current-context", null);
  if (comparison === "same") {
    currentNote.textContent = positionChanged ? "The same wording appears at a different position." : "The current edition contains the same wording.";
    if (positionChanged && currentMatch) showContext("quote-current-context", currentMatch);
  } else if (comparison === "changed") {
    currentNote.textContent = "The current edition verified. This exact excerpt is absent from its signed text.";
    if (current?.contentMarkdown?.length <= 360) {
      currentContext.textContent = current.contentMarkdown;
      currentContext.hidden = false;
    }
  } else {
    currentNote.textContent = currentVerified
      ? "The current edition verified. Comparison requires a verified match in the cited edition."
      : "Comparison unavailable.";
  }

  citation = citationFor(report, proofPage);
  $("quote-proof-actions").hidden = !citation;
  const link = $("quote-proof-link");
  if (citation) link.href = citation.href;
  else link.removeAttribute("href");
  result.hidden = false;
}

async function check({ focus = false } = {}) {
  clearResult();
  const address = post.value.trim();
  const text = excerpt.value;
  const citedVersion = version.value ? version.valueAsNumber : undefined;
  if (!isHttpsUrl(address) || !text.trim() || !form.reportValidity()) return;

  const controller = new AbortController();
  active = controller;
  const get = makeFetcher((url, options) => fetch(url, {
    ...options, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]),
  }));
  state.textContent = "Checking the cited edition and current post…";
  let report;
  try {
    report = await verifyQuote(address, get, { version: citedVersion, quote: text });
  } catch {
    report = { error: "The browser could not finish the check." };
  }
  if (active !== controller) return;
  showReport(report, citedVersion);
  if (focus && form.contains(document.activeElement)) {
    state.textContent = "";
    title.focus();
  } else {
    state.textContent = title.textContent;
  }
}

form.addEventListener("input", () => {
  post.setCustomValidity("");
  excerpt.setCustomValidity("");
  clearResult();
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  post.setCustomValidity(isHttpsUrl(post.value.trim()) ? "" : "Enter a public HTTPS post URL.");
  excerpt.setCustomValidity(excerpt.value.trim() ? "" : "Enter a quote to check.");
  if (form.reportValidity()) void check({ focus: true });
});

$("quote-copy").addEventListener("click", async () => {
  const checked = citation;
  if (!checked) return;
  try {
    await navigator.clipboard.writeText(checked.text);
    if (citation === checked) copyStatus.textContent = "Verified citation copied.";
  } catch {
    if (citation !== checked) return;
    const field = $("quote-citation");
    field.value = checked.text;
    copyFallback.hidden = false;
    field.focus();
    field.select();
    copyStatus.textContent = "Copy the selected citation.";
  }
});

$("quote-submit").disabled = false;

if (new URLSearchParams(location.search).get("example") === "pinned") {
  post.value = "https://fishbiscuit.me/blyggdrasil/demo/edit-and-pin/blyg/items/1hk3fv43xwpgckk19k4wf3v9ts/v1.json";
  version.value = "1";
  excerpt.value = "The reading room closes at five.";
  void check();
}
