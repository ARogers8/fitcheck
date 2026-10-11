import express from 'express';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { scrapeProduct, downloadImages, fetchImage, assertPublicUrl, ScrapeError } from './scrape.js';
import { detectKind, KINDS } from './category.js';
import { buildGarment, CACHE_DIR } from './garment.js';
import { visionAvailable, locateGarment } from './vision.js';
import { dedupeImages, dedupeSizes } from './extract.js';

const app = express();
app.use(express.json({ limit: '30mb' }));
app.use((req, res, next) => {
  // The bookmarklet posts from the retailer's page, so the import API allows any origin.
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/api/health', (_req, res) => res.json({ ok: true, vision: visionAvailable() }));

/** Product data supplied by the bookmarklet or the manual form instead of a fetch. */
function normalizeSuppliedPage(page, url) {
  let store = page.store;
  try {
    store ||= new URL(url).hostname.replace(/^www\./, '');
  } catch {}
  return {
    title: String(page.title || '').slice(0, 200),
    brand: page.brand,
    description: String(page.description || '').slice(0, 2000),
    price: page.price != null && page.price !== '' ? Number(String(page.price).replace(/[^0-9.]/g, '')) || undefined : undefined,
    currency: page.currency,
    sizes: dedupeSizes(page.sizes || []),
    images: (page.images || []).filter((i) => typeof i === 'string' && i.startsWith('data:image/')).concat(
      dedupeImages((page.images || []).filter((i) => typeof i === 'string' && !i.startsWith('data:')), url || undefined)
    ),
    breadcrumbs: page.breadcrumbs || [],
    url: url || '',
    store: store || 'added by hand',
    sources: [page.source || 'manual'],
  };
}

app.post('/api/import', async (req, res) => {
  const { url, page, kind: forcedKind } = req.body || {};
  try {
    if (!url && !page) throw new ScrapeError('Paste a product link.', { status: 400 });
    const product = page ? normalizeSuppliedPage(page, url) : await scrapeProduct(url);
    if (!product.title) throw new ScrapeError('The piece needs a name.', { status: 400 });
    if (!product.images.length) throw new ScrapeError('No product photos were found.', { status: 422 });

    const photos = await downloadImages(product.images, product.url);
    if (!photos.length) throw new ScrapeError('Couldn’t download any of the product photos.', { status: 502 });

    const titleKind = detectKind(product);
    let kind = KINDS[forcedKind] ? forcedKind : titleKind || 'tee';
    let hints = [];
    let vision = false;
    if (visionAvailable()) {
      try {
        const located = await locateGarment({ title: product.title, kind, photos });
        if (located) {
          hints = located.hints;
          vision = true;
          if (!forcedKind && !titleKind && KINDS[located.kind]) kind = located.kind;
        }
      } catch (err) {
        console.warn('[vision] falling back to heuristics:', err.message);
      }
    }

    const garment = await buildGarment(photos, kind, hints);
    const tex = (t) => (t ? { ...t, url: `/cache/${t.file}` } : null);
    res.json({
      id: randomUUID(),
      addedAt: Date.now(),
      url: product.url,
      store: product.store,
      title: product.title,
      brand: product.brand,
      description: product.description,
      price: product.price,
      currency: product.currency,
      sizes: product.sizes,
      images: photos.map((p) => p.url).filter((u) => !u.startsWith('data:')),
      kind,
      slot: KINDS[kind].slot,
      color: garment.color,
      textures: { front: tex(garment.textures.front), back: tex(garment.textures.back) },
      photos: garment.photos.map(({ url: u, ...rest }) => ({ ...rest, url: u.startsWith('data:') ? null : u })),
      vision,
      sources: product.sources,
    });
  } catch (err) {
    const status = err instanceof ScrapeError ? err.status : 500;
    if (status === 500) console.error(err);
    res.status(status).json({ error: err.message, blocked: Boolean(err.blocked) });
  }
});

/** Proxies product photos so the browser can show them despite hotlink rules. */
app.get('/api/image', async (req, res) => {
  try {
    const url = String(req.query.url || '');
    await assertPublicUrl(url);
    const { buf, type } = await fetchImage(url, req.query.ref ? String(req.query.ref) : undefined);
    if (!/^image\//.test(type)) return res.sendStatus(415);
    res.set('Content-Type', type).set('Cache-Control', 'public, max-age=86400').send(buf);
  } catch (err) {
    res.status(err.status || 502).end();
  }
});

app.use('/cache', express.static(CACHE_DIR, { maxAge: '7d', immutable: true }));

const clientDist = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'client', 'dist');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^\/(?!api|cache).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

const port = Number(process.env.PORT || 8787);
app.listen(port, () => {
  console.log(`Fitcheck API on http://localhost:${port}  (vision: ${visionAvailable() ? 'on' : 'off'})`);
});
