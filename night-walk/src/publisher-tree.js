export const BLYGGDRASIL = 'https://fishbiscuit.me/blyggdrasil/';

export function publicBlygOrigin(origin) {
  if (typeof origin !== 'string') return null;
  try {
    const url = new URL(origin);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
    if (!url.pathname.endsWith('/')) url.pathname += '/';
    return url.href;
  } catch {
    return null;
  }
}

export function publisherTreeUrl(origin) {
  const blyg = publicBlygOrigin(origin);
  if (!blyg) return null;
  const url = new URL('tree/', BLYGGDRASIL);
  url.searchParams.set('blyg', blyg);
  return url.href;
}
