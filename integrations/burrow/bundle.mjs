import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

if (process.argv.length !== 3) {
  console.error("Usage: node integrations/burrow/bundle.mjs <new-extension-directory>");
  process.exit(2);
}

const target = resolve(process.argv[2]);
const integration = join(target, "integrations", "burrow");
const lib = join(target, "lib");
try {
  await mkdir(target);
  await mkdir(integration, { recursive: true });
  await mkdir(lib);

  for (const file of ["main.mjs", "edition.mjs", "inspect.mjs", "public-json.mjs"]) {
    await copyFile(new URL(file, import.meta.url), join(integration, file));
  }
  for (const file of ["blyggdrasil.js", "post-proof.js", "proof-link.js"]) {
    await copyFile(new URL("../../lib/" + file, import.meta.url), join(lib, file));
  }
  await copyFile(new URL("README.md", import.meta.url), join(target, "README.md"));
  await copyFile(new URL("../../LICENSE", import.meta.url), join(target, "LICENSE"));
  await writeFile(join(target, "package.json"), '{ "type": "module" }\n');

  const manifest = await readFile(new URL("extension.toml", import.meta.url), "utf8");
  const command = "command = " + JSON.stringify([process.execPath, "integrations/burrow/main.mjs"]);
  await writeFile(join(target, "extension.toml"), manifest.replace(/^command = .+$/m, () => command));
  console.log("Extension package: " + target);
} catch (error) {
  console.error("Could not build the extension package: " + error.message);
  process.exitCode = 1;
}
