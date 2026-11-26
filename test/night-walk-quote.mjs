import { strict as assert } from 'node:assert';
import test from 'node:test';
import { quoteProofUrl } from '../night-walk/src/quote-proof.js';
import { Thicket } from '../night-walk/src/thicket.js';

const source = 'https://source.example/community/blyg/';
const reply = 'https://reply.example/blyg/';
const sourceId = '01jgbbjax9769h8pagjyt3vg4p';
const replyId = '01jgbbjax9769h8pagjyt3vg4q';
const now = '2026-11-26T00:00:00.000Z';

test('a loaded exchange carries the quoted edition, even when the source has a newer current item', async (t) => {
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => null },
  });
  t.after(() => {
    if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor);
    else delete globalThis.localStorage;
  });
  const thicket = new Thicket();
  const replySite = { origin: reply, itemTemplate: 'items/{id}.json' };
  thicket.sites.set(reply, replySite);
  thicket.sites.set(source, { origin: source, items: [{ id: sourceId, version: 5 }] });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (address) => {
    assert.equal(address, new URL(`items/${replyId}.json`, reply).href);
    return { ok: true, json: async () => ({
      origin: reply, id: replyId, version: 4, created: now, updated: now,
      transclusions: [{ origin: source, id: sourceId, version: 2, cited: {
        excerpt: 'They close at five.',
        url: 'https://elsewhere.example/current',
      } }],
    }) };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  await thicket.loadItem(replySite, { id: replyId, updated: now });
  assert.equal(thicket.exchanges.length, 1);
  const exchange = thicket.exchanges[0];
  assert.equal(thicket.currentVersion(exchange.to, sourceId).version, 5);
  const url = new URL(quoteProofUrl(exchange.quote));
  assert.equal(url.origin, 'https://fishbiscuit.me');
  assert.equal(url.pathname, '/blyggdrasil/verify/');
  assert.deepEqual(Object.fromEntries(url.searchParams), { origin: source, id: sourceId, version: '2' });
});

test('an incomplete quote cannot claim a verification link to any edition', () => {
  const valid = { origin: source, id: sourceId, version: 2 };
  for (const invalid of [
    { version: null },
    { version: '2' },
    { version: 0 },
    { version: 1.5 },
    { id: 'latest' },
    { origin: source + '?version=2' },
    { origin: 'https://secret@source.example/blyg/' },
  ]) {
    assert.equal(quoteProofUrl({ ...valid, ...invalid, url: source + 'latest/' }), null);
  }
});
