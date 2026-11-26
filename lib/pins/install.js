import { randomUUID } from "node:crypto";
import { mkdir, realpath, rename, rmdir, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { itemUrl, pinUrl } from "../blyggdrasil.js";
import { documentBytes, writeImmutable } from "./immutable.js";
import { preparePin } from "./prepare.js";
import { publicationEntry, snapshotPin, validatePin } from "./snapshot.js";
import { publisherFile, readRegular } from "./static-root.js";

async function updateChangelog(path, previous, item) {
  const pending = join(dirname(path), `.blyggdrasil-item-${randomUUID()}.tmp`);
  try {
    await writeFile(pending, documentBytes(item), { mode: previous.mode, flag: "wx" });
    if (!(await readRegular(path)).bytes.equals(previous.bytes)) {
      throw new Error("The current item changed during installation. The pin is intact. Retry from a stable build.");
    }
    await rename(pending, path);
  } finally {
    await unlink(pending).catch((error) => { if (error.code !== "ENOENT") throw error; });
  }
}

export async function installPin(publisher, pin) {
  validatePin(pin);
  const root = await realpath(publisher);
  const lock = join(root, ".blyggdrasil-pin-install");
  try {
    await mkdir(lock);
  } catch (error) {
    if (error.code === "EEXIST") throw new Error("Another pin installation is in progress in this publisher.");
    throw error;
  }
  try {
    const origin = pin.origin;
    const manifest = JSON.parse((await readRegular(join(root, "blyg.json"))).bytes);
    if (!manifest?.blyg) throw new Error("This folder has no usable Blygger manifest.");
    const currentAddress = itemUrl(origin, manifest, pin.id);
    const pinnedAddress = pinUrl(origin, manifest, pin.id, pin.version);
    const currentPath = await publisherFile(root, origin, currentAddress);
    const previous = await readRegular(currentPath);
    const current = JSON.parse(previous.bytes);
    const edition = publicationEntry(current, pin.version);
    if (current.id !== pin.id || current.origin !== origin ||
        (current.kind !== "withdrawn" && current.kind !== pin.kind) ||
        !Number.isSafeInteger(current.version) || current.version < pin.version ||
        !edition || edition.at !== pin.at || (edition.note ?? null) !== (pin.note ?? null)) {
      throw new Error("The pin does not match a published edition in this publisher's changelog.");
    }
    if (current.version === pin.version && !isDeepStrictEqual(snapshotPin(current), pin)) {
      throw new Error("The pin differs from the published current edition.");
    }
    if (currentAddress === pinnedAddress) throw new Error("The current item and pin must have separate files.");
    const get = async (url) => {
      if (url === pinnedAddress) return { ok: true, status: 200, url, json: pin };
      try {
        const file = await publisherFile(root, origin, url);
        const { bytes } = await readRegular(file);
        return { ok: true, status: 200, url, json: JSON.parse(bytes) };
      } catch (error) {
        if (error.code === "ENOENT") return { ok: false, status: 404, url };
        throw error;
      }
    };
    await preparePin(pinnedAddress, get, { version: pin.version });

    const pinnedPath = await publisherFile(root, origin, pinnedAddress, { makeParents: true });
    if (currentPath === pinnedPath) throw new Error("The current item and pin must have separate files.");
    // Readers can never observe the changelog's promise before the immutable snapshot exists.
    const created = await writeImmutable(pinnedPath, pin);
    const changelogUpdated = edition.pinned !== true;
    if (changelogUpdated) {
      edition.pinned = true;
      await updateChangelog(currentPath, previous, current);
    }
    return { id: pin.id, version: pin.version, created, changelogUpdated };
  } finally {
    await rmdir(lock);
  }
}
