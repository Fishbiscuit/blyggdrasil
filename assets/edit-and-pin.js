import { verifyEditAndPin } from "../lib/edit-and-pin.js";
import { makeFetcher } from "../lib/resolvers.js";

const pinned = document.querySelector("#pinned-edition");
const current = document.querySelector("#current-edition");
const status = document.querySelector("#comparison-status");
const canonical = document.querySelector('link[rel="canonical"]').href;
const dataUrl = (edition) => new URL(edition.querySelector(".edition-data").getAttribute("href"), canonical).href;
const get = makeFetcher((url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(12_000) }));

const summaries = {
  verified: "Verified", failed: "Verification failed", unsigned: "Unsigned", unavailable: "Proof unavailable",
};
const verdicts = { valid: "Passed", invalid: "Failed", unsigned: "Unsigned", unavailable: "Unavailable" };

function show(edition, report) {
  edition.querySelector(".edition-version").textContent = report.version ? `Version ${report.version}` : "";
  const result = edition.querySelector(".edition-result");
  result.textContent = summaries[report.status];
  result.dataset.status = report.status;
  const quote = edition.querySelector("blockquote");
  quote.textContent = report.contentMarkdown ?? "";
  quote.hidden = report.contentMarkdown === undefined;
  const error = edition.querySelector(".edition-error");
  error.textContent = report.error ?? "";
  error.hidden = !report.error;

  const checks = edition.querySelector("dl");
  checks.hidden = false;
  for (const verdict of checks.querySelectorAll("dd")) {
    const value = report.checks[verdict.dataset.check];
    verdict.textContent = verdicts[value];
    verdict.dataset.verdict = value;
  }
  const proof = edition.querySelector(".edition-proof");
  const url = new URL("../verify/", import.meta.url);
  url.searchParams.set("post", report.itemUrl ?? dataUrl(edition));
  if (report.version) url.searchParams.set("version", report.version);
  proof.href = url.href;
  proof.hidden = false;
}

const result = await verifyEditAndPin({ pinnedUrl: dataUrl(pinned), currentUrl: dataUrl(current) }, get);
show(pinned, result.pinned);
show(current, result.current);
status.textContent = result.error || "Both proofs verified. The pinned URL still serves the original text.";
