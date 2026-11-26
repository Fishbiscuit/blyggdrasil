import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readAccounts, renderAccount } from "../lib/tree-page.js";

test("a proof link targets its own disclosure and retains the complete evidence URL", () => {
  const url = "https://x.com/publisher/status/12345?view=proof&via=tree";
  const html = renderAccount({ url }, "Claimed");
  const target = html.match(/<details[^>]*>[\s\S]*?<p class="account-reason" id="([^"]+)"/)?.[1];
  const href = html.match(/class="account-permalink" href="#([^"]+)"/)?.[1];
  assert.ok(target && href);
  assert.equal(decodeURIComponent(href), target.replaceAll("&amp;", "&"));
  assert.equal(decodeURIComponent(href), `account-${url}`);

  const otherPost = renderAccount({ url: "https://x.com/publisher/status/67890" }, "Claimed");
  assert.notEqual(otherPost.match(/class="account-permalink" href="#([^"]+)"/)?.[1], href);
  assert.match(otherPost, /href="https:\/\/x\.com\/publisher"/);
});

test("only one disclosure is emitted per canonical account proof address", () => {
  const url = "https://github.com/publisher";
  const branches = [url, "https://GITHUB.com/publisher", "https://github.com/other"];
  const accounts = readAccounts({ tree: { valid: true, claims: { branches } } });
  assert.deepEqual(accounts.map((account) => account.url), [url, branches[2]]);
});
