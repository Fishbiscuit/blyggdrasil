// Places each blyg as a house. Blygs that quote each other become neighbours.
// Deterministic: the same thicket always produces the same village.

export function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function rng(seed) {
  let s = seed || 1;
  return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Initial positions: a loose ring, before anyone has been heard.
export function ringLayout(origins, radius = 70) {
  const pos = new Map();
  const sorted = [...origins].sort((a, b) => hash(a) - hash(b));
  sorted.forEach((o, i) => {
    const a = (i / sorted.length) * Math.PI * 2;
    const r = radius * (0.85 + 0.3 * rng(hash(o))());
    pos.set(o, { x: Math.cos(a) * r, z: Math.sin(a) * r });
  });
  return pos;
}

// Force layout: springs along quote pairs, gentle repulsion, a pull to centre.
export function neighbourLayout(origins, pairs, start) {
  const nodes = [...origins].map(o => ({ o, x: start.get(o).x, z: start.get(o).z, vx: 0, vz: 0, deg: 0 }));
  const idx = new Map(nodes.map((n, i) => [n.o, i]));
  const links = [];
  for (const p of pairs.values()) {
    if (!idx.has(p.a) || !idx.has(p.b)) continue;
    const w = Math.log2(1 + p.exchanges.length);
    links.push([idx.get(p.a), idx.get(p.b), w]);
    nodes[idx.get(p.a)].deg += w; nodes[idx.get(p.b)].deg += w;
  }
  const MIN = 15;   // houses keep a garden between them
  for (let step = 0; step < 600; step++) {
    const cool = 1 - step / 600;
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        let dx = a.x - b.x, dz = a.z - b.z;
        let d2 = dx * dx + dz * dz + 0.01;
        const d = Math.sqrt(d2);
        let f = 520 / d2;
        if (d < MIN) f += (MIN - d) * 0.6;
        dx /= d; dz /= d;
        a.vx += dx * f; a.vz += dz * f; b.vx -= dx * f; b.vz -= dz * f;
      }
    }
    for (const [i, j, w] of links) {
      const a = nodes[i], b = nodes[j];
      const dx = b.x - a.x, dz = b.z - a.z;
      const d = Math.sqrt(dx * dx + dz * dz) + 0.01;
      const target = 20;
      const f = (d - target) * 0.02 * w;
      a.vx += dx / d * f; a.vz += dz / d * f; b.vx -= dx / d * f; b.vz -= dz / d * f;
    }
    for (const n of nodes) {
      const pull = n.deg > 0 ? 0.014 : 0.011;
      n.vx -= n.x * pull; n.vz -= n.z * pull;
      const sp = Math.hypot(n.vx, n.vz), cap = 3 * cool + 0.05;
      if (sp > cap) { n.vx *= cap / sp; n.vz *= cap / sp; }
      n.x += n.vx; n.z += n.vz; n.vx *= 0.5; n.vz *= 0.5;
    }
  }
  // Quiet blygs (no quotes either way) settle on the outskirts, still on a lane.
  const out = new Map();
  for (const n of nodes) out.set(n.o, { x: n.x, z: n.z });
  return out;
}

// Lanes: a minimum spanning tree so every house can be reached on foot,
// plus a lane for every pair that has spoken.
export function lanes(pos, pairs) {
  const keys = [...pos.keys()];
  const inTree = new Set([keys[0]]);
  const edges = [];
  const seen = new Set();
  while (inTree.size < keys.length) {
    let best = null;
    for (const a of inTree) for (const b of keys) {
      if (inTree.has(b)) continue;
      const d = dist(pos.get(a), pos.get(b));
      if (!best || d < best.d) best = { a, b, d };
    }
    inTree.add(best.b);
    edges.push([best.a, best.b]);
    seen.add([best.a, best.b].sort().join('|'));
  }
  for (const p of pairs.values()) {
    const k = [p.a, p.b].join('|');
    if (seen.has(k) || !pos.has(p.a) || !pos.has(p.b)) continue;
    if (dist(pos.get(p.a), pos.get(p.b)) < 45) { edges.push([p.a, p.b]); seen.add(k); }
  }
  return edges;
}

export function dist(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }

export function segDist(p, a, b) {
  const vx = b.x - a.x, vz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.z - a.z) * vz) / (vx * vx + vz * vz || 1)));
  return Math.hypot(p.x - (a.x + vx * t), p.z - (a.z + vz * t));
}
