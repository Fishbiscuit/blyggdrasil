#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readBundleFile } from "../lib/public-bundle/file.js";
import { verifyPublicBundle } from "../lib/public-bundle/verify.js";

const usage = "node bin/verify-public-bundle.mjs <bundle.json> [--expect-key <public did:key>]";
try {
  const { positionals, values } = parseArgs({
    options: { "expect-key": { type: "string" }, help: { type: "boolean" } },
    allowPositionals: true,
  });
  if (values.help) {
    console.log(usage);
  } else {
    if (positionals.length !== 1) throw new Error(usage);
    const bundle = await readBundleFile(positionals[0]);
    const report = await verifyPublicBundle(bundle, { expectedKey: values["expect-key"] });
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== "verified") process.exitCode = 1;
  }
} catch (error) {
  console.error(`verify-public-bundle: ${error.message}`);
  process.exitCode = 1;
}
