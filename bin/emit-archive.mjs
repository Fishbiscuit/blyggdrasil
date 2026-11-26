#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { emitArchiveRepublish } from "../lib/archive-republish/emit.js";
import { planArchiveRepublish } from "../lib/archive-republish/plan.js";
import { importKeyFile } from "../lib/blyggdrasil.js";

function help() {
  console.log("Usage: node bin/emit-archive.mjs ARCHIVE --origin HTTPS_BLYG_ORIGIN --seed FILE --key FILE --out DIRECTORY --published-at UTC");
  console.log("Write signed public archive items locally. Preview the same archive, origin and seed with bin/republish-archive.mjs first.");
  console.log("Pass the publication time as YYYY-MM-DDTHH:MM:SSZ. Use the same private seed to keep item IDs after future key changes.");
  console.log("The signature covers the archive copy. Existing items are preserved. This command makes no network requests.");
}

async function loadKey(file) {
  try {
    return await importKeyFile(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    throw new Error("Could not load a valid Blyggdrasil private key file.");
  }
}

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      origin: { type: "string" }, seed: { type: "string" }, key: { type: "string" },
      out: { type: "string" }, "published-at": { type: "string" }, help: { type: "boolean" },
    },
  });
  if (values.help) help();
  else {
    if (positionals.length !== 1 || ["origin", "seed", "key", "out", "published-at"].some((name) => !values[name])) {
      throw new Error("Supply ARCHIVE, --origin, --seed, --key, --out and --published-at. See --help.");
    }
    const [archive] = positionals;
    const plan = planArchiveRepublish(archive, { origin: values.origin, seed: readFileSync(values.seed) });
    const report = await emitArchiveRepublish(plan, {
      archive, outDir: values.out, publishedAt: values["published-at"], key: await loadKey(values.key),
    });
    console.log(JSON.stringify(report, null, 2));
  }
} catch (error) {
  console.error(`Archive emission: ${error.message}`);
  process.exitCode = 1;
}
