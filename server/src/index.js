import express from 'express';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { scrapeProduct, downloadImages, fetchImage, assertPublicUrl, ScrapeError } from './scrape.js';
import { detectKind, KINDS } from './category.js';
import { buildGarment, CACHE_DIR } from './garment.js';
import { visionAvailable, locateGarment } from './vision.js';
import { dedupeImages, dedupeSizes } from './extract.js';
import { renderAvailable, renderOutfit, makePerson, RenderError } from './render.js';
import sharp from 'sharp';
import { redact, sendError, errorHandler } from './safe.js';

const app = express();
app.use(express.json({ limit: '30mb' }));
app.use((req, res, next) => {
  // The bookmarklet posts from the retailer's page, so the import API allows any origin.
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/api/health', (_req, res) => res.json({ ok: true, vision: visionAvailable(), render: renderAvailable() }));

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
        console.warn('[vision] falling back to heuristics:', redact(err.message));
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
    sendError(res, err, { expected: err instanceof ScrapeError, extra: { blocked: Boolean(err.blocked) } });
  }
});

/** Re-cuts a piece from one photo the user chose ("Use this photo"). */
app.post('/api/recut', async (req, res) => {
  const { image, ref, kind } = req.body || {};
  try {
    if (!KINDS[kind]) throw new ScrapeError('Unknown garment type.', { status: 400 });
    const photos = await downloadImages([String(image || '')], ref ? String(ref) : undefined, 1);
    if (!photos.length) throw new ScrapeError('Couldn’t download that photo.', { status: 502 });
    const garment = await buildGarment(photos, kind, [{ index: 0, view: 'front' }]);
    const front = garment.textures.front;
    if (!front) throw new ScrapeError('Couldn’t find the piece in that photo.', { status: 422 });
    res.json({ color: garment.color, textures: { front: { ...front, url: `/cache/${front.file}` }, back: null } });
  } catch (err) {
    sendError(res, err, { expected: err instanceof ScrapeError });
  }
});

/** Product photo -> JPEG data URI, so the try-on service never hits store hotlink walls. */
async function asDataUri(image, ref) {
  let buffer;
  if (/^data:image\//.test(image)) buffer = Buffer.from(image.split(',')[1] || '', 'base64');
  else {
    const [photo] = await downloadImages([image], ref, 1);
    if (!photo) throw new RenderError('Couldn’t download one of the product photos.');
    buffer = photo.buffer;
  }
  const jpg = await sharp(buffer, { failOn: 'none' }).rotate().flatten({ background: '#ffffff' })
    .resize(1296, 1296, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
  return `data:image/jpeg;base64,${jpg.toString('base64')}`;
}

/** Photoreal picture of the avatar wearing the outfit (needs FASHN_API_KEY). */
app.post('/api/render', async (req, res) => {
  const { avatar, pieces = [], modelImage } = req.body || {};
  try {
    if (!renderAvailable()) throw new RenderError('Realistic photos are turned off on this server.', 503);
    if (modelImage && !/^data:image\//.test(modelImage)) throw new RenderError('Your photo must be an uploaded image.', 400);
    const ready = await Promise.all(
      pieces.slice(0, 6).map(async (p) => ({
        kind: String(p.kind || ''),
        title: String(p.title || '').slice(0, 200),
        packshot: Boolean(p.packshot),
        image: p.image ? await asDataUri(String(p.image), p.ref ? String(p.ref) : undefined) : null,
      }))
    );
    const out = await renderOutfit({ avatar, pieces: ready, modelImage: modelImage && (await asDataUri(modelImage)) });
    if (out.image.startsWith('data:')) {
      // Free-model results come back inline; save them so the page gets a real link.
      const buf = Buffer.from(out.image.split(',')[1], 'base64');
      const file = `render-${createHash('sha1').update(buf).digest('hex').slice(0, 20)}.jpg`;
      await mkdir(CACHE_DIR, { recursive: true });
      await sharp(buf).jpeg({ quality: 92 }).toFile(path.join(CACHE_DIR, file));
      out.image = `/cache/${file}`;
    }
    res.json(out);
  } catch (err) {
    sendError(res, err, { expected: err instanceof RenderError || err instanceof ScrapeError });
  }
});

/** Photo of a real-looking person matching the avatar, shown as the main view. */
app.post('/api/person', async (req, res) => {
  try {
    if (!renderAvailable()) throw new RenderError('Realistic photos are turned off on this server.', 503);
    const image = await makePerson({ avatar: req.body?.avatar || {} });
    res.json({ image: await asDataUri(image) });
  } catch (err) {
    sendError(res, err, { expected: err instanceof RenderError || err instanceof ScrapeError });
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

app.use(errorHandler);

const port = Number(process.env.PORT || 8787);
app.listen(port, () => {
  console.log(`Fitcheck API on http://localhost:${port}  (vision: ${visionAvailable() ? 'on' : 'off'})`);
});
