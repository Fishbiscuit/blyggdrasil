import { verifyPost } from "./post-proof.js";
import { verifyQuote } from "./quote-proof.js";

const threadUrl = "https://fishbiscuit.me/blyggdrasil/demo/quoted-edition/blyg/items/01m8cmqz6ysjc8rdkmwjmz0yvk.json";
const sourceOrigin = "https://fishbiscuit.me/blyggdrasil/demo/edit-and-pin/blyg/";
const sourceId = "1hk3fv43xwpgckk19k4wf3v9ts";
const version = 1;
const pinUrl = new URL(`items/${sourceId}/v${version}.json`, sourceOrigin).href;

export async function loadQuotedEdition(get) {
  let doc;
  const thread = await verifyPost(threadUrl, async (address, options) => {
    const result = await get(address, options);
    if (address === threadUrl && result.ok) doc = result.json;
    return result;
  }, { includeText: true });
  if (thread.status !== "verified") {
    return { thread, error: "The quoting post could not be verified." };
  }

  const references = Array.isArray(doc?.transclusions) ? doc.transclusions : [];
  const [reference] = references;
  // The signed Markdown binds the quote and the pinned URL. Blygger's
  // transclusion metadata rides outside the content hash, so check it too.
  const directive = `![[${sourceId}]]\n> `;
  const quote = thread.contentMarkdown.split("\n\n")
    .find((block) => block.startsWith(directive))?.slice(directive.length);
  if (doc?.kind !== "thread" || references.length !== 1 || reference?.origin !== sourceOrigin ||
      reference.id !== sourceId || reference.version !== version ||
      !quote || quote.includes("\n") || reference.selector?.exact !== quote ||
      !thread.contentMarkdown.split("\n\n").includes(`[Pinned source edition](${pinUrl})`)) {
    return { thread, error: "The published reference does not match the signed citation." };
  }

  const source = await verifyQuote(pinUrl, get, { version, quote });
  return { thread, quote, source };
}
