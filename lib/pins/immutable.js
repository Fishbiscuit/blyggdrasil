import { randomUUID } from "node:crypto";
import { link, lstat, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";

export const documentBytes = (value) => JSON.stringify(value, null, 2) + "\n";

export async function writeImmutable(path, pin) {
  const pending = join(dirname(path), `.blyggdrasil-pin-${randomUUID()}.tmp`);
  try {
    await writeFile(pending, documentBytes(pin), { flag: "wx" });
    try {
      await link(pending, path);
      return true;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (!(await lstat(path)).isFile()) throw new Error("The pin path is not a regular file.");
      const existing = JSON.parse(await readFile(path, "utf8"));
      if (!isDeepStrictEqual(existing, pin)) throw new Error("A conflicting snapshot already exists at this pin path.");
      return false;
    }
  } finally {
    await unlink(pending).catch((error) => { if (error.code !== "ENOENT") throw error; });
  }
}
