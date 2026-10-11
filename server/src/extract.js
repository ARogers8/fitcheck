// Pulls product data (title, brand, price, sizes, images) out of a product page.
// Sources are tried from most to least structured: JSON-LD, embedded state,
// OpenGraph/meta tags, then the visible DOM.
import * as cheerio from 'cheerio';

const SIZE_TOKEN =
  /^(xxs|xs|s|m|l|xl|xxl|xxxl|[2-5]xl|one size|os|petite|tall|\d{1,2}(\.\d)?|\d{2}\s?[x\/]\s?\d{2}|(eu|uk|us|it|fr)\s?\d{1,2}(\.\d)?|\d{1,2}[wl]|\d{2,3}(cm)?|(x{0,3}s|m|x{0,3}l)\s?(\/|-)\s?\w+)$/i;

export function looksLikeSize(text) {
  if (!text) return false;
  const t = String(text).trim().replace(/\s+/g, ' ');
  if (t.length > 14) return false;
  return SIZE_TOKEN.test(t);
}

function asArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function absolutize(src, base) {
  if (!src || typeof src !== 'string') return null;
  const s = src.trim();
  if (!s || s.startsWith('data:')) return null;
  try {
    return new URL(s.startsWith('//') ? `https:${s}` : s, base).href;
  } catch {
    return null;
  }
}

function imageUrlFrom(v) {
  if (!v) return null;
  if (typeof v === 'string') return v;
  return v.contentUrl || v.url || v.image || null;
}

/** Collects every JSON-LD node in the page, flattening @graph and arrays. */
function jsonLdNodes($) {
  const nodes = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    let data;
    try {
      data = JSON.parse(raw.trim().replace(/^\s*<!--|-->\s*$/g, ''));
    } catch {
      return;
    }
    const walk = (n) => {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) return n.forEach(walk);
      nodes.push(n);
      if (n['@graph']) walk(n['@graph']);
    };
    walk(data);
  });
  return nodes;
}

function hasType(node, type) {
  return asArray(node['@type']).some((t) => String(t).toLowerCase() === type.toLowerCase());
}

function fromJsonLd($) {
  const nodes = jsonLdNodes($);
  const product =
    nodes.find((n) => hasType(n, 'ProductGroup')) || nodes.find((n) => hasType(n, 'Product'));
  if (!product) return {};

  const out = { images: [], sizes: [], breadcrumbs: [] };
  out.title = product.name;
  out.brand = typeof product.brand === 'string' ? product.brand : product.brand?.name;
  out.description = product.description;
  out.color = product.color;
  out.images.push(...asArray(product.image).map(imageUrlFrom));

  const variants = asArray(product.hasVariant);
  for (const v of variants) {
    out.images.push(...asArray(v.image).map(imageUrlFrom));
    if (v.size) out.sizes.push(typeof v.size === 'string' ? v.size : v.size.name);
  }

  const offers = [...asArray(product.offers), ...variants.flatMap((v) => asArray(v.offers))];
  for (const o of offers.flatMap((o) => (o?.offers ? asArray(o.offers) : [o]))) {
    if (!o) continue;
    const price = o.price ?? o.lowPrice ?? o.priceSpecification?.price;
    if (out.price == null && price != null) {
      out.price = Number(price);
      out.currency = o.priceCurrency || o.priceSpecification?.priceCurrency;
    }
    if (o.size) out.sizes.push(o.size);
    else if (o.name && looksLikeSize(o.name)) out.sizes.push(o.name);
  }

  for (const p of asArray(product.additionalProperty)) {
    if (/size/i.test(p?.name || '')) out.sizes.push(...asArray(p.value));
  }

  const crumbs = nodes.find((n) => hasType(n, 'BreadcrumbList'));
  if (crumbs) {
    out.breadcrumbs = asArray(crumbs.itemListElement)
      .map((i) => i.name || i.item?.name)
      .filter(Boolean);
  }
  if (product.category) out.breadcrumbs.push(...asArray(product.category).map(String));
  return out;
}

function meta($, ...names) {
  for (const n of names) {
    const v =
      $(`meta[property="${n}"]`).attr('content') || $(`meta[name="${n}"]`).attr('content');
    if (v) return v.trim();
  }
  return undefined;
}

function fromMeta($) {
  const images = [];
  $('meta[property="og:image"], meta[property="og:image:secure_url"], meta[name="twitter:image"]').each(
    (_, el) => images.push($(el).attr('content'))
  );
  const price = meta($, 'product:price:amount', 'og:price:amount', 'twitter:data1');
  return {
    title: meta($, 'og:title', 'twitter:title') || $('title').first().text().trim(),
    brand: meta($, 'product:brand', 'og:brand'),
    siteName: meta($, 'og:site_name', 'application-name'),
    description: meta($, 'og:description', 'description'),
    price: price ? Number(String(price).replace(/[^0-9.]/g, '')) || undefined : undefined,
    currency: meta($, 'product:price:currency', 'og:price:currency'),
    images,
  };
}

/** Finds size choices in the visible page: size pickers, selects, buttons. */
function sizesFromDom($) {
  const found = [];
  const push = (t) => {
    const s = String(t || '').trim().replace(/\s+/g, ' ');
    if (looksLikeSize(s)) found.push(s);
  };
  $('select').each((_, sel) => {
    const $sel = $(sel);
    const key = `${$sel.attr('name') || ''} ${$sel.attr('id') || ''} ${$sel.attr('aria-label') || ''}`;
    if (/size/i.test(key)) $sel.find('option').each((_, o) => push($(o).text()));
  });
  $('[data-size], [data-option-size], [data-value]').each((_, el) => {
    const $el = $(el);
    const inSizeArea = $el.closest('[class*="size" i], [id*="size" i], [data-testid*="size" i]').length;
    if ($el.attr('data-size') || $el.attr('data-option-size')) push($el.attr('data-size') || $el.attr('data-option-size'));
    else if (inSizeArea) push($el.attr('data-value'));
  });
  $('[class*="size" i] button, [class*="size" i] li, [class*="size" i] label, [id*="size" i] button, [data-testid*="size" i] button')
    .slice(0, 80)
    .each((_, el) => push($(el).attr('aria-label')?.replace(/^size\s*/i, '') || $(el).text()));
  $('[aria-label^="Size " i]').each((_, el) => push($(el).attr('aria-label').replace(/^size\s*/i, '')));
  return found;
}

/** Product gallery images whose alt text overlaps the product title. */
function imagesFromDom($, base, title) {
  const words = new Set(
    String(title || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2)
  );
  const results = [];
  $('img, source').each((_, el) => {
    const $el = $(el);
    const alt = ($el.attr('alt') || $el.closest('picture').find('img').attr('alt') || '').toLowerCase();
    const inGallery = $el.closest('[class*="gallery" i], [class*="carousel" i], [class*="product-image" i], [class*="media" i], [data-testid*="image" i]').length;
    const overlap = [...words].filter((w) => alt.includes(w)).length;
    if (!(inGallery || (words.size && overlap >= Math.min(2, words.size)))) return;
    const srcset = $el.attr('srcset') || $el.attr('data-srcset');
    let src = $el.attr('data-zoom-image') || $el.attr('data-src') || $el.attr('src');
    if (srcset) {
      const best = srcset
        .split(',')
        .map((p) => p.trim().split(/\s+/))
        .map(([u, w]) => ({ u, w: parseInt(w, 10) || 0 }))
        .sort((a, b) => b.w - a.w)[0];
      if (best?.u) src = best.u;
    }
    const url = absolutize(src, base);
    if (url && !/sprite|logo|icon|placeholder|blank|pixel|\.svg/i.test(url)) results.push(url);
  });
  return results;
}

/** Normalizes an image URL so size variants of the same picture dedupe. */
export function imageKey(url) {
  try {
    const u = new URL(url);
    u.search = '';
    return (u.host + u.pathname)
      .toLowerCase()
      .replace(/_(\d+x\d*|\d*x\d+|small|medium|large|grande|master|compact)(?=\.)/g, '')
      .replace(/\/(w|h)_\d+[^/]*\//g, '/');
  } catch {
    return url;
  }
}

/** Upgrades known CDN thumbnail URLs to large versions. */
export function upscaleImageUrl(url) {
  try {
    const u = new URL(url);
    if (/cdn\.shopify\.com|\/cdn\/shop\//.test(url)) {
      u.pathname = u.pathname.replace(/_(\d+x\d*|\d*x\d+|small|medium|large|grande|compact)(?=\.)/, '');
      u.searchParams.set('width', '1400');
      return u.href;
    }
    for (const k of ['w', 'width', 'wid']) if (u.searchParams.has(k)) u.searchParams.set(k, '1400');
    for (const k of ['h', 'height', 'hei']) u.searchParams.delete(k);
    return u.href;
  } catch {
    return url;
  }
}

export function dedupeImages(urls, base) {
  const seen = new Map();
  for (const raw of urls) {
    const url = absolutize(raw, base);
    if (!url || /\.svg(\?|$)/i.test(url)) continue;
    const key = imageKey(url);
    if (!seen.has(key)) seen.set(key, upscaleImageUrl(url));
  }
  return [...seen.values()];
}

export function dedupeSizes(sizes) {
  const seen = new Map();
  for (const s of sizes) {
    const t = String(s || '').trim().replace(/\s+/g, ' ');
    if (!t || t.length > 20) continue;
    if (!seen.has(t.toUpperCase())) seen.set(t.toUpperCase(), t);
  }
  return [...seen.values()];
}

export function extractFromHtml(html, pageUrl) {
  const $ = cheerio.load(html);
  const ld = fromJsonLd($);
  const mt = fromMeta($);
  const title = ld.title || mt.title;
  const domSizes = sizesFromDom($);
  const sizes = dedupeSizes([...(ld.sizes || []), ...domSizes]);
  const images = dedupeImages(
    [...(ld.images || []), ...mt.images, ...imagesFromDom($, pageUrl, title)],
    pageUrl
  );
  const breadcrumbs = [...(ld.breadcrumbs || [])];
  $('[class*="breadcrumb" i] a, nav[aria-label*="breadcrumb" i] a').each((_, a) =>
    breadcrumbs.push($(a).text().trim())
  );

  return {
    title: cleanTitle(title, mt.siteName),
    brand: ld.brand || mt.brand || mt.siteName,
    description: ld.description || mt.description,
    color: ld.color,
    price: ld.price ?? mt.price,
    currency: ld.currency || mt.currency,
    sizes,
    images,
    breadcrumbs: [...new Set(breadcrumbs.filter(Boolean))],
    sources: [ld.title ? 'json-ld' : null, mt.title ? 'meta' : null, domSizes.length ? 'dom' : null].filter(Boolean),
  };
}

export function cleanTitle(title, siteName) {
  if (!title) return title;
  let t = String(title).trim();
  if (siteName) t = t.replace(new RegExp(`\\s*[|\\-–—]\\s*${siteName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*$`, 'i'), '');
  return t.replace(/\s*\|\s*[^|]{2,30}$/, '').trim();
}

/** Shopify exposes /products/<handle>.js with clean JSON for any product page. */
export function fromShopifyJson(data, pageUrl) {
  const p = data.product || data;
  const sizeOptIdx = (p.options || []).findIndex((o) => /size|waist|length/i.test(o.name || o));
  const sizes = [];
  if (sizeOptIdx >= 0) {
    const opt = p.options[sizeOptIdx];
    if (Array.isArray(opt.values)) sizes.push(...opt.values);
    else for (const v of p.variants || []) sizes.push(v[`option${sizeOptIdx + 1}`]);
  }
  const images = (p.images || []).map((i) => (typeof i === 'string' ? i : i.src));
  const priceRaw = p.price ?? p.variants?.[0]?.price;
  // .js returns cents as integers; .json returns "49.00" strings.
  const price =
    typeof priceRaw === 'number' ? priceRaw / 100 : priceRaw != null ? Number(priceRaw) : undefined;
  return {
    title: p.title,
    brand: p.vendor,
    description: String(p.description || p.body_html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    price,
    sizes: dedupeSizes(sizes),
    images: dedupeImages(images, pageUrl),
    breadcrumbs: [p.type || p.product_type].filter(Boolean),
    sources: ['shopify'],
  };
}
