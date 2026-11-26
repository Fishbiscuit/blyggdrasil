#!/usr/bin/env node
// Blyggdrasil command line. Deterministic: every outcome is defined by SPEC.md.
//
//   blyggdrasil keygen [--label main] [--out file]       make a key file (kept private, mode 600)
//   blyggdrasil tree --trunk URL --key file [--branch URL]... [--recovery file|did]...
//                    [--previous file] [--recovered-from N --sign file] [--moved-from URL]...
//                    [--intro text] [--out file]          write a signed tree post (Markdown)
//   blyggdrasil proof --trunk URL --key file             print the proof line for your accounts
//   blyggdrasil proof-link <URL> [--version N]           print the verified edition's share link
//   blyggdrasil verify <blyg or tree URL> [--json]       check a tree and every branch
//   blyggdrasil verify-post <URL> [--version N] [--expect-key DID] [--json]
//                                                      check the content, signature, and tree signer
//   blyggdrasil verify-quote <URL> --version N --quote TEXT [--expect-key DID] [--json]
//                                                      check an excerpt in a signed edition
//   blyggdrasil sign-byline --key file <content_hash>    print an author.sig member (SPEC §6)
//   blyggdrasil ingest bluesky <handle> --out dir         save public Bluesky posts as archive files (SPEC §8)
//   blyggdrasil ingest x <archive folder> --out dir       read an X archive download into archive files
//   blyggdrasil ingest <network> <source> --preview [--out dir] [--json]
//                                                      preview posts and duplicates without writing files

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  generateKey, importKeyFile, allowLocalDevelopment, isDidKey, serializeClaims, signClaims, treeMarkdown, proofLine,
  loadTree, claimedLinks, signByline,
} from "../lib/blyggdrasil.js";
import { checkBranch, makeFetcher } from "../lib/resolvers.js";
import { ingestBluesky, ingestXArchive, previewBluesky, previewXArchive } from "../lib/ingest.js";
import { verifyPost } from "../lib/post-proof.js";
import { verifyQuote } from "../lib/quote-proof.js";
import { proofLink } from "../lib/proof-link.js";

if (process.env.BLYGGDRASIL_DEV === "1") allowLocalDevelopment();
const fail = (m) => { console.error(`blyggdrasil: ${m}`); process.exit(2); };

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { out._.push(a); continue; }
    const k = a.slice(2);
    const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
    (out[k] ??= []).push(v);
  }
  return out;
}
const one = (o, k) => (o[k] ? o[k].at(-1) : undefined);
const readKey = async (p) => importKeyFile(JSON.parse(readFileSync(resolve(p), "utf8")));
const didOf = async (v) => (isDidKey(v) ? v : (await readKey(v)).did);

async function keygen(o) {
  const label = one(o, "label") || "main";
  const out = resolve(one(o, "out") || join(homedir(), ".blyggdrasil", `${label}.json`));
  if (existsSync(out)) fail(`${out} already exists; refusing to overwrite a key`);
  const key = await generateKey(label);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(key, null, 2) + "\n", { mode: 0o600 });
  chmodSync(out, 0o600);
  console.log(`${key.did}\nKey written to ${out}. Keep it private and back it up; anyone with this file can sign as you.`);
}

async function tree(o) {
  const trunk = one(o, "trunk");
  if (!trunk || !one(o, "key")) fail("tree needs --trunk and --key");
  const main = await readKey(one(o, "key"));
  const signers = [main];
  const claims = { trunk, key: main.did, branches: o.branch || [], recovery: [], movedFrom: o["moved-from"] || [] };
  for (const r of o.recovery || []) claims.recovery.push(await didOf(r));
  if (one(o, "previous")) {
    const prevArg = one(o, "previous");
    if (one(o, "recovered-from")) {
      claims.previous = await didOf(prevArg);
      claims.recoveredFrom = Number(one(o, "recovered-from"));
      if (!one(o, "sign")) fail("recovery needs --sign <recovery key file>");
      signers.push(await readKey(one(o, "sign")));
    } else {
      const prev = await readKey(prevArg);
      claims.previous = prev.did;
      signers.push(prev);
    }
  }
  const body = serializeClaims(claims);
  const intro = one(o, "intro") ?? `These accounts are mine, and this key signs for them. Each one carries the line \`${proofLine(claims)}\`. Check it at <https://fishbiscuit.me/blyggdrasil/#blyg=${trunk.replace(/^https:\/\//, "")}>.`;
  const md = treeMarkdown(body, await signClaims(body, signers), intro);
  const out = one(o, "out");
  if (out) { writeFileSync(resolve(out), md + "\n"); console.log(`Tree written to ${out}`); } else console.log(md);
}

async function proof(o) {
  if (!one(o, "trunk") || !one(o, "key")) fail("proof needs --trunk and --key");
  console.log(proofLine({ key: (await readKey(one(o, "key"))).did, trunk: one(o, "trunk") }));
}

async function verify(o) {
  const target = o._[1];
  if (!target) fail("verify needs a blyg or tree URL");
  const get = makeFetcher();
  const t = await loadTree(target, get);
  const report = { input: target, origin: t.origin || null, tree: null, branches: [] };
  if (t.error) { report.error = t.error; return finish(report, o, 1); }
  if (!t.tree) {
    report.tree = { present: false };
    for (const l of claimedLinks(t.manifest)) report.branches.push({ url: l.url, ...(await checkBranch(l.url, { keys: [], trunk: t.origin, get })) });
    return finish(report, o, 1);
  }
  report.tree = { present: true, valid: t.tree.valid, reason: t.tree.reason || null, key: t.tree.claims?.key || null, history: t.tree.history || [] };
  if (!t.tree.valid) return finish(report, o, 1);
  for (const b of t.tree.claims.branches) report.branches.push({ url: b, ...(await checkBranch(b, { keys: t.tree.keys, trunk: t.origin, get })) });
  return finish(report, o, 0);
}

function finish(r, o, code) {
  if (o.json) { console.log(JSON.stringify(r, null, 2)); process.exit(code); }
  if (r.error) { console.log(`${r.input}: ${r.error}`); process.exit(code); }
  console.log(`Trunk  ${r.origin}`);
  if (!r.tree.present) console.log("Tree   none. Showing the links this blyg claims, checked by link only.");
  else if (!r.tree.valid) console.log(`Tree   invalid: ${r.tree.reason}`);
  else {
    console.log(`Tree   valid, key ${r.tree.key}`);
    for (const h of r.tree.history) console.log(`       ${h.how} from ${h.key}${h.by ? ` (signed by recovery key ${h.by}, ${h.from})` : ""}`);
  }
  for (const b of r.branches) console.log(`  ${b.verdict.padEnd(11)} ${b.method ? `[${b.method}] ` : ""}${b.url}${b.detail ? `  — ${b.detail}` : ""}`);
  process.exit(code);
}

async function verifyPostCmd(o) {
  if (one(o, "help")) {
    console.log("Usage: blyggdrasil verify-post <URL> [--version N] [--expect-key DID] [--json]");
    console.log("Exit 0 for verified, 1 for failed, unsigned or unavailable, and 2 for invalid arguments.");
    return;
  }
  const [, target] = o._;
  if (!target || o._.length !== 2) fail("verify-post needs one Blygger post URL");
  const rawVersion = one(o, "version");
  const version = rawVersion === undefined ? undefined : Number(rawVersion);
  if (rawVersion !== undefined && (!/^[1-9]\d*$/.test(rawVersion) || !Number.isSafeInteger(version))) {
    fail("--version must be a positive whole number");
  }
  const expectedKey = one(o, "expect-key");
  if (expectedKey !== undefined && !isDidKey(expectedKey)) fail("--expect-key must be an Ed25519 did:key");
  const get = makeFetcher((url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(10_000) }));
  const report = await verifyPost(target, get, { version, expectedKey });
  if (o.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`${report.status.toUpperCase()} ${report.itemUrl || target}`);
    if (report.version) console.log(`Version    ${report.version}${report.pinned ? " (pinned)" : ""}`);
    console.log(`Content    ${report.checks.content}`);
    console.log(`Signature  ${report.checks.signature}${report.signingKey ? "  " + report.signingKey : ""}`);
    console.log(`Tree signer  ${report.checks.signer}`);
    if (report.expectedSigner) console.log(`Expected key  ${report.expectedSigner}  ${report.expectedKey}`);
    if (report.error) console.log(report.error);
  }
  process.exitCode = report.status === "verified" ? 0 : 1;
}

async function signBylineCmd(o) {
  const hash = o._[1];
  if (!one(o, "key") || !/^sha256:[0-9a-f]{64}$/.test(hash || "")) fail("sign-byline needs --key and a sha256:… content_hash");
  console.log(JSON.stringify(await signByline(await readKey(one(o, "key")), hash)));
}

async function verifyQuoteCmd(o) {
  if (one(o, "help")) {
    console.log("Usage: blyggdrasil verify-quote <URL> --version N --quote TEXT [--expect-key DID] [--json]");
    console.log("Exit 0 for a matched signed excerpt, 1 for a mismatch or unavailable proof, and 2 for invalid arguments.");
    return;
  }
  const [, target] = o._;
  const rawVersion = one(o, "version");
  const version = Number(rawVersion);
  const quote = one(o, "quote");
  const expectedKey = one(o, "expect-key");
  if (!target || o._.length !== 2) fail("verify-quote needs one public Blygger post URL");
  if (!/^[1-9]\d*$/.test(rawVersion) || !Number.isSafeInteger(version)) fail("--version must be a positive whole number");
  if (typeof quote !== "string" || !quote.trim()) fail("--quote needs the exact excerpt");
  if (expectedKey !== undefined && !isDidKey(expectedKey)) fail("--expect-key must be an Ed25519 did:key");
  const get = makeFetcher((url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(10_000) }));
  const result = await verifyQuote(target, get, { version, quote, expectedKey });
  if (o.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Quote ${result.match.status} in version ${version}`);
    console.log(`Current edition comparison: ${result.comparison}`);
    if (result.edition?.itemUrl) console.log(result.edition.itemUrl);
    if (result.error) console.log(result.error);
  }
  process.exitCode = result.match.status === "matched" ? 0 : 1;
}

async function proofLinkCmd(o) {
  if (one(o, "help")) {
    console.log("Usage: blyggdrasil proof-link <URL> [--version N]");
    return;
  }
  const [, target] = o._;
  const raw = one(o, "version");
  const version = raw === undefined ? undefined : Number(raw);
  if (!target || o._.length !== 2) fail("proof-link needs one public Blygger post URL");
  if (raw !== undefined && (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(version))) fail("--version must be a positive whole number");
  const get = makeFetcher((url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(10_000) }));
  const report = await verifyPost(target, get, { version });
  if (report.status !== "verified") {
    console.error(report.error || `Edition proof is ${report.status}.`);
    process.exitCode = 1;
    return;
  }
  console.log(proofLink({ origin: report.origin, id: report.itemId, version: report.version }).href);
}

async function ingest(o) {
  if (o.help) {
    console.log("Usage: blyggdrasil ingest bluesky <handle> --out dir");
    console.log("       blyggdrasil ingest x <archive folder> --out dir");
    console.log("       blyggdrasil ingest <network> <source> --preview [--out dir] [--json]");
    console.log("Preview lists public post URLs, dates and types. Private entries appear only in the total.");
    console.log("Add --out to check for posts already in that archive. Preview writes no files.");
    return;
  }
  const [, network, source] = o._;
  const out = one(o, "out");
  if (!network || !source) fail("ingest needs a network and a source. See ingest --help.");
  if (network !== "bluesky" && network !== "x") fail("ingest supports bluesky and x");
  if (out === true) fail("--out needs a directory");
  if (o.preview) {
    if (one(o, "preview") !== true || o._.length !== 3) fail("See ingest --help for preview options");
    let report;
    try {
      const target = out ? resolve(out) : undefined;
      report = network === "bluesky" ? await previewBluesky(source, target, makeFetcher()) : previewXArchive(resolve(source), target);
    } catch (error) {
      fail(error.message);
    }
    if (o.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    console.log(`Preview: ${report.public} public, ${report.private} private, ${report.duplicates} duplicate. No files written.`);
    for (const entry of report.entries) {
      const flags = [];
      if (entry.duplicateInInput) flags.push("repeated in source");
      if (entry.alreadyArchived) flags.push("already archived");
      console.log(`${entry.created}  ${entry.kind}  ${entry.url ?? "URL unavailable"}${flags.length ? `  (${flags.join(", ")})` : ""}`);
    }
    return;
  }
  if (!out) fail("ingest needs --out to write archive files. See ingest --help.");
  const n = network === "bluesky" ? await ingestBluesky(source, resolve(out), makeFetcher())
    : ingestXArchive(resolve(source), resolve(out));
  console.log(`Wrote ${n.public} public and ${n.private} private archive files to ${out}`);
}

const o = args(process.argv.slice(2));
const commands = { keygen, tree, proof, "proof-link": proofLinkCmd, verify, "verify-post": verifyPostCmd, "verify-quote": verifyQuoteCmd, "sign-byline": signBylineCmd, ingest };
const cmd = commands[o._[0]];
if (!cmd) {
  console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n\n")[0].split("\n").slice(1).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
  process.exit(o._[0] ? 2 : 0);
}
await cmd(o);
