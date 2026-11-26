import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { packetItem, readPacket, verifyPacketCase } from "../interop/packet.mjs";

const packet = await readPacket();

test("the edition proof packet contains the public demo documents", async () => {
  const mirror = new URL("../demo/edit-and-pin/blyg/", import.meta.url);
  assert.equal(packet.format, "blyggdrasil-edition-proof/1");
  for (const [url, doc] of Object.entries(packet.documents)) {
    assert.ok(url.startsWith(packet.origin), url);
    const served = JSON.parse(await readFile(new URL(url.slice(packet.origin.length), mirror), "utf8"));
    assert.deepEqual(doc, served, url);
  }
  const original = packet.cases.find((entry) => entry.name === "pinned-original");
  assert.equal(packet.trustedKey, packetItem(packet, original).author.sig.key);
});

for (const entry of packet.cases) {
  test(`edition proof case: ${entry.name}`, async () => {
    const result = await verifyPacketCase(packet, entry);
    assert.deepEqual(result, { version: entry.version, pinned: entry.pinned, ...entry.expected });
  });
}
