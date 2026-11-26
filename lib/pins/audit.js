import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { isHttpsUrl, itemUrl, pinUrl } from "../blyggdrasil.js";
import { publicationEntry } from "./snapshot.js";
import { publisherFile, readRegular } from "./static-root.js";

const ID = /^[0-7][0-9abcdefghjkmnpqrstvwxyz]{25}$/;

async function openBuild(directory) {
  const root = await realpath(directory);
  const manifest = JSON.parse((await readRegular(join(root, "blyg.json"))).bytes);
  if (!manifest || typeof manifest.blyg !== "string" || !manifest.blyg) {
    throw new Error("Expected a static Blygger output folder containing blyg.json.");
  }
  return { root, manifest };
}

async function readAt(build, origin, url) {
  const path = await publisherFile(build.root, origin, url);
  return (await readRegular(path)).bytes;
}

async function loadCurrent(build, origin, id) {
  const address = itemUrl(origin, build.manifest, id);
  const bytes = await readAt(build, origin, address);
  const item = JSON.parse(bytes);
  if (item.id !== id || item.origin !== origin || !Array.isArray(item.changelog)) {
    throw new Error(`Cannot audit item ${id}: the document does not match the publisher's index.`);
  }
  return item;
}

export async function auditPins(beforeDirectory, afterDirectory, { origin } = {}) {
  const before = await openBuild(beforeDirectory);
  const after = await openBuild(afterDirectory);
  const base = origin ?? before.manifest.site;
  if (!isHttpsUrl(base) || new URL(base).href !== base || !base.endsWith("/") || /[?#]/.test(base)) {
    throw new Error("Supply a canonical --origin ending in / when the manifest has no canonical site URL.");
  }
  const archiveUrl = new URL(before.manifest.items ?? "items/index.json", base).href;
  const archive = JSON.parse(await readAt(before, base, archiveUrl));
  if (!Array.isArray(archive.items)) throw new Error("The original publisher has no readable item index.");
  const checked = [];
  const ids = new Set();
  for (const { id } of archive.items) {
    if (!ID.test(id || "") || ids.has(id)) throw new Error("The original item index has an invalid or duplicate ID.");
    ids.add(id);
    const item = await loadCurrent(before, base, id);
    const pinned = item.changelog.filter((entry) => entry?.pinned === true);
    if (!pinned.length) continue;
    const afterItem = await loadCurrent(after, base, id).catch((error) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    for (const { version } of pinned) {
      if (!Number.isSafeInteger(version) || version < 1 || !publicationEntry(item, version)) {
        throw new Error(`Cannot audit item ${id}: the original changelog has an invalid pinned version.`);
      }
      const url = pinUrl(base, before.manifest, id, version);
      const original = await readAt(before, base, url);
      const old = JSON.parse(original);
      if (old.id !== id || old.origin !== base || old.version !== version || old.pinned !== true) {
        throw new Error(`Cannot audit item ${id} version ${version}: the original pin is inconsistent.`);
      }
      const replacement = await readAt(after, base, url).catch((error) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      });
      const content = replacement === undefined ? "missing" : original.equals(replacement) ? "preserved" : "changed";
      const declared = afterItem !== undefined && publicationEntry(afterItem, version)?.pinned === true;
      checked.push({ id, version, url, content, declared });
    }
  }
  const unchanged = checked.filter((pin) => pin.content === "preserved" && pin.declared).length;
  return { ok: unchanged === checked.length, unchanged, checked };
}
