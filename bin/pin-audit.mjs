#!/usr/bin/env node
import { parseArgs } from "node:util";
import { allowLocalDevelopment } from "../lib/blyggdrasil.js";
import { auditPins } from "../lib/pins/audit.js";

try {
  const { values, positionals } = parseArgs({
    options: { origin: { type: "string" }, json: { type: "boolean" }, help: { type: "boolean" } },
    allowPositionals: true,
  });
  const usage = "Usage: node bin/pin-audit.mjs BEFORE_DIR AFTER_DIR [--origin BLYG_URL] [--json]";
  if (values.help) {
    console.log(usage);
  } else {
    if (positionals.length !== 2) throw new Error(usage);
    if (process.env.BLYGGDRASIL_DEV === "1") allowLocalDevelopment();
    const report = await auditPins(...positionals, { origin: values.origin });
    if (values.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(`${report.unchanged} of ${report.checked.length} existing pin(s) preserved.`);
      for (const entry of report.checked) {
        if (entry.content !== "preserved") console.log(`${entry.content} ${entry.url}`);
        if (!entry.declared) console.log(`Missing changelog flag for ${entry.url}`);
      }
    }
    process.exitCode = report.ok ? 0 : 1;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
