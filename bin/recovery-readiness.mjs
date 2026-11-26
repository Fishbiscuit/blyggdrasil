#!/usr/bin/env node
import { parseArgs } from "node:util";
import { allowLocalDevelopment } from "../lib/blyggdrasil.js";
import { checkRecoveryReadiness } from "../lib/recovery-readiness.js";
import { makeFetcher } from "../lib/resolvers.js";

const usage = "Usage: recovery-readiness <blyg> --version N [--recovery-key DID] [--json]";

async function main() {
  if (process.env.BLYGGDRASIL_DEV === "1") allowLocalDevelopment();
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      version: { type: "string" },
      "recovery-key": { type: "string" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    console.log(usage);
    console.log("Checks the public evidence needed to replace a lost signing key. Keep the recovery private key offline.");
    return;
  }
  if (positionals.length !== 1 || !/^[1-9]\d*$/.test(values.version || "")) throw new TypeError(usage);
  const get = makeFetcher((url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(8000) }));
  const report = await checkRecoveryReadiness(positionals[0], get, {
    version: Number(values.version),
    recoveryKey: values["recovery-key"],
  });
  if (values.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`${report.status}: ${report.detail}`);
    if (report.currentVersion) console.log(`Current tree v${report.currentVersion}: ${report.treeUrl}`);
    if (report.pinUrl) console.log(`Requested pin v${report.pinVersion}: ${report.pinUrl}`);
    for (const key of report.recoveryKeys) console.log(`Recovery key: ${key}`);
  }
  process.exitCode = report.status === "ready" ? 0 : 1;
}

try {
  await main();
} catch (error) {
  console.error(`recovery-readiness: ${error instanceof TypeError ? error.message : "The check could not be completed."}`);
  process.exitCode = 2;
}
