import { Thicket, hostOf, ITEMS_PER_SITE } from './thicket.js';
import { World } from './world.js';
import { ringLayout, neighbourLayout, lanes, segDist } from './layout.js';

const $ = (s) => document.querySelector(s);
let START = Date.parse('2026-09-01T00:00:00Z');
const NOW = Date.now();
const fmtDay = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const fmtShort = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

let world = null;
let thicket = null;
let time = NOW;
let settled = false;
let started = false;
let tour = null;

// ---------- loading ----------
thicket = new Thicket(onData);
thicket.load().catch((e) => {
  $('#progress').textContent = 'Could not reach the Blygger directory. ' + (e && e.message ? e.message : '');
});
const settleTimer = setTimeout(() => settleVillage(), 24000);

let refreshQueued = false;
function onData(kind) {
  const p = thicket.progress;
  if (kind === 'sites') {
    world = new World($('#world'), { onPick, onMode, onFrame, onArrive });
    world.setSites(thicket.sites, ringLayout(thicket.sites.keys()));
    world.setData(thicket);
    world.setExtent();
    world.setMode('aerial');
    buildLane();
  }
  if (p.phase === 'doors') $('#progress').textContent = `Knocking on ${p.sites} doors… ${p.answered + p.closed} answered`;
  if (p.phase === 'items') $('#progress').textContent = `${p.answered} of ${p.sites} blygs open their doors to a browser. Reading their recent posts… ${p.itemsDone} of ${p.items}`;
  if (kind === 'done') {
    $('#progress').textContent = `${p.answered} of ${p.sites} blygs read live · ${thicket.docs.size} recent posts · ${thicket.exchanges.length} quotes between blygs`;
    settleVillage();
  }
  if (world && !refreshQueued) {
    refreshQueued = true;
    requestAnimationFrame(() => { refreshQueued = false; world.refresh(); });
  }
}

function settleVillage() {
  if (settled || !world) return;
  settled = true;
  clearTimeout(settleTimer);
  const start = new Map([...world.houses].map(([o, h]) => [o, { ...h.pos }]));
  const pos = neighbourLayout(thicket.sites.keys(), thicket.pairs, start);
  world.settle(pos);
  world.hooks.onSettled = () => {
    world.setExtent();
    world.setLanes(lanes(new Map([...world.houses].map(([o, h]) => [o, h.pos])), thicket.pairs));
    world.plantThicket();
    world.refresh();
    $('#startBtn').disabled = false;
    $('#startBtn').focus({ preventScroll: true });
    $('#sourceNote').textContent = `Read ${fmtDay.format(NOW)}: ${thicket.progress.answered} of ${thicket.progress.sites} listed blygs answered; up to ${ITEMS_PER_SITE} recent posts each since September.`;
  };
}

// ---------- start ----------
$('#startBtn').addEventListener('click', start);
$('#aboutBtn').addEventListener('click', () => $('#key').showModal());

function start() {
  if (started) return;
  started = true;
  $('#intro').classList.add('leaving');
  setTimeout(() => $('#intro').hidden = true, 900);
  for (const el of ['.bar', '.time', '#overheard', '#hint']) $(el).hidden = false;
  setTimeout(() => { $('#hint').style.opacity = 0; }, 9000);
  setupScrubber();
  // A shared link can name a house: #blyg=host/path
  const wanted = new URLSearchParams(location.hash.slice(1)).get('blyg');
  const home = wanted && [...thicket.sites.keys()].find(o => hostOf(o) === wanted.replace(/\/$/, ''));
  if (home) { world.goToHouse(home); showHouse(home); return; }
  // Otherwise begin beside the most recent conversation on the lane.
  const byTime = [...thicket.exchanges].sort((a, b) => b.at.localeCompare(a.at));
  const latest = byTime.find(e => thicket.siteName(e.from) !== thicket.siteName(e.to)) || byTime[0];
  if (latest) { world.goToPair(pairOf(latest)); focus = { pair: pairOf(latest), first: latest }; } else world.setMode('walk');
}

function pairOf(ex) {
  const [a, b] = [ex.from, ex.to].sort();
  return thicket.pairs.get(a + '|' + b);
}

// ---------- views ----------
$('#viewToggle').addEventListener('click', () => {
  if (world.view.mode === 'walk') world.setMode('aerial');
  else { world.setMode('walk'); }
});
function onMode(mode) {
  $('#viewToggle').textContent = mode === 'walk' ? 'Above' : 'On foot';
  if (mode === 'aerial') $('#overheard').replaceChildren();
}

// ---------- time ----------
function setupScrubber() {
  // The replay begins the day before the first blyg was listed.
  const first = Math.min(...[...thicket.sites.values()].map(x => x.listedAt ? Date.parse(x.listedAt) : Infinity));
  if (isFinite(first)) START = first - 86400000;
  const s = $('#scrub');
  s.min = START; s.max = NOW; s.step = 3600000; s.value = NOW;
  s.addEventListener('input', () => { stopPlay(); setTime(Number(s.value)); });
  setTime(NOW);
}
function setTime(t) {
  time = t;
  $('#scrub').value = t;
  $('#when').value = NOW - t < 3600000 * 2 ? 'Tonight' : fmtShort.format(t);
  world.setTime(t);
  lastOverheard = '';
}
let play = null;
$('#playBtn').addEventListener('click', () => {
  if (play) return stopPlay();
  const from = NOW - time < 3600000 * 2 ? START : time;
  const ms = 18000 * (NOW - from) / (NOW - START);
  play = { from, start: performance.now(), ms: Math.max(1000, ms) };
  $('#playBtn').textContent = '❚❚';
  $('#playBtn').setAttribute('aria-label', 'Pause');
  if (world.view.mode === 'walk') world.setMode('aerial');
});
function stopPlay() {
  play = null;
  $('#playBtn').textContent = '▶';
  $('#playBtn').setAttribute('aria-label', 'Replay the thicket from September');
}

// ---------- every frame ----------
let acc = 0;
function onFrame(dt) {
  if (play) {
    const k = Math.min(1, (performance.now() - play.start) / play.ms);
    setTime(play.from + (NOW - play.from) * k);
    if (k >= 1) stopPlay();
  }
  acc += dt;
  if (acc > 0.4 && started) { acc = 0; overhear(); }
}

// ---------- overhearing ----------
let lastOverheard = '';
let focus = null;   // a string the visitor chose; overheard lines stay with it while they are near
let queue = [];
let qi = 0;
let lineTimer = 0;

function overhear() {
  if (world.view.mode !== 'walk') return;
  const p = world.player;
  const iso = new Date(time).toISOString();
  let best = null;
  if (focus) {
    const A = world.houses.get(focus.pair.a).pos, B = world.houses.get(focus.pair.b).pos;
    if (world.glide || segDist(p, A, B) < 26) {
      const ex = focus.pair.exchanges.filter(e => e.at <= iso).sort((a, b) => b.at.localeCompare(a.at));
      const first = ex.indexOf(focus.first);
      if (first > 0) ex.unshift(...ex.splice(first, 1));
      best = { kind: 'pair', key: 'focus' + focus.pair.a + focus.pair.b + (focus.first ? focus.first.doc : ''), items: ex };
    } else focus = null;
  }
  if (!best) for (const v of world.visiblePairs || []) {
    const A = world.houses.get(v.pair.a).pos, B = world.houses.get(v.pair.b).pos;
    const d = segDist(p, A, B);
    if (d < 9 && (!best || d < best.d)) best = { d, kind: 'pair', key: v.pair.a + '|' + v.pair.b, items: v.ex.slice().reverse() };
  }
  if (!best) {
    const near = world.nearest(15);
    if (near) {
      const docs = [...thicket.docs.values()].filter(d => d.origin === near.origin && d.created <= iso && d.text)
        .sort((a, b) => b.created.localeCompare(a.created)).slice(0, 6);
      if (docs.length) best = { kind: 'house', key: near.origin, items: docs };
    }
  }
  const key = best ? best.kind + best.key : '';
  if (key !== lastOverheard) {
    lastOverheard = key;
    queue = best ? best.items : [];
    qi = 0; lineTimer = 0;
    if (!best) { $('#overheard').replaceChildren(); return; }
  }
  if (!queue.length) return;
  lineTimer -= 0.4;
  if (lineTimer <= 0) {
    say(best.kind, queue[qi % queue.length]);
    qi++;
    lineTimer = best.kind === 'pair' ? 8 : 6;
  }
}

function say(kind, item) {
  const box = $('#overheard');
  box.replaceChildren();
  if (kind === 'pair') {
    const e = item, doc = thicket.docs.get(e.doc);
    const q = e.quote;
    const [fromName, toName] = names(e.from, e.to);
    const where = el('p', 'where', `${fromName} quoting ${toName} · ${fmtDay.format(Date.parse(e.at))}`);
    box.append(where);
    box.append(line(q.author || thicket.siteName(e.to), quotedWords(q), q.url || e.to, true));
    if (doc && doc.text) box.append(line(doc.author || thicket.siteName(e.from), clip(doc.text, 190), doc.page, false));
  } else {
    const d = item;
    box.append(el('p', 'where', `Outside ${thicket.sites.get(d.origin).title} · ${fmtDay.format(Date.parse(d.created))}`));
    box.append(line(d.author || thicket.siteName(d.origin), clip(d.text, 220), d.page, false));
  }
}

function line(who, words, href, quoted) {
  const p = el('p', 'line' + (quoted ? ' quoted' : ''));
  p.append(el('span', 'who', who));
  const a = document.createElement('a');
  a.href = href || '#'; a.target = '_blank'; a.rel = 'noopener';
  const q = document.createElement('q'); q.textContent = words;
  a.append(q);
  p.append(a);
  return p;
}

// ---------- picking and cards ----------
function onPick(hit) {
  if (!hit) return hideCard();
  if (hit.kind === 'bulb') showExchange(hit.ref);
  else if (hit.kind === 'window') showPost(hit.ref.origin, hit.ref.id);
  else if (hit.kind === 'house') showHouse(hit.ref);
}

function card(nodes) {
  $('#hint').hidden = true;
  const c = $('#card');
  c.querySelector('.card-body').replaceChildren(...nodes);
  c.hidden = false;
  document.body.classList.add('card-open');
}
function hideCard() { $('#card').hidden = true; document.body.classList.remove('card-open'); }
$('#card .close').addEventListener('click', hideCard);
addEventListener('keydown', (e) => { if (e.key === 'Escape') { hideCard(); stopTour(); } });

function showExchange(e) {
  const doc = thicket.docs.get(e.doc);
  const q = e.quote;
  focus = { pair: pairOf(e), first: e };
  const [fromName, toName] = names(e.from, e.to);
  const nodes = [
    el('h3', '', `${fromName} quoting ${toName}`),
    el('p', 'meta', fmtDay.format(Date.parse(e.at))),
  ];
  const bq = document.createElement('blockquote');
  bq.append(text(quotedWords(q)));
  bq.append(el('cite', '', `${q.author || thicket.siteName(e.to)}${q.version ? ' · as quoted, version ' + q.version : ''}`));
  nodes.push(bq);
  const cur = thicket.currentVersion(e.to, q.id);
  if (cur && cur.withdrawn) nodes.push(el('p', 'changed', 'The quoted post has since been withdrawn by its publisher. The quote keeps the words as they were published.'));
  else if (cur && q.version && cur.version > q.version) nodes.push(el('p', 'changed', `The quoted post has been revised since: it is now version ${cur.version}. The quote keeps version ${q.version}.`));
  if (doc) {
    if (doc.text) nodes.push(el('p', 'words', clip(doc.text, 600)));
    nodes.push(tags(doc));
  }
  const links = el('div', 'links');
  if (q.url) links.append(link(q.url, `Open the quoted post ↗`));
  if (doc && doc.page) links.append(link(doc.page, `Open the reply ↗`));
  nodes.push(links);
  const acts = el('div', 'actions');
  acts.append(button('Walk to this string', () => world.goToPair(pairOf(e))));
  acts.append(button(`Visit ${thicket.siteName(e.from)}`, () => world.goToHouse(e.from)));
  nodes.push(acts);
  card(nodes);
}

function showPost(origin, id) {
  const site = thicket.sites.get(origin);
  const doc = thicket.docs.get(origin + '|' + id);
  const it = site.items.find(i => i.id === id);
  const nodes = [el('h3', '', site.title), el('p', 'meta', `${doc && doc.author ? doc.author + ' · ' : ''}${it ? fmtDay.format(Date.parse(it.created)) : ''}${it ? ' · ' + (it.kind === 'fragment' ? 'fragment' : 'thread') : ''}`)];
  if (doc) {
    for (const q of doc.quotes.filter(q => q.excerpt)) {
      const bq = document.createElement('blockquote');
      bq.append(text(q.excerpt));
      bq.append(el('cite', '', `${q.author || thicket.siteName(q.origin)}${q.version ? ' · version ' + q.version : ''}`));
      nodes.push(bq);
    }
    if (doc.text) nodes.push(el('p', 'words', clip(doc.text, 700)));
    nodes.push(tags(doc));
    if (doc.changelog.length > 1) {
      nodes.push(el('h4', '', 'Changelog'));
      const ol = document.createElement('ol');
      for (const c of doc.changelog) ol.append(el('li', '', `Version ${c.version} · ${fmtDay.format(Date.parse(c.at))}${c.note ? ' · ' + c.note : ''}`));
      nodes.push(ol);
    }
    const links = el('div', 'links');
    if (doc.page) links.append(link(doc.page, 'Open the post ↗'));
    nodes.push(links);
  } else {
    nodes.push(el('p', 'words', `An older post${it && it.version > 1 ? ', revised to version ' + it.version : ''}. Night Walk reads each blyg's most recent posts since September.`));
    const links = el('div', 'links');
    links.append(link(site.home, `Visit ${hostOf(origin)} ↗`));
    nodes.push(links);
  }
  card(nodes);
}

function showHouse(origin) {
  const site = thicket.sites.get(origin);
  try { history.replaceState(null, '', '#blyg=' + hostOf(origin)); } catch { /* sandboxed */ }
  const nodes = [el('h3', '', site.title), el('p', 'meta', [site.author, hostOf(origin)].filter(Boolean).join(' · '))];
  if (site.status !== 'ok') nodes.push(el('p', 'words', 'This blyg does not let browsers read it directly, so its windows stay dark. Quotes from its neighbours still reach its door.'));
  const facts = [];
  if (site.listedAt) facts.push(`Listed ${fmtDay.format(Date.parse(site.listedAt))}`);
  if (site.generator) facts.push(`Published with ${site.generator}`);
  if (facts.length) nodes.push(el('p', 'meta', facts.join(' · ')));
  const iso = new Date(time).toISOString();
  const docs = [...thicket.docs.values()].filter(d => d.origin === origin && d.created <= iso).sort((a, b) => b.created.localeCompare(a.created)).slice(0, 5);
  if (docs.length) {
    nodes.push(el('h4', '', 'Recent posts'));
    const ol = document.createElement('ol');
    for (const d of docs) {
      const li = document.createElement('li');
      li.append(link(d.page, clip(d.text || 'A post', 90)), text(' · ' + fmtDay.format(Date.parse(d.created))));
      ol.append(li);
    }
    nodes.push(ol);
  }
  const neighbours = [...thicket.pairs.values()].filter(p => (p.a === origin || p.b === origin) && p.exchanges.some(e => e.at <= iso));
  if (neighbours.length) {
    nodes.push(el('h4', '', 'Neighbours they talk with'));
    const acts = el('div', 'actions');
    for (const p of neighbours.sort((x, y) => thicket.siteName(x.a === origin ? x.b : x.a).localeCompare(thicket.siteName(y.a === origin ? y.b : y.a)))) {
      const other = p.a === origin ? p.b : p.a;
      acts.append(button(thicket.siteName(other), () => world.goToPair(p)));
    }
    nodes.push(acts);
  }
  const links = el('div', 'links');
  links.append(link(site.home, `Visit ${hostOf(origin)} ↗`));
  nodes.push(links);
  const acts = el('div', 'actions');
  acts.append(button('Walk to the door', () => world.goToHouse(origin)));
  nodes.push(acts);
  card(nodes);
}

function tags(doc) {
  const t = el('div', '');
  if (doc.generated.length) t.append(el('span', 'tag ai', 'AI-generated passage · ' + [...new Set(doc.generated)].join(', ')));
  if (doc.changelog.length > 1) t.append(el('span', 'tag rev', `Revised · version ${doc.version}`));
  if (doc.stub) t.append(el('span', 'tag', 'Stub of another post'));
  if (doc.media) t.append(el('span', 'tag', doc.media === 1 ? '1 image' : doc.media + ' images'));
  return t;
}

// ---------- the lane (directory) ----------
function buildLane() {
  const list = $('#laneList');
  const sites = [...thicket.sites.values()].sort((a, b) => (a.listedAt || '').localeCompare(b.listedAt || ''));
  list.replaceChildren(...sites.map(s => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.append(el('span', 't', s.title), el('span', 's', [s.author, hostOf(s.origin), s.listedAt ? 'joined ' + fmtDay.format(Date.parse(s.listedAt)) : ''].filter(Boolean).join(' · ')));
    b.addEventListener('click', () => { $('#lane').close(); if (!started) start(); world.goToHouse(s.origin); showHouse(s.origin); });
    li.append(b);
    return li;
  }));
}
$('#laneBtn').addEventListener('click', () => { buildLane(); $('#lane').showModal(); });
$('#keyBtn').addEventListener('click', () => $('#key').showModal());

// ---------- find a conversation ----------
let found = [];
$('#findBtn').addEventListener('click', () => { $('#find').showModal(); $('#findInput').focus(); });
$('#findInput').addEventListener('input', () => {
  const q = $('#findInput').value.trim().toLowerCase();
  const list = $('#findList');
  found = [];
  if (q.length >= 2) {
    for (const e of thicket.exchanges) {
      const doc = thicket.docs.get(e.doc);
      const hay = [e.quote.excerpt, doc && doc.text, thicket.siteName(e.from), thicket.siteName(e.to)].join(' ').toLowerCase();
      if (hay.includes(q)) found.push(e);
    }
    found.sort((a, b) => a.at.localeCompare(b.at));
  }
  $('#tourBtn').disabled = found.length < 2;
  list.replaceChildren(...found.slice(0, 40).map(e => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    const doc = thicket.docs.get(e.doc);
    b.append(el('span', 'q', `“${clip(e.quote.excerpt || (doc && doc.text) || '', 140)}”`),
      el('span', 's', `${names(e.from, e.to).join(' quoting ')} · ${fmtDay.format(Date.parse(e.at))}`));
    b.addEventListener('click', () => { $('#find').close(); if (!started) start(); jumpToNow(); world.goToPair(pairOf(e)); showExchange(e); });
    li.append(b);
    return li;
  }));
});
$('#tourBtn').addEventListener('click', () => {
  $('#find').close();
  if (!started) start();
  jumpToNow();
  tour = { list: found.slice(0, 12), i: 0 };
  nextStop();
});
function nextStop() {
  if (!tour) return;
  if (tour.i >= tour.list.length) return stopTour();
  const e = tour.list[tour.i++];
  world.goToPair(pairOf(e));
  showExchange(e);
  tour.timer = setTimeout(nextStop, 9000);
}
function stopTour() { if (tour) { clearTimeout(tour.timer); tour = null; } }
function onArrive() {}
function jumpToNow() { if (time !== NOW) setTime(NOW); }

// The words a quote carried. Some quotes carry no excerpt; then use the quoted
// post itself, but only when it is still the exact version that was quoted.
function quotedWords(q) {
  if (q.excerpt) return q.excerpt;
  const src = thicket.docs.get(q.origin + '|' + q.id);
  if (src && src.text && (!q.version || src.version === q.version)) return clip(src.text, 160);
  return 'A post on ' + hostOf(q.origin);
}

// One person can keep two blygs; then name the blygs, not the person twice.
function names(a, b) {
  const x = thicket.siteName(a), y = thicket.siteName(b);
  return x === y ? [thicket.sites.get(a).title, thicket.sites.get(b).title] : [x, y];
}

// ---------- small DOM helpers ----------
function el(tag, cls, txt) { const n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; }
function text(t) { return document.createTextNode(t); }
function link(href, label) { if (!href) return el('span', '', label.replace(/ ↗$/, '')); const a = document.createElement('a'); a.href = href; a.target = '_blank'; a.rel = 'noopener'; a.textContent = label; return a; }
function button(label, fn) { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.addEventListener('click', fn); return b; }
function clip(s, n) { s = (s || '').trim(); return s.length > n ? s.slice(0, n).replace(/\s+\S*$/, '') + '…' : s; }

// Read-only handle for inspection in the browser console.
window.nightWalk = { get world() { return world; }, get thicket() { return thicket; } };
