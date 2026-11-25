import { createWorld, webglAvailable } from "./world.js";

function showExample() {
  if (!webglAvailable()) return false;
  const demo = [
    ["GitHub", "bio names the key", "verified"],
    ["Bluesky", "handle is the domain", "verified"],
    ["X", "proof post", "verified"],
    ["Mastodon", "link checked by server", "pending"],
    ["LinkedIn", "no public check", "claimed"],
  ];
  const verdicts = { verified: "verified", claimed: "claimed only", pending: "checking" };
  const world = createWorld({
    canvas: document.querySelector("#world"),
    tags: document.querySelector("#tags"),
    reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
  });
  world.setTree({
    seed: "blyggdrasil", title: "your blyg", subtitle: "the trunk",
    branches: demo.map(([label, sub]) => ({ label, sub })),
    verdictText: () => verdicts.pending,
  });
  demo.forEach(([, , verdict], index) => {
    setTimeout(() => world.setVerdict(index, verdict, verdicts[verdict]), 2200 + index * 450);
  });
  return true;
}

try {
  if (!showExample()) document.body.classList.add("no-webgl");
} catch {
  document.body.classList.add("no-webgl");
}
