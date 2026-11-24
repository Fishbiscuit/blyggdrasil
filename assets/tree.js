// Draws a Blyggdrasil tree as SVG: the blyg is the trunk, each branch a limb with a leaf.
// Verified limbs are solid green; failed ones are dotted red; unchecked or uncheckable ones are dashed grey.

const NS = "http://www.w3.org/2000/svg";
const el = (name, attrs = {}, text) => {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text != null) n.textContent = text;
  return n;
};

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

const trim = (s, n) => ([...s].length > n ? [...s].slice(0, n - 1).join("") + "…" : s);

export function drawTree(svg, { title, branches }) {
  const narrow = (svg.clientWidth || 800) < 560;
  const W = narrow ? 440 : 800;
  const k = W / 800;
  const n = branches.length;
  const rows = n > 8 ? 2 : 1;
  const H = rows === 2 ? 500 : 420;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.replaceChildren();
  const baseY = H - 52;
  const forkY = baseY - 140;
  const cx = W / 2;

  svg.append(el("line", { class: "ground", x1: 60 * k, y1: baseY, x2: W - 60 * k, y2: baseY, "stroke-width": 1 }));
  for (const dx of [-26, -12, 12, 26]) svg.append(el("path", { class: "limb", d: `M${cx} ${baseY} Q ${cx + dx * 0.6} ${baseY + 10} ${cx + dx * 1.6} ${baseY + 18}`, "stroke-width": 3 }));
  svg.append(el("path", { class: "trunk", d: `M${cx} ${baseY} L ${cx} ${forkY}`, "stroke-width": 14, "stroke-linecap": "round" }));

  if (!n) {
    svg.append(el("circle", { class: "leaf pending", cx, cy: forkY - 30, r: 10 }));
    svg.append(el("text", { class: "sub", x: cx, y: forkY - 52, "text-anchor": "middle" }, "no branches yet"));
  }

  branches.forEach((b, i) => {
    const row = rows === 2 ? i % 2 : 0;
    const perRow = rows === 2 ? Math.ceil(n / 2) : n;
    const idx = rows === 2 ? Math.floor(i / 2) : i;
    const t = perRow === 1 ? 0.5 : idx / (perRow - 1);
    const spread = Math.min(narrow ? 150 : 160, 50 + perRow * 16);
    const angle = (-90 - spread / 2 + spread * t) * (Math.PI / 180);
    const r = (row === 0 ? 220 : 310) * (narrow ? 0.62 : 1);
    const x = cx + Math.cos(angle) * r * (narrow ? 1.05 : 1.35);
    const y = forkY + 10 + Math.sin(angle) * r * (rows === 2 ? 0.95 : 0.88);
    const startY = forkY + 30 - (i % 3) * 18;
    const v = b.verdict || "pending";
    svg.append(el("path", { class: `limb ${v}`, d: `M${cx} ${startY} C ${cx} ${startY - 70}, ${x} ${y + 90}, ${x} ${y}`, "stroke-width": v === "verified" ? 5 : 3 }));
    const leaf = el("circle", { class: `leaf ${v}`, cx: x, cy: y, r: v === "verified" ? 11 : 9 });
    leaf.append(el("title", {}, `${b.url} — ${v}`));
    svg.append(leaf);
    const [net, handle] = branchLabel(b.url);
    const anchor = x < cx - 40 ? "end" : x > cx + 40 ? "start" : "middle";
    const lx = anchor === "end" ? x - 16 : anchor === "start" ? x + 16 : x;
    const ly = anchor === "middle" ? y - 22 : y - 2;
    svg.append(el("text", { class: "label", x: lx, y: ly, "text-anchor": anchor }, trim(net, narrow ? 12 : 18)));
    svg.append(el("text", { class: "sub", x: lx, y: ly + 15, "text-anchor": anchor }, trim(handle, narrow ? 14 : 26)));
  });

  svg.append(el("text", { class: "label", x: cx, y: baseY + 36, "text-anchor": "middle" }, trim(title || "", 48)));
}
