#!/usr/bin/env node
import { readFile, realpath, stat, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { allowLocalDevelopment } from "../lib/blyggdrasil.js";
import { exportPublicBundle } from "../lib/public-bundle/export.js";
import { blygOrigin, MAX_DOCUMENT_BYTES } from "../lib/public-bundle/surface.js";

const usage = "node bin/export-public-bundle.mjs <https://…/blyg/> [--out bundle.json] [--mirror <public directory>]";
try {
  const { values, positionals } = parseArgs({
    options: { out: { type: "string" }, mirror: { type: "string" }, help: { type: "boolean" } },
    allowPositionals: true,
  });
  if (values.help) {
    console.log(usage);
  } else {
    if (positionals.length !== 1) throw new Error(usage);
    if (process.env.BLYGGDRASIL_DEV === "1") allowLocalDevelopment();
    const origin = blygOrigin(positionals[0]);
    const read = values.mirror ? await mirrorReader(origin, values.mirror) : fetchPublic;
    const bundle = await exportPublicBundle(origin, read);
    const json = JSON.stringify(bundle, null, 2) + "\n";
    if (values.out) {
      await writeFile(values.out, json, { flag: "wx", mode: 0o600 });
    } else {
      process.stdout.write(json);
    }
  }
} catch (error) {
  console.error(`export-public-bundle: ${error.message}`);
  process.exitCode = 1;
}

async function fetchPublic(url) {
  const response = await fetch(url, {
    credentials: "omit", redirect: "error", headers: { accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok || !response.body) throw new Error(`Can't read ${url} (HTTP ${response.status}).`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  let bytes = 0;
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_DOCUMENT_BYTES) throw new Error(`Document exceeds the size limit at ${url}.`);
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    await reader.cancel().catch(() => {});
  }
}

async function mirrorReader(origin, folder) {
  const root = await realpath(folder);
  const mount = new URL(origin).pathname;
  return async address => {
    const url = new URL(address);
    const path = decodeURIComponent(url.pathname.slice(mount.length));
    if (!url.pathname.startsWith(mount) || url.search || path.split("/").some(part => part.startsWith("."))) {
      throw new Error(`Document has no supported path in the public mirror: ${address}.`);
    }
    const file = await realpath(resolve(root, path));
    const inside = relative(root, file);
    if (inside === ".." || inside.startsWith(".." + sep) || isAbsolute(inside)) {
      throw new Error(`Document points outside the public mirror: ${address}.`);
    }
    const info = await stat(file);
    if (!info.isFile() || info.size > MAX_DOCUMENT_BYTES) {
      throw new Error(`Document is absent or too large at ${address}.`);
    }
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(await readFile(file));
  };
}
