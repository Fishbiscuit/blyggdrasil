import { auditArchive, DEFAULT_AUDIT_LIMIT, makeAuditFetcher } from "../lib/archive-audit.js";
import { allowLocalDevelopment, isHttpsUrl } from "../lib/blyggdrasil.js";
import { proofLink } from "../lib/proof-link.js";

if (location.hostname === "localhost" || location.hostname === "127.0.0.1") allowLocalDevelopment();

const $ = (id) => document.getElementById(id);
const address = $("audit-blyg");
const limitInput = $("audit-limit");
const status = $("audit-status");
const results = $("audit-results");
const list = $("audit-result-list");
const filter = $("audit-issues");
const noIssues = $("audit-empty-filter");
const template = $("audit-row");
const labels = { verified: "Verified", failed: "Check failed", unsigned: "Unsigned", unavailable: "Evidence unavailable" };
const checks = { valid: "passed", invalid: "failed", unsigned: "unsigned", unavailable: "unavailable" };
let complete = false;

function filterRows() {
  let visible = 0;
  for (const row of list.children) {
    row.hidden = filter.checked && row.dataset.verdict === "verified";
    if (!row.hidden) visible++;
  }
  noIssues.hidden = !complete || !filter.checked || visible !== 0;
}

function addRow({ origin, id, version, proof }) {
  const row = template.content.firstElementChild.cloneNode(true);
  const verdict = row.querySelector(".audit-verdict");
  row.dataset.verdict = proof.status;
  row.querySelector(".audit-post").textContent = `Version ${version} · ${id}`;
  verdict.textContent = labels[proof.status];
  row.querySelector(".audit-checks").textContent = [
    `Text ${checks[proof.checks.content]}`,
    `signature ${checks[proof.checks.signature]}`,
    `signer ${checks[proof.checks.signer]}`,
  ].join(" · ");
  if (proof.error) {
    const detail = row.querySelector(".audit-error");
    detail.textContent = proof.error;
    detail.hidden = false;
  }
  row.querySelector(".audit-proof-link").href = proofLink({ origin, id, version }, new URL("../verify/", location.href));
  if (proof.pageUrl && isHttpsUrl(proof.pageUrl)) {
    const link = row.querySelector(".audit-post-link");
    link.href = proof.pageUrl;
    link.hidden = false;
  }
  row.hidden = filter.checked && proof.status === "verified";
  list.append(row);
  results.hidden = false;
}

async function runAudit(input, limit) {
  status.textContent = "Checking the public archive…";
  try {
    const report = await auditArchive(input, makeAuditFetcher(), { limit, onItem: addRow });
    complete = true;
    filterRows();
    if (!report.results.length) {
      status.textContent = "No public posts to check in this archive.";
      return;
    }
    status.textContent = report.truncated
      ? `Checked the first ${report.results.length} posts listed by the archive.`
      : `Checked ${report.results.length} ${report.results.length === 1 ? "post" : "posts"}.`;
    const index = $("audit-index");
    index.href = report.archiveUrl;
    index.hidden = false;
  } catch (error) {
    status.textContent = error.message;
  }
}

filter.addEventListener("change", filterRows);

const params = new URLSearchParams(location.search);
address.value = params.get("blyg") ?? "";
limitInput.value = params.get("limit") ?? DEFAULT_AUDIT_LIMIT;
if (address.value) void runAudit(address.value, Number(params.get("limit") ?? DEFAULT_AUDIT_LIMIT));
