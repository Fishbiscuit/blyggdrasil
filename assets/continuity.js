import { continuitySteps, rehearseContinuity } from "../lib/continuity.js";

const element = (id) => document.getElementById(id);
const scenarios = element("continuity-steps");
const result = element("continuity-result");
const status = element("continuity-status");
const outcomes = {
  verified: "Current post verified",
  failed: "Current post verification failed",
  unavailable: "Current post verification unavailable",
};
const verdicts = {
  valid: "Passed",
  invalid: "Failed",
  unavailable: "Unavailable",
  unsigned: "Unsigned",
};
const keys = ["content", "signature", "signer"];
const labels = ["Current text matches its hash", "Current signature verifies", "Tree authorizes the current key"];

function row(label, value, { verdict, code } = {}) {
  const div = document.createElement("div");
  const dt = document.createElement("dt");
  const dd = document.createElement("dd");
  dt.textContent = label;
  if (verdict) dd.dataset.verdict = verdict;
  if (code) {
    const data = document.createElement("code");
    data.textContent = value;
    dd.append(data);
  } else {
    dd.textContent = value;
  }
  div.append(dt, dd);
  return div;
}

function show(index, report) {
  const step = continuitySteps[index];
  for (const [number, button] of [...scenarios.querySelectorAll("button")].entries()) {
    if (number === index) button.setAttribute("aria-current", "step");
    else button.removeAttribute("aria-current");
  }
  element("continuity-heading").textContent = step.title;
  element("continuity-description").textContent = step.description;
  const outcome = element("continuity-outcome");
  outcome.textContent = outcomes[report.active.status];
  outcome.dataset.status = report.active.status;
  const checks = keys.map((key, number) =>
    row(labels[number], verdicts[report.active.checks[key]], { verdict: report.active.checks[key] }));
  checks.push(row("Matches the known public key", verdicts[report.active.expectedSigner], { verdict: report.active.expectedSigner }));
  checks.push(row("Pinned first copy", report.samePinnedCopy ? "Verified" : "Unavailable"));
  checks.push(row("Account’s original proof", report.branch.verdict === "verified" ? "Verified" : "Unavailable"));
  if (report.redirected) checks.push(row("Old manifest resolves to the new blyg", "Confirmed"));
  if (report.signedMove) checks.push(row("Signed tree names the old blyg", "Confirmed"));
  element("continuity-checks").replaceChildren(...checks);

  const facts = [
    row("Blyg address", report.origin, { code: true }),
    row("Current item in catalog", `Version ${report.catalogVersion}`),
    row("Public signing key", report.active.signingKey, { code: true }),
    row("Pinned item address", report.pinned.itemUrl, { code: true }),
  ];
  for (const action of report.history) {
    facts.push(row(action.how === "rotated" ? "Previous key authorized by rotation" : "Previous key authorized by recovery", action.key, { code: true }));
    if (action.from) facts.push(row("Pinned recovery evidence", `Tree ${action.from}`));
  }
  if (report.treeError) facts.push(row("Tree verification", report.treeError));
  element("continuity-facts").replaceChildren(...facts);
  result.hidden = false;
}

try {
  const reports = await rehearseContinuity();
  for (const [index, step] of continuitySteps.entries()) {
    const listItem = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = step.title;
    button.addEventListener("click", () => show(index, reports[index]));
    listItem.append(button);
    scenarios.append(listItem);
  }
  show(0, reports[0]);
  status.hidden = true;
} catch {
  status.textContent = "The rehearsal could not run. Use a current browser with Ed25519 support.";
}
