import { verifyPost } from "../../lib/post-proof.js";
import { copyEditionLink } from "./edition.mjs";
import { publicJson } from "./public-json.mjs";

const labels = { valid: "Passed", invalid: "Failed", unsigned: "Unsigned", unavailable: "Unavailable" };
const summaries = {
  verified: "The publisher's edition verified.",
  failed: "One or more proof checks failed.",
  unsigned: "This edition has no valid published signature.",
  unavailable: "The proof could not be checked.",
};

export async function inspectEdition(edition, { shownMarkdown, get = publicJson(edition.origin) } = {}) {
  const sheet = copyEditionLink(edition);
  const report = await verifyPost(undefined, get, { edition, version: edition.version, includeText: true });
  sheet.title = "Blyggdrasil edition proof";
  sheet.description = report.error || summaries[report.status];
  sheet.fields.push(
    { label: "Content hash", value: labels[report.checks.content] },
    { label: "Post signature", value: labels[report.checks.signature] },
    { label: "Signer authorized by tree", value: labels[report.checks.signer] },
  );

  if (report.status === "verified" && typeof shownMarkdown === "string" && shownMarkdown !== "") {
    const sameCopy = shownMarkdown === report.contentMarkdown;
    sheet.fields.push({ label: "Copy shown in Burrow", value: sameCopy ? "Matches" : "Different text" });
    if (!sameCopy) sheet.description = "The publisher's edition verified. The text held by Burrow differs from it.";
  }
  return sheet;
}

export function networkUnavailable(edition) {
  return {
    ...copyEditionLink(edition),
    title: "Blyggdrasil edition proof",
    description: "Allow network access for this extension to check the publisher. The full proof link is available below.",
  };
}
