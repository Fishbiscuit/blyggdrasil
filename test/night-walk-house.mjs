import { strict as assert } from 'node:assert';
import test from 'node:test';
import { publisherTreeUrl } from '../night-walk/src/publisher-tree.js';

test('a Night Walk house points to the readable tree for its exact blyg path', () => {
  const url = new URL(publisherTreeUrl('https://published.example/two/blygs'));
  assert.equal(url.origin, 'https://fishbiscuit.me');
  assert.equal(url.pathname, '/blyggdrasil/tree/');
  assert.equal(url.searchParams.get('blyg'), 'https://published.example/two/blygs/');
});

test('a Night Walk house needs a public HTTPS blyg address for an evidence link', () => {
  for (const origin of [
    undefined,
    'published.example',
    'http://published.example/blyg/',
    'https://reader:secret@published.example/blyg/',
    'https://published.example/blyg/?ref=another',
    'https://published.example/blyg/#another',
  ]) {
    assert.equal(publisherTreeUrl(origin), null);
  }
});
