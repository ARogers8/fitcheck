// Turns product photos into clean garment textures for the 3D model.
//
// For each photo we decide whether it's a "packshot" (the garment alone on a plain
// background) or a model shot (a person wearing it, usually with other clothes).
// Packshots are cut out by flood-filling the background from the edges. Model shots
// are cropped to the region where this kind of garment sits (or the box a vision
// model gave us), with skin and background removed, so the other clothes the model
// is wearing don't end up on your avatar.
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { mkdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { PHOTO_BANDS } from './category.js';

const ANALYSIS_SIZE = 320;
const OUTPUT_SIZE = 1024;

export const CACHE_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'cache');

const dist = (r1, g1, b1, r2, g2, b2) => Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);

function isSkin(r, g, b) {
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  return y > 50 && cb >= 77 && cb <= 127 && cr >= 137 && cr <= 173 && r > g && r > b;
}

function median(values) {
  if (!values.length) return 0;
  const s = Float32Array.from(values).sort();
  return s[s.length >> 1];
}

/** Analyzes one photo at low resolution. Returns stats plus a background mask. */
export async function analyzePhoto(buffer) {
  const img = sharp(buffer, { failOn: 'none' }).rotate().flatten({ background: '#ffffff' });
  const { data, info } = await img
    .resize(ANALYSIS_SIZE, ANALYSIS_SIZE, { fit: 'inside' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const px = (i) => [data[i * 3], data[i * 3 + 1], data[i * 3 + 2]];

  // Background colour = median of the border pixels.
  const border = [];
  for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) border.push(y * w, y * w + w - 1);
  const br = median(border.map((i) => data[i * 3]));
  const bg = median(border.map((i) => data[i * 3 + 1]));
  const bb = median(border.map((i) => data[i * 3 + 2]));
  const uniform =
    border.filter((i) => dist(...px(i), br, bg, bb) < 28).length / border.length;

  // Flood-fill the background in from the edges.
  const isBg = new Uint8Array(w * h);
  // Tolerance follows how clean the backdrop is: a spotless white studio
  // backdrop gets a tight threshold so white sneakers or tees aren't eaten.
  const noise = median(border.map((i) => dist(...px(i), br, bg, bb)));
  const tol = uniform > 0.85 ? Math.min(34, Math.max(12, noise * 4 + 10)) : 22;
  const stack = border.filter((i) => dist(...px(i), br, bg, bb) < tol);
  for (const i of stack) isBg[i] = 1;
  while (stack.length) {
    const i = stack.pop();
    const x = i % w;
    const y = (i / w) | 0;
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
      if (j < 0 || isBg[j]) continue;
      if (dist(...px(j), br, bg, bb) < tol) {
        isBg[j] = 1;
        stack.push(j);
      }
    }
  }

  let fg = 0;
  let skin = 0;
  const skinTop = [];
  for (let i = 0; i < w * h; i++) {
    if (isBg[i]) continue;
    fg++;
    if (isSkin(...px(i))) {
      skin++;
      if (i < w * h * 0.16) skinTop.push(i);
    }
  }
  const skinFrac = fg ? skin / fg : 0;
  const fgFrac = fg / (w * h);

  // The model's actual skin tone, sampled from the face/neck area at the top of the
  // frame. Matching against this (rather than any skin-like colour) keeps beige,
  // tan and camel garments from being mistaken for skin.
  let skinRef = null;
  if (skinTop.length > w * h * 0.004) {
    skinRef = [0, 1, 2].map((c) => median(skinTop.map((i) => data[i * 3 + c])));
  } else if (skinFrac > 0.02 && skinFrac < 0.4) {
    const all = [];
    for (let i = 0; i < w * h; i++) if (!isBg[i] && isSkin(...px(i))) all.push(i);
    skinRef = [0, 1, 2].map((c) => median(all.map((i) => data[i * 3 + c])));
  }

  return {
    w,
    h,
    data,
    isBg,
    uniform,
    skinFrac,
    fgFrac,
    skinRef,
    // A garment on its own: plain background and either no skin at all, or "skin"
    // that's really the garment's own colour (nearly all of the foreground).
    packshot: uniform > 0.8 && fgFrac > 0.08 && fgFrac < 0.92 && (skinFrac < 0.035 || skinFrac > 0.85),
  };
}

/** Keeps only the largest 4-connected blob in a mask (drops stray specks). */
function largestComponent(mask, w, h) {
  const label = new Int32Array(w * h);
  let best = 0;
  let bestSize = 0;
  let next = 1;
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || label[s]) continue;
    const stack = [s];
    label[s] = next;
    let size = 0;
    while (stack.length) {
      const i = stack.pop();
      size++;
      const x = i % w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (j < 0 || j >= w * h || !mask[j] || label[j]) continue;
        label[j] = next;
        stack.push(j);
      }
    }
    if (size > bestSize) {
      bestSize = size;
      best = next;
    }
    next++;
  }
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = label[i] === best ? 1 : 0;
  return out;
}

/**
 * Builds the garment mask for a photo. `box` is [x0,y0,x1,y1] in 0..1 image
 * coordinates; when absent, packshots use the whole frame and model shots use
 * the usual vertical band for this kind of garment.
 */
export function garmentMask(a, kind, box) {
  const { w, h, data, isBg } = a;
  const band = PHOTO_BANDS[kind] || [0, 1];
  const [x0, y0, x1, y1] = box || (a.packshot ? [0, 0, 1, 1] : [0, band[0], 1, band[1]]);
  const X0 = Math.floor(x0 * w);
  const X1 = Math.ceil(x1 * w);
  const Y0 = Math.floor(y0 * h);
  const Y1 = Math.ceil(y1 * h);
  const mask = new Uint8Array(w * h);
  for (let y = Y0; y < Y1; y++) {
    for (let x = X0; x < X1; x++) {
      const i = y * w + x;
      if (isBg[i]) continue;
      if (!a.packshot && a.skinRef && dist(data[i * 3], data[i * 3 + 1], data[i * 3 + 2], ...a.skinRef) < 34) continue;
      mask[i] = 1;
    }
  }
  return largestComponent(mask, w, h);
}

function maskBounds(mask, w, h) {
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (mask[y * w + x]) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
  return maxX < 0 ? null : { minX, minY, maxX, maxY };
}

/** Median colour of the garment pixels, as a hex string. */
function garmentColor(a, mask) {
  const r = [], g = [], b = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    r.push(a.data[i * 3]);
    g.push(a.data[i * 3 + 1]);
    b.push(a.data[i * 3 + 2]);
  }
  const hex = (v) => Math.round(v).toString(16).padStart(2, '0');
  return `#${hex(median(r))}${hex(median(g))}${hex(median(b))}`;
}

/** Writes the cut-out garment as a transparent PNG and returns its cache file name. */
async function writeCutout(buffer, a, mask, cacheKey) {
  const bounds = maskBounds(mask, a.w, a.h);
  if (!bounds) return null;
  const file = `${cacheKey}.png`;
  const out = path.join(CACHE_DIR, file);
  try {
    await access(out);
    return { file, bounds };
  } catch {}

  const { data: rgb, info } = await sharp(buffer, { failOn: 'none' })
    .rotate()
    .flatten({ background: '#ffffff' })
    .resize(OUTPUT_SIZE, OUTPUT_SIZE, { fit: 'inside' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  // Upscale the low-res mask to output size with soft edges.
  const alpha = await sharp(Buffer.from(mask.map((m) => (m ? 255 : 0))), { raw: { width: a.w, height: a.h, channels: 1 } })
    .resize(W, H, { fit: 'fill', kernel: 'cubic' })
    .blur(1.2)
    .extractChannel(0)
    .raw()
    .toBuffer({ resolveWithObject: true })
    .then(({ data, info: ai }) => {
      if (ai.width !== W || ai.height !== H || ai.channels !== 1) throw new Error('mask resize mismatch');
      return data;
    });
  const rgba = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    rgba[i * 4] = rgb[i * 3];
    rgba[i * 4 + 1] = rgb[i * 3 + 1];
    rgba[i * 4 + 2] = rgb[i * 3 + 2];
    rgba[i * 4 + 3] = alpha[i];
  }
  const left = Math.floor((bounds.minX / a.w) * W);
  const top = Math.floor((bounds.minY / a.h) * H);
  const width = Math.min(W - left, Math.max(1, Math.ceil(((bounds.maxX + 1) / a.w) * W) - left));
  const height = Math.min(H - top, Math.max(1, Math.ceil(((bounds.maxY + 1) / a.h) * H) - top));
  await mkdir(CACHE_DIR, { recursive: true });
  await sharp(rgba, { raw: { width: W, height: H, channels: 4 } })
    .extract({ left, top, width, height })
    .png({ compressionLevel: 8 })
    .toFile(out);
  return { file, bounds };
}

/**
 * Picks the best front (and back, if we can tell) photo and produces textures.
 * `photos` is [{ url, buffer }] in page order. `hints` (optional, from vision)
 * is [{ index, view, shot, box }].
 */
export async function buildGarment(photos, kind, hints = []) {
  const analyzed = [];
  for (const [index, p] of photos.entries()) {
    try {
      analyzed.push({ index, url: p.url, buffer: p.buffer, a: await analyzePhoto(p.buffer) });
    } catch {
      // Unreadable image (GIF sprite, video poster, etc.) - skip it.
    }
  }
  if (!analyzed.length) return { textures: {}, photos: [] };

  const hintFor = (idx) => hints.find((h) => h.index === idx);
  for (const p of analyzed) {
    const hint = hintFor(p.index);
    if (hint?.shot === 'flat' || hint?.shot === 'ghost') p.a.packshot = true;
    if (hint?.shot === 'model') p.a.packshot = false;
    p.view = hint?.view || null;
    p.box = hint?.box || null;
    p.usable = !hint || (hint.view !== 'detail' && hint.view !== 'other' && hint.containsItem !== false);
  }

  const usable = analyzed.filter((p) => p.usable);
  const rank = (p) => (p.a.packshot ? 0 : 1) + (p.view === 'front' ? 0 : p.view ? 0.5 : 0.25);
  const front = [...usable].sort((x, y) => rank(x) - rank(y) || x.index - y.index)[0] || analyzed[0];

  let back = usable.find((p) => p !== front && p.view === 'back');
  if (!back && !hints.length && front.a.packshot) {
    // Without vision, guess: the next packshot with a similar silhouette size is
    // usually the back view; close-up detail shots fill most of the frame.
    back = usable.find(
      (p) => p !== front && p.a.packshot && p.a.fgFrac / front.a.fgFrac > 0.7 && p.a.fgFrac / front.a.fgFrac < 1.4
    );
  }

  const key = (p, side) => createHash('sha1').update(`${p.url}|${kind}|${side}|${JSON.stringify(p.box)}`).digest('hex').slice(0, 20);
  const textures = {};
  let color = null;
  for (const [side, p] of [['front', front], ['back', back]]) {
    if (!p) continue;
    const mask = garmentMask(p.a, kind, p.box);
    const cut = await writeCutout(p.buffer, p.a, mask, key(p, side));
    if (!cut) continue;
    textures[side] = { file: cut.file, source: p.url, packshot: p.a.packshot };
    if (side === 'front') color = garmentColor(p.a, mask);
  }

  return {
    textures,
    color: color || '#888888',
    photos: analyzed.map((p) => ({
      url: p.url,
      packshot: p.a.packshot,
      view: p.view,
      skin: Number(p.a.skinFrac.toFixed(3)),
    })),
  };
}
