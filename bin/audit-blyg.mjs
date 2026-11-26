#!/usr/bin/env node
import { parseArgs } from "node:util";
import { allowLocalDevelopment } from "../lib/blyggdrasil.js";
import { auditArchive, makeAuditFetcher } from "../lib/archive-audit.js";

const help = "Usage: node bin/audit-blyg.mjs <public blyg> [--limit 1–50]\nPrints one JSON result per post to stdout. Unreadable archives report an error to stderr.";
try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { help: { type: "boolean", short: "h" }, limit: { type: "string" } },
  });
  if (values.help) console.log(help);
  else {
    if (positionals.length !== 1) throw new Error(help);
    if (process.env.BLYGGDRASIL_DEV === "1") allowLocalDevelopment();
    const limit = values.limit === undefined ? undefined : Number(values.limit);
    await auditArchive(positionals[0], makeAuditFetcher(), {
      limit,
      onItem: (result) => console.log(JSON.stringify(result)),
    });
  }
} catch (error) {
  console.error(`audit-blyg: ${error.message}`);
  process.exitCode = 1;
}
