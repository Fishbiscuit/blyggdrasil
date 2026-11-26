import { readFile } from "node:fs/promises";
import { verifyPost } from "../lib/post-proof.js";

const source = new URL("./proof-packet.json", import.meta.url);

export async function readPacket() {
  return JSON.parse(await readFile(source, "utf8"));
}

export function packetItem(packet, entry) {
  return { ...packet.documents[entry.itemUrl], ...entry.replace };
}

export async function verifyPacketCase(packet, entry) {
  const get = async (url) => {
    const json = url === entry.itemUrl ? packetItem(packet, entry) : packet.documents[url];
    return json ? { ok: true, status: 200, url, json } : { ok: false, status: 404, url };
  };
  const report = await verifyPost(entry.itemUrl, get, {
    version: entry.version,
    expectedKey: packet.trustedKey,
  });
  return {
    version: report.version,
    pinned: report.pinned,
    status: report.status,
    content: report.checks.content,
    signature: report.checks.signature,
    expectedSigner: report.expectedSigner,
    treeSigner: report.checks.signer,
  };
}
