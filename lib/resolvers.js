// Blyggdrasil 0.1 branch checks (SPEC.md §5.2, §5.3). One function per network.
// Each check makes at most 3 fetches, without credentials, and returns a verdict:
// verified (with method key | link | handle), failed, unreachable or claimed.

import { backReference, htmlHrefs, htmlText, isHttpsUrl, itemUrl, matchForm, loadTreeAt } from "./blyggdrasil.js";

const CLAIMED_HOSTS = /^(?:www\.)?(?:linkedin\.com|instagram\.com|threads\.net|threads\.com|facebook\.com|tiktok\.com)$/i;
const TRANSIENT_STATUS = new Set([429, 500, 502, 503, 504]);
const BRANCH_FETCH_LIMIT = 3;
const DEFAULT_RETRY_MS = 250;
const MAX_RETRY_MS = 1000;
const cancelled = () => ({ ok: false, status: 0, error: "request cancelled" });

// fetcher(url, { as: "json" | "text", signal? }) → { ok, status, json?, text?, url?, error?, retryAfter? }
export function makeFetcher(fetchImpl = globalThis.fetch) {
  return async function get(url, { as = "json", signal } = {}) {
    if (signal?.aborted) return cancelled();
    let res;
    try {
      const options = { credentials: "omit", redirect: "follow", headers: as === "json" ? { accept: "application/json" } : {} };
      if (signal) options.signal = signal;
      res = await fetchImpl(url, options);
    } catch {
      if (signal?.aborted) return cancelled();
      return { ok: false, status: 0, error: "network or cross-origin block" };
    }
    const out = { ok: res.ok, status: res.status, url: res.url || url };
    if (TRANSIENT_STATUS.has(res.status)) {
      const retryAfter = res.headers?.get?.("retry-after");
      if (retryAfter) out.retryAfter = retryAfter;
    }
    try {
      if (as === "json") out.json = await res.json(); else out.text = await res.text();
    } catch {
      if (signal?.aborted) return cancelled();
      out.ok = false;
      out.error = "unexpected response";
    }
    return out;
  };
}

const verdict = (v, extra = {}) => ({ verdict: v, ...extra });

function retryDelay(header) {
  const text = typeof header === "string" ? header.trim() : "";
  if (/^\d+$/.test(text)) return Number(text) * 1000;
  const date = /^[A-Za-z]{3}[A-Za-z]*[, ]/.test(text) ? Date.parse(text) : NaN;
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : DEFAULT_RETRY_MS;
}

function retryableUrl(value) {
  if (!isHttpsUrl(value)) return false;
  const { protocol, hostname } = new URL(value);
  const host = hostname.replace(/\.$/, "");
  return protocol === "https:" && /\.[a-z]/i.test(host) && !/\.(?:localhost|local|internal|home\.arpa)$/.test(host);
}

function waitForRetry(ms, signal) {
  if (!ms || signal?.aborted) return Promise.resolve(!signal?.aborted);
  return new Promise((resolve) => {
    const finish = (ready) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      resolve(ready);
    };
    const abort = () => finish(false);
    const timer = setTimeout(() => finish(true), ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function branchRequests(get, signal) {
  let attempts = 0;
  let retried = false;
  const state = { exhausted: false, get: read };

  async function read(url, options) {
    if (signal?.aborted) return cancelled();
    // A retry uses one of the branch's existing fetches. Leave ordinary lookup sequences unchanged.
    if (retried && attempts >= BRANCH_FETCH_LIMIT) {
      state.exhausted = true;
      return { ok: false, status: 0, error: "proof response still unavailable" };
    }
    const request = signal ? { ...options, signal } : options;
    attempts++;
    const response = await get(url, request);
    if (signal?.aborted) return cancelled();
    if (retried || attempts >= BRANCH_FETCH_LIMIT || !TRANSIENT_STATUS.has(response.status) ||
        !retryableUrl(url) || (response.url && !retryableUrl(response.url))) return response;
    const delay = retryDelay(response.retryAfter);
    if (delay > MAX_RETRY_MS) return response;
    retried = true;
    if (!await waitForRetry(delay, signal) || signal?.aborted) return cancelled();
    attempts++;
    return get(url, request);
  }

  return state;
}

function fromFetch(r, what) {
  if (r.status === 404 || r.status === 410) return verdict("failed", { detail: `${what} not found (${r.status})` });
  return verdict("unreachable", { detail: r.error || `${what} answered ${r.status}` });
}

function verified(method, account, detail, source) {
  const result = { method, account, detail };
  if (isHttpsUrl(source) && new URL(source).protocol === "https:") result.source = source;
  return verdict("verified", result);
}

function found(ref, account, detail, source) {
  return ref ? verified(ref.method, account, detail, source) : null;
}

async function github(user, ctx) {
  const api = `https://api.github.com/users/${encodeURIComponent(user)}`;
  const r = await ctx.get(api);
  if (!r.ok) return fromFetch(r, "GitHub user");
  const account = `github:${r.json.login}`;
  const ref = backReference({ texts: [r.json.bio, r.json.blog], links: [r.json.blog] }, ctx);
  if (ref) return found(ref, account, "profile", `https://github.com/${encodeURIComponent(user)}`);
  const g = await ctx.get(`${api}/gists?per_page=100`);
  if (!g.ok || !Array.isArray(g.json)) return g.ok ? verdict("unreachable", { detail: "gists answered oddly" }) : fromFetch(g, "GitHub gists");
  const file = g.json.flatMap((gist) => Object.values(gist.files || {})).find((f) => f?.filename === "blyggdrasil.txt");
  if (!file) return verdict("failed", { account, detail: "No back-reference in the profile and no blyggdrasil.txt gist." });
  if (!isHttpsUrl(file.raw_url) || new URL(file.raw_url).hostname !== "gist.githubusercontent.com") {
    return verdict("unreachable", { account, detail: "GitHub did not return a public gist URL." });
  }
  const t = await ctx.get(file.raw_url, { as: "text" });
  if (!t.ok) return fromFetch(t, "gist");
  return found(backReference({ texts: [t.text] }, ctx), account, "gist", file.raw_url) || verdict("failed", { account, detail: "blyggdrasil.txt gist has no back-reference" });
}

// Medium: a story containing the proof line, found in the author's RSS feed. Medium sends no
// cross-origin header, so a browser gets `unreachable`; the command line can read it.
async function medium(user, ctx) {
  const source = `https://medium.com/feed/@${encodeURIComponent(user)}`;
  const r = await ctx.get(source, { as: "text" });
  if (!r.ok) {
    if (r.status === 0) return verdict("unreachable", { detail: "Medium doesn’t let browsers read it; `blyggdrasil verify` on the command line can" });
    return fromFetch(r, "Medium feed");
  }
  const account = `medium:@${user}`;
  const items = r.text.split(/<item>/).slice(1);
  const texts = items.map((it) => htmlText((it.match(/<content:encoded><!\[CDATA\[([\s\S]*?)\]\]><\/content:encoded>/) || [])[1] || it));
  const links = items.flatMap((it) => htmlHrefs((it.match(/<content:encoded><!\[CDATA\[([\s\S]*?)\]\]><\/content:encoded>/) || [])[1] || ""));
  return found(backReference({ texts, links }, ctx), account, "story in the feed", source) || verdict("failed", { account, detail: "no recent Medium story names the key" });
}

async function blueskyProfile(actor, ctx) {
  const r = await ctx.get(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(actor)}`);
  if (!r.ok) return { fail: r.status === 400 ? verdict("failed", { detail: "Bluesky account not found" }) : fromFetch(r, "Bluesky profile") };
  return { profile: r.json };
}

async function bluesky(actor, rkey, ctx) {
  const { profile, fail } = await blueskyProfile(actor, ctx);
  if (fail) return fail;
  const account = `bluesky:${profile.did}`;
  const trunkHost = new URL(ctx.trunk).host.toLowerCase();
  const source = `https://bsky.app/profile/${encodeURIComponent(actor)}`;
  if (!rkey) {
    if (String(profile.handle).toLowerCase() === trunkHost) return verified("handle", account, `handle @${profile.handle}`, source);
    return found(backReference({ texts: [profile.description] }, ctx), account, "profile", source) || verdict("failed", { account, detail: "no back-reference in the profile" });
  }
  const uri = `at://${profile.did}/app.bsky.feed.post/${rkey}`;
  const p = await ctx.get(`https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts?uris=${encodeURIComponent(uri)}`);
  if (!p.ok) return fromFetch(p, "Bluesky post");
  const post = (p.json.posts || [])[0];
  if (!post) return verdict("failed", { account, detail: "Bluesky post not found" });
  if (post.author?.did !== profile.did) return verdict("failed", { account, detail: "the post belongs to another account" });
  const links = (post.record?.facets || []).flatMap((f) => (f.features || []).map((x) => x.uri).filter(Boolean));
  return found(backReference({ texts: [post.record?.text], links }, ctx), account, "post", `${source}/post/${encodeURIComponent(rkey)}`) || verdict("failed", { account, detail: "the post has no back-reference" });
}

// Returns null when the host does not answer as a Mastodon-family server, so the caller falls through.
async function mastodon(host, user, statusId, ctx) {
  const source = `https://${host}/@${encodeURIComponent(user)}`;
  if (statusId) {
    const r = await ctx.get(`https://${host}/api/v1/statuses/${encodeURIComponent(statusId)}`);
    if (!r.ok || typeof r.json?.account?.acct !== "string") return r.status === 404 && r.json?.error ? fromFetch(r, "post") : null;
    const acct = r.json.account.acct.split("@")[0].toLowerCase();
    if (acct !== user.toLowerCase()) return verdict("failed", { detail: "the post belongs to another account" });
    const account = `acct:${user}@${host}`;
    return found(backReference({ texts: [htmlText(r.json.content)], links: htmlHrefs(r.json.content) }, ctx), account, "post", `${source}/${encodeURIComponent(statusId)}`) || verdict("failed", { account, detail: "the post has no back-reference" });
  }
  const r = await ctx.get(`https://${host}/api/v1/accounts/lookup?acct=${encodeURIComponent(user)}`);
  if (!r.ok || typeof r.json?.acct !== "string") return r.status === 404 && r.json?.error ? fromFetch(r, "account") : null;
  const account = `acct:${r.json.acct.includes("@") ? r.json.acct : `${r.json.acct}@${host}`}`;
  const fields = r.json.fields || [];
  const html = [r.json.note, ...fields.map((f) => f.value)];
  const ref = backReference({ texts: html.map(htmlText), links: html.flatMap(htmlHrefs) }, ctx);
  const checked = fields.some((f) => f.verified_at && htmlHrefs(f.value).some((h) => matchForm(h) && ctx.trunk && matchForm(h).startsWith(matchForm(ctx.trunk))));
  return found(ref, account, checked ? "profile (link confirmed by the server)" : "profile", source) || verdict("failed", { account, detail: "no back-reference in the profile" });
}

async function xPost(user, id, ctx) {
  const target = `https://x.com/${user}/status/${id}`;
  const r = await ctx.get(`https://publish.x.com/oembed?url=${encodeURIComponent(target)}&omit_script=1&dnt=true`);
  if (!r.ok) return fromFetch(r, "X post");
  const author = String(r.json?.author_url || "").toLowerCase().replace("twitter.com", "x.com");
  if (author !== `https://x.com/${user.toLowerCase()}`) return verdict("failed", { detail: "the post belongs to another account" });
  const account = `x:${user}`;
  return found(backReference({ texts: [htmlText(r.json.html)], links: htmlHrefs(r.json.html) }, ctx), account, "post", target) || verdict("failed", { account, detail: "the post has no back-reference" });
}

// One probe of {url}/blyg.json; if it is a manifest, one more fetch for that blyg's tree.
async function blygBranch(url, ctx) {
  const u = new URL(url);
  u.hash = ""; u.search = "";
  if (!u.pathname.endsWith("/")) u.pathname += "/";
  const probe = await ctx.get(`${u}blyg.json`);
  if (!probe.ok || typeof probe.json?.blyg !== "string") return null;
  const origin = String(probe.url || `${u}blyg.json`).replace(/blyg\.json$/, "");
  const t = await loadTreeAt(origin, probe.json, ctx.get);
  const account = `blyg:${origin}`;
  if (!t.tree) return verdict("failed", { account, detail: "that blyg has no tree" });
  if (!t.tree.valid) return verdict("failed", { account, detail: `that blyg's tree is invalid: ${t.tree.reason}` });
  const shared = t.tree.keys.find((k) => ctx.keys.includes(k));
  const source = t.doc?.id ? itemUrl(origin, probe.json, t.doc.id) : `${origin}blyg.json`;
  return shared ? verified("key", account, "its tree has the same key", source) : verdict("failed", { account, detail: "its tree has a different key" });
}

async function page(url, ctx) {
  const r = await ctx.get(url, { as: "text" });
  if (!r.ok) return fromFetch(r, "page");
  const html = r.text;
  const relMe = [...html.matchAll(/<(?:a|link)\b[^>]*>/gi)].map((m) => m[0]).filter((tag) => /\brel\s*=\s*["'][^"']*\bme\b/i.test(tag)).flatMap(htmlHrefs);
  const ref = backReference({ texts: [htmlText(html)], links: relMe }, ctx);
  return found(ref, `web:${url}`, ref?.method === "link" ? 'rel="me" link' : "page", url) || verdict("failed", { detail: 'no rel="me" link or key on the page' });
}

// ctx: { keys: [did…], trunk, get, signal? }
export async function checkBranch(url, ctx) {
  let u;
  try { u = new URL(url); } catch { return verdict("failed", { detail: "not a URL" }); }
  const requests = branchRequests(ctx.get, ctx.signal);
  const result = await matchBranch(url, u, { ...ctx, get: requests.get });
  if (ctx.signal?.aborted) return verdict("unreachable", { detail: cancelled().error });
  if (requests.exhausted) return verdict("unreachable", { detail: "A temporary error interrupted the proof check. Try again." });
  return result;
}

async function matchBranch(url, u, ctx) {
  const host = u.host.toLowerCase().replace(/^www\./, "");
  const parts = u.pathname.split("/").filter(Boolean);

  if (ctx.trunk && matchForm(url) === matchForm(ctx.trunk)) return verified("link", `blyg:${ctx.trunk}`, "this is the trunk itself", ctx.trunk);
  if (host === "github.com" && parts.length === 1) return github(parts[0], ctx);
  if (host === "bsky.app" && parts[0] === "profile" && parts[1]) {
    if (parts.length === 2) return bluesky(parts[1], null, ctx);
    if (parts[2] === "post" && parts[3]) return bluesky(parts[1], parts[3], ctx);
  }
  if ((host === "x.com" || host === "twitter.com") && parts.length >= 1) {
    if (parts[1] === "status" && /^\d+$/.test(parts[2] || "")) return xPost(parts[0], parts[2], ctx);
    return verdict("claimed", { detail: "X profiles can't be read publicly; link a proof post instead" });
  }
  if (host === "medium.com" && parts[0]?.startsWith("@")) return medium(parts[0].slice(1), ctx);
  if (host.endsWith(".medium.com") && host !== "www.medium.com") return medium(host.slice(0, -".medium.com".length), ctx);
  if (CLAIMED_HOSTS.test(host)) return verdict("claimed", { detail: `${host} offers no public way to check` });
  if (parts[0]?.startsWith("@") && parts.length <= 2) {
    const m = await mastodon(u.host, parts[0].slice(1), parts[1] && /^\d+$/.test(parts[1]) ? parts[1] : null, ctx);
    if (m) return m;
  }
  const b = await blygBranch(url, ctx);
  if (b) return b;
  return page(url, ctx);
}
