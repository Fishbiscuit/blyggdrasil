import { verifyPost } from "./post-proof.js";

export function verifyExample(packet, name) {
  if (!Object.hasOwn(packet.examples, name)) throw new Error("Unknown proof example.");
  const item = packet.examples[name];
  const get = async (url) => {
    const data = url === packet.postUrl ? item : Object.hasOwn(packet.shared, url) ? packet.shared[url] : null;
    return data ? { ok: true, status: 200, url, json: data } : { ok: false, status: 404, url };
  };
  return verifyPost(packet.postUrl, get);
}
