import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { verifyExample } from "../lib/proof-examples.js";

const json = async (href) => JSON.parse(await readFile(new URL(href, import.meta.url), "utf8"));

test("the published v1 examples match real verified and failed proof reports", async () => {
  const schema = await json("../schemas/post-proof.v1.json");
  const packet = await json("../demo/proof/examples.json");
  for (const [file, name] of [["verified", "original"], ["failed", "edited"]]) {
    const sample = await json(`../schemas/examples/post-proof.${file}.json`);
    const report = await verifyExample(packet, name);
    assert.equal(sample.status, file);
    assert(schema.properties.status.enum.includes(sample.status));
    for (const field of schema.required) assert(Object.hasOwn(sample, field), field);
    for (const [key, value] of Object.entries(sample)) assert.deepEqual(report[key], value, key);
    for (const check of schema.properties.checks.required) assert(schema.$defs.check.enum.includes(sample.checks[check]));
    if (file === "verified") {
      for (const check of Object.keys(sample.checks)) {
        assert.equal(sample.checks[check], schema.allOf[0].then.properties.checks.properties[check].const);
      }
    } else {
      assert.equal(sample.checks.content, "invalid");
      assert(!Object.hasOwn(sample, "contentMarkdown"));
    }
  }
});
