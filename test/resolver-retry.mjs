import assert from "node:assert/strict";
import { test } from "node:test";
import { checkBranch, makeFetcher } from "../lib/resolvers.js";

const trunk = "https://publisher.example/blyg/";
const branch = "https://github.com/publisher";
const profile = "https://api.github.com/users/publisher";
const gist = "https://gist.githubusercontent.com/publisher/example/raw/blyggdrasil.txt";
const profileProof = { login: "publisher", blog: trunk };
const branchContext = (get, signal) => ({ get, signal, trunk, keys: [] });

function reply(status, body, retryAfter) {
  const headers = retryAfter ? { "Retry-After": retryAfter } : {};
  return new Response(JSON.stringify(body), { status, headers });
}

test("ordinary fetches retain their signal, omit credentials and leave retry timing to the caller", async () => {
  const controller = new AbortController();
  let calls = 0;
  const get = makeFetcher((url, options) => {
    calls++;
    assert.equal(url, profile);
    assert.equal(options.signal, controller.signal);
    assert.equal(options.credentials, "omit");
    return reply(429, { message: "rate limited" }, "0");
  });
  const result = await get(profile, { signal: controller.signal });
  assert.equal(result.retryAfter, "0");
  assert.equal(calls, 1);
});

test("a branch can verify after a temporary rate limit", async () => {
  const calls = [];
  const get = makeFetcher((url, { credentials }) => {
    assert.equal(credentials, "omit");
    calls.push(url);
    return calls.length === 1 ? reply(429, { message: "rate limited" }, "0") : reply(200, profileProof);
  });
  const result = await checkBranch(branch, branchContext(get));
  assert.deepEqual(calls, [profile, profile]);
  assert.equal(result.verdict, "verified");
  assert.equal(result.source, branch);
});

test("a short Retry-After delay is honored and the same request is tried only once more", async () => {
  const times = [];
  const get = makeFetcher(() => {
    times.push(performance.now());
    return reply(503, { message: "temporarily unavailable" }, "1");
  });
  const result = await checkBranch(branch, branchContext(get));
  assert.equal(result.verdict, "unreachable");
  assert.equal(times.length, 2);
  assert.ok(times[1] - times[0] >= 990, "retry must wait for the service");
});

test("a longer Retry-After HTTP-date is respected by skipping the automatic retry", async () => {
  let calls = 0;
  const get = makeFetcher(() => {
    calls++;
    return reply(503, { message: "temporarily unavailable" }, new Date(Date.now() + 60_000).toUTCString());
  });
  const result = await checkBranch(branch, branchContext(get));
  assert.equal(result.verdict, "unreachable");
  assert.equal(calls, 1);
});

test("an automatic retry cannot make a successful fallback exceed three public reads", async () => {
  const calls = [];
  const get = makeFetcher((url) => {
    calls.push(url);
    if (calls.length === 1) return reply(429, {}, "0");
    if (url === profile) return reply(200, { login: "publisher" });
    if (url === `${profile}/gists?per_page=100`) {
      return reply(200, [{ files: { proof: { filename: "blyggdrasil.txt", raw_url: gist } } }]);
    }
    assert.fail("no fourth public read");
  });
  const result = await checkBranch(branch, branchContext(get));
  assert.deepEqual(calls, [profile, profile, `${profile}/gists?per_page=100`]);
  assert.equal(result.verdict, "unreachable");
  assert.equal(result.source, undefined);
});

test("permanent failures and HTTP branch fallbacks do not retry", async () => {
  for (const status of [401, 403, 404, 410]) {
    const calls = [];
    const get = makeFetcher((url) => {
      calls.push(url);
      return reply(status, {}, "0");
    });
    const result = await checkBranch(branch, branchContext(get));
    assert.deepEqual(calls, [profile]);
    assert.equal(result.verdict, status === 404 || status === 410 ? "failed" : "unreachable");
  }

  const calls = [];
  const get = makeFetcher((url) => {
    calls.push(url);
    return reply(503, {}, "0");
  });
  const address = "http://publisher.example/other";
  await checkBranch(address, branchContext(get));
  assert.deepEqual(calls, [`${address}/blyg.json`, address]);
});

test("cancelling a scheduled retry prevents another request", async () => {
  const controller = new AbortController();
  let calls = 0;
  const get = async (url, { signal }) => {
    calls++;
    assert.equal(signal, controller.signal);
    setTimeout(() => controller.abort(), 10);
    return { ok: false, status: 429, url, retryAfter: "1" };
  };
  const result = await checkBranch(branch, branchContext(get, controller.signal));
  assert.equal(result.verdict, "unreachable");
  assert.match(result.detail, /cancelled/);
  assert.equal(calls, 1);
});
