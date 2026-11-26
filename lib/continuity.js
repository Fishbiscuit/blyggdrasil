import {
  generateKey, importKeyFile, itemUrl, loadTree, pinUrl, proofLine, resolveBlyg,
  serializeClaims, signByline, signClaims, treeMarkdown,
} from "./blyggdrasil.js";
import { verifyPost } from "./post-proof.js";
import { checkBranch } from "./resolvers.js";

const oldOrigin = "https://old-blyg.example/blyg/";
const newOrigin = "https://new-blyg.example/blyg/";
const account = "https://profile.example/avery";
const postId = "01jpcyy4qaaaek03ptm4c5g1c2";
const treeId = "01jpcyy4qaaaek03ptm4c5g1c3";
const original = "# A note from the ferry\n\nThe orange light reached the wake.";
const updated = original + "\n\nBy morning I had come ashore.";
const encoder = new TextEncoder();

export const continuitySteps = [
  {
    id: "publish", title: "Publish and pin",
    description: "Publish the first signed post and pin version 1 of both the post and the tree. The tree names a recovery key.",
  },
  {
    id: "move", title: "Move the blyg",
    description: "Copy the post and its pinned version to the new blyg. Publish a tree signed by the original key that names the former address. Simulate a permanent redirect for the old manifest.",
  },
  {
    id: "rotate", title: "Rotate the signing key",
    description: "After the move, both keys sign the rotation tree. A new edit uses the new key, while the pinned copy and account still verify with the previous key.",
  },
  {
    id: "recover", title: "Recover a lost key",
    description: "Try the other path after the move. If the original key is lost before rotation, use the recovery key named in pinned tree version 1. The lost key never signs the recovery tree.",
  },
  {
    id: "missing-pin", title: "Remove recovery evidence",
    description: "Make the pinned tree unavailable. The post’s content and signature still check, but the reader can no longer establish that the signing key is authorized.",
  },
  {
    id: "wrong-key", title: "Try an unrelated key",
    description: "Sign the current post with an unrelated key. Its signature is mathematically valid, but the recovered tree does not authorize it.",
  },
];

async function signedTree(origin, version, signer, otherSigners, claims) {
  const body = serializeClaims({ ...claims, trunk: origin, key: signer.did, branches: [account] });
  const signatures = await signClaims(body, [signer, ...otherSigners]);
  return { id: treeId, origin, version, kind: "thread", content_md: treeMarkdown(body, signatures) };
}

async function signedPost(origin, version, signer) {
  const content_md = version === 1 ? original : updated;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(content_md)));
  const content_hash = "sha256:" + Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return {
    id: postId, kind: "thread", origin, version, content_md, content_hash,
    author: { sig: await signByline(signer, content_hash) },
  };
}

function catalog(origin, tree, treePin, current, postPin, did, moved) {
  const manifest = { blyg: "0.4", blyggdrasil: new URL(`t/${treeId}/`, origin).href };
  if (moved) manifest.moved_from = [oldOrigin];
  const manifestUrl = new URL("blyg.json", origin).href;
  const documents = new Map([
    [manifestUrl, { ok: true, json: manifest }],
    [itemUrl(origin, manifest, treeId), { ok: true, json: tree }],
    [itemUrl(origin, manifest, postId), { ok: true, json: current }],
    [pinUrl(origin, manifest, postId, 1), { ok: true, json: { ...postPin, pinned: true } }],
    [new URL("items/index.json", origin).href, { ok: true, json: { items: [current, tree].map(({ id, version, kind }) => ({ id, version, kind })) } }],
    [account, { ok: true, text: `<p>${proofLine({ key: did, trunk: oldOrigin })}</p>` }],
  ]);
  if (treePin) documents.set(pinUrl(origin, manifest, treeId, 1), { ok: true, json: { ...treePin, pinned: true } });
  if (moved) {
    // A local response map models the final response after following a permanent move.
    documents.set(new URL("blyg.json", oldOrigin).href, { ok: true, json: manifest, url: manifestUrl });
  }
  const get = async (url, { as = "json" } = {}) => {
    const entry = documents.get(url);
    if (!entry?.[as]) return { ok: false, status: 404, url };
    return { status: 200, url, ...entry };
  };
  return { get, manifest, current };
}

async function checkScenario(name, scenario, expectedKey, firstPost, moved) {
  const { get, manifest, current } = scenario;
  const origin = current.origin;
  const tree = await loadTree(origin, get);
  const signedClaim = tree.tree?.claims?.movedFrom?.includes(oldOrigin) || false;
  const pinnedUrl = pinUrl(origin, manifest, postId, 1);
  const [active, pinned, branch, succession, items, pinnedData] = await Promise.all([
    verifyPost(itemUrl(origin, manifest, postId), get, { expectedKey }),
    verifyPost(pinnedUrl, get, { expectedKey: firstPost.author.sig.key }),
    tree.tree?.valid
      ? checkBranch(account, { keys: tree.tree.keys, trunk: origin, get })
      : { verdict: "unreachable" },
    moved ? resolveBlyg(oldOrigin, get) : null,
    get(new URL("items/index.json", origin).href),
    get(pinnedUrl),
  ]);
  const copy = pinnedData.json;
  return {
    name, origin, active, pinned, branch, catalogVersion: items.json?.items.find((item) => item.id === postId)?.version,
    samePinnedCopy: pinned.status === "verified" && copy?.content_md === firstPost.content_md
      && copy.content_hash === firstPost.content_hash && copy.author.sig.value === firstPost.author.sig.value,
    history: tree.tree?.history || [],
    treeError: tree.tree?.valid ? null : tree.error || tree.tree?.reason || "No valid tree.",
    signedMove: !!tree.tree?.valid && signedClaim,
    redirected: succession?.origin === newOrigin,
  };
}

// All addresses are reserved examples, and every response is served from memory.
export async function rehearseContinuity() {
  const keys = await Promise.all(["owner", "rotation", "emergency", "offline", "unrelated"]
    .map(async (label) => importKeyFile(await generateKey(label))));
  const [owner, rotation, emergency, offline, unrelated] = keys;
  const initialClaims = { recovery: [offline.did] };
  const movedClaims = { ...initialClaims, movedFrom: [oldOrigin] };
  const oldTree = await signedTree(oldOrigin, 1, owner, [], initialClaims);
  const movedTree = await signedTree(newOrigin, 1, owner, [], movedClaims);
  const rotatedTree = await signedTree(newOrigin, 2, rotation, [owner], { ...movedClaims, previous: owner.did });
  const recoveredTree = await signedTree(newOrigin, 3, emergency, [offline], {
    ...movedClaims, previous: owner.did, recoveredFrom: 1,
  });
  const [firstPost, rotatedPost, recoveredPost] = await Promise.all([
    signedPost(oldOrigin, 1, owner), signedPost(newOrigin, 2, rotation), signedPost(newOrigin, 2, emergency),
  ]);
  // The original signature is copied byte for byte to the new origin.
  const movedPost = { ...firstPost, origin: newOrigin };
  const badPost = { ...recoveredPost, author: { sig: await signByline(unrelated, recoveredPost.content_hash) } };
  const start = catalog(oldOrigin, oldTree, oldTree, firstPost, firstPost, owner.did, false);
  const scenarios = [
    [start, owner.did],
    [catalog(newOrigin, movedTree, movedTree, movedPost, movedPost, owner.did, true), owner.did],
    [catalog(newOrigin, rotatedTree, movedTree, rotatedPost, movedPost, owner.did, true), rotation.did],
    [catalog(newOrigin, recoveredTree, movedTree, recoveredPost, movedPost, owner.did, true), emergency.did],
    [catalog(newOrigin, recoveredTree, null, recoveredPost, movedPost, owner.did, true), emergency.did],
    [catalog(newOrigin, recoveredTree, movedTree, badPost, movedPost, owner.did, true), emergency.did],
  ];
  return Promise.all(scenarios.map(([fixture, expected], index) =>
    checkScenario(continuitySteps[index].id, fixture, expected, firstPost, index > 0)));
}
