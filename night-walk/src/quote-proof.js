import { BLYGGDRASIL, publicBlygOrigin } from './publisher-tree.js';

const ITEM_ID = /^[0-9abcdefghjkmnpqrstvwxyz]{26}$/;

export function quoteProofUrl(quote) {
  const { origin, id, version } = quote || {};
  const blyg = publicBlygOrigin(origin);
  if (!blyg || typeof id !== 'string' || !ITEM_ID.test(id) || !Number.isSafeInteger(version) || version < 1) return null;
  const url = new URL('verify/', BLYGGDRASIL);
  url.searchParams.set('origin', blyg);
  url.searchParams.set('id', id);
  url.searchParams.set('version', version);
  return url.href;
}
