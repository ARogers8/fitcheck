// Fetches a product page (or its images) the way a browser would, and turns it
// into product data. Many big retailers sit behind bot protection; when that
// happens we say so clearly so the app can offer the bookmarklet or manual entry.
import { lookup } from 'node:dns/promises';
import net from 'node:net';
import { extractFromHtml, fromShopifyJson } from './extract.js';

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Upgrade-Insecure-Requests': '1',
};

export class ScrapeError extends Error {
  constructor(message, { status = 502, blocked = false } = {}) {
    super(message);
    this.status = status;
    this.blocked = blocked;
  }
}

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const v = ip.toLowerCase();
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('::ffff:127.') || v.startsWith('::ffff:10.') || v.startsWith('::ffff:192.168.');
}

/** Rejects non-http(s) URLs and anything that resolves to a private address. */
export async function assertPublicUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new ScrapeError('That doesn’t look like a link.', { status: 400 });
  }
  if (!/^https?:$/.test(u.protocol)) throw new ScrapeError('Only http and https links work.', { status: 400 });
  if (process.env.ALLOW_PRIVATE_URLS === '1') return u;
  const addrs = await lookup(u.hostname, { all: true }).catch(() => []);
  if (!addrs.length) throw new ScrapeError(`Couldn’t find the site ${u.hostname}.`, { status: 400 });
  if (addrs.some((a) => isPrivateIp(a.address))) throw new ScrapeError('That link points at a private network address.', { status: 400 });
  return u;
}

async function safeFetch(url, { headers = {}, timeoutMs = 15000, maxBytes = 12 * 1024 * 1024 } = {}) {
  let current = url;
  for (let hop = 0; hop < 6; hop++) {
    await assertPublicUrl(current);
    const res = await fetch(current, {
      headers: { ...BROWSER_HEADERS, ...headers },
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location'), current).href;
      continue;
    }
    const len = Number(res.headers.get('content-length') || 0);
    if (len > maxBytes) throw new ScrapeError('That file is too large.', { status: 413 });
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw new ScrapeError('That file is too large.', { status: 413 });
    return { res, buf, finalUrl: current };
  }
  throw new ScrapeError('Too many redirects.');
}

const BLOCK_MARKERS = [
  /access denied/i,
  /px-captcha|perimeterx/i,
  /cf-chl|challenge-platform|just a moment\.\.\./i,
  /_Incapsula_Resource|incapsula/i,
  /datadome/i,
  /are you a robot|verify you are human|unusual traffic/i,
  /akamai.*reference #|reference&#32;&#35;/i,
];

function looksBlocked(status, html) {
  if ([401, 403, 429, 503].includes(status)) return true;
  // Bot walls are small pages; real product pages are big.
  return html.length < 60000 && BLOCK_MARKERS.some((re) => re.test(html));
}

async function tryShopify(u) {
  const m = u.pathname.match(/^(.*\/products\/[^/?#]+)/);
  if (!m) return null;
  try {
    const { res, buf } = await safeFetch(`${u.origin}${m[1].replace(/\.(js|json)$/, '')}.js`, {
      headers: { Accept: 'application/json' },
      timeoutMs: 10000,
    });
    if (!res.ok || !/json|javascript/.test(res.headers.get('content-type') || '')) return null;
    const data = JSON.parse(buf.toString('utf8'));
    return data?.title ? fromShopifyJson(data, u.href) : null;
  } catch {
    return null;
  }
}

/** Fetches a product page and returns structured product data. */
export async function scrapeProduct(rawUrl) {
  const u = await assertPublicUrl(rawUrl);
  const shopify = await tryShopify(u);

  let page = null;
  let blocked = false;
  try {
    const { res, buf, finalUrl } = await safeFetch(u.href);
    const html = buf.toString('utf8');
    if (looksBlocked(res.status, html)) blocked = true;
    else if (res.ok) page = extractFromHtml(html, finalUrl);
    else if (!shopify) throw new ScrapeError(`The store answered with an error (${res.status}).`, { status: 502 });
  } catch (err) {
    if (!shopify) {
      if (err instanceof ScrapeError) throw err;
      throw new ScrapeError(`Couldn’t load that page: ${err.cause?.code || err.message}`, { status: 502, blocked: true });
    }
  }

  // Merge: Shopify JSON is cleanest; the HTML fills in anything it lacks.
  const merged = { ...(page || {}) };
  if (shopify) {
    for (const [k, v] of Object.entries(shopify)) {
      if (Array.isArray(v) ? v.length : v != null && v !== '') merged[k] = v;
    }
    merged.sources = [...new Set([...(shopify.sources || []), ...(page?.sources || [])])];
  }
  if (!merged.title || !merged.images?.length) {
    throw new ScrapeError(
      blocked
        ? `${u.hostname} blocks automated page reads. Use the Fitcheck bookmarklet on the product page, or add it by hand.`
        : 'Couldn’t find product details on that page.',
      { status: blocked ? 403 : 422, blocked }
    );
  }
  return { ...merged, url: u.href, store: u.hostname.replace(/^www\./, '') };
}

/** Downloads product photos (http URLs or data: URLs from manual uploads). */
export async function downloadImages(urls, referer, limit = 10) {
  const out = [];
  for (const url of urls.slice(0, limit)) {
    try {
      if (url.startsWith('data:image/')) {
        out.push({ url, buffer: Buffer.from(url.split(',')[1], 'base64') });
        continue;
      }
      const { res, buf } = await safeFetch(url, {
        headers: { Accept: 'image/avif,image/webp,image/*,*/*;q=0.8', 'Sec-Fetch-Dest': 'image', ...(referer ? { Referer: referer } : {}) },
      });
      if (res.ok && buf.length > 2000) out.push({ url, buffer: buf });
    } catch {
      // One bad image shouldn't sink the import.
    }
  }
  return out;
}

export async function fetchImage(url, referer) {
  const { res, buf } = await safeFetch(url, {
    headers: { Accept: 'image/avif,image/webp,image/*,*/*;q=0.8', ...(referer ? { Referer: referer } : {}) },
  });
  if (!res.ok) throw new ScrapeError(`Image request failed (${res.status}).`);
  return { buf, type: res.headers.get('content-type') || 'image/jpeg' };
}
