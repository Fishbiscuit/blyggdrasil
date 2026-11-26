import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { packetItem, readPacket, verifyPacketCase } from "./packet.mjs";

const reader = fileURLToPath(new URL("./blyg_read.py", import.meta.url));
const run = promisify(execFile);

async function pythonByline(path, entry, trustedKey) {
  const args = [reader, "--file", path, "--expect-key", trustedKey, "--json"];
  if (entry.pinned) args.push("--pin", String(entry.version));
  const { stdout, exit } = await run("python3", args).then(
    (result) => ({ stdout: result.stdout, exit: 0 }),
    (error) => {
      if (error.code !== 1) throw error;
      return { stdout: error.stdout, exit: 1 };
    },
  );
  const reports = JSON.parse(stdout);
  assert.equal(reports.length, 1, entry.name);
  const [report] = reports;
  assert.equal(exit, report.status === "verified" ? 0 : 1, entry.name);
  return {
    version: report.version,
    pinned: report.pinned,
    status: report.status,
    content: report.checks.content,
    signature: report.checks.signature,
    expectedSigner: report.expectedSigner,
  };
}

const packet = await readPacket();
const workspace = await mkdtemp(join(tmpdir(), "blyggdrasil-interop-"));
try {
  const cases = [];
  for (const [index, entry] of packet.cases.entries()) {
    const path = join(workspace, `case-${index}.json`);
    await writeFile(path, JSON.stringify(packetItem(packet, entry)));
    const [javascript, python] = await Promise.all([
      verifyPacketCase(packet, entry),
      pythonByline(path, entry, packet.trustedKey),
    ]);
    assert.deepEqual(javascript, { version: entry.version, pinned: entry.pinned, ...entry.expected }, entry.name);
    const { treeSigner, ...byline } = javascript;
    assert.deepEqual(python, byline, entry.name);
    cases.push({ name: entry.name, ...byline, treeSigner });
  }
  console.log(JSON.stringify({ packet: packet.format, agreement: true, cases }, null, 2));
} finally {
  await rm(workspace, { recursive: true });
}
