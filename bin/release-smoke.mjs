#!/usr/bin/env node
import { parseArgs } from "node:util";
import { checkRelease } from "../scripts/release/smoke.mjs";

const usage = `Usage: node bin/release-smoke.mjs [--mirror https://staged.example]

Read the public Fishbiscuit tree, verify both live edit-and-pin editions, and
expect HTTP 404 for the missing pin. With --mirror, read an HTTPS mirror while
checking canonical publisher identities. The results are JSON. A failed check
makes the command exit with status 1.`;

try {
  const { values } = parseArgs({ options: {
    mirror: { type: "string" },
    help: { type: "boolean", short: "h" },
  } });
  if (values.help) {
    console.log(usage);
  } else {
    const report = await checkRelease({ mirror: values.mirror });
    console.log(JSON.stringify(report, null, 2));
    if (!report.passed) process.exitCode = 1;
  }
} catch (error) {
  console.error(`release-smoke: ${error.message}`);
  process.exitCode = 1;
}
