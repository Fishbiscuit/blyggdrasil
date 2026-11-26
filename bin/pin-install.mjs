#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { allowLocalDevelopment } from "../lib/blyggdrasil.js";
import { installPin } from "../lib/pins/install.js";

try {
  const { values, positionals } = parseArgs({
    options: { publisher: { type: "string" }, help: { type: "boolean" } },
    allowPositionals: true,
  });
  const usage = "Usage: node bin/pin-install.mjs PIN.json --publisher STATIC_BLYG_DIR";
  if (values.help) {
    console.log(usage);
  } else {
    if (positionals.length !== 1 || !values.publisher) throw new Error(usage);
    if (process.env.BLYGGDRASIL_DEV === "1") allowLocalDevelopment();
    const pin = JSON.parse(await readFile(positionals[0], "utf8"));
    const result = await installPin(values.publisher, pin);
    console.log(JSON.stringify(result, null, 2));
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
