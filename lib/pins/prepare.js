import { verifyPost } from "../post-proof.js";
import { snapshotPin } from "./snapshot.js";

export async function preparePin(input, get, options = {}) {
  const responses = new Map();
  const served = new Map();
  const capture = (url, fetchOptions) => {
    const type = fetchOptions?.as || "json";
    const key = `${type} ${url}`;
    if (!responses.has(key)) {
      // Capture each response once and send the same document to the verifier and pin writer.
      responses.set(key, Promise.resolve(get(url, fetchOptions)).then((response) => {
        const retained = structuredClone(response);
        if (retained?.ok && type === "json") served.set(url, retained.json);
        return retained;
      }));
    }
    return responses.get(key);
  };
  const report = await verifyPost(input, capture, options);
  if (report.status !== "verified") {
    throw new Error(`Cannot prepare pin: ${report.error || `post proof is ${report.status}`}.`);
  }
  return snapshotPin(served.get(report.itemUrl));
}
