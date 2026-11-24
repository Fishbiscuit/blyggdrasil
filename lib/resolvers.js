// Blyggdrasil 0.1 branch checks (SPEC.md §5.2, §5.3). One function per network.
// Each check makes at most 3 fetches, without credentials, and returns a verdict:
// verified (with method key | link | handle), failed, unreachable or claimed.

import { backReference, htmlHrefs, htmlText, matchForm, loadTreeAt } from "./blyggdrasil.js";

const CLAIMED_HOSTS = /^(?:www\.)?(?:linkedin\.com|instagram\.com|threads\.net|threads\.com|facebook\.com|tiktok\.com)$/i;

// fetcher(url, { as: "json" | "text" }) → { ok, status, json?, text?, url?, error? }
export function makeFetcher(fetchImpl = globalThis.fetch) {
  return async function get(url, { as = "json" } = {}) {
    let res;
    try {
      res = await fetchImpl(url, { credentials: "omit", redirect: "follow", headers: as === "json" ? { accept: "application/json" } : {} });
    } catch (e) {
      return { ok: false, status: 0, error: "network or cross-origin block" };
    }
    const out = { ok: res.ok, status: res.status, url: res.url || url };
    try {
      if (as === "json") out.json = await res.json(); else out.text = await res.text();
    } catch {
      out.ok = false;
      out.error = "unexpected response";
    }
    return out;
  };
}

const verdict = (v, extra = {}) => ({ verdict: v, ...extra });

function fromFetch(r, what) {
  if (r.status === 404 || r.status === 410) return verdict("failed", { detail: `${what} not found (${r.status})` });
  return verdict("unreachable", { detail: r.error || `${what} answered ${r.status}` });
}

function found(ref, account, detail) {
  return ref ? verdict("verified", { method: ref.method, account, detail }) : null;
}

async function github(user, ctx) {
  const api = `https://api.github.com/users/${encodeURIComponent(user)}`;
  const r = await ctx.get(api);
  if (!r.ok) return fromFetch(r, "GitHub user");
  const account = `github:${r.json.login}`;
  const ref = backReference({ texts: [r.json.bio, r.json.blog], links: [r.json.blog] }, ctx);
  if (ref) return found(ref, account, "profile");
  const g = await ctx.get(`${api}/gists?per_page=100`);
  if (!g.ok || !Array.isArray(g.json)) return g.ok ? verdict("unreachable", { detail: "gists answered oddly" }) : fromFetch(g, "GitHub gists");
  const file = g.json.flatMap((gist) => Object.values(gist.files || {})).find((f) => f?.filename === "blyggdrasil.txt");
  if (!file) return verdict("failed", { account, detail: "no back-reference in the profile, and no blyggdrasil.txt gist" });
  const t = await ctx.get(file.raw_url, { as: "text" });
  if (!t.ok) return fromFetch(t, "gist");
  return found(backReference({ texts: [t.text] }, ctx), account, "gist") || verdict("failed", { account, detail: "blyggdrasil.txt gist has no back-reference" });
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
  if (!rkey) {
    if (String(profile.handle).toLowerCase() === trunkHost) return verdict("verified", { method: "handle", account, detail: `handle @${profile.handle}` });
    return found(backReference({ texts: [profile.description] }, ctx), account, "profile") || verdict("failed", { account, detail: "no back-reference in the profile" });
  }
  const uri = `at://${profile.did}/app.bsky.feed.post/${rkey}`;
  const p = await ctx.get(`https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts?uris=${encodeURIComponent(uri)}`);
  if (!p.ok) return fromFetch(p, "Bluesky post");
  const post = (p.json.posts || [])[0];
  if (!post) return verdict("failed", { account, detail: "Bluesky post not found" });
  if (post.author?.did !== profile.did) return verdict("failed", { account, detail: "the post belongs to another account" });
  const links = (post.record?.facets || []).flatMap((f) => (f.features || []).map((x) => x.uri).filter(Boolean));
  return found(backReference({ texts: [post.record?.text], links }, ctx), account, "post") || verdict("failed", { account, detail: "the post has no back-reference" });
}

// Returns null when the host does not answer as a Mastodon-family server, so the caller falls through.
async function mastodon(host, user, statusId, ctx) {
  if (statusId) {
    const r = await ctx.get(`https://${host}/api/v1/statuses/${encodeURIComponent(statusId)}`);
    if (!r.ok || typeof r.json?.account?.acct !== "string") return r.status === 404 && r.json?.error ? fromFetch(r, "post") : null;
    const acct = r.json.account.acct.split("@")[0].toLowerCase();
    if (acct !== user.toLowerCase()) return verdict("failed", { detail: "the post belongs to another account" });
    const account = `acct:${user}@${host}`;
    return found(backReference({ texts: [htmlText(r.json.content)], links: htmlHrefs(r.json.content) }, ctx), account, "post") || verdict("failed", { account, detail: "the post has no back-reference" });
  }
  const r = await ctx.get(`https://${host}/api/v1/accounts/lookup?acct=${encodeURIComponent(user)}`);
  if (!r.ok || typeof r.json?.acct !== "string") return r.status === 404 && r.json?.error ? fromFetch(r, "account") : null;
  const account = `acct:${r.json.acct.includes("@") ? r.json.acct : `${r.json.acct}@${host}`}`;
  const fields = r.json.fields || [];
  const html = [r.json.note, ...fields.map((f) => f.value)];
  const ref = backReference({ texts: html.map(htmlText), links: html.flatMap(htmlHrefs) }, ctx);
  const checked = fields.some((f) => f.verified_at && htmlHrefs(f.value).some((h) => matchForm(h) && ctx.trunk && matchForm(h).startsWith(matchForm(ctx.trunk))));
  return found(ref, account, checked ? "profile (link confirmed by the server)" : "profile") || verdict("failed", { account, detail: "no back-reference in the profile" });
}

async function xPost(user, id, ctx) {
  const target = `https://x.com/${user}/status/${id}`;
  const r = await ctx.get(`https://publish.x.com/oembed?url=${encodeURIComponent(target)}&omit_script=1&dnt=true`);
  if (!r.ok) return fromFetch(r, "X post");
  const author = String(r.json?.author_url || "").toLowerCase().replace("twitter.com", "x.com");
  if (author !== `https://x.com/${user.toLowerCase()}`) return verdict("failed", { detail: "the post belongs to another account" });
  const account = `x:${user}`;
  return found(backReference({ texts: [htmlText(r.json.html)], links: htmlHrefs(r.json.html) }, ctx), account, "post") || verdict("failed", { account, detail: "the post has no back-reference" });
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
  return shared ? verdict("verified", { method: "key", account, detail: "its tree has the same key" }) : verdict("failed", { account, detail: "its tree has a different key" });
}

async function page(url, ctx) {
  const r = await ctx.get(url, { as: "text" });
  if (!r.ok) return fromFetch(r, "page");
  const html = r.text;
  const relMe = [...html.matchAll(/<(?:a|link)\b[^>]*>/gi)].map((m) => m[0]).filter((tag) => /\brel\s*=\s*["'][^"']*\bme\b/i.test(tag)).flatMap(htmlHrefs);
  const ref = backReference({ texts: [htmlText(html)], links: relMe }, ctx);
  return found(ref, `web:${url}`, ref?.method === "link" ? 'rel="me" link' : "page") || verdict("failed", { detail: 'no rel="me" link or key on the page' });
}

// ctx: { keys: [did…], trunk, get, depth }
export async function checkBranch(url, ctx) {
  let u;
  try { u = new URL(url); } catch { return verdict("failed", { detail: "not a URL" }); }
  const host = u.host.toLowerCase().replace(/^www\./, "");
  const parts = u.pathname.split("/").filter(Boolean);
  ctx = { depth: 0, ...ctx };

  if (ctx.trunk && matchForm(url) === matchForm(ctx.trunk)) return verdict("verified", { method: "link", account: `blyg:${ctx.trunk}`, detail: "this is the trunk itself" });
  if (host === "github.com" && parts.length === 1) return github(parts[0], ctx);
  if (host === "bsky.app" && parts[0] === "profile" && parts[1]) {
    if (parts.length === 2) return bluesky(parts[1], null, ctx);
    if (parts[2] === "post" && parts[3]) return bluesky(parts[1], parts[3], ctx);
  }
  if ((host === "x.com" || host === "twitter.com") && parts.length >= 1) {
    if (parts[1] === "status" && /^\d+$/.test(parts[2] || "")) return xPost(parts[0], parts[2], ctx);
    return verdict("claimed", { detail: "X profiles can't be read publicly; link a proof post instead" });
  }
  if (CLAIMED_HOSTS.test(host)) return verdict("claimed", { detail: `${host} offers no public way to check` });
  if (parts[0]?.startsWith("@") && parts.length <= 2) {
    const m = await mastodon(u.host, parts[0].slice(1), parts[1] && /^\d+$/.test(parts[1]) ? parts[1] : null, ctx);
    if (m) return m;
  }
  const b = await blygBranch(url, ctx);
  if (b) return b;
  return page(url, ctx);
}
