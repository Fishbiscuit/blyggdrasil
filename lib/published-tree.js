import { extractBlocks, isHttpsUrl, itemIdIn, loadTreeAt, resolveBlyg, treePointer } from "./blyggdrasil.js";
import { checkBranch } from "./resolvers.js";

export async function checkPublishedTree(draft, publishedUrl, get) {
  if (!isHttpsUrl(publishedUrl)) return { error: "Paste the full address of your published tree post." };
  const id = itemIdIn(publishedUrl);
  const trunk = new URL(draft.origin);
  if (!id || new URL(publishedUrl).origin !== trunk.origin || !new URL(publishedUrl).pathname.startsWith(trunk.pathname)) {
    return { error: "Paste the address of a post on the blyg you used to make this tree." };
  }

  const blyg = await resolveBlyg(draft.origin, get);
  if (blyg.error || blyg.origin !== draft.origin) {
    return { error: "Your blyg could not be reached at the address in this tree. Check the address and try again." };
  }
  const result = await loadTreeAt(blyg.origin, blyg.manifest, get, publishedUrl);
  if (!result.doc) return { error: "The tree post could not be read. Publish it publicly and check the post address." };
  if (result.doc.id !== id || result.doc.origin !== blyg.origin) {
    return { error: "The item returned by your blyg does not match this post address." };
  }
  if (!result.tree?.valid) return { error: result.tree?.reason || "This post does not contain a valid signed tree." };
  if (result.tree.claims.key !== draft.key) {
    return { error: "The public tree uses a different signing key from the tree you just made." };
  }
  if (extractBlocks(result.doc.content_md).body !== draft.body) {
    return { error: "The signing key matches, but the signed tree details differ from the draft you just made." };
  }
  const pointer = treePointer(blyg.manifest);
  let pointerUrl;
  try {
    if (pointer) pointerUrl = new URL(pointer, blyg.origin).href;
  } catch {}
  if (!pointerUrl || new URL(pointerUrl).origin !== trunk.origin
      || !new URL(pointerUrl).pathname.startsWith(trunk.pathname) || itemIdIn(pointerUrl) !== id) {
    return { error: 'Your signed tree is public. Add a profile link named “Blyggdrasil” pointing to this post, or set the blyggdrasil field in your manifest, then check again.' };
  }

  const branches = [];
  for (let i = 0; i < result.tree.claims.branches.length; i += 4) {
    const batch = result.tree.claims.branches.slice(i, i + 4);
    branches.push(...await Promise.all(batch.map(async (url) => ({
      url,
      ...await checkBranch(url, { keys: result.tree.keys, trunk: blyg.origin, get }),
    }))));
  }
  return { origin: blyg.origin, branches };
}
