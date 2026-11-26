import { lstat, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export async function publisherFile(root, origin, url, { makeParents = false } = {}) {
  const base = new URL(origin);
  const target = new URL(url);
  if (target.origin !== base.origin || !target.pathname.startsWith(base.pathname) || target.search || target.hash) {
    throw new Error("The item or pin URL does not map to a file within this static publisher.");
  }
  const segments = target.pathname.slice(base.pathname.length).split("/").map(decodeURIComponent);
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || /[\\/:\0]/.test(segment))) {
    throw new Error("The item or pin path is not a valid static file path.");
  }
  let parent = root;
  for (const segment of segments.slice(0, -1)) {
    parent = join(parent, segment);
    let info = await lstat(parent).catch((error) => {
      if (makeParents && error.code === "ENOENT") return null;
      throw error;
    });
    if (!info) {
      await mkdir(parent);
      info = await lstat(parent);
    }
    if (!info.isDirectory()) throw new Error("Static publisher paths must use real directories.");
  }
  return join(parent, segments.at(-1));
}

export async function readRegular(path) {
  const info = await lstat(path);
  if (!info.isFile()) throw new Error("Expected a regular static publisher file.");
  return { bytes: await readFile(path), mode: info.mode & 0o777 };
}
