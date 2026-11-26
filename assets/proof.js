import { allowLocalDevelopment, isHttpsUrl } from "../lib/blyggdrasil.js";
import { verifyPost } from "../lib/post-proof.js";
import { makeFetcher } from "../lib/resolvers.js";

if (["localhost", "127.0.0.1"].includes(location.hostname)) allowLocalDevelopment();

const $ = (id) => document.getElementById(id);
const form = $("proof-form");
const post = $("post-url");
const version = $("post-version");
const expectedKey = $("expected-key");
const copyButton = $("copy-proof-link");
const state = $("proof-status");
const result = $("proof-result");
const get = makeFetcher((url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(12_000) }));
const words = {
  valid: "Passed", invalid: "Failed", unsigned: "Unsigned", unavailable: "Unavailable",
};
const summary = {
  verified: ["Signature verified", "This copy matches the text signed by a key recognized by the blyg’s tree."],
  failed: ["Verification failed", "At least one check failed. Review the individual results below."],
  unsigned: ["Unsigned post", "This post has no signature to check."],
  unavailable: ["Verification unavailable", "Some evidence could not be checked. Review the individual results below."],
};

let request = 0;
let share = "";

function verificationUrl({ post: address, version: number, key }) {
  const url = new URL("./", location.href);
  url.searchParams.set("post", address);
  if (number) url.searchParams.set("version", number);
  if (key) url.searchParams.set("key", key);
  return url;
}

function showLink(id, href, text = href) {
  const link = $(id);
  const valid = typeof href === "string" && isHttpsUrl(href);
  if (valid) {
    link.href = href;
    link.textContent = text;
  } else {
    link.removeAttribute("href");
    link.textContent = "";
  }
  const row = $(id + "-row");
  if (row) row.hidden = !valid;
  else link.hidden = !valid;
  return valid;
}

function showCheck(id, value) {
  const element = $(id);
  const verdict = Object.hasOwn(words, value) ? value : "unavailable";
  element.textContent = words[verdict];
  element.dataset.verdict = verdict;
}

function showResult(report, address, key) {
  const [title, description] = summary[report.status] || summary.unavailable;
  const foundVersion = Number.isSafeInteger(report.version) && report.version > 0;
  $("proof-heading").textContent = title;
  $("proof-summary").textContent = report.error || description;
  $("proof-version").textContent = foundVersion ? `Version ${report.version}${report.pinned ? " · pinned" : ""}` : "";
  $("proof-version").hidden = !foundVersion;

  for (const check of ["content", "signature", "signer"]) {
    showCheck(check + "-verdict", report.checks?.[check]);
  }
  $("expected-signer-row").hidden = !key;
  showCheck("expected-signer-verdict", report.expectedSigner);

  showLink("read-post", report.pageUrl, "Read the latest post");
  const showOrigin = showLink("proof-origin", report.origin);
  const showItem = showLink("proof-item", report.itemUrl);
  const showSource = showLink("proof-source", report.sourceUrl);
  const publicKey = typeof report.signingKey === "string" ? report.signingKey : "";
  $("proof-key").textContent = publicKey;
  $("proof-key-row").hidden = !publicKey;
  $("proof-source-note").hidden = !showSource;
  $("proof-source-note").textContent = report.sourceKind === "archive-footer"
    ? "The signature covers the archived copy on this blyg."
    : "The signature covers the version published on this blyg.";
  $("proof-evidence").hidden = !(showOrigin || showItem || showSource || publicKey);
  $("proof-evidence").open = false;

  share = foundVersion && showItem ? verificationUrl({ post: address, version: report.version, key }).href : "";
  copyButton.hidden = !share;
  result.hidden = false;
  state.textContent = title;
  state.classList.add("visually-hidden");
}

async function check({ post: address, version: number, key }, focus = false) {
  const id = ++request;
  share = "";
  copyButton.hidden = true;
  $("copy-proof-status").textContent = "";
  $("copy-link-fallback").hidden = true;
  result.hidden = true;
  state.classList.remove("visually-hidden");
  state.textContent = address ? "Checking the post and signing key…" : "";
  if (!address) return;

  let report;
  try {
    report = await verifyPost(address, get, { version: number, expectedKey: key || undefined });
  } catch {
    report = { status: "unavailable", error: "The post could not be checked in this browser." };
  }
  if (id !== request) return;
  showResult(report, address, key);
  if (focus && form.contains(document.activeElement)) $("proof-heading").focus();
}

function fromLocation() {
  const params = new URLSearchParams(location.search);
  const address = params.get("post") || "";
  const number = params.get("version") || "";
  const key = params.get("key") || "";
  post.value = address;
  version.value = number;
  expectedKey.value = key;
  $("proof-options").open = Boolean(number || key);
  void check({ post: address, version: number ? Number(number) : undefined, key });
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const address = post.value.trim();
  if (!address) {
    post.setCustomValidity("Enter a public Blygger post URL.");
    post.reportValidity();
    return;
  }
  const data = { post: address, version: version.value ? version.valueAsNumber : undefined, key: expectedKey.value.trim() };
  history.pushState(null, "", verificationUrl(data));
  void check(data, true);
});

post.addEventListener("input", () => post.setCustomValidity(""));
window.addEventListener("popstate", fromLocation);
copyButton.addEventListener("click", async () => {
  if (!share) return;
  const link = share;
  try {
    await navigator.clipboard.writeText(link);
    if (share === link) $("copy-proof-status").textContent = "Verification link copied.";
  } catch {
    if (share !== link) return;
    $("copy-link-fallback").hidden = false;
    const input = $("proof-share-url");
    input.value = link;
    input.focus();
    input.select();
    $("copy-proof-status").textContent = "Copy the selected verification link.";
  }
});

fromLocation();
