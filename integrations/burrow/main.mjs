import { createInterface } from "node:readline";
import { copyEditionLink, readEdition } from "./edition.mjs";

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
const write = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
const error = (id, code, message) => write({ id, error: { code, message } });

for await (const line of lines) {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    error(null, -32700, "Invalid JSON.");
    continue;
  }

  if (!request || request.jsonrpc !== "2.0" || typeof request.method !== "string") {
    error(null, -32600, "Expected a JSON-RPC request.");
    continue;
  }
  if (!Object.hasOwn(request, "id")) continue;
  const { id, method, params } = request;

  if (method === "initialize") {
    if (params?.protocolVersion !== 1) {
      error(id, -32602, "Burrow Extension Protocol version 1 is required.");
      continue;
    }
    write({ id, result: { protocolVersion: 1, name: "blyggdrasil-proof", version: "0.1.0" } });
  } else if (method === "shutdown") {
    write({ id, result: null });
    lines.close();
    process.stdin.pause();
    break;
  } else if (method === "extension/entry.action" && params?.action === "copy-proof-link") {
    const edition = readEdition(params.entry);
    if (!edition) {
      error(id, -32602, "This entry has no valid public Blygger origin, item ID, and edition.");
      continue;
    }
    write({ id, result: copyEditionLink(edition) });
  } else {
    error(id, -32601, "Unknown extension method or action.");
  }
}
