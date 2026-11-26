#!/usr/bin/env node
import { parseArgs } from "node:util";
import { allowLocalDevelopment, isDidKey } from "../lib/blyggdrasil.js";
import { makeFetcher } from "../lib/resolvers.js";
import { preparePin } from "../lib/pins/prepare.js";
import { documentBytes, writeImmutable } from "../lib/pins/immutable.js";

try {
  const { values, positionals } = parseArgs({
    options: { version: { type: "string" }, "expect-key": { type: "string" }, out: { type: "string" }, help: { type: "boolean" } },
    allowPositionals: true,
  });
  const usage = "Usage: node bin/pin-prepare.mjs POST_URL [--version N] [--expect-key DID] [--out PIN.json]";
  if (values.help) {
    console.log(usage);
  } else {
    if (positionals.length !== 1) throw new Error(usage);
    const version = values.version === undefined ? undefined : Number(values.version);
    if (values.version !== undefined && (!/^[1-9]\d*$/.test(values.version) || !Number.isSafeInteger(version))) {
      throw new Error("--version must be a positive whole number.");
    }
    const expectedKey = values["expect-key"];
    if (expectedKey !== undefined && !isDidKey(expectedKey)) throw new Error("--expect-key must be an Ed25519 did:key.");
    if (process.env.BLYGGDRASIL_DEV === "1") allowLocalDevelopment();
    const get = makeFetcher((url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(10_000) }));
    const pin = await preparePin(positionals[0], get, { version, expectedKey });
    if (values.out) await writeImmutable(values.out, pin);
    else process.stdout.write(documentBytes(pin));
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
