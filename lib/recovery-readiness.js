import {
  isDidKey, isHttpsUrl, itemIdIn, itemUrl, pinUrl, resolveBlyg, treePointer, validateTree,
} from "./blyggdrasil.js";

const isVersion = (value) => Number.isSafeInteger(value) && value > 0;
const isTreeDocument = (doc, origin, id) => doc?.id === id && doc.origin === origin
  && isVersion(doc.version) && (doc.kind === "thread" || doc.kind === "fragment")
  && typeof doc.content_md === "string";

function publisherAddress(input) {
  if (typeof input !== "string" || !input.trim()) return null;
  const address = input.trim();
  const url = /^[a-z][a-z0-9+.-]*:/i.test(address) ? address : `https://${address}`;
  return isHttpsUrl(url) ? url : null;
}

async function getPublicDocument(url, get, { manifest = false } = {}) {
  if (!isHttpsUrl(url)) return { ok: false, status: 0 };
  try {
    const response = await get(url);
    const finalUrl = response.url || url;
    if (!isHttpsUrl(finalUrl)) return { ok: false, status: 0 };
    const final = new URL(finalUrl);
    if (manifest) {
      if (!final.pathname.endsWith("/blyg.json") || final.search || final.hash) return { ok: false, status: 0 };
    } else if (final.origin !== new URL(url).origin) {
      return { ok: false, status: 0 };
    }
    return response;
  } catch {
    return { ok: false, status: 0 };
  }
}

export async function checkRecoveryReadiness(input, get, { version, recoveryKey } = {}) {
  const target = publisherAddress(input);
  if (!target) throw new TypeError("Use a public blyg address.");
  if (!isVersion(version)) throw new TypeError("Choose a positive tree version to check.");
  if (recoveryKey !== undefined && !isDidKey(recoveryKey)) throw new TypeError("Use an Ed25519 did:key for the recovery key.");

  const report = { origin: null, treeId: null, treeUrl: null, currentVersion: null, currentKey: null,
    pinVersion: version, pinUrl: null, recoveryKeys: [] };
  const finish = (status, detail) => ({ ...report, status, detail });
  const { origin, manifest } = await resolveBlyg(target, (url) => getPublicDocument(url, get, { manifest: true }));
  if (!origin) return finish("unavailable", "The publisher’s manifest could not be read.");
  report.origin = origin;
  const pointer = treePointer(manifest);
  const id = typeof pointer === "string" && itemIdIn(pointer, origin);
  if (!id) return finish("invalid-tree", "The manifest has no identifiable tree post.");
  report.treeId = id;

  try {
    report.treeUrl = itemUrl(origin, manifest, id);
    report.pinUrl = pinUrl(origin, manifest, id, version);
  } catch {
    return finish("invalid-tree", "The publisher’s item or pin template is invalid.");
  }

  const current = await getPublicDocument(report.treeUrl, get);
  if (!current.ok) return finish("unavailable", "The canonical tree post could not be read.");
  if (!isTreeDocument(current.json, origin, id)) return finish("invalid-tree", "The current tree document has the wrong identity, version, or kind.");
  const treeDoc = current.json;
  report.currentVersion = treeDoc.version;

  const pins = new Map();
  const getPin = (number) => {
    if (!pins.has(number)) {
      pins.set(number, (async () => {
        try {
          return await getPublicDocument(pinUrl(origin, manifest, id, number), get);
        } catch {
          return { ok: false, status: 0 };
        }
      })());
    }
    return pins.get(number);
  };
  const isExactPin = (doc, number) => isTreeDocument(doc, origin, id)
    && doc.version === number && doc.pinned === true;

  let dependencyUnavailable = false;
  const active = await validateTree(treeDoc.content_md, origin, { fetchPinned: async (number) => {
    if (!isVersion(number) || number >= treeDoc.version) return null;
    const pin = await getPin(number);
    if (!pin.ok) dependencyUnavailable = true;
    return pin.ok && isExactPin(pin.json, number) ? pin.json.content_md : null;
  } });
  if (dependencyUnavailable) return finish("unavailable", "The current tree’s recovery record could not be read.");
  if (!active.valid) return finish("invalid-tree", "The canonical tree’s claims or signatures did not verify.");
  report.currentKey = active.claims.key;

  const selected = await getPin(version);
  if (!selected.ok) {
    if (selected.status === 404 || selected.status === 410) return finish("unpinned", "This tree version is not served at its canonical pin URL.");
    return finish("unavailable", "The requested pin could not be read.");
  }
  if (!isExactPin(selected.json, version) || version > treeDoc.version
      || (version === treeDoc.version && selected.json.content_md !== treeDoc.content_md)) {
    return finish("invalid-pin", "The pin does not match the claimed public tree version.");
  }

  // A recovery record is verified on its own under the rules of §7.2.
  const pinned = await validateTree(selected.json.content_md, origin);
  if (!pinned.valid) return finish("invalid-pin", "The pinned tree cannot serve as an independently valid recovery record.");
  if (pinned.claims.key !== active.claims.key) return finish("stale-pin", "The pin names a different main key from the current tree.");

  report.recoveryKeys = pinned.claims.recovery.filter((key) => active.claims.recovery.includes(key)
    && (!recoveryKey || key === recoveryKey));
  if (!report.recoveryKeys.length) {
    return finish("missing-recovery-key", recoveryKey
      ? "The selected recovery key is not listed by both the current tree and this pin."
      : "The current tree and this pin share no configured recovery key.");
  }
  return finish("ready", "The public pin names the current main key and an active recovery key.");
}
