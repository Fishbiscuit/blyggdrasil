// Short human labels for a branch URL: [network, handle].
export function branchLabel(url) {
  try {
    const u = new URL(url);
    const host = u.host.replace(/^www\./, "");
    const p = u.pathname.split("/").filter(Boolean);
    if (host === "github.com") return ["GitHub", p[0] || ""];
    if (host === "bsky.app" && p[0] === "profile") return ["Bluesky", (p[1] || "") + (p[2] === "post" ? " · post" : "")];
    if (host === "x.com" || host === "twitter.com") return ["X", "@" + (p[0] || "") + (p[1] === "status" ? " · post" : "")];
    if (/linkedin\.com$/.test(host)) return ["LinkedIn", p[1] || ""];
    if (/instagram\.com$/.test(host)) return ["Instagram", p[0] || ""];
    if (p[0]?.startsWith("@")) return [host, p[0] + (p[1] ? " · post" : "")];
    return [host, p.length ? "/" + p.join("/") : ""];
  } catch {
    return ["?", url];
  }
}
