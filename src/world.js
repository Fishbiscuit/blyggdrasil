import * as THREE from '../vendor/three.module.js';
import { hash, rng, dist } from './layout.js';

const DAY = 86400000;
const MOVE_KEYS = new Set(['w', 'a', 's', 'd', 'shift', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);
const EYE = 1.7;
const HOUSE = { w: 7, h: 5, d: 6 };
// Window slots, in house-local space: ground floor either side of the door,
// four upstairs, two on each side wall. Most recent post takes slot 0.
const SLOTS = [
  [-1.6, 3.55, 1], [1.6, 3.55, 1], [-2.6, 3.55, 1], [2.6, 3.55, 1],
  [-2.4, 1.55, 1], [2.4, 1.55, 1],
  [-1, 2.6, 'L'], [1, 2.6, 'L'], [-1, 2.6, 'R'], [1, 2.6, 'R'],
];
const PALETTE = ['#46506a', '#5a4650', '#5b5844', '#44585a', '#52445f', '#634b3e', '#425064', '#5a5660'];
const WARM = new THREE.Color('#ffc978');
const EMBER = new THREE.Color('#5a3a1a');
const COOL = new THREE.Color('#8fd3ff');
const COOL_DIM = new THREE.Color('#203a52');
const DARK = new THREE.Color('#0b0f19');
const SHUT = new THREE.Color('#1a1e28');

export class World {
  constructor(canvas, hooks) {
    this.hooks = hooks;
    this.canvas = canvas;
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#05070f');
    this.scene.fog = new THREE.FogExp2('#0e1530', 0.0105);
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 3000);
    this.player = { x: 0, z: 95, yaw: Math.PI, pitch: 0.05 };
    this.view = { mode: 'aerial', blend: 1 };       // blend 1 = aerial, 0 = on foot
    this.keys = new Set();
    this.houses = new Map();
    this.time = Date.now();
    this.glide = null;
    this.clock = new THREE.Clock();
    this.windowRefs = [];
    this.bulbRefs = [];

    this.buildSky();
    this.buildGround();
    this.buildShared();
    this.bindInput();
    this.resize();
    addEventListener('resize', () => this.resize());
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ---------- static scenery ----------
  buildSky() {
    const sky = new THREE.Mesh(new THREE.SphereGeometry(2400, 32, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color('#03040b') }, horizon: { value: new THREE.Color('#0e1530') } },
      vertexShader: 'varying vec3 vp; void main(){ vp = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 horizon; varying vec3 vp; void main(){ float h = clamp(vp.y*1.6,0.0,1.0); gl_FragColor = vec4(mix(horizon, top, pow(h,0.6)),1.0); }',
    }));
    this.scene.add(sky);

    const r = rng(7), n = 1400, pos = new Float32Array(n * 3), size = new Float32Array(n), col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const th = r() * Math.PI * 2, ph = Math.acos(0.12 + r() * 0.88);
      pos.set([Math.sin(ph) * Math.cos(th) * 2000, Math.cos(ph) * 2000, Math.sin(ph) * Math.sin(th) * 2000], i * 3);
      size[i] = 1.2 + r() * r() * 5;
      const c = new THREE.Color().setHSL(0.6 - r() * 0.1, 0.4, 0.75 + r() * 0.25);
      col.set([c.r, c.g, c.b], i * 3);
    }
    this.scene.add(glowPoints(pos, col, size, { fixedSize: true, fog: false }));

    const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture('#f3f1e4', 0.18), fog: false, depthWrite: false, transparent: true }));
    moon.position.set(-830, 750, -1300);
    moon.scale.set(350, 350, 1);
    this.scene.add(moon);

    this.scene.add(new THREE.HemisphereLight('#5d72b8', '#0b0e16', 1.6));
    const moonlight = new THREE.DirectionalLight('#b4c4ff', 1.1);
    moonlight.position.set(-330, 300, -520);
    this.scene.add(moonlight);
  }

  buildGround() {
    const tex = noiseTexture();
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(260, 260);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshLambertMaterial({ color: '#16202c', map: tex }));
    ground.rotation.x = -Math.PI / 2;
    ground.name = 'ground';
    this.ground = ground;
    this.scene.add(ground);
  }

  buildShared() {
    this.windowTex = windowTexture();
    this.shutterTex = shutterTexture();
    this.halo = radialTexture('#ffffff', 0.0);
    this.roofGeo = gableGeometry(HOUSE.w + 0.8, 2.6, HOUSE.d + 0.8);
    this.bodyGeo = new THREE.BoxGeometry(HOUSE.w, HOUSE.h, HOUSE.d);
    this.bodyGeo.translate(0, HOUSE.h / 2, 0);
    const winGeo = new THREE.PlaneGeometry(1.05, 1.25);
    this.maxWindows = 0;
    this.winGeo = winGeo;
  }

  // ---------- village ----------
  setSites(sites, positions) {
    for (const site of sites.values()) {
      const p = positions.get(site.origin);
      const r = rng(hash(site.origin));
      const g = new THREE.Group();
      const color = PALETTE[Math.floor(r() * PALETTE.length)];
      const body = new THREE.Mesh(this.bodyGeo, new THREE.MeshLambertMaterial({ color }));
      const roof = new THREE.Mesh(this.roofGeo, new THREE.MeshLambertMaterial({ color: '#232838' }));
      roof.position.y = HOUSE.h;
      const door = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 2.3), new THREE.MeshBasicMaterial({ color: '#2a1d10' }));
      door.position.set(0, 1.15, HOUSE.d / 2 + 0.03);
      g.add(body, roof, door);
      const sx = 0.85 + r() * 0.3, sy = 0.85 + r() * 0.35;
      g.scale.set(sx, sy, 1);
      body.userData.origin = roof.userData.origin = door.userData.origin = site.origin;
      const sign = textSprite(site.title, site.author && site.author !== site.title ? site.author : '');
      sign.position.set(p.x, HOUSE.h * sy + 4.2, p.z);
      this.scene.add(g, sign);
      const house = { site, group: g, door, sign, pos: { x: p.x, z: p.z }, target: null, from: null, sy, slots: [], visible: true };
      this.houses.set(site.origin, house);
      this.placeHouse(house);
    }
    const total = this.houses.size * SLOTS.length;
    const winMat = new THREE.MeshBasicMaterial({ map: this.windowTex, fog: true });
    this.windows = new THREE.InstancedMesh(this.winGeo, winMat, total);
    this.windows.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(total * 3), 3);
    this.shutters = new THREE.InstancedMesh(this.winGeo, new THREE.MeshBasicMaterial({ map: this.shutterTex, color: '#3a4152' }), total);
    this.shutters.count = 0;
    this.scene.add(this.windows, this.shutters);
    const hp = new Float32Array(total * 3), hc = new Float32Array(total * 3), hs = new Float32Array(total);
    this.winHalo = glowPoints(hp, hc, hs, {});
    this.scene.add(this.winHalo);
    this.lanterns = glowPoints(new Float32Array(this.houses.size * 9 * 3), new Float32Array(this.houses.size * 9 * 3), new Float32Array(this.houses.size * 9), {});
    this.scene.add(this.lanterns);
    this.festoon = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#4a4658', transparent: true, opacity: 0.8 }));
    this.scene.add(this.festoon);
    this.bulbs = glowPoints(new Float32Array(3), new Float32Array(3), new Float32Array(1), {});
    this.scene.add(this.bulbs);
    this.cores = glowPoints(new Float32Array(3), new Float32Array(3), new Float32Array(1), { core: true });
    this.scene.add(this.cores);
    this.resize();
  }

  setLanes(edges) {
    this.edges = edges;
    this.laneKey = null;
    this.drawLanes();
  }

  // Only lanes between houses that exist at the current time.
  drawLanes() {
    if (!this.edges) return;
    const shown = this.edges.filter(([a, b]) => this.houses.get(a).visible && this.houses.get(b).visible);
    const key = shown.length + ':' + shown.map(e => e[0].length + e[1].length).join(',');
    if (key === this.laneKey) return;
    this.laneKey = key;
    if (this.laneMesh) { this.scene.remove(this.laneMesh); this.laneMesh.geometry.dispose(); }
    const verts = [];
    const W = 1.6;
    for (const [a, b] of shown) {
      const A = this.houses.get(a).pos, B = this.houses.get(b).pos;
      const dx = B.x - A.x, dz = B.z - A.z, L = Math.hypot(dx, dz) || 1;
      const nx = -dz / L * W, nz = dx / L * W;
      const q = [[A.x + nx, A.z + nz], [A.x - nx, A.z - nz], [B.x - nx, B.z - nz], [B.x + nx, B.z + nz]];
      for (const i of [0, 1, 2, 0, 2, 3]) verts.push(q[i][0], 0.03, q[i][1]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.computeVertexNormals();
    this.laneMesh = new THREE.Mesh(g, this.laneMat || (this.laneMat = new THREE.MeshLambertMaterial({ color: '#2a3243', side: THREE.DoubleSide })));
    this.scene.add(this.laneMesh);
  }

  plantThicket() {
    if (this.trees) this.scene.remove(this.trees);
    const r = rng(42), spots = [];
    const hs = [...this.houses.values()].map(h => h.pos);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of hs) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
    const pad = 60;
    for (let tries = 0; tries < 9000 && spots.length < 900; tries++) {
      const x = minX - pad + r() * (maxX - minX + pad * 2), z = minZ - pad + r() * (maxZ - minZ + pad * 2);
      const p = { x, z };
      if (hs.some(h => dist(h, p) < 9)) continue;
      if (this.edges && this.edges.some(([a, b]) => segToPoint(this.houses.get(a).pos, this.houses.get(b).pos, p) < 3.4)) continue;
      // Keep the ground under every string clear, and the places people stand to listen.
      if (this.thicket && [...this.thicket.pairs.values()].some(pr => {
        const A = this.houses.get(pr.a), B = this.houses.get(pr.b);
        if (!A || !B) return false;
        const mx = (A.pos.x + B.pos.x) / 2, mz = (A.pos.z + B.pos.z) / 2;
        return segToPoint(A.pos, B.pos, p) < 5 || Math.hypot(p.x - mx, p.z - mz) < 19;
      })) continue;
      spots.push([x, z, 0.6 + r() * 1.3, r()]);
    }
    const geo = new THREE.ConeGeometry(1.4, 5, 7);
    geo.translate(0, 2.5, 0);
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: '#0f1d1a' }), spots.length);
    const m = new THREE.Matrix4(), c = new THREE.Color();
    spots.forEach(([x, z, s, t], i) => {
      m.compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion(), new THREE.Vector3(s, s * (0.9 + t * 0.6), s));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, c.setHSL(0.42 + t * 0.08, 0.35, 0.06 + t * 0.05));
    });
    this.trees = mesh;
    this.treeSpots = spots;
    this.scene.add(mesh);
  }

  placeHouse(h) {
    const { x, z } = h.pos;
    h.group.position.set(x, 0, z);
    // Face the middle of the village, where the lanes meet.
    h.group.rotation.y = Math.atan2(-x, -z);
    h.group.updateMatrixWorld(true);
    h.sign.position.set(x, HOUSE.h * h.sy + 4.2, z);
  }

  // Smoothly move houses to where their conversations put them.
  settle(positions, ms = 2600) {
    for (const h of this.houses.values()) {
      h.from = { ...h.pos };
      h.target = positions.get(h.site.origin);
    }
    this.settling = { start: performance.now(), ms: this.reduced ? 1 : ms };
  }

  // ---------- what is lit at time t ----------
  setData(thicket) { this.thicket = thicket; this.refresh(); }
  setTime(t) { this.time = t; this.refresh(); }

  refresh() {
    if (!this.windows || !this.thicket) return;
    const t = this.time;
    const iso = new Date(t).toISOString();
    const m = new THREE.Matrix4(), local = new THREE.Matrix4(), q = new THREE.Quaternion();
    const v = new THREE.Vector3(), c = new THREE.Color();
    const hp = this.winHalo.geometry.attributes.position, hc = this.winHalo.geometry.attributes.color, hsz = this.winHalo.geometry.attributes.size;
    const lp = this.lanterns.geometry.attributes.position, lc = this.lanterns.geometry.attributes.color, lsz = this.lanterns.geometry.attributes.size;
    let w = 0, s = 0, li = 0;
    this.windowRefs = [];
    this.flickers = [];
    for (const h of this.houses.values()) {
      const site = h.site;
      const listed = site.listedAt ? Date.parse(site.listedAt) : 0;
      const visible = listed <= t + DAY;
      h.visible = visible;
      h.group.visible = visible;
      h.sign.visible = visible;
      if (!visible) continue;
      const lit = site.status === 'ok';
      h.door.material.color.set(lit ? '#6b4a22' : '#15100a');
      const items = site.items.filter(i => i.created <= iso).slice(-SLOTS.length).reverse();
      SLOTS.forEach((slot, k) => {
        const it = items[k];
        const [lx, ly, face] = slot;
        if (face === 1) local.compose(v.set(lx, ly, HOUSE.d / 2 + 0.04), q.identity(), new THREE.Vector3(1, 1, 1));
        else {
          const sgn = face === 'L' ? -1 : 1;
          local.compose(v.set(sgn * (HOUSE.w / 2 + 0.04), ly, lx * 1.2), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), sgn * Math.PI / 2), new THREE.Vector3(1, 1, 1));
        }
        m.multiplyMatrices(h.group.matrixWorld, local);
        if (it && it.kind === 'withdrawn') {
          this.shutters.setMatrixAt(s++, m);
          return;
        }
        this.windows.setMatrixAt(w, m);
        let glow = 0;
        if (it && lit) {
          const doc = this.thicket.docs.get(site.origin + '|' + it.id);
          const age = Math.max(0, (t - Date.parse(it.created)) / DAY);
          glow = Math.max(0.16, Math.exp(-age / 9));
          const ai = doc && doc.generated.length > 0;
          c.copy(ai ? COOL_DIM : EMBER).lerp(ai ? COOL : WARM, glow);
          const revised = doc ? doc.changelog.some(e => e.version > 1 && e.at <= iso) : it.version > 1 && it.updated <= iso;
          if (revised) this.flickers.push({ w, base: c.clone(), seed: hash(it.id) % 997 });
          this.windowRefs[w] = { origin: site.origin, id: it.id };
        } else {
          c.copy(DARK);
          this.windowRefs[w] = { origin: site.origin, id: null };
        }
        this.windows.setColorAt(w, c);
        v.setFromMatrixPosition(m);
        hp.setXYZ(w, v.x, v.y, v.z);
        hc.setXYZ(w, c.r, c.g, c.b);
        hsz.setX(w, glow > 0 ? 3.2 + glow * 4.5 : 0);
        w++;
      });
      // Lantern cluster at the door for the latest burst (several items published as one act).
      const burst = lit ? [...site.bursts].reverse().find(b => b.at <= iso) : null;
      if (burst) {
        const age = (t - Date.parse(burst.at)) / DAY;
        const n = Math.min(9, burst.size);
        const g = Math.max(0.25, Math.exp(-age / 14));
        for (let k = 0; k < n; k++) {
          v.set(-1.25 + (k % 3) * 0.32, 2.75 - Math.floor(k / 3) * 0.38, HOUSE.d / 2 + 0.45).applyMatrix4(h.group.matrixWorld);
          lp.setXYZ(li, v.x, v.y, v.z);
          c.set('#ffb35c').multiplyScalar(g);
          lc.setXYZ(li, c.r, c.g, c.b);
          lsz.setX(li, 1.6 + g * 1.4);
          li++;
        }
      }
    }
    this.windows.count = w;
    this.shutters.count = s;
    this.windows.instanceMatrix.needsUpdate = true;
    this.windows.instanceColor.needsUpdate = true;
    this.shutters.instanceMatrix.needsUpdate = true;
    this.winHalo.geometry.setDrawRange(0, w);
    hp.needsUpdate = hc.needsUpdate = hsz.needsUpdate = true;
    this.lanterns.geometry.setDrawRange(0, li);
    lp.needsUpdate = lc.needsUpdate = lsz.needsUpdate = true;
    this.buildFestoons(iso);
    this.drawLanes();
  }

  // Festoon lights: one wire per pair of blygs that have quoted each other,
  // one bulb per quote, in the order they were published.
  buildFestoons(iso) {
    const wire = [], bp = [], bc = [], bs = [], cs = [];
    this.bulbRefs = [];
    this.visiblePairs = [];
    const c = new THREE.Color();
    for (const pair of this.thicket.pairs.values()) {
      const ex = pair.exchanges.filter(e => e.at <= iso).sort((a, b) => a.at.localeCompare(b.at));
      if (!ex.length) continue;
      const A = this.houses.get(pair.a), B = this.houses.get(pair.b);
      if (!A || !B || !A.visible || !B.visible) continue;
      this.visiblePairs.push({ pair, ex });
      const curve = this.wireCurve(A, B);
      const N = 28;
      for (let i = 0; i < N; i++) { const p0 = curve(i / N), p1 = curve((i + 1) / N); wire.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z); }
      ex.forEach((e, k) => {
        const u = (k + 1) / (ex.length + 1);
        const p = curve(u);
        p.y -= 0.18;
        const doc = this.thicket.docs.get(e.doc);
        const ai = doc && doc.generated.length;
        const age = (Date.parse(iso) - Date.parse(e.at)) / DAY;
        const g = Math.max(0.35, Math.exp(-age / 20));
        c.copy(ai ? COOL : WARM).multiplyScalar(0.55 + 0.45 * g);
        bp.push(p.x, p.y, p.z); bc.push(c.r, c.g, c.b); bs.push(2.6 + g * 2.6); cs.push(0.55);
        this.bulbRefs.push(e);
      });
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3));
    this.festoon.geometry.dispose();
    this.festoon.geometry = g;
    setPoints(this.bulbs, bp, bc, bs);
    setPoints(this.cores, bp, bc.map(x => Math.min(1, x * 1.4 + 0.25)), cs);
  }

  wireCurve(A, B) {
    const a = new THREE.Vector3(A.pos.x, HOUSE.h * A.sy + 0.9, A.pos.z);
    const b = new THREE.Vector3(B.pos.x, HOUSE.h * B.sy + 0.9, B.pos.z);
    const dir = b.clone().sub(a).setY(0).normalize();
    a.addScaledVector(dir, 2.2); b.addScaledVector(dir, -2.2);
    const L = a.distanceTo(b);
    const sag = Math.min(3.2, 0.55 + L * 0.05);
    return (u) => new THREE.Vector3().lerpVectors(a, b, u).setY(a.y + (b.y - a.y) * u - sag * 4 * u * (1 - u));
  }

  // ---------- movement ----------
  bindInput() {
    const el = this.canvas;
    let down = null;
    el.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY, yaw: this.player.yaw, pitch: this.player.pitch, moved: 0 };
      this.dragging = true;
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!down) { this.hover(e); return; }
      const dx = e.clientX - down.x, dy = e.clientY - down.y;
      down.moved = Math.max(down.moved, Math.hypot(dx, dy));
      if (down.moved > 4) {
        this.glide = null;
        if (this.view.mode === 'walk') {
          this.player.yaw = down.yaw + dx * 0.004;
          this.player.pitch = clamp(down.pitch + dy * 0.003, -0.6, 0.9);
        } else {
          this.aerialYaw = (this.aerialYaw || 0) + (e.movementX || 0) * 0.004;
        }
      }
    });
    el.addEventListener('pointerup', (e) => {
      if (down && down.moved < 6) this.click(e);
      down = null;
      this.dragging = false;
    });
    el.addEventListener('wheel', (e) => {
      if (this.view.mode === 'aerial') this.aerialZoom = clamp((this.aerialZoom || 1) * (1 + e.deltaY * 0.001), 0.45, 1.6);
    }, { passive: true });
    addEventListener('keydown', (e) => {
      // Typing in a field or using a dialog never moves you. A focused button
      // or link (after clicking Above, Lane and so on) only keeps Enter and Space.
      if (document.querySelector('dialog[open]')) return;
      const t = e.target.closest ? e.target : null;
      if (t && t.closest('input, textarea, select, [contenteditable]')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (!MOVE_KEYS.has(k)) return;
      if (k.startsWith('arrow') && t && t.closest('.card, .time')) return;   // arrows still scroll the card and move the slider
      this.keys.add(k);
      if (k.startsWith('arrow')) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    addEventListener('blur', () => this.keys.clear());
  }

  ray(e) {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const rc = new THREE.Raycaster();
    rc.params.Points.threshold = this.view.mode === 'aerial' ? 2.2 : 0.55;
    rc.setFromCamera(ndc, this.camera);
    return rc;
  }

  pick(e) {
    const rc = this.ray(e);
    const hits = [];
    const b = rc.intersectObject(this.cores || new THREE.Object3D());
    if (b.length) hits.push({ d: b[0].distanceToRay * 4 + b[0].distance * 0.0, t: b[0].distance, kind: 'bulb', ref: this.bulbRefs[b[0].index] });
    if (this.windows) {
      const w = rc.intersectObject(this.windows);
      if (w.length && this.windowRefs[w[0].instanceId] && this.windowRefs[w[0].instanceId].id) hits.push({ t: w[0].distance, kind: 'window', ref: this.windowRefs[w[0].instanceId], point: w[0].point });
    }
    const objs = [];
    for (const h of this.houses.values()) if (h.visible) objs.push(...h.group.children);
    const hh = rc.intersectObjects(objs);
    if (hh.length) hits.push({ t: hh[0].distance + 0.01, kind: 'house', ref: hh[0].object.userData.origin, point: hh[0].point });
    const g = rc.intersectObject(this.ground);
    if (g.length) hits.push({ t: g[0].distance + 0.02, kind: 'ground', point: g[0].point });
    hits.sort((a, b) => a.t - b.t);
    // Bulbs are small: prefer one when the pointer is close to it, even if a wall is just behind.
    const bulb = hits.find(x => x.kind === 'bulb');
    return bulb && bulb.t <= (hits[0].t + 2) ? bulb : hits[0];
  }

  hover(e) {
    const hit = this.pick(e);
    this.canvas.style.cursor = hit && hit.kind !== 'ground' ? 'pointer' : (this.view.mode === 'walk' ? 'grab' : 'default');
  }

  click(e) {
    const hit = this.pick(e);
    if (!hit) return;
    if (hit.kind === 'ground') {
      if (this.view.mode === 'walk') this.walkTo(hit.point.x, hit.point.z);
      else this.hooks.onPick && this.hooks.onPick(null);
      return;
    }
    this.hooks.onPick && this.hooks.onPick(hit);
  }

  setMode(mode) {
    this.view.mode = mode;
    this.glide = null;
    this.hooks.onMode && this.hooks.onMode(mode);
  }

  // Glide to a spot, looking at something. Used by clicks, the directory and tours.
  walkTo(x, z, look) {
    const target = { x, z };
    const yaw = look ? Math.atan2(-(look.x - x), -(look.z - z)) : Math.atan2(-(x - this.player.x), -(z - this.player.z));
    if (this.reduced) { Object.assign(this.player, target, { yaw }); this.glide = null; return; }
    const d = Math.hypot(x - this.player.x, z - this.player.z);
    this.glide = { from: { ...this.player }, to: { ...target, yaw, pitch: look && look.y ? clamp(Math.atan2(look.y - EYE, Math.hypot(look.x - x, look.z - z) || 9), -0.2, 0.6) : 0.05 }, start: performance.now(), ms: clamp(d * 70, 500, 4200) };
  }

  houseStand(origin) {
    const h = this.houses.get(origin);
    const fx = Math.sin(h.group.rotation.y), fz = Math.cos(h.group.rotation.y);
    const spot = this.clearSpot(h.pos.x, h.pos.z, fx, fz, [20, 24, 17]);
    return { ...spot, look: { x: h.pos.x, z: h.pos.z, y: 4 } };
  }

  goToHouse(origin) {
    const s = this.houseStand(origin);
    if (this.view.mode !== 'walk') { Object.assign(this.player, { x: s.x, z: s.z }); this.setMode('walk'); }
    this.walkTo(s.x, s.z, s.look);
  }

  goToPair(pair) {
    const A = this.houses.get(pair.a).pos, B = this.houses.get(pair.b).pos;
    const mx = (A.x + B.x) / 2, mz = (A.z + B.z) / 2;
    const dx = B.x - A.x, dz = B.z - A.z, L = Math.hypot(dx, dz) || 1;
    const nx = -dz / L, nz = dx / L;
    // Stand to one side of the string, preferring the side nearer the village centre,
    // on open ground with a clear view of the middle of the string.
    const pref = (mx + nx) * (mx + nx) + (mz + nz) * (mz + nz) < mx * mx + mz * mz ? 1 : -1;
    const spot = this.clearSpot(mx, mz, nx * pref, nz * pref, [15, 19, 12, 23]);
    if (this.view.mode !== 'walk') { Object.assign(this.player, spot); this.setMode('walk'); }
    this.walkTo(spot.x, spot.z, { x: mx, z: mz, y: 4.2 });
  }

  clearSpot(cx, cz, dx, dz, dists) {
    let best = null;
    for (const side of [1, -1]) for (const d of dists) for (const turn of [0, 0.35, -0.35, 0.7, -0.7]) {
      const c = Math.cos(turn), s = Math.sin(turn);
      const ux = (dx * c - dz * s) * side, uz = (dx * s + dz * c) * side;
      const x = cx + ux * d, z = cz + uz * d;
      let room = Infinity, blocked = false;
      for (const h of this.houses.values()) {
        if (!h.visible) continue;
        room = Math.min(room, Math.hypot(h.pos.x - x, h.pos.z - z));
        if (Math.hypot(h.pos.x - cx, h.pos.z - cz) > 1 && segToPoint({ x, z }, { x: cx, z: cz }, h.pos) < 4.5) blocked = true;
      }
      const score = (room >= 9 ? 0 : 50 + (9 - room) * 5) + (blocked ? 30 : 0) + (side < 0 ? 4 : 0) + Math.abs(turn) * 3 + Math.abs(d - 15) * 0.3;
      if (!best || score < best.score) best = { x, z, score };
    }
    return { x: best.x, z: best.z };
  }

  // ---------- frame ----------
  resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = w < 640 ? 72 : 62;
    this.camera.updateProjectionMatrix();
    const scale = h / 2 / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    for (const o of [this.winHalo, this.bulbs, this.cores, this.lanterns]) if (o) o.material.uniforms.scale.value = scale;
    this.pointScale = scale;
  }

  frame() {
    const dt = Math.min(0.05, this.clock.getDelta());
    const now = performance.now();
    if (this.settling) {
      const k = clamp((now - this.settling.start) / this.settling.ms, 0, 1), e = ease(k);
      for (const h of this.houses.values()) {
        if (!h.target) continue;
        h.pos.x = h.from.x + (h.target.x - h.from.x) * e;
        h.pos.z = h.from.z + (h.target.z - h.from.z) * e;
        this.placeHouse(h);
      }
      this.refresh();
      if (k >= 1) { this.settling = null; this.hooks.onSettled && this.hooks.onSettled(); }
    }
    this.move(dt, now);
    this.view.blend += ((this.view.mode === 'aerial' ? 1 : 0) - this.view.blend) * (this.reduced ? 1 : 1 - Math.exp(-dt * 2.2));
    this.scene.fog.density = 0.0105 + (0.0032 - 0.0105) * clamp(this.view.blend, 0, 1);
    const boost = 1 + 1.6 * clamp(this.view.blend, 0, 1);
    for (const o of [this.winHalo, this.bulbs, this.cores, this.lanterns]) if (o) o.material.uniforms.boost.value = boost;
    if (this.view.mode === 'aerial' && !this.reduced && !this.dragging) this.aerialYaw = (this.aerialYaw || 0) + dt * 0.025;
    this.placeCamera();
    this.animateLights(now);
    if (this.windows) this.fadeSigns();
    this.renderer.render(this.scene, this.camera);
    if (this.hooks.onFrame) this.hooks.onFrame(dt);
  }

  move(dt, now) {
    const p = this.player;
    if (this.glide) {
      const g = this.glide, k = clamp((now - g.start) / g.ms, 0, 1), e = ease(k);
      p.x = g.from.x + (g.to.x - g.from.x) * e;
      p.z = g.from.z + (g.to.z - g.from.z) * e;
      p.yaw = g.from.yaw + angleDelta(g.from.yaw, g.to.yaw) * e;
      p.pitch = g.from.pitch + (g.to.pitch - g.from.pitch) * e;
      if (k >= 1) { this.glide = null; this.hooks.onArrive && this.hooks.onArrive(); }
      return;
    }
    if (this.view.mode !== 'walk') return;
    const k = this.keys;
    const fwd = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0);
    const turn = (k.has('arrowleft') ? 1 : 0) - (k.has('arrowright') ? 1 : 0);
    const strafe = (k.has('d') ? 1 : 0) - (k.has('a') ? 1 : 0);
    p.yaw += turn * dt * 1.8;
    const speed = (k.has('shift') ? 16 : 7.5) * dt;
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);   // facing
    const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);    // to the right
    p.x += (fx * fwd + rx * strafe) * speed;
    p.z += (fz * fwd + rz * strafe) * speed;
    // Do not walk through walls.
    for (const h of this.houses.values()) {
      if (!h.visible) continue;
      const dx = p.x - h.pos.x, dz = p.z - h.pos.z, d = Math.hypot(dx, dz), R = 5.4;
      if (d < R && d > 0.001) { p.x = h.pos.x + dx / d * R; p.z = h.pos.z + dz / d * R; }
    }
  }

  placeCamera() {
    const p = this.player, b = ease(clamp(this.view.blend, 0, 1));
    const eye = new THREE.Vector3(p.x, EYE, p.z);
    const dir = new THREE.Vector3(-Math.sin(p.yaw) * Math.cos(p.pitch), Math.sin(p.pitch), -Math.cos(p.yaw) * Math.cos(p.pitch));
    const zoom = this.aerialZoom || 1;
    const ay = this.aerialYaw || 0;
    const R = (this.extent || 120) * zoom * 0.82;
    const air = new THREE.Vector3(Math.sin(ay) * R * 1.25, R * 0.78, Math.cos(ay) * R * 1.25);
    const pos = eye.clone().lerp(air, b);
    const lookFoot = eye.clone().add(dir);
    const lookAir = new THREE.Vector3(Math.sin(ay) * R * 0.12, 0, Math.cos(ay) * R * 0.12);
    this.camera.position.copy(pos);
    this.camera.lookAt(lookFoot.lerp(lookAir, b));
  }

  animateLights(now) {
    if (!this.windows || !this.flickers || this.reduced) return;
    const c = new THREE.Color();
    const hc = this.winHalo.geometry.attributes.color;
    for (const f of this.flickers) {
      const ph = (now / 1000 + f.seed) % 9;
      // A revised window catches every few seconds: a short double flicker.
      const on = ph < 0.08 || (ph > 0.16 && ph < 0.22) ? 0.25 : 1;
      c.copy(f.base).multiplyScalar(on);
      this.windows.setColorAt(f.w, c);
      hc.setXYZ(f.w, c.r, c.g, c.b);
    }
    this.windows.instanceColor.needsUpdate = true;
    hc.needsUpdate = true;
  }

  fadeSigns() {
    const p = this.player, aerial = this.view.blend > 0.5;
    for (const h of this.houses.values()) {
      const d = Math.hypot(p.x - h.pos.x, p.z - h.pos.z);
      const o = aerial ? 0.0 : clamp(1.4 - d / 30, 0, 1);
      h.sign.material.opacity = o;
    }
  }

  nearest(radius) {
    let best = null;
    for (const h of this.houses.values()) {
      if (!h.visible) continue;
      const d = Math.hypot(this.player.x - h.pos.x, this.player.z - h.pos.z);
      if (d < radius && (!best || d < best.d)) best = { d, origin: h.site.origin };
    }
    return best;
  }

  setExtent() {
    let m = 40;
    for (const h of this.houses.values()) m = Math.max(m, Math.abs(h.pos.x), Math.abs(h.pos.z));
    this.extent = m * 1.05;
  }
}

// ---------- helpers ----------
function glowPoints(pos, col, size, { fixedSize = false, fog = true, core = false } = {}) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('size', new THREE.BufferAttribute(size, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { boost: { value: 1 }, scale: { value: 600 }, uFixed: { value: fixedSize ? 1 : 0 }, core: { value: core ? 1 : 0 } },
    vertexShader: `attribute float size; attribute vec3 color; varying vec3 vColor; varying float vFade; uniform float scale; uniform float uFixed; uniform float boost;
      void main(){ vColor = color; vec4 mv = modelViewMatrix * vec4(position,1.0);
        float d = -mv.z; vFade = ${fog ? 'clamp(1.6 - d/260.0, 0.15, 1.0)' : '1.0'};
        gl_PointSize = uFixed > 0.5 ? size : min(size * scale / max(d, 0.5) * 0.55 * boost, 90.0);
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying vec3 vColor; varying float vFade; uniform float core;
      void main(){ vec2 p = gl_PointCoord - 0.5; float r = length(p)*2.0; if (r>1.0) discard;
        float a = core > 0.5 ? smoothstep(1.0, 0.55, r) : pow(1.0 - r, 2.2) * 0.85;
        gl_FragColor = vec4(vColor * a * vFade, a); }`,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  return pts;
}

function setPoints(points, pos, col, size) {
  const g = points.geometry;
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos.length ? pos : [0, -99, 0], 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col.length ? col : [0, 0, 0], 3));
  g.setAttribute('size', new THREE.Float32BufferAttribute(size.length ? size : [0], 1));
  g.computeBoundingSphere();
}

function gableGeometry(w, h, d) {
  const x = w / 2, z = d / 2;
  const v = [
    -x, 0, z, x, 0, z, 0, h, z,          // front gable
    x, 0, -z, -x, 0, -z, 0, h, -z,       // back gable
    -x, 0, z, 0, h, z, 0, h, -z, -x, 0, z, 0, h, -z, -x, 0, -z, // left slope
    x, 0, z, x, 0, -z, 0, h, -z, x, 0, z, 0, h, -z, 0, h, z,    // right slope
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

function radialTexture(color, core) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, color); g.addColorStop(core || 0.01, color);
  g.addColorStop(0.35, color + '55'); g.addColorStop(1, color + '00');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function windowTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 80;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 46, 4, 32, 40, 46);
  g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#b9b0a0');
  x.fillStyle = g; x.fillRect(0, 0, 64, 80);
  x.fillStyle = '#1a1410';
  x.fillRect(0, 0, 64, 5); x.fillRect(0, 75, 64, 5); x.fillRect(0, 0, 5, 80); x.fillRect(59, 0, 5, 80);
  x.fillRect(30, 0, 4, 80); x.fillRect(0, 36, 64, 4);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function shutterTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 80;
  const x = c.getContext('2d');
  x.fillStyle = '#9aa2b4'; x.fillRect(0, 0, 64, 80);
  x.fillStyle = '#3a4050';
  for (let y = 4; y < 80; y += 8) x.fillRect(3, y, 58, 3);
  x.fillRect(30, 0, 4, 80);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function noiseTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d'), r = rng(3), img = x.createImageData(128, 128);
  for (let i = 0; i < 128 * 128; i++) { const v = 170 + r() * 85; img.data.set([v, v, v, 255], i * 4); }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function textSprite(title, sub) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 220;
  const x = c.getContext('2d');
  x.textAlign = 'center';
  x.shadowColor = 'rgba(0,0,0,0.9)'; x.shadowBlur = 18;
  x.fillStyle = '#f4ead8';
  x.font = '600 64px "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif';
  x.fillText(fit(x, title, 980), 512, 92);
  if (sub) {
    x.fillStyle = '#b8c1d6';
    x.font = 'italic 44px "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif';
    x.fillText(fit(x, sub, 900), 512, 160);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, opacity: 0 }));
  s.scale.set(9.5, 2.05, 1);
  return s;
}

function fit(ctx, text, w) {
  if (ctx.measureText(text).width <= w) return text;
  let t = text;
  while (t.length > 3 && ctx.measureText(t + '…').width > w) t = t.slice(0, -1);
  return t + '…';
}

function segToPoint(a, b, p) {
  const vx = b.x - a.x, vz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.z - a.z) * vz) / (vx * vx + vz * vz || 1)));
  return Math.hypot(p.x - (a.x + vx * t), p.z - (a.z + vz * t));
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function ease(k) { return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; }
function angleDelta(a, b) { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; }
