#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { planArchiveRepublish } from "../lib/archive-republish/plan.js";

function help() {
  console.log("Usage: node bin/republish-archive.mjs ARCHIVE --origin HTTPS_BLYG_ORIGIN --seed FILE");
  console.log("Preview public archive posts as JSON. The seed holds 32 private random bytes. Keep it for stable item IDs.");
  console.log("This command leaves the archive and filesystem unchanged.");
}

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { origin: { type: "string" }, seed: { type: "string" }, help: { type: "boolean" } },
  });
  if (values.help) help();
  else {
    if (positionals.length !== 1 || !values.origin || !values.seed) throw new Error("Supply ARCHIVE, --origin and --seed. See --help.");
    const plan = planArchiveRepublish(positionals[0], { origin: values.origin, seed: readFileSync(values.seed) });
    console.log(JSON.stringify(plan, null, 2));
  }
} catch (error) {
  console.error(`Archive republishing: ${error.message}`);
  process.exitCode = 1;
}
