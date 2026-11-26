import { createHash } from "node:crypto";
import { linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { signByline } from "../blyggdrasil.js";
import { isArchiveTimestamp } from "./plan.js";

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function render(post) {
  const url = post.syndication[0].url;
  const network = new URL(url).hostname === "x.com" ? "X" : "Bluesky";
  const provenance = `[Original post on ${network}](${url})`;
  if (!post.content_md.endsWith(provenance)) throw new Error("The public archive item is missing its source attribution.");
  const body = post.content_md.slice(0, -provenance.length).trimEnd();
  const paragraphs = body ? body.split(/\n{2,}/).map((part) => `<p>${escapeHtml(part).replace(/\n/g, "<br>")}</p>`) : [];
  return paragraphs.concat(`<p><a href="${escapeHtml(url)}">Original post on ${network}</a></p>`).join("\n");
}

async function signedItem(post, origin, key, publishedAt) {
  const { itemUrl, ...fields } = post;
  const content_hash = "sha256:" + createHash("sha256").update(post.content_md, "utf8").digest("hex");
  return {
    blyg: "0.4",
    ...fields,
    origin, updated: publishedAt, content_hash, content_html: render(post), media: [],
    author: { url: origin, sig: await signByline(key, content_hash) },
    changelog: [{ version: 1, at: publishedAt, note: null }],
    ...(post.kind === "thread" ? { transclusions: [] } : {}),
  };
}

function info(path) {
  return lstatSync(path, { throwIfNoEntry: false });
}

function ensureDirectory(path) {
  const stat = info(path);
  if (stat && !stat.isDirectory()) throw new Error("The output and its items directory must be regular directories.");
  return Boolean(stat);
}

function locateOutput(path, archive) {
  const absolute = resolve(path);
  const out = ensureDirectory(absolute) ? realpathSync(absolute) : join(realpathSync(dirname(absolute)), basename(absolute));
  const location = relative(realpathSync(archive), out);
  if (!location || (!isAbsolute(location) && location !== ".." && !location.startsWith(".." + sep))) {
    throw new Error("Choose an output directory separate from the input archive.");
  }
  ensureDirectory(join(out, "items"));
  return out;
}

function withPublicationDate(item, date) {
  return { ...item, updated: date, changelog: [{ version: 1, at: date, note: null }] };
}

// Only the original publication time may differ on a retry. Keep the first
// written time instead of generating a new edition of already exported data.
function targetExists(path, expected) {
  const stat = info(path);
  if (!stat) return false;
  const conflict = `Item ${expected.id} already exists with different data. Nothing will overwrite it.`;
  if (!stat.isFile()) throw new Error(conflict);
  let saved;
  try {
    saved = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(conflict);
  }
  if (!isArchiveTimestamp(saved?.updated) || saved.updated < expected.created
      || !isDeepStrictEqual(saved, withPublicationDate(expected, saved.updated))) {
    throw new Error(conflict);
  }
  return true;
}

export async function emitArchiveRepublish(plan, { archive, outDir, publishedAt, key }) {
  if (!isArchiveTimestamp(publishedAt) || plan.items.some((item) => publishedAt < item.created)) {
    throw new Error("Use a UTC publication timestamp at or after every post's original date.");
  }
  const output = locateOutput(outDir, archive);
  const itemsDir = join(output, "items");
  const items = [];
  for (const post of plan.items) {
    if (!/^[0-7][0-9abcdefghjkmnpqrstvwxyz]{25}$/.test(post.id)) throw new Error("The archive plan contains an invalid item ID.");
    items.push(await signedItem(post, plan.origin, key, publishedAt));
  }
  const paths = items.map((item) => {
    const target = join(itemsDir, item.id + ".json");
    return { item, target, existing: targetExists(target, item) };
  });
  const pending = paths.filter(({ existing }) => !existing);
  const report = { origin: plan.origin, written: 0, existing: paths.length - pending.length };
  if (!pending.length) return report;

  mkdirSync(itemsDir, { recursive: true });
  ensureDirectory(output);
  ensureDirectory(itemsDir);
  const temp = mkdtempSync(join(output, ".republish-"));
  try {
    for (const { item, target } of pending) {
      const ready = join(temp, basename(target));
      writeFileSync(ready, JSON.stringify(item, null, 2) + "\n", { flag: "wx" });
      try {
        // Linking a complete file is atomic and refuses an occupied name.
        linkSync(ready, target);
        report.written++;
      } catch (error) {
        if (error.code !== "EEXIST" || !targetExists(target, item)) throw error;
        report.existing++;
      }
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
  return report;
}
