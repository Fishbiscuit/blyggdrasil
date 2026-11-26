import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";

const namespace = "blyggdrasil";
const pageDirectories = ["new", "verify", "tree", "quote", "audit", "demo"];
const runtimeDirectories = [...pageDirectories, "assets", "vendor", "media"];
const browserLibraries = [
  "archive-audit", "blyggdrasil", "continuity", "edit-and-pin", "post-proof", "proof-examples",
  "proof-link", "published-tree", "quote-match", "quote-proof", "quoted-edition", "resolvers", "tree-page",
];
const runtimeFiles = [
  "index.html",
  ...browserLibraries.map((name) => `lib/${name}.js`),
  "schemas/post-proof.v1.json",
  "schemas/examples/post-proof.verified.json",
  "schemas/examples/post-proof.failed.json",
];
const webExtensions = new Set([".html", ".css", ".js", ".json", ".xml", ".svg", ".jpg", ".png", ".webp", ".mp4"]);
const textExtensions = new Set([".html", ".css", ".js", ".json", ".xml", ".svg", ".txt"]);
const sensitiveSegment = /^(?:\.env(?:\..*)?|\.git|\.ssh|\.npmrc|\.netrc|private|secrets?|credentials?|keys?|id_rsa|id_ed25519)$/i;
const sensitiveSuffix = /\.(?:key(?:\.json)?|pem|p12|pfx)$/i;
const pinPath = /(?:^|\/)items\/[0-7][0-9abcdefghjkmnpqrstvwxyz]{25}\/v[1-9][0-9]*\.json$/;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function isWithin(root, path) {
  const relation = relative(root, path);
  return relation === "" || (relation !== ".." && !relation.startsWith(`..${sep}`) && !isAbsolute(relation));
}

async function statOrNull(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return null;
  }
}

function checkName(path) {
  if (path.includes("\\") || path.split("/").some((part) => sensitiveSegment.test(part)) || sensitiveSuffix.test(path)) {
    throw new Error(`Refusing a private path in public input: ${path}`);
  }
}

async function* walk(root, path = "") {
  const absolute = join(root, path);
  const stat = await statOrNull(absolute);
  if (!stat) return;
  if (path) checkName(path);
  if (stat.isSymbolicLink()) throw new Error(`Refusing a symbolic link in public input: ${path}`);
  if (stat.isFile()) {
    yield path;
    return;
  }
  if (!stat.isDirectory()) throw new Error(`Refusing a non-file entry in public input: ${path}`);
  for (const name of (await readdir(absolute)).sort()) {
    yield* walk(root, path ? `${path}/${name}` : name);
  }
}

function isWebFile(path) {
  return webExtensions.has(extname(path)) || path === "vendor/three.LICENSE.txt";
}

async function inspect(root, path) {
  const absolute = join(root, path);
  const bytes = await readFile(absolute);
  let pin = pinPath.test(path);
  if (textExtensions.has(extname(path))) {
    const text = bytes.toString("utf8");
    if (/-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/.test(text)) {
      throw new Error(`Refusing private key material in public input: ${path}`);
    }
    if (extname(path) === ".json") {
      let document;
      try { document = JSON.parse(text); } catch { /* Non-item JSON is carried as bytes. */ }
      if (document?.blyggdrasil_key === 1 || document?.jwk?.d || (document?.kty && document?.d)) {
        throw new Error(`Refusing a private signing key in public input: ${path}`);
      }
      pin ||= document?.pinned === true && typeof document?.id === "string" &&
        typeof document?.origin === "string" && Number.isSafeInteger(document?.version) &&
        typeof document?.content_hash === "string";
    }
  }
  return { absolute, digest: sha256(bytes), pin };
}

async function publicInventory(root) {
  const files = new Map();
  for await (const path of walk(root)) files.set(path, await inspect(root, path));
  return files;
}

async function webInventory(root) {
  const files = new Map();
  for (const directory of runtimeDirectories) {
    for await (const path of walk(root, directory)) {
      if (isWebFile(path)) files.set(`${namespace}/${path}`, await inspect(root, path));
    }
  }
  for (const path of runtimeFiles) {
    // An allowed leaf cannot cross a parent symlink.
    let parentPath = root;
    for (const segment of path.split("/").slice(0, -1)) {
      parentPath = join(parentPath, segment);
      const parent = await statOrNull(parentPath);
      if (parent && !parent.isDirectory()) {
        throw new Error(`Refusing a non-directory parent in public input: ${segment}`);
      }
    }
    const stat = await statOrNull(join(root, path));
    if (!stat) continue;
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`Expected a regular web file: ${path}`);
    }
    files.set(`${namespace}/${path}`, await inspect(root, path));
  }
  if (!files.has(`${namespace}/index.html`)) throw new Error("Web source is missing index.html.");
  return files;
}

export async function buildReleaseOverlay({ baseline, source, output }) {
  const baselineRoot = await realpath(baseline);
  const sourceRoot = await realpath(source);
  if (!(await lstat(baselineRoot)).isDirectory() || !(await lstat(sourceRoot)).isDirectory()) {
    throw new Error("Baseline and web source must be directories.");
  }
  const outputParent = await realpath(dirname(resolve(output)));
  const outputRoot = join(outputParent, basename(resolve(output)));
  if (isWithin(baselineRoot, outputRoot) || isWithin(outputRoot, baselineRoot) ||
      isWithin(sourceRoot, outputRoot) || isWithin(outputRoot, sourceRoot)) {
    throw new Error("Choose an output directory separate from the baseline and source roots.");
  }
  if (await statOrNull(outputRoot)) throw new Error("Output already exists. Choose a new directory.");

  const original = await publicInventory(baselineRoot);
  if (!original.size) throw new Error("The public baseline is empty.");
  const web = await webInventory(sourceRoot);
  const intended = new Map(original);
  const added = [];
  const changed = [];
  for (const [path, incoming] of web) {
    const existing = original.get(path);
    if (existing?.digest === incoming.digest) continue;
    if (existing?.pin) throw new Error(`A release cannot change the bytes of an existing pin: ${path}`);
    (existing ? changed : added).push({ path, sha256: incoming.digest });
    intended.set(path, incoming);
  }

  const scratch = await mkdtemp(join(outputParent, ".blyggdrasil-overlay-"));
  let completed = false;
  try {
    for (const [path, { absolute }] of intended) {
      const destination = join(scratch, path);
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(absolute, destination);
    }
    const outputFiles = await publicInventory(scratch);
    if (outputFiles.size !== intended.size) throw new Error("Release file count differs from the verified inventory.");
    for (const [path, expected] of intended) {
      if (outputFiles.get(path)?.digest !== expected.digest) {
        throw new Error(`Release file differs from the verified inventory: ${path}`);
      }
    }
    if (await statOrNull(outputRoot)) throw new Error("Output was created while packaging. Choose a new directory.");
    await rename(scratch, outputRoot);
    completed = true;
  } finally {
    if (!completed) await rm(scratch, { recursive: true, force: true });
  }

  const byPath = (a, b) => a.path.localeCompare(b.path, "en");
  return {
    mount: `/${namespace}/`,
    baselineFiles: original.size,
    outputFiles: intended.size,
    unchangedFiles: original.size - changed.length,
    added: added.sort(byPath),
    changed: changed.sort(byPath),
    retainedPins: [...original].filter(([, file]) => file.pin)
      .map(([path, file]) => ({ path, sha256: file.digest })).sort(byPath),
  };
}
