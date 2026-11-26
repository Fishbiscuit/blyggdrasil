#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { buildReleaseOverlay } from "../scripts/release/overlay.mjs";

const usage = `Usage: node bin/release-overlay.mjs --baseline PUBLIC_DIR --out NEW_PUBLIC_DIR [--source CHECKOUT]

Build a local public directory from a previously verified site baseline. Only
the allowed Blyggdrasil web files are overlaid. The command preserves every
other public file, refuses changes to an existing pin, and prints the verified
file changes and SHA-256 hashes as JSON. Use an existing parent directory for
the output. The command takes an unpacked public directory and does no network I/O.`;

try {
  const { values } = parseArgs({
    options: {
      baseline: { type: "string" },
      out: { type: "string" },
      source: { type: "string", default: fileURLToPath(new URL("../", import.meta.url)) },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    console.log(usage);
  } else {
    if (!values.baseline || !values.out) throw new Error("Use --baseline and --out. See --help.");
    const report = await buildReleaseOverlay({
      baseline: values.baseline, output: values.out, source: values.source,
    });
    console.log(JSON.stringify(report, null, 2));
  }
} catch (error) {
  console.error(`release-overlay: ${error.message}`);
  process.exitCode = 1;
}
