import { loadTree, isHttpsUrl } from "../lib/blyggdrasil.js";
import { checkBranch, makeFetcher } from "../lib/resolvers.js";
import { branchLabel } from "./labels.js";

const example = "https://fishbiscuit.me/blyg/";
const get = makeFetcher((url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(12_000) }));
const tags = document.querySelector("#tags");
const demoStatus = document.querySelector("#demo-status");
const branchesPanel = document.querySelector("#demo-branches");
const keyLabel = document.querySelector("#hud-key");
const states = {
  pending: "Checking…",
  verified: "Verified",
  failed: "Proof failed",
  unreachable: "Unavailable",
  claimed: "Claimed",
};
const proofMethods = {
  key: "A public proof names this tree’s signing key.",
  link: "The account links back to the blyg.",
  handle: "The account uses the blyg’s domain as its handle.",
};

async function showWorld(branches) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return null;
  try {
    const { createWorld, webglAvailable } = await import("./world.js");
    if (!webglAvailable()) return null;
    document.body.classList.remove("no-webgl");
    const world = createWorld({ canvas: document.querySelector("#world"), tags });
    world.setTree({
      seed: example, title: "Fishbiscuit", subtitle: "fishbiscuit.me/blyg",
      branches: branches.map(({ id, network, handle }) => ({ label: network, sub: handle, url: `#${id}` })),
      verdictText: () => states.pending,
    });
    for (const link of tags.querySelectorAll('a[href^="#demo-branch-"]')) {
      link.removeAttribute("target");
      link.addEventListener("click", (event) => {
        if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
        const detail = document.getElementById(link.hash.slice(1));
        if (!detail) return;
        detail.open = true;
        detail.querySelector("summary").focus({ preventScroll: true });
      });
    }
    return world;
  } catch {
    document.body.classList.add("no-webgl");
    return null;
  }
}

function branchRow(branch) {
  const details = document.createElement("details");
  details.id = branch.id;
  const summary = document.createElement("summary");
  const account = document.createElement("span");
  account.textContent = [branch.network, branch.handle].filter(Boolean).join(" · ");
  const status = document.createElement("span");
  status.className = "demo-branch-state";
  status.dataset.verdict = "pending";
  status.textContent = states.pending;
  summary.append(account, status);

  const note = document.createElement("p");
  note.textContent = "Checking the public proof…";
  const link = document.createElement("a");
  link.href = branch.url;
  link.rel = "noopener noreferrer";
  link.textContent = branch.network === "X" ? "Open proof post" : "Open account";
  const source = document.createElement("a");
  source.rel = "noopener noreferrer";
  source.textContent = "Open source that passed the check";
  source.hidden = true;
  const links = document.createElement("div");
  links.className = "demo-branch-links";
  links.append(link, source);
  details.append(summary, note, links);
  branchesPanel.append(details);
  return { status, note, link, source };
}

function showVerdict(row, result) {
  const status = Object.hasOwn(states, result.verdict) ? result.verdict : "unreachable";
  row.status.textContent = states[status];
  row.status.dataset.verdict = status;
  if (status === "verified") {
    row.note.textContent = proofMethods[result.method] || "The public proof verifies.";
    if (isHttpsUrl(result.source) && new URL(result.source).protocol === "https:") {
      const source = new URL(result.source).href;
      if (source !== row.link.href) {
        row.source.href = source;
        row.source.hidden = false;
      }
    }
  } else {
    row.note.textContent = result.detail || "The public proof could not be checked.";
  }
  return status;
}

async function showExample() {
  demoStatus.textContent = "Loading the live account proofs…";
  const tree = await loadTree(example, get);
  if (!tree.tree?.valid) {
    demoStatus.textContent = "The live account proofs are unavailable. The tree and post links are below.";
    return;
  }
  const branches = tree.tree.claims.branches.filter(isHttpsUrl).map((url, index) => {
    const [network, handle] = branchLabel(url);
    return { id: `demo-branch-${index + 1}`, url, network, handle: handle.split(" · ")[0] };
  });
  const rows = branches.map(branchRow);
  demoStatus.textContent = rows.length ? "Choose an account to see its proof." : "This tree lists no public accounts.";
  branchesPanel.hidden = rows.length === 0;
  keyLabel.textContent = `Key · ${tree.tree.claims.key.slice(0, 16)}…${tree.tree.claims.key.slice(-6)}`;
  keyLabel.hidden = false;

  const world = showWorld(branches);
  await Promise.all(branches.map(async (branch, index) => {
    let result;
    try {
      result = await checkBranch(branch.url, { trunk: tree.origin, keys: tree.tree.keys, get });
    } catch {
      result = { verdict: "unreachable" };
    }
    const status = showVerdict(rows[index], result);
    (await world)?.setVerdict(index, status, states[status]);
  }));
}

showExample().catch(() => {
  demoStatus.textContent = "The live account proofs are unavailable. The tree and post links are below.";
});
