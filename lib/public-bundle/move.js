import { itemUrl, pinUrl, serializeClaims } from "../blyggdrasil.js";
import { blygOrigin, publicAddress } from "./surface.js";
import { openPublicBundle, verifyOpenedPublicBundle } from "./verify.js";

function localPage(value, origin) {
  try {
    return publicAddress(value, origin);
  } catch {
    return null;
  }
}

function pageAt(doc, origin) {
  const fragment = doc.kind === "fragment" ||
    (doc.kind === "withdrawn" && /(?:^|\/)f\/[^/]+\/?$/.test(doc.page ?? ""));
  return new URL(`${fragment ? "f" : "t"}/${doc.id}/`, origin).href;
}

export async function planBlygMove(bundle, destination, options) {
  const nextOrigin = blygOrigin(destination);
  const opened = await openPublicBundle(bundle);
  const { origin, surface, resources } = opened;
  if (nextOrigin === origin) throw new Error("Choose a destination different from the old blyg origin.");

  const checked = await verifyOpenedPublicBundle(opened, options);
  if (checked.status === "failed") throw new Error("The source bundle failed verification.");
  const claims = checked.tree.claims;
  const movedFrom = [...new Set([...claims.movedFrom, origin])];
  if (movedFrom.includes(nextOrigin)) {
    throw new Error("The destination is already named as a former origin in the signed tree.");
  }
  if (!Number.isSafeInteger(surface.tree.doc.version + 1)) throw new Error("The tree cannot advance to another version.");

  const treePage = pageAt(surface.tree.doc, nextOrigin);
  const destinationManifest = new URL("blyg.json", nextOrigin).href;
  const destinationIndex = new URL("items/index.json", nextOrigin).href;
  const destinationFeed = new URL("feed.xml", nextOrigin).href;
  const kept = new Map();
  const redirects = new Map();
  const documents = [];
  const blockers = [];
  if (checked.status === "incomplete") blockers.push("Review the unsigned or unavailable post proofs before switching origins.");
  if (claims.recoveredFrom) {
    blockers.push("The current tree relies on recovery at the old origin. Establish a valid signed key history at the destination before switching.");
  }

  function keep(url, version, pinned) {
    kept.set(url, { url, version, pinned, sha256: resources.get(url).sha256 });
  }
  function redirect(from, to) {
    if (!from || from === to || kept.has(from)) return;
    const existing = redirects.get(from);
    if (existing && existing.to !== to) {
      blockers.push(`The old address ${from} has more than one proposed redirect.`);
      return;
    }
    redirects.set(from, { status: 308, from, to });
  }
  for (const item of surface.items) {
    keep(item.url, item.doc.version, false);
    for (const pin of item.pins) keep(pin.url, pin.doc.version, true);
  }
  redirect(surface.manifestUrl, destinationManifest);
  redirect(surface.indexUrl, destinationIndex);
  redirect(localPage(surface.manifest.feed ?? "feed.xml", origin), destinationFeed);
  redirect(origin, nextOrigin);

  for (const item of surface.items) {
    const { doc, url } = item;
    const page = pageAt(doc, nextOrigin);
    const tree = item === surface.tree;
    documents.push({
      from: url, to: itemUrl(nextOrigin, {}, doc.id), id: doc.id, origin: nextOrigin, page,
      version: tree ? doc.version + 1 : doc.version,
      action: tree ? "publish-resigned-tree" : "reissue-with-original-byline",
    });
    redirect(localPage(doc.page, origin), page);
    for (const pin of item.pins) {
      documents.push({
        from: pin.url, to: pinUrl(nextOrigin, {}, doc.id, pin.doc.version),
        id: doc.id, version: pin.doc.version, origin: nextOrigin,
        action: "reissue-pin-with-original-content-and-byline",
      });
    }
  }
  if ([destinationManifest, destinationIndex, destinationFeed, ...documents.map(doc => doc.to)]
    .some(url => kept.has(url))) {
    blockers.push("A destination item path overlaps an old document that must be retained byte for byte.");
  }
  if (!redirects.has(surface.manifestUrl)) throw new Error("The old manifest redirect conflicts with a retained document.");

  return {
    status: blockers.length ? "review-required" : "planned",
    source: origin,
    destination: nextOrigin,
    sourceProof: checked.status,
    blockers,
    publish: {
      manifest: {
        url: destinationManifest,
        fields: {
          site: nextOrigin, blyggdrasil: treePage, moved_from: movedFrom,
          items: "items/index.json", feed: "feed.xml", item: "items/{id}.json", pin: "items/{id}/v{n}.json",
        },
      },
      rebuild: { archive: destinationIndex, feed: destinationFeed, pages: "Regenerate from the destination items." },
      documents,
      tree: {
        itemId: surface.tree.doc.id, page: treePage,
        unsignedClaims: serializeClaims({ ...claims, trunk: nextOrigin, movedFrom }),
        key: claims.key, previous: claims.previous, recoveredFrom: claims.recoveredFrom,
        signing: "Sign the tree claims and the new tree item with the required keys before publishing.",
      },
    },
    afterDestinationChecks: {
      redirects: [...redirects.values()],
      retain: [...kept.values()],
      media: "Keep old media URLs reachable, including every asset embedded in a pin. Check the destination media references separately.",
    },
  };
}
