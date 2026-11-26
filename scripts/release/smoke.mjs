import { isHttpsUrl, loadTree, pinUrl } from "../../lib/blyggdrasil.js";
import { verifyEditAndPin } from "../../lib/edit-and-pin.js";
import { verifyPost } from "../../lib/post-proof.js";

const site = "https://fishbiscuit.me";
const profile = `${site}/blyggdrasil/tree/fishbiscuit/`;
const blyg = `${site}/blyg/`;
const demo = `${site}/blyggdrasil/demo/edit-and-pin/blyg/`;
const demoItem = "1hk3fv43xwpgckk19k4wf3v9ts";
const pinnedUrl = pinUrl(demo, {}, demoItem, 1);
const currentUrl = `${demo}items/${demoItem}.json`;
const missingUrl = pinUrl(demo, {}, demoItem, 3);

function readFrom(mirror, fetchImpl) {
  return async (url, { as = "json" } = {}) => {
    try {
      const canonical = new URL(url);
      if (canonical.origin !== site) return { ok: false, status: 0, url };
      const target = new URL(mirror);
      target.pathname = canonical.pathname;
      target.search = canonical.search;
      const response = await fetchImpl(target.href, {
        credentials: "omit",
        redirect: "error",
        signal: AbortSignal.timeout(8000),
        headers: { accept: as === "json" ? "application/json" : "text/html" },
      });
      if (!response.ok || (response.url && new URL(response.url).origin !== mirror)) {
        await response.body?.cancel();
        return { ok: false, status: response.status, url };
      }
      // The mirror serves the canonical documents. Keep their identity URLs for
      // verification and change only the transport used to read the bytes.
      const body = as === "json" ? await response.json() : await response.text();
      return { ok: true, status: response.status, [as]: body, url };
    } catch {
      return { ok: false, status: 0, url };
    }
  };
}

export async function checkRelease({ mirror = site, fetchImpl = globalThis.fetch } = {}) {
  if (!isHttpsUrl(mirror)) throw new Error("The mirror must be an absolute HTTPS site origin.");
  const target = new URL(mirror);
  if (target.pathname !== "/" || target.search || target.hash) {
    throw new Error("The mirror must be a site origin with no route, query or fragment.");
  }
  const get = readFrom(target.origin, fetchImpl);
  const [page, tree, editions, missing, missingProof] = await Promise.all([
    get(profile, { as: "text" }),
    loadTree(blyg, get).catch(() => null),
    verifyEditAndPin({ pinnedUrl, currentUrl }, get),
    get(missingUrl),
    verifyPost(missingUrl, get, { version: 3 }),
  ]);

  const checks = [
    {
      name: "Public tree page",
      url: profile,
      passed: page.ok && page.text.includes(`data-tree-address="${blyg}"`) && /<article\b/i.test(page.text),
      status: page.status,
    },
    {
      name: "Signed public tree",
      url: blyg,
      passed: tree?.origin === blyg && tree?.tree?.valid === true,
    },
    {
      name: "Pinned edition proof",
      url: pinnedUrl,
      passed: editions.pinned.status === "verified" && editions.pinned.pinned === true &&
        editions.pinned.version === 1,
      verdict: editions.pinned.status,
      version: editions.pinned.version,
    },
    {
      name: "Edited edition proof",
      url: currentUrl,
      passed: !editions.error && editions.current.status === "verified" && editions.current.pinned === false &&
        editions.current.version === 2,
      verdict: editions.current.status,
      version: editions.current.version,
    },
    {
      name: "Missing pin",
      url: missingUrl,
      passed: missing.status === 404 && missingProof.status === "unavailable",
      status: missing.status,
      verdict: missingProof.status,
    },
  ];
  return { site, checkedAt: target.origin, passed: checks.every((check) => check.passed), checks };
}
