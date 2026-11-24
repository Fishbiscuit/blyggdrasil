// The world tree at night. A procedural Yggdrasil whose trunk is a blyg and whose
// branches are its accounts; each branch ends in a light coloured by its verdict.
import * as THREE from "../vendor/three.module.js";

const V3 = THREE.Vector3;
const COLORS = { verified: 0xc8f23c, failed: 0xe2583f, unreachable: 0x6f7871, claimed: 0x6f7871, pending: 0xb9c2ba };
const BG = 0x0a0e0c;

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rngFrom(seed) {
  let a = hashString(String(seed)) || 1;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function haloTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.18, "rgba(255,255,255,0.55)");
  grd.addColorStop(0.45, "rgba(255,255,255,0.12)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// A tube that narrows from r0 to r1 along its curve, revealed segment by segment as it grows.
function taperedTube(curve, r0, r1, seg = 18, rad = 7) {
  const g = new THREE.TubeGeometry(curve, seg, 1, rad, false);
  const pos = g.attributes.position;
  const v = new V3();
  const c = new V3();
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    curve.getPointAt(t, c);
    const r = r0 + (r1 - r0) * Math.pow(t, 0.85);
    for (let j = 0; j <= rad; j++) {
      const k = i * (rad + 1) + j;
      v.fromBufferAttribute(pos, k).sub(c).multiplyScalar(r).add(c);
      pos.setXYZ(k, v.x, v.y, v.z);
    }
  }
  g.computeVertexNormals();
  g.setDrawRange(0, 0);
  g.userData = { seg, rad };
  return g;
}

export function webglAvailable() {
  try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch { return false; }
}

export function createWorld({ canvas, tags, reducedMotion = false, compact = false }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(BG, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(BG, compact ? 0.035 : 0.05);
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
  const lookAt = new V3(0, 2.75, 0);

  scene.add(new THREE.HemisphereLight(0xb7c6b9, 0x0a0e0c, 1.15));
  const key = new THREE.DirectionalLight(0xe8ece4, 1.4);
  key.position.set(-4, 7, 5);
  scene.add(key);
  const sap = new THREE.PointLight(0xc8f23c, 0, 7, 1.6);
  sap.position.set(0, 3.1, 0);
  scene.add(sap);

  const halo = haloTexture();
  const bark = new THREE.MeshStandardMaterial({ color: 0x59625a, roughness: 0.92, metalness: 0, emissive: 0x0b100c });
  const barkLight = new THREE.MeshStandardMaterial({ color: 0x77817a, roughness: 0.85, metalness: 0, emissive: 0x0e130f });

  const root = new THREE.Group();
  scene.add(root);

  // Ground: faint rings around the trunk and a glow where it is rooted.
  const ground = new THREE.Group();
  for (const [r, o] of [[1.1, 0.1], [2.1, 0.07], [3.3, 0.05], [4.8, 0.035]]) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.008, 128), new THREE.MeshBasicMaterial({ color: 0xe8ece4, transparent: true, opacity: o, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ground.add(ring);
  }
  const rootGlow = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 4.2), new THREE.MeshBasicMaterial({ map: halo, color: 0xc8f23c, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false }));
  rootGlow.rotation.x = -Math.PI / 2;
  rootGlow.position.y = 0.01;
  ground.add(rootGlow);
  scene.add(ground);

  // Fireflies drifting through the canopy.
  const FLIES = compact ? 50 : 110;
  const flyPos = new Float32Array(FLIES * 3);
  const flySeed = [];
  for (let i = 0; i < FLIES; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 0.6 + Math.random() * 3.4;
    flySeed.push({ a, r, y: 0.4 + Math.random() * 4.6, s: 0.2 + Math.random() * 0.6, p: Math.random() * 10 });
  }
  const flyGeo = new THREE.BufferGeometry();
  flyGeo.setAttribute("position", new THREE.BufferAttribute(flyPos, 3));
  const flies = new THREE.Points(flyGeo, new THREE.PointsMaterial({ size: 0.075, map: halo, color: 0xd9f37a, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true }));
  scene.add(flies);

  let limbs = [];
  let branches = [];
  let trunkTag = null;
  let t0 = performance.now() / 1000;
  let yaw = 0.6;
  let pitch = 0;
  let spin = reducedMotion ? 0 : 0.07;
  let dragging = null;
  let visible = true;
  let raf = 0;

  function clearTree() {
    for (const l of limbs) { root.remove(l.mesh); l.mesh.geometry.dispose(); }
    for (const b of branches) {
      root.remove(b.mesh, b.orb, b.glow, b.sapSprite);
      b.mesh.geometry.dispose();
      b.tag?.remove();
    }
    trunkTag?.remove();
    limbs = [];
    branches = [];
  }

  function addLimb(curve, r0, r1, start, dur, mat = bark, seg = 18) {
    const mesh = new THREE.Mesh(taperedTube(curve, r0, r1, seg), mat);
    root.add(mesh);
    const l = { mesh, start, dur };
    limbs.push(l);
    return l;
  }

  function grow(rng) {
    const top = new V3((rng() - 0.5) * 0.25, 2.55, (rng() - 0.5) * 0.25);
    const trunk = new THREE.CatmullRomCurve3([new V3(0, -0.08, 0), new V3(0.06, 0.7, 0.03), new V3(-0.07, 1.55, -0.04), top]);
    addLimb(trunk, 0.2, 0.085, 0, 1.0, bark, 24);
    const up = new V3(0, 1, 0);
    const twig = (from, dir, len, r, depth, start) => {
      const end = from.clone().addScaledVector(dir, len);
      const mid = from.clone().lerp(end, 0.5).add(new V3((rng() - 0.5) * len * 0.3, rng() * len * 0.15, (rng() - 0.5) * len * 0.3));
      addLimb(new THREE.CatmullRomCurve3([from.clone(), mid, end]), r, r * 0.5, start, 0.55, bark, 12);
      if (depth >= 3) return;
      const kids = depth === 1 ? 3 : 2;
      for (let k = 0; k < kids; k++) {
        const axis = new V3(rng() - 0.5, 0, rng() - 0.5).normalize();
        const nd = dir.clone().applyAxisAngle(axis, 0.45 + rng() * 0.5).addScaledVector(up, 0.25).normalize();
        twig(end, nd, len * (0.62 + rng() * 0.12), r * 0.55, depth + 1, start + 0.42);
      }
    };
    const mains = 4;
    for (let i = 0; i < mains; i++) {
      const az = (i / mains) * Math.PI * 2 + rng() * 0.8;
      const dir = new V3(Math.cos(az) * 0.75, 1, Math.sin(az) * 0.75).normalize();
      twig(top, dir, 1.15 + rng() * 0.35, 0.075, 1, 0.85);
    }
    for (let i = 0; i < 7; i++) {
      const az = (i / 7) * Math.PI * 2 + rng() * 0.5;
      const reach = 1.1 + rng() * 1.3;
      const end = new V3(Math.cos(az) * reach, -0.06, Math.sin(az) * reach);
      const mid = new V3(Math.cos(az) * reach * 0.45, 0.02, Math.sin(az) * reach * 0.45);
      addLimb(new THREE.CatmullRomCurve3([new V3(Math.cos(az) * 0.08, 0.12, Math.sin(az) * 0.08), mid, end]), 0.09, 0.008, 0.15, 0.9, bark, 14);
    }
    return trunk;
  }

  function makeTag(label, sub, verdictText, href) {
    const el = document.createElement(href ? "a" : "div");
    el.className = "tag v-pending";
    if (href) { el.href = href; el.rel = "nofollow noopener"; el.target = "_blank"; }
    el.innerHTML = `<span class="tag-net"></span><span class="tag-sub"></span><span class="tag-v"></span>`;
    el.querySelector(".tag-net").textContent = label;
    el.querySelector(".tag-sub").textContent = sub;
    el.querySelector(".tag-v").textContent = verdictText;
    tags.append(el);
    return el;
  }

  function setTree({ seed, title, subtitle, branches: list, verdictText = () => "checking" }) {
    clearTree();
    t0 = performance.now() / 1000;
    const rng = rngFrom(seed || "blyggdrasil");
    const trunk = grow(rng);
    const n = list.length;
    list.forEach((b, i) => {
      const along = 0.5 + 0.42 * ((i + 0.5) / Math.max(n, 1));
      const base = trunk.getPointAt(along);
      const az = i * 2.39996 + rng() * 0.35 + 0.4;
      const reach = 1.75 + rng() * 0.75 + (n > 8 ? (i % 2) * 0.6 : 0);
      const rise = 0.9 + rng() * 1.0 + (i % 3) * 0.2;
      const tip = new V3(Math.cos(az) * reach, base.y + rise, Math.sin(az) * reach);
      const c1 = base.clone().lerp(tip, 0.35).add(new V3(0, rise * 0.15 + 0.25, 0));
      const c2 = base.clone().lerp(tip, 0.75).add(new V3(0, 0.3, 0));
      const curve = new THREE.CatmullRomCurve3([base, c1, c2, tip]);
      const start = 0.7 + i * 0.12;
      const mesh = new THREE.Mesh(taperedTube(curve, 0.05, 0.016, 22), barkLight.clone());
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.075, 20, 14), new THREE.MeshBasicMaterial({ color: COLORS.pending }));
      orb.position.copy(tip);
      orb.scale.setScalar(0.001);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: halo, color: COLORS.pending, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      glow.position.copy(tip);
      glow.scale.setScalar(1.1);
      const sapSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: halo, color: COLORS.verified, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      sapSprite.scale.setScalar(0.32);
      root.add(mesh, orb, glow, sapSprite);
      const tag = makeTag(b.label, b.sub || "", verdictText("pending"), b.url);
      branches.push({ curve, mesh, orb, glow, sapSprite, tip, start, dur: 0.7, verdict: "pending", tag, phase: rng() });
    });
    if (title) {
      trunkTag = document.createElement("div");
      trunkTag.className = "tag trunk-tag";
      trunkTag.innerHTML = `<span class="tag-net"></span><span class="tag-sub"></span>`;
      trunkTag.querySelector(".tag-net").textContent = title;
      trunkTag.querySelector(".tag-sub").textContent = subtitle || "";
      tags.append(trunkTag);
    }
    if (reducedMotion) t0 -= 10;
    kick();
  }

  function setVerdict(i, verdict, text) {
    const b = branches[i];
    if (!b) return;
    b.verdict = verdict;
    const col = COLORS[verdict] ?? COLORS.pending;
    b.orb.material.color.setHex(col);
    b.glow.material.color.setHex(col);
    if (verdict === "verified") { b.mesh.material.emissive.setHex(0x2c3a0c); b.mesh.material.color.setHex(0x9aa86a); }
    else if (verdict === "failed") { b.mesh.material.color.setHex(0x5c4440); }
    b.tag.className = `tag v-${verdict}`;
    b.tag.querySelector(".tag-v").textContent = text;
    kick();
  }

  // Drag to turn the tree. Vertical page scroll stays with the page on touch.
  canvas.addEventListener("pointerdown", (e) => { dragging = { x: e.clientX, y: e.clientY, yaw, pitch }; canvas.setPointerCapture(e.pointerId); spin = 0; });
  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    yaw = dragging.yaw + (e.clientX - dragging.x) * 0.008;
    pitch = Math.max(-0.25, Math.min(0.35, dragging.pitch + (e.clientY - dragging.y) * 0.003));
    kick();
  });
  const end = () => { dragging = null; if (!reducedMotion) setTimeout(() => { if (!dragging) spin = 0.07; }, 2500); };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);

  function resize() {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const half = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const dist = Math.max(compact ? 9.5 : 10.5, (camera.aspect < 0.8 ? 8.6 : 6.6) / (2 * half * camera.aspect), 7.4 / (2 * half));
    // On wide screens the tree stands right of centre, leaving the left for the headline.
    const shift = !compact && camera.aspect > 1.25 ? -Math.min(2.6, (camera.aspect - 1.1) * 2.2) : 0;
    camera.position.set(shift, 3.1, dist);
    camera.lookAt(lookAt.x + shift, lookAt.y, lookAt.z);
    camera.updateProjectionMatrix();
    kick();
  }
  new ResizeObserver(resize).observe(canvas);
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; kick(); }).observe(canvas);
  document.addEventListener("visibilitychange", kick);

  const tmp = new V3();
  const ndc = new V3();
  // Projects a point to canvas pixels: { x, y, behind }.
  function project(worldPos) {
    ndc.copy(worldPos).project(camera);
    const cam = tmp.copy(worldPos).applyMatrix4(camera.matrixWorldInverse);
    return { x: (ndc.x * 0.5 + 0.5) * canvas.clientWidth, y: (-ndc.y * 0.5 + 0.5) * canvas.clientHeight, behind: cam.z < -camera.position.length() };
  }
  function setTag(el, p, left) {
    const w = el.offsetWidth + 22;
    const W = canvas.clientWidth;
    const x = left ? Math.max(w + 6, p.x) : Math.min(W - w - 6, p.x);
    el.style.transform = `translate(${x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
    el.classList.toggle("left", left);
    el.classList.toggle("far", p.behind);
  }

  function frame() {
    raf = 0;
    if (!visible || document.hidden) return;
    const now = performance.now() / 1000;
    const t = now - t0;
    if (!dragging) yaw += spin / 60;
    root.rotation.y = yaw;
    root.rotation.x = pitch * 0.3;
    let busy = spin > 0 || !!dragging;
    for (const l of limbs) {
      const p = Math.min(1, Math.max(0, (t - l.start) / l.dur));
      const { seg, rad } = l.mesh.geometry.userData;
      l.mesh.geometry.setDrawRange(0, Math.ceil(p * seg) * rad * 6);
      if (p < 1) busy = true;
    }
    let lit = 0;
    for (const b of branches) {
      const p = Math.min(1, Math.max(0, (t - b.start) / b.dur));
      const { seg, rad } = b.mesh.geometry.userData;
      b.mesh.geometry.setDrawRange(0, Math.ceil(p * seg) * rad * 6);
      const bloom = Math.min(1, Math.max(0, (t - b.start - b.dur) / 0.35));
      const pulse = b.verdict === "pending" ? 0.75 + 0.25 * Math.sin(now * 3 + b.phase * 6) : 1;
      b.orb.scale.setScalar(Math.max(0.001, bloom * (b.verdict === "verified" ? 1.25 : 1) * pulse));
      b.glow.material.opacity = bloom * (b.verdict === "verified" ? 0.95 : b.verdict === "failed" ? 0.5 : 0.32) * pulse;
      b.glow.scale.setScalar(b.verdict === "verified" ? 1.5 : 1.05);
      if (b.verdict === "verified" && bloom >= 1) {
        lit++;
        const s = (now * 0.32 + b.phase) % 1;
        b.curve.getPointAt(s, b.sapSprite.position);
        b.sapSprite.material.opacity = Math.sin(Math.PI * s) * 0.9;
      } else b.sapSprite.material.opacity = 0;
      if (p < 1 || bloom < 1 || b.verdict === "pending" || b.verdict === "verified") busy = true;
    }
    sap.intensity = Math.min(3, lit * 0.9);
    for (let i = 0; i < FLIES; i++) {
      const f = flySeed[i];
      const a = f.a + (reducedMotion ? 0 : now * 0.04 * f.s);
      flyPos[i * 3] = Math.cos(a) * f.r;
      flyPos[i * 3 + 1] = f.y + (reducedMotion ? 0 : Math.sin(now * f.s + f.p) * 0.25);
      flyPos[i * 3 + 2] = Math.sin(a) * f.r;
    }
    flyGeo.attributes.position.needsUpdate = true;
    if (!reducedMotion) busy = true;
    renderer.render(scene, camera);
    root.updateMatrixWorld();
    const cx = project(root.localToWorld(new V3(0, 2.4, 0))).x;
    const placed = branches.map((b) => {
      const p = project(root.localToWorld(tmp.copy(b.tip)));
      return { b, p, left: p.x < cx, ty: p.y };
    });
    // Keep labels on the same side at least 30px apart, so neighbouring lights stay readable.
    for (const side of [true, false]) {
      const col = placed.filter((q) => q.left === side).sort((a, c) => a.p.y - c.p.y);
      for (let i = 1; i < col.length; i++) if (col[i].ty - col[i - 1].ty < 30) col[i].ty = col[i - 1].ty + 30;
    }
    for (const q of placed) {
      setTag(q.b.tag, { x: q.p.x, y: q.ty, behind: q.p.behind }, q.left);
      q.b.tag.style.opacity = Math.min(1, Math.max(0, (t - q.b.start - q.b.dur) / 0.35));
    }
    if (trunkTag) { setTag(trunkTag, project(root.localToWorld(new V3(0, -0.25, 0))), false); trunkTag.style.opacity = Math.min(1, t / 0.8); }
    if (busy) kick();
  }
  function kick() { if (!raf) raf = requestAnimationFrame(frame); }

  resize();
  return { setTree, setVerdict, resize };
}
