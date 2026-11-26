import { verifyPost } from "./post-proof.js";

export async function verifyEditAndPin({ pinnedUrl, currentUrl }, get) {
  const [pinned, current] = await Promise.all([
    verifyPost(pinnedUrl, get, { version: 1, includeText: true }),
    verifyPost(currentUrl, get, { includeText: true }),
  ]);

  const editions = { pinned, current };
  if (pinned.status !== "verified" || current.status !== "verified") {
    return { ...editions, error: "Both editions need to verify before they can be compared." };
  }
  if (!pinned.pinned || current.pinned || current.origin !== pinned.origin || current.itemId !== pinned.itemId) {
    return { ...editions, error: "The two URLs must identify the pinned original and the current edition of one post." };
  }
  if (current.version <= pinned.version || current.contentMarkdown === pinned.contentMarkdown) {
    return { ...editions, error: "The current post has no newer edition with different text." };
  }
  return editions;
}
