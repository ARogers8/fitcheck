// Loads a garment cutout and prepares it for the 3D model: an opaque texture
// (holes filled with the fabric's own colours), a soft "back" version for when
// the store has no back photo, and the silhouette lookup used to warp it on.
import * as THREE from 'three';
import { silhouetteLookup } from './garmentGeometry.js';

const cache = new Map();
const MAX = 1024;
const LOOKUP_ROWS = 160;
const LOOKUP_COLS = 240;

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Couldn't load ${src}`));
    img.src = src;
  });
}

function canvasTexture(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

function compose(img, color, blur) {
  const scale = Math.min(1, MAX / Math.max(img.width, img.height));
  const w = Math.max(4, Math.round(img.width * scale));
  const h = Math.max(4, Math.round(img.height * scale));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
  // Smear the garment outward so transparent gaps take nearby fabric colour.
  for (const r of [48, 24, 10]) {
    ctx.filter = `blur(${Math.round(r * (w / 512))}px)`;
    ctx.drawImage(img, 0, 0, w, h);
  }
  ctx.filter = blur ? `blur(${Math.round(blur * (w / 512))}px)` : 'none';
  ctx.drawImage(img, 0, 0, w, h);
  ctx.filter = 'none';
  return c;
}

function alphaRows(img) {
  const c = document.createElement('canvas');
  c.width = LOOKUP_COLS;
  c.height = LOOKUP_ROWS;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, LOOKUP_COLS, LOOKUP_ROWS);
  const { data } = ctx.getImageData(0, 0, LOOKUP_COLS, LOOKUP_ROWS);
  const rows = [];
  for (let r = 0; r < LOOKUP_ROWS; r++) {
    const row = new Uint8Array(LOOKUP_COLS);
    for (let x = 0; x < LOOKUP_COLS; x++) row[x] = data[(r * LOOKUP_COLS + x) * 4 + 3];
    rows.push(row);
  }
  return rows;
}

/** Solid-colour fallback when a piece has no usable photo. */
function solid(color) {
  const c = document.createElement('canvas');
  c.width = c.height = 4;
  const ctx = c.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 4, 4);
  const full = silhouetteLookup([new Uint8Array(8).fill(255)]);
  return { map: canvasTexture(c), lookup: full };
}

/** Returns { front: {map, lookup}, back: {map, lookup} } for a piece. */
export async function garmentTextures(piece) {
  const key = `${piece.id}|${piece.textures?.front?.url}|${piece.textures?.back?.url}|${piece.color}`;
  if (cache.has(key)) return cache.get(key);
  const promise = (async () => {
    const color = piece.color || '#888';
    if (!piece.textures?.front?.url) {
      const s = solid(color);
      return { front: s, back: s };
    }
    const frontImg = await loadImage(piece.textures.front.url);
    const front = { map: canvasTexture(compose(frontImg, color, 0)), lookup: silhouetteLookup(alphaRows(frontImg)) };
    let back;
    if (piece.textures.back?.url) {
      const backImg = await loadImage(piece.textures.back.url).catch(() => null);
      if (backImg) back = { map: canvasTexture(compose(backImg, color, 0)), lookup: silhouetteLookup(alphaRows(backImg)) };
    }
    // No back photo: a heavily softened front keeps colour and pattern but drops logos and buttons.
    back ||= { map: canvasTexture(compose(frontImg, color, 26)), lookup: front.lookup };
    return { front, back };
  })();
  cache.set(key, promise);
  promise.catch(() => cache.delete(key));
  return promise;
}
