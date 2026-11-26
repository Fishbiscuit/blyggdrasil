import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { archiveFile } from "../lib/ingest.js";

export const cli = fileURLToPath(new URL("../bin/republish-archive.mjs", import.meta.url));
export const origin = "https://publisher.example/blyg/";
export const oldDate = "2025-11-16T01:12:13Z";

export function archiveSetup(t) {
  const workspace = mkdtempSync(join(tmpdir(), "blyggdrasil-republish-"));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  const seed = join(workspace, "seed");
  writeFileSync(seed, randomBytes(32), { mode: 0o600 });
  const archive = join(workspace, "archive");
  const put = (name, overrides = {}, folder = "public") => {
    const item = {
      network: "x", url: "https://x.com/river/status/123", created: oldDate,
      kind: "post", visibility: "public", text: "An archive story", ...overrides,
    };
    const dest = join(archive, folder, item.network, item.created.slice(0, 4));
    mkdirSync(dest, { recursive: true });
    const path = join(dest, name + ".md");
    writeFileSync(path, archiveFile(item));
    return path;
  };
  const args = [cli, archive, "--origin", origin, "--seed", seed];
  return { workspace, archive, seed, args, put };
}
