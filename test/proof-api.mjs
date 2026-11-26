import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyPost } from "blyggdrasil/post-proof";
import { proofLink } from "blyggdrasil/proof-link";

test("an external consumer can import the proof verifier and edition links", async () => {
  const origin = "https://publisher.example/blyg/";
  const id = "01jpcyy4qaaaek03ptm4c5g1c2";
  const url = proofLink({ origin, id, version: 1 });
  assert.equal(url.searchParams.get("origin"), origin);
  const result = await verifyPost(undefined, async () => ({ ok: false, status: 404 }), {
    edition: { origin, id }, version: 1,
  });
  assert.equal(result.status, "unavailable");
});
