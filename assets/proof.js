import { allowLocalDevelopment, isHttpsUrl } from "../lib/blyggdrasil.js";
import { verifyPost } from "../lib/post-proof.js";
import { verifyExample } from "../lib/proof-examples.js";
import { proofLink } from "../lib/proof-link.js";
import { makeFetcher } from "../lib/resolvers.js";

if (["localhost", "127.0.0.1"].includes(location.hostname)) allowLocalDevelopment();

const $ = (id) => document.getElementById(id);
const form = $("proof-form");
const post = $("post-url");
const version = $("post-version");
const expectedKey = $("expected-key");
const copyButton = $("copy-proof-link");
const retryButton = $("retry-proof");
const state = $("proof-status");
const result = $("proof-result");
const get = makeFetcher((url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(12_000) }));
const exampleFile = new URL("../demo/proof/examples.json", import.meta.url);
const exampleNames = { original: "Example · signed original", edited: "Example · edited copy" };
const words = {
  valid: "Passed", invalid: "Failed", unsigned: "Unsigned", unavailable: "Unavailable",
};
const summary = {
  verified: ["Signature verified", "This copy matches the text signed by a key recognized by the blyg’s tree."],
  failed: ["Verification failed", "At least one check failed. Review the individual results below."],
  unsigned: ["Unsigned post", "This post has no signature to check."],
  unavailable: ["Verification unavailable", "Some evidence could not be checked. Review the individual results below."],
};
const recovery = {
  "invalid-input": "Check the post address, edition number and any trusted key you entered.",
  "post-not-found": "Check the post address or copy a new link from the publisher.",
  "pin-not-found": "Ask the publisher for a pinned copy of this edition. The latest post may contain different text.",
  "publisher-unavailable": "Check your connection, then retry. The publisher may be temporarily unavailable.",
  "malformed-post": "Ask the publisher for its canonical post address and version.",
  withdrawn: "If the publisher pinned an earlier edition, use that edition’s link.",
  unsigned: "Ask the publisher for a signed copy if you need to verify who signed it.",
  "content-mismatch": "Use the exact item data from the publisher before quoting this edition.",
  "signature-invalid": "Check the source post on the blyg or ask the publisher for a signed copy.",
  "signer-unauthorized": "Check which key the publisher’s signed tree authorizes.",
  "trusted-key-mismatch": "Confirm the publisher’s public key using a source you already trust.",
  "signing-tree-unavailable": "The signing tree or its history could not be checked. Retry or ask the publisher for its public proof.",
  "cryptography-unavailable": "Open the proof in a browser that supports Ed25519 verification.",
};
const retryable = new Set(["publisher-unavailable", "signing-tree-unavailable"]);

let request = 0;
let share = "";
let retryCheck = null;

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

function showEvidenceList(id, values) {
  $(id).replaceChildren(...values.map((value) => {
    const item = document.createElement("li");
    item.textContent = value;
    return item;
  }));
  $(id + "-row").hidden = !values.length;
}

function showResult(report, address, key, example, edition) {
  const [title, description] = summary[report.status] || summary.unavailable;
  const foundVersion = Number.isSafeInteger(report.version) && report.version > 0;
  $("proof-heading").textContent = title;
  $("proof-summary").textContent = report.error || description;
  const guidance = $("proof-recovery");
  guidance.textContent = Object.hasOwn(recovery, report.reason) ? recovery[report.reason] : "";
  guidance.hidden = !guidance.textContent;
  $("proof-version").textContent = foundVersion ? `Version ${report.version}${report.pinned ? " · pinned" : ""}` : "";
  $("proof-version").hidden = !foundVersion;

  for (const check of ["content", "signature", "signer"]) {
    showCheck(check + "-verdict", report.checks?.[check]);
  }
  $("expected-signer-row").hidden = !key;
  showCheck("expected-signer-verdict", report.expectedSigner);

  const isExample = Boolean(example);
  $("proof-example-label").hidden = !isExample;
  $("proof-example-label").textContent = isExample ? exampleNames[example.name] : "";
  $("proof-example-text").hidden = !isExample || !example.text;
  $("proof-example-text").textContent = example?.text || "";
  showLink("read-post", isExample ? null : report.pageUrl, "Read the latest post");
  const showOrigin = showLink("proof-origin", isExample ? null : report.origin);
  const showItem = showLink("proof-item", isExample ? exampleFile.href : report.itemUrl, isExample ? "Example evidence (JSON)" : report.itemUrl);
  const showManifest = showLink("proof-manifest", isExample ? null : report.manifestUrl);
  const showTree = showLink("proof-tree", isExample ? null : report.treeUrl);
  const showSource = showLink("proof-source", report.sourceUrl);
  const publicKey = typeof report.signingKey === "string" ? report.signingKey : "";
  $("proof-key").textContent = publicKey;
  $("proof-key-row").hidden = !publicKey;
  const currentKey = report.treeIdentity?.currentKey;
  $("proof-current-key").textContent = currentKey || "";
  $("proof-current-key-row").hidden = !currentKey || currentKey === publicKey;
  showEvidenceList("proof-history", (report.treeIdentity?.keyHistory || []).map((change) => change.how === "recovered"
    ? `Recovered from pinned tree ${change.from} using ${change.by}. Previous key ${change.key}`
    : `Rotated from ${change.key}`));
  showEvidenceList("proof-former", report.treeIdentity?.formerOrigins || []);
  $("proof-source-note").hidden = !showSource;
  $("proof-source-note").textContent = report.sourceKind === "archive-footer"
    ? "The signature covers the archived copy on this blyg."
    : "The signature covers the version published on this blyg.";
  $("proof-evidence").hidden = !(showOrigin || showItem || showManifest || showTree || showSource || publicKey);
  $("proof-evidence").open = false;

  if (foundVersion && showItem) {
    if (isExample) {
      share = location.href;
    } else if (edition) {
      const url = proofLink({ ...edition, version: report.version }, new URL("./", location.href));
      if (key) url.searchParams.set("key", key);
      share = url.href;
    } else {
      share = verificationUrl({ post: address, version: report.version, key }).href;
    }
  }
  copyButton.hidden = !share;
  result.hidden = false;
  state.textContent = title;
  state.classList.add("visually-hidden");
}

async function check(input, focus = false) {
  const { post: address, version: number, key, example: name, edition } = input;
  const id = ++request;
  const retryHadFocus = document.activeElement === retryButton;
  share = "";
  retryCheck = null;
  copyButton.hidden = true;
  retryButton.hidden = true;
  $("copy-proof-status").textContent = "";
  $("copy-link-fallback").hidden = true;
  result.hidden = true;
  state.classList.remove("visually-hidden");
  $("proof-edition-link").hidden = !edition;
  state.textContent = address || name || edition ? "Checking the post and signing key…" : "";
  if (!address && !name && !edition) return;

  let report;
  let example = name ? { name } : null;
  try {
    if (example) {
      const response = await fetch(exampleFile);
      if (!response.ok) throw new Error("Example evidence is unavailable.");
      const packet = await response.json();
      report = await verifyExample(packet, name);
      example.text = packet.examples[name].content_md;
    } else {
      report = await verifyPost(address, get, { version: number, expectedKey: key || undefined, edition });
    }
  } catch {
    report = { status: "unavailable", reason: "publisher-unavailable", error: "The post could not be checked in this browser." };
  }
  if (id !== request) return;
  if (edition && !post.value && report.itemUrl) post.value = report.itemUrl;
  showResult(report, address, key, example, edition);
  if (retryable.has(report.reason)) {
    retryCheck = input;
    retryButton.hidden = false;
  }
  if ((focus && form.contains(document.activeElement)) ||
      (retryHadFocus && document.activeElement === document.body)) $("proof-heading").focus();
}

function fromLocation() {
  const params = new URLSearchParams(location.search);
  const example = params.get("example");
  const address = params.get("post") || "";
  const number = params.get("version") || "";
  const key = params.get("key") || "";
  post.value = address;
  version.value = number;
  expectedKey.value = key;
  $("proof-options").open = Boolean(number || key);
  if (Object.hasOwn(exampleNames, example)) {
    void check({ example });
  } else if (!address && (params.has("origin") || params.has("id"))) {
    const edition = { origin: params.get("origin"), id: params.get("id") };
    void check({ edition, version: number, key });
  } else {
    void check({ post: address, version: number ? Number(number) : undefined, key });
  }
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
retryButton.addEventListener("click", () => {
  if (retryCheck) void check(retryCheck);
});
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
