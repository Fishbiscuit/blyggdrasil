// Reads the public Blygger thicket live from each publisher.
// Nothing is stored on a server: the directory, manifests, indexes and items
// are fetched by the visitor's browser and kept only in memory (plus an
// optional local cache in that browser).

const DIRECTORY = 'https://blygger.com/blygs.json';
const SINCE = '2026-09-01T00:00:00Z';   // Blygger's public launch month
export const ITEMS_PER_SITE = 24;              // most recent items read per blyg
const BURST_MS = 15 * 60 * 1000;        // spec §13.7 burst window
const CACHE_KEY = 'night-walk-items-v1';

export class Thicket {
  constructor(onChange) {
    this.sites = new Map();      // origin -> site
    this.docs = new Map();       // origin|id -> doc
    this.pairs = new Map();      // a|b -> { a, b, exchanges: [] }
    this.exchanges = [];
    this.onChange = onChange || (() => {});
    this.progress = { sites: 0, answered: 0, closed: 0, items: 0, itemsDone: 0, phase: 'directory' };
    this.cache = loadCache();
  }

  async load() {
    const dir = await getJSON(DIRECTORY);
    const list = dir.blygs || [];
    this.directoryGenerated = dir.generated || null;
    for (const b of list) {
      const origin = normOrigin(b.origin);
      this.sites.set(origin, {
        origin, title: b.title || hostOf(origin), home: b.home || origin,
        listedAt: b.listedAt || null, generator: (b.generator || '').split('/')[0],
        author: null, status: 'pending', items: [], bursts: [], itemTemplate: 'items/{id}.json',
      });
    }
    this.progress.sites = this.sites.size;
    this.progress.phase = 'doors';
    this.emit('sites');

    const queue = new Pool(12);
    await Promise.all([...this.sites.values()].map(site => queue.run(() => this.loadSite(site))));
    this.progress.phase = 'items';
    this.emit('indexes');

    // Interleave sites so requests spread across publishers instead of queueing on one host.
    const perSite = [];
    for (const site of this.sites.values()) {
      if (site.status !== 'ok') continue;
      const recent = site.items
        .filter(i => i.kind !== 'withdrawn' && i.created >= SINCE)
        .sort((x, y) => y.updated.localeCompare(x.updated))
        .slice(0, ITEMS_PER_SITE);
      perSite.push(recent.map(it => [site, it]));
    }
    const jobs = [];
    for (let k = 0; k < ITEMS_PER_SITE; k++) for (const list of perSite) if (list[k]) jobs.push(list[k]);
    const items = new Pool(28);
    this.progress.items = jobs.length;
    let pending = 0;
    await Promise.all(jobs.map(([site, it]) => items.run(async () => {
      await this.loadItem(site, it);
      this.progress.itemsDone++;
      if (++pending % 25 === 0) this.emit('items');
    })));
    saveCache(this.cache);
    this.progress.phase = 'done';
    this.emit('done');
  }

  async loadSite(site) {
    try {
      const m = await getJSON(new URL('blyg.json', site.origin).href);
      site.author = (m.author && m.author.name) || null;
      site.title = m.title || site.title;
      if (m.item) site.itemTemplate = m.item;
      const ix = await getJSON(new URL(m.items || 'items/index.json', site.origin).href);
      site.items = (ix.items || []).map(i => ({
        id: i.id, kind: i.kind, created: i.created || i.updated, updated: i.updated || i.created,
        version: i.version || 1,
      })).filter(i => i.id && i.created);
      site.items.sort((a, b) => a.created.localeCompare(b.created));
      site.bursts = findBursts(site.items);
      site.status = 'ok';
      this.progress.answered++;
    } catch (e) {
      site.status = 'closed';
      this.progress.closed++;
    }
    this.emit('site', site);
  }

  async loadItem(site, it) {
    const key = site.origin + '|' + it.id;
    const cached = this.cache[key];
    let doc = cached && cached.updated === it.updated ? cached : null;
    if (!doc) {
      try {
        const url = new URL(site.itemTemplate.replace('{id}', it.id), site.origin).href;
        doc = compactDoc(await getJSON(url), site);
        this.cache[key] = doc;
      } catch { return; }
    }
    this.addDoc(doc);
  }

  addDoc(doc) {
    const key = doc.origin + '|' + doc.id;
    if (this.docs.has(key)) return;
    this.docs.set(key, doc);
    for (const q of doc.quotes) {
      if (q.origin === doc.origin) continue;
      if (!this.sites.has(q.origin)) continue;
      const ex = { from: doc.origin, to: q.origin, at: doc.created, doc: key, quote: q };
      this.exchanges.push(ex);
      const [a, b] = [doc.origin, q.origin].sort();
      const pk = a + '|' + b;
      if (!this.pairs.has(pk)) this.pairs.set(pk, { a, b, exchanges: [] });
      this.pairs.get(pk).exchanges.push(ex);
    }
  }

  // The current version of an item as its own publisher reports it.
  currentVersion(origin, id) {
    const site = this.sites.get(origin);
    const it = site && site.items.find(i => i.id === id);
    return it ? { version: it.version, withdrawn: it.kind === 'withdrawn' } : null;
  }

  siteName(origin) {
    const s = this.sites.get(origin);
    return s ? (s.author || s.title) : hostOf(origin);
  }

  emit(kind, data) { this.onChange(kind, data); }
}

function compactDoc(d, site) {
  const origin = normOrigin(d.origin || site.origin);
  const quotes = [];
  for (const t of (d.transclusions || [])) {
    const c = t.cited || {};
    quotes.push({
      origin: normOrigin(t.origin || origin), id: t.id, version: t.version || null,
      excerpt: cleanExcerpt(c.excerpt || ''), url: c.url || null, author: c.author || null, source: c.source || null,
    });
  }
  if (d.stub_of && !quotes.some(q => q.id === d.stub_of.id)) {
    const c = d.stub_of.cited || {};
    quotes.push({ origin: normOrigin(d.stub_of.origin || origin), id: d.stub_of.id, version: d.stub_of.version || null,
      excerpt: cleanExcerpt(c.excerpt || ''), url: c.url || null, author: c.author || null, source: c.source || null });
  }
  return {
    origin, id: d.id, kind: d.kind, created: d.created, updated: d.updated, version: d.version || 1,
    page: d.page ? new URL(d.page, origin).href : null,
    author: (d.author && d.author.name) || site.author || null,
    text: ownWords(d.content_md || ''),
    quotes,
    stub: !!d.stub_of,
    generated: (d.generated || []).map(g => g.model || 'unnamed model'),
    changelog: (d.changelog || []).map(c => ({ version: c.version, at: c.at, note: c.note || null })),
    media: (d.media || []).length,
  };
}

// The author's own words: drop transclusion directives, markup and links.
export function ownWords(md) {
  return md
    .replace(/!\[\[[^\]]*\]\]/g, ' ')
    .replace(/\[\[([^\]|]*)\|?([^\]]*)\]\]/g, (_, a, b) => b || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\{\{[^}]*\}\}/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^#+\s*/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/[*_`~]+/g, '')
    .replace(/^\s*[-+]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1200);
}

function cleanExcerpt(s) { return s.replace(/\s+/g, ' ').trim(); }

function findBursts(items) {
  // A thread plus fragments first published within the burst window.
  const bursts = [];
  const sorted = items.filter(i => i.kind !== 'withdrawn');
  for (let i = 0; i < sorted.length; i++) {
    const start = Date.parse(sorted[i].created);
    let j = i;
    while (j + 1 < sorted.length && Date.parse(sorted[j + 1].created) - start <= BURST_MS) j++;
    if (j > i) {
      const group = sorted.slice(i, j + 1);
      if (group.some(g => g.kind === 'thread')) bursts.push({ at: group[0].created, size: group.length, ids: group.map(g => g.id) });
      i = j;
    }
  }
  return bursts;
}

export function hostOf(origin) {
  try { const u = new URL(origin); return (u.host + u.pathname).replace(/\/$/, ''); } catch { return origin; }
}

function normOrigin(o) { return o && !o.endsWith('/') ? o + '/' : o; }

async function getJSON(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, credentials: 'omit' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(timer); }
}

class Pool {
  constructor(n) { this.n = n; this.active = 0; this.queue = []; }
  run(fn) {
    return new Promise((resolve) => {
      const go = async () => {
        this.active++;
        try { resolve(await fn()); } catch { resolve(); }
        finally { this.active--; const next = this.queue.shift(); if (next) next(); }
      };
      this.active < this.n ? go() : this.queue.push(go);
    });
  }
}

function loadCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') || {}; } catch { return {}; }
}
function saveCache(c) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch { /* full or blocked: fine */ }
}
