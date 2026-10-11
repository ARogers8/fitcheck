// The "Send to Fitcheck" bookmarklet. It runs on the store's page in the user's own
// browser (so bot walls don't apply), reads the product details the same way the
// server does, and opens Fitcheck with them.

function collect() {
  /* eslint-disable no-var */
  var d = document;
  var q = function (s) {
    return Array.prototype.slice.call(d.querySelectorAll(s));
  };
  var out = { title: '', brand: '', price: '', currency: '', sizes: [], images: [], breadcrumbs: [], description: '', source: 'bookmarklet' };
  var img = function (i) {
    return typeof i === 'string' ? i : i && (i.url || i.contentUrl);
  };
  q('script[type="application/ld+json"]').forEach(function (s) {
    try {
      (function walk(n) {
        if (!n || typeof n !== 'object') return;
        if (Array.isArray(n)) return n.forEach(walk);
        var t = [].concat(n['@type'] || []).join(' ');
        if (/Product/.test(t)) {
          out.title = out.title || n.name;
          out.brand = out.brand || (n.brand && (n.brand.name || n.brand));
          out.description = out.description || n.description;
          [].concat(n.image || []).forEach(function (i) { out.images.push(img(i)); });
          [].concat(n.offers || []).forEach(function (f) {
            if (f && !out.price) { out.price = f.price || f.lowPrice; out.currency = f.priceCurrency; }
          });
          [].concat(n.hasVariant || []).forEach(function (v) {
            if (v.size) out.sizes.push(v.size.name || v.size);
            [].concat(v.image || []).forEach(function (i) { out.images.push(img(i)); });
          });
        }
        if (/BreadcrumbList/.test(t)) [].concat(n.itemListElement || []).forEach(function (i) { out.breadcrumbs.push(i.name || (i.item && i.item.name)); });
        if (n['@graph']) walk(n['@graph']);
      })(JSON.parse(s.textContent));
    } catch (e) {}
  });
  var meta = function (n) {
    var m = d.querySelector('meta[property="' + n + '"],meta[name="' + n + '"]');
    return m ? m.getAttribute('content') : '';
  };
  out.title = out.title || meta('og:title') || ((d.querySelector('h1') || {}).textContent || '').trim();
  out.price = out.price || meta('product:price:amount') || meta('og:price:amount');
  out.currency = out.currency || meta('product:price:currency');
  out.brand = out.brand || meta('og:site_name');
  if (meta('og:image')) out.images.push(meta('og:image'));

  var sizeRe = /^(xxs|xs|s|m|l|xl|xxl|xxxl|[2-5]xl|one size|os|\d{1,2}(\.\d)?|\d{2}\s?[x\/]\s?\d{2}|(eu|uk|us)\s?\d{1,2}(\.\d)?)$/i;
  q('[class*="size" i] button,[class*="size" i] li,[class*="size" i] label,[class*="size" i] option,[aria-label^="Size" i],select[name*="size" i] option,[data-size]').forEach(function (el) {
    var t = (el.getAttribute('data-size') || el.getAttribute('aria-label') || el.textContent || '').replace(/^size\s*/i, '').replace(/\s+/g, ' ').trim();
    if (sizeRe.test(t) && out.sizes.indexOf(t) < 0) out.sizes.push(t);
  });

  var words = out.title.toLowerCase().split(/[^a-z0-9]+/).filter(function (w) { return w.length > 2; });
  q('img').forEach(function (el) {
    var alt = (el.alt || '').toLowerCase();
    var gallery = el.closest('[class*="gallery" i],[class*="carousel" i],[class*="product" i],[class*="media" i],[class*="image" i]');
    var hits = words.filter(function (w) { return alt.indexOf(w) >= 0; }).length;
    if (el.naturalWidth < 300 || !(gallery || hits >= 2)) return;
    var best = el.currentSrc || el.src;
    if (el.srcset) {
      var top = 0;
      el.srcset.split(',').forEach(function (p) {
        var bits = p.trim().split(/\s+/);
        var w = parseInt(bits[1], 10) || 0;
        if (w > top) { top = w; best = bits[0]; }
      });
    }
    if (best && !/\.svg|logo|icon|sprite/i.test(best)) out.images.push(best);
  });
  out.images = out.images.filter(Boolean).map(function (u) { return new URL(u, location.href).href; })
    .filter(function (u, i, a) { return a.indexOf(u) === i; }).slice(0, 16);
  return out;
}

export function bookmarkletHref(origin) {
  const body = `(function(){var out=(${collect.toString()})();window.open(${JSON.stringify(origin)}+'/#import='+encodeURIComponent(JSON.stringify({url:location.href,page:out})),'_blank');})()`;
  return `javascript:${encodeURIComponent(body)}`;
}
