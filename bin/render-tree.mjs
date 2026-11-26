#!/usr/bin/env node
// Render a public tree for readers that do not run JavaScript.
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { allowLocalDevelopment, isHttpsUrl, itemUrl, loadTree } from "../lib/blyggdrasil.js";
import { makeFetcher } from "../lib/resolvers.js";
import {
  archiveEntries, archiveUrl, escape, readAccounts, readPost, renderAccount,
  renderDiscoveryLinks, renderPost, renderSources, safeUrl, signedByTree,
} from "../lib/tree-page.js";

const help = "node bin/render-tree.mjs <blyg URL> --out <index.html> [--mirror <public blyg folder>] [--site-root ../../]";
const { values, positionals } = parseArgs({
  options: {
    out: { type: "string" },
    mirror: { type: "string" },
    "site-root": { type: "string", default: "../../" },
    help: { type: "boolean" },
  },
  allowPositionals: true,
});

if (values.help) {
  console.log(help);
} else {
  try {
    if (positionals.length !== 1 || !values.out) throw new Error(help);
    if (process.env.BLYGGDRASIL_DEV === "1") allowLocalDevelopment();
    const siteRoot = values["site-root"];
    if (!/^(?:\.\.\/)+$/.test(siteRoot)) throw new Error("--site-root must be a relative path such as ../../");
    const input = positionals[0];
    const origin = new URL(input);
    if (!isHttpsUrl(origin.href) || origin.search || origin.hash) throw new Error("Supply a public blyg origin URL");
    if (!origin.pathname.endsWith("/")) origin.pathname += "/";
    const get = values.mirror
      ? await mirrorFetcher(origin, values.mirror)
      : makeFetcher((url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(12_000) }));
    const tree = await loadTree(origin.href, get);
    if (tree.error) throw new Error(tree.error);
    const archive = archiveUrl(tree);
    const index = archive && await get(archive);
    if (!index?.ok || !Array.isArray(index.json?.items)) throw new Error("The public archive could not be read");
    const keys = tree.tree?.valid ? tree.tree.keys : [];
    const posts = [];
    for (const entry of archiveEntries(index.json.items, tree)) {
      const address = safeUrl(itemUrl(tree.origin, tree.manifest, entry.id));
      const item = address && await get(address);
      const doc = item?.json;
      if (!item?.ok || doc?.id !== entry.id || doc.origin !== tree.origin) {
        throw new Error(`The public archive item ${entry.id} could not be read`);
      }
      if (doc.kind === "withdrawn" || (doc.visibility && doc.visibility !== "public")) continue;
      const post = readPost(doc, tree.origin, address);
      post.signed = await signedByTree(doc, keys);
      posts.push(renderPost(post, siteRoot));
    }
    const accounts = readAccounts(tree).map((branch) => renderAccount(branch, "Claimed"));
    const template = await readFile(new URL("../tree/index.html", import.meta.url), "utf8");
    const html = publicPage(template, { tree, siteRoot, posts, accounts });
    const out = resolve(values.out);
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, html);
    console.log(`Rendered ${posts.length} posts and ${accounts.length} accounts to ${out}`);
  } catch (error) {
    console.error(`render-tree: ${error.message}`);
    process.exitCode = 1;
  }
}

function publicPage(template, { tree, siteRoot, posts, accounts }) {
  const displayOrigin = new URL(tree.origin).host + new URL(tree.origin).pathname.replace(/\/$/, "");
  const title = escape(tree.manifest.title || displayOrigin);
  const changes = [
    ["<title>Blyggdrasil</title>", `<title>${title} · Blyggdrasil</title>\n  ${renderDiscoveryLinks(tree)}`],
    ['<body data-tree-address="" data-site-root="../">', `<body data-tree-address="${escape(tree.origin)}" data-site-root="${siteRoot}">`],
    ['<h1 id="title">Blyg</h1>', `<h1 id="title">${title}</h1>`],
    ['<a id="origin" hidden></a>', `<a id="origin" href="${escape(tree.origin)}">${escape(displayOrigin)}</a>`],
    ['<p id="loading" role="status">Reading posts and accounts…</p>', '<p id="loading" role="status" hidden></p>'],
    ['id="profile" hidden', 'id="profile"'],
    ['<ul id="accounts" class="accounts"></ul>', `<ul id="accounts" class="accounts">\n${accounts.join("\n")}\n</ul>`],
    ['<ol class="posts" id="posts"></ol>', `<ol class="posts" id="posts">\n${posts.join("\n")}\n</ol>`],
    ['aria-label="Blygger data sources" hidden></footer>', `aria-label="Blygger data sources">${renderSources(tree)}</footer>`],
    ["    <noscript>Enable JavaScript to read this tree.</noscript>\n", ""],
    ['href="../assets/mark.svg"', `href="${siteRoot}assets/mark.svg"`],
    ['href="../assets/tree.css"', `href="${siteRoot}assets/tree.css"`],
    ['href="../">Blyggdrasil', `href="${siteRoot}">Blyggdrasil`],
    ['src="../assets/tree.js"', `src="${siteRoot}assets/tree.js"`],
  ];
  return changes.reduce((html, [anchor, replacement]) => {
    if (!html.includes(anchor)) throw new Error(`Tree template changed near ${anchor}`);
    return html.replace(anchor, () => replacement);
  }, template);
}

async function mirrorFetcher(origin, folder) {
  const root = await realpath(folder);
  return async function get(address) {
    const url = new URL(address);
    if (url.origin !== origin.origin || !url.pathname.startsWith(origin.pathname)) return { ok: false, status: 404 };
    try {
      const file = await realpath(resolve(root, decodeURIComponent(url.pathname.slice(origin.pathname.length))));
      const child = relative(root, file);
      if (!child || child === ".." || child.startsWith(".." + sep) || isAbsolute(child)) return { ok: false, status: 404 };
      return { ok: true, status: 200, json: JSON.parse(await readFile(file, "utf8")), url: url.href };
    } catch {
      return { ok: false, status: 404 };
    }
  };
}
