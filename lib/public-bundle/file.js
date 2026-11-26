import { open } from "node:fs/promises";
import { MAX_TOTAL_BYTES } from "./surface.js";

// The envelope escapes JSON text, so its disk size can exceed the raw content limit.
const MAX_FILE_BYTES = 3 * MAX_TOTAL_BYTES;

export async function readBundleFile(path) {
  const file = await open(path, "r");
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > MAX_FILE_BYTES) throw new Error("Expected a regular bundle file within the size limit.");
    try {
      return JSON.parse(await file.readFile("utf8"));
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error("The bundle file is not valid JSON.");
      throw error;
    }
  } finally {
    await file.close();
  }
}
