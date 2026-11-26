#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readBundleFile } from "../lib/public-bundle/file.js";
import { planBlygMove } from "../lib/public-bundle/move.js";

const usage = "node bin/plan-blyg-move.mjs <bundle.json> <https://new.example/blyg/> [--expect-key <public did:key>]";
try {
  const { positionals, values } = parseArgs({
    options: { "expect-key": { type: "string" }, help: { type: "boolean" } },
    allowPositionals: true,
  });
  if (values.help) {
    console.log(usage);
  } else {
    if (positionals.length !== 2) throw new Error(usage);
    const bundle = await readBundleFile(positionals[0]);
    const plan = await planBlygMove(bundle, positionals[1], { expectedKey: values["expect-key"] });
    console.log(JSON.stringify(plan, null, 2));
    if (plan.status !== "planned") process.exitCode = 1;
  }
} catch (error) {
  console.error(`plan-blyg-move: ${error.message}`);
  process.exitCode = 1;
}
