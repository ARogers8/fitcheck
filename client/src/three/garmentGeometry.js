// Builds the 3D shape of a garment on the avatar and maps its product photo onto it.
import * as THREE from 'three';
import { tubeGeometry, torsoRings, limbRings, footRings, LANDMARKS as L } from '../body/geometry.js';
import { KIND_EASE } from '../fit/sizes.js';

const LAYER = { base: 0.004, mid: 0.012, outer: 0.022, bottom: 0.003, dress: 0.005, shoes: 0.008, hat: 0.006 };
const SLEEVES = {
  tee: 0.2, longsleeve: 0.985, sweater: 0.99, hoodie: 0.99, jacket: 1.0, coat: 1.0, tank: 0, dress: 0,
};

function style(title = '') {
  const t = title.toLowerCase();
  return {
    wide: /\b(wide|baggy|loose|relaxed|flare|bootcut|palazzo|balloon|barrel|parachute|cargo|skater)\b/.test(t),
    skinny: /\b(skinny|slim|legging|tapered|jogger|fitted)\b/.test(t),
    cropped: /\b(crop|cropped|boxy)\b/.test(t),
    longline: /\b(longline|oversized|tunic|long)\b/.test(t) && !/long[- ]sleeve/.test(t),
    mini: /\bmini\b/.test(t),
    midi: /\bmidi\b/.test(t),
    maxi: /\b(maxi|gown|floor)\b/.test(t),
    longSleeve: /long[- ]sleeve/.test(t),
    shortSleeve: /short[- ]sleeve|tee|t-shirt/.test(t),
    boot: /\bboots?\b/.test(t),
    sneaker: /\b(sneakers?|trainers?|runners?|court|ace|dunk|samba|gazelle|jordan)\b/.test(t),
    cap: /\b(cap|baseball|trucker|snapback)\b/.test(t),
    bucket: /\bbucket\b/.test(t),
  };
}

/** Radial room (m) for a garment, from its kind, layer and the chosen size. */
function roomFor(piece, fit) {
  const easeCm = Math.max(-2, (KIND_EASE[piece.kind] ?? 6) + (fit?.ease ?? 0));
  return LAYER[piece.slot] + easeCm / 100 / (2 * Math.PI);
}

/**
 * Returns { parts: [{ role, side, geometry }], yTop, yHem } for a piece.
 * role: body | leg | sleeve | collar | shoe | sole | hat
 */
export function garmentParts(rig, piece, fit) {
  const kind = piece.kind;
  const st = style(piece.title);
  const H = rig.H;
  const room = roomFor(piece, fit);
  const lengthScale = fit?.lengthScale ?? 1;
  const parts = [];
  const add = (role, side, rings, opts) => parts.push({ role, side, geometry: tubeGeometry(rings, opts) });

  // Below the hips a garment hangs straight (and flares a little) instead of
  // following the body into the crotch.
  const drapeRings = (from, to, flare = 0.15, steps = 34, top = room) => {
    const hip = rig.torsoAt(L.hip);
    const rings = torsoRings(rig, from, to, { steps, offset: () => top });
    for (const r of rings) {
      const f = r.c.y / H;
      if (f < L.hip) {
        const drop = (L.hip - f) * H;
        r.rx = Math.max(r.rx, hip.rx + top + drop * flare);
        r.rzF = Math.max(r.rzF, hip.rzF + top + drop * flare * 0.7);
        r.rzB = Math.max(r.rzB, hip.rzB + top + drop * flare * 0.7);
        r.c.z = 0;
      }
    }
    return rings;
  };

  let yTop;
  let yHem;

  if (['tee', 'longsleeve', 'tank', 'sweater', 'hoodie', 'jacket', 'coat'].includes(kind)) {
    const top = kind === 'tank' ? L.shoulder - 0.012 : L.neckBase - 0.006;
    let hem = { tee: 0.47, longsleeve: 0.465, tank: 0.48, sweater: 0.475, hoodie: 0.47, jacket: 0.47, coat: 0.3 }[kind];
    if (st.cropped) hem = Math.max(hem, 0.56);
    if (st.longline && kind !== 'coat') hem -= 0.035;
    hem = top - (top - hem) * lengthScale;
    const flare = kind === 'coat' ? 0.12 : 0.05;
    const rings = drapeRings(hem, top, flare, 40);
    // Knit hems and cuffs hug a little.
    if (kind === 'sweater' || kind === 'hoodie') {
      for (const r of rings.slice(0, 2)) {
        r.rx -= room * 0.35;
        r.rzF -= room * 0.35;
        r.rzB -= room * 0.35;
      }
    }
    add('body', 0, rings, { segments: 56 });
    yTop = top * H;
    yHem = hem * H;

    let sleeveEnd = SLEEVES[kind];
    if (kind === 'tee' && st.longSleeve) sleeveEnd = 0.985;
    if (sleeveEnd > 0) {
      const sleeveRoom = (at) => room * (kind === 'tee' ? 1 + at * 2.5 : 1) - (at > sleeveEnd - 0.04 && kind !== 'tee' ? room * 0.3 : 0);
      for (const arm of rig.arms) {
        const end = kind === 'tee' ? sleeveEnd * lengthScale : sleeveEnd;
        add('sleeve', arm.side, limbRings(arm, 0.04, end, { steps: 26, offset: sleeveRoom }), { segments: 30 });
      }
    }
    if (kind === 'hoodie' || kind === 'jacket' || kind === 'coat') {
      // Collar (or a lowered hood bunched behind the neck).
      const collar = [];
      const hood = kind === 'hoodie';
      for (let i = 0; i <= 8; i++) {
        const f = THREE.MathUtils.lerp(L.neckBase - 0.012, L.neckBase + (hood ? 0.03 : 0.022), i / 8);
        const bulge = Math.sin((i / 8) * Math.PI);
        collar.push({
          c: new THREE.Vector3(0, f * H, hood ? -0.02 - bulge * 0.015 : -0.006),
          right: new THREE.Vector3(1, 0, 0),
          fwd: new THREE.Vector3(0, 0, 1),
          rx: rig.neckR * (hood ? 2.1 + bulge * 0.5 : 1.55) + room * 0.5,
          rzF: rig.neckR * (hood ? 1.2 : 1.25) + room * 0.3,
          rzB: rig.neckR * (hood ? 2.6 + bulge * 1.0 : 1.5) + room * 0.5,
          n: 2,
        });
      }
      add('collar', 0, collar, { segments: 40 });
    }
  } else if (kind === 'pants' || kind === 'shorts') {
    const top = L.waist - 0.03;
    add('body', 0, torsoRings(rig, L.crotch - 0.015, top, { steps: 16, offset: () => room }), { segments: 56, capStart: false });
    yTop = top * H;
    const leg0 = rig.legs[0];
    const crotchY = L.crotch * H;
    let hemAt;
    if (kind === 'shorts') {
      hemAt = leg0.crotchAt + (0.43 - leg0.crotchAt) * (st.mini ? 0.35 : 0.62) * lengthScale;
    } else if (fit?.inseam) {
      // Inseam from the label: hem lands at crotch minus inseam (may stack on the shoe).
      const hemY = Math.max(0.012 * H, crotchY - fit.inseam / 100);
      hemAt = Math.min(1.04, (leg0.joints[0].y - hemY) / (leg0.joints[0].y - leg0.joints[2].y));
    } else {
      hemAt = st.cropped ? 0.9 : 1.02;
    }
    yHem = Infinity;
    for (const leg of rig.legs) {
      const flare = st.wide ? 0.05 : st.skinny ? -0.004 : 0.016;
      const offset = (at) => {
        const below = Math.max(0, at - leg.crotchAt);
        const o = room + flare * below;
        return st.skinny ? Math.max(0.002, o) : o;
      };
      const rings = limbRings(leg, 0, Math.min(hemAt, 1), { steps: 34, offset });
      if (hemAt > 1) {
        // Extend past the ankle, puddling slightly over the shoe.
        const last = rings[rings.length - 1];
        const extra = (hemAt - 1) * 0.3 * H;
        rings.push({ ...last, c: last.c.clone().add(new THREE.Vector3(0, -extra, 0.008)), rx: last.rx * 1.08, rzF: last.rzF * 1.12, rzB: last.rzB * 1.08 });
      }
      // Hanging fabric: never narrower than the widest point below it allows (straight leg look).
      if (!st.skinny) {
        let minR = 0;
        const hangStart = Math.floor(rings.length * 0.45);
        for (let i = hangStart; i < rings.length; i++) {
          minR = Math.max(minR * 0.985, rings[hangStart].rx * (st.wide ? 1 : 0.92));
          rings[i].rx = Math.max(rings[i].rx, minR);
          rings[i].rzF = Math.max(rings[i].rzF, minR * 0.95);
          rings[i].rzB = Math.max(rings[i].rzB, minR * 0.95);
        }
      }
      add('leg', leg.side, rings, { segments: 36 });
      yHem = Math.min(yHem, rings[rings.length - 1].c.y);
    }
  } else if (kind === 'skirt' || kind === 'dress') {
    const top = kind === 'skirt' ? L.waist - 0.01 : st.longSleeve || st.shortSleeve ? L.neckBase - 0.008 : L.armpit + 0.012;
    let hem = st.mini ? 0.4 : st.midi ? 0.2 : st.maxi ? 0.045 : 0.31;
    hem = top - (top - hem) * lengthScale;
    const flare = st.mini ? 0.12 : st.maxi ? 0.14 : 0.18;
    add('body', 0, drapeRings(hem, top, flare, 44), { segments: 64 });
    yTop = top * H;
    yHem = hem * H;
    if (kind === 'dress' && (st.longSleeve || st.shortSleeve)) {
      for (const arm of rig.arms) add('sleeve', arm.side, limbRings(arm, 0.04, st.longSleeve ? 0.985 : 0.2, { steps: 20, offset: () => room }), { segments: 28 });
    }
  } else if (kind === 'shoes') {
    for (const leg of rig.legs) {
      const upper = footRings(rig, leg, room, { sole: 0.012 });
      add('shoe', leg.side, upper, { segments: 32, capStart: true, capEnd: true });
      const sole = footRings(rig, leg, room + 0.003).map((r) => ({
        ...r,
        c: r.c.clone().setY(0.009),
        rzF: Math.min(r.rzF, 0.009),
        rzB: Math.min(r.rzB, 0.009),
        n: 4,
      }));
      add('sole', leg.side, sole, { segments: 32, capStart: true, capEnd: true });
      if (st.boot) add('shoe', leg.side, limbRings(leg, 0.8, 1, { steps: 10, offset: () => room + 0.008 }), { segments: 30 });
    }
    yTop = rig.legs[0].joints[2].y + (st.boot ? 0.12 * H : 0.02);
    yHem = 0;
  } else if (kind === 'hat') {
    const h = rig.head;
    const rings = [];
    const from = st.cap || st.bucket ? 0.05 : -0.05;
    for (let i = 0; i <= 18; i++) {
      const t = THREE.MathUtils.lerp(from, 1, i / 18);
      const ang = Math.asin(Math.min(1, t));
      const s = Math.cos(ang);
      rings.push({
        c: new THREE.Vector3(0, h.y + h.ry * 0.12 + t * (h.ry * 0.95), -0.006),
        right: new THREE.Vector3(1, 0, 0),
        fwd: new THREE.Vector3(0, 0, 1),
        rx: Math.max(0.002, (h.rx + room) * s * 1.06),
        rzF: Math.max(0.002, (h.rz + room) * s),
        rzB: Math.max(0.002, (h.rz + room) * s * 1.04),
        n: 2,
      });
    }
    add('hat', 0, rings, { segments: 40, capEnd: true });
    if (st.cap || st.bucket) {
      const brim = new THREE.CylinderGeometry(1, 1, 0.006, 40, 1);
      brim.scale(h.rx * (st.bucket ? 1.6 : 1.15), 1, h.rz * (st.bucket ? 1.6 : 1.5));
      brim.translate(0, h.y + h.ry * 0.12, st.bucket ? 0 : h.rz * 0.55);
      brim.setAttribute('aLocal', new THREE.Float32BufferAttribute(new Float32Array(brim.attributes.position.count * 3).fill(0), 3));
      parts.push({ role: 'brim', side: 0, geometry: brim });
    }
    yTop = h.y + h.ry * 1.1;
    yHem = h.y;
  }

  return { parts, yTop, yHem };
}

/**
 * Per-row horizontal spans of the garment in its photo (from the cutout's alpha),
 * so the photo can be warped onto the body: the middle span covers the torso,
 * the leftmost/rightmost spans cover each trouser leg.
 */
export function silhouetteLookup(alphaRows) {
  const rows = alphaRows.length;
  const center = new Float32Array(rows * 2);
  const left = new Float32Array(rows * 2);
  const right = new Float32Array(rows * 2);
  const has = new Uint8Array(rows);
  for (let r = 0; r < rows; r++) {
    const row = alphaRows[r];
    const n = row.length;
    const runs = [];
    let start = -1;
    for (let i = 0; i <= n; i++) {
      const on = i < n && row[i] > 100;
      if (on && start < 0) start = i;
      if (!on && start >= 0) {
        if (runs.length && start - runs[runs.length - 1][1] < n * 0.02) runs[runs.length - 1][1] = i;
        else runs.push([start, i]);
        start = -1;
      }
    }
    if (!runs.length) continue;
    has[r] = 1;
    const mid = n / 2;
    const c = runs.find((u) => u[0] <= mid && u[1] >= mid) || [runs[0][0], runs[runs.length - 1][1]];
    center.set([c[0] / n, c[1] / n], r * 2);
    left.set([runs[0][0] / n, runs[0][1] / n], r * 2);
    right.set([runs[runs.length - 1][0] / n, runs[runs.length - 1][1] / n], r * 2);
  }
  // Fill empty rows from their nearest filled neighbour.
  let last = -1;
  for (let r = 0; r < rows; r++) {
    if (has[r]) last = r;
    else if (last >= 0) for (const a of [center, left, right]) a.set(a.subarray(last * 2, last * 2 + 2), r * 2);
  }
  last = -1;
  for (let r = rows - 1; r >= 0; r--) {
    if (has[r]) last = r;
    else if (last >= 0 && !center[r * 2 + 1]) for (const a of [center, left, right]) a.set(a.subarray(last * 2, last * 2 + 2), r * 2);
  }
  for (let r = 0; r < rows; r++) {
    if (!center[r * 2 + 1]) {
      center.set([0, 1], r * 2);
      left.set([0, 0.5], r * 2);
      right.set([0.5, 1], r * 2);
    }
  }
  return { rows, center, left, right };
}

// Spans are pulled in a little so the side seams sample fabric, not the cut-out edge.
const spanAt = (arr, rows, v) => {
  const r = Math.min(rows - 1, Math.max(0, Math.round(v * (rows - 1))));
  const a = arr[r * 2];
  const b = arr[r * 2 + 1];
  const inset = (b - a) * 0.035;
  return [a + inset, b - inset];
};

/**
 * Writes `uv` (front photo) and `uvBack` (back photo) for a garment part.
 * front/back are silhouette lookups for each image (back may be the blurred front).
 */
export function assignUVs(part, layout, front, back) {
  const g = part.geometry;
  const pos = g.attributes.position;
  const loc = g.attributes.aLocal;
  const n = pos.count;
  const uv = new Float32Array(n * 2);
  const uvb = new Float32Array(n * 2);
  const { yTop, yHem } = layout;
  const vOf = (y) => Math.min(1, Math.max(0, (yTop - y) / Math.max(0.01, yTop - yHem)));

  let zMin = Infinity, zMax = -Infinity, yMin = Infinity, yMax = -Infinity, xMin = Infinity, xMax = -Infinity;
  for (let i = 0; i < n; i++) {
    zMin = Math.min(zMin, pos.getZ(i)); zMax = Math.max(zMax, pos.getZ(i));
    yMin = Math.min(yMin, pos.getY(i)); yMax = Math.max(yMax, pos.getY(i));
    xMin = Math.min(xMin, pos.getX(i)); xMax = Math.max(xMax, pos.getX(i));
  }

  for (let i = 0; i < n; i++) {
    const lx = loc.getX(i);
    const y = pos.getY(i);
    let fu, fv, bu, bv;
    switch (part.role) {
      case 'body':
      case 'collar': {
        fv = bv = part.role === 'collar' ? 0.02 : vOf(y);
        const [a, b] = spanAt(front.center, front.rows, fv);
        fu = a + (b - a) * (lx + 1) / 2;
        const [c, d] = spanAt(back.center, back.rows, bv);
        bu = c + (d - c) * (1 - lx) / 2;
        break;
      }
      case 'leg': {
        fv = bv = vOf(y);
        // Viewer's left in the front photo is the avatar's right leg (-x).
        const [a, b] = spanAt(part.side < 0 ? front.left : front.right, front.rows, fv);
        fu = a + (b - a) * (lx + 1) / 2;
        const [c, d] = spanAt(part.side < 0 ? back.right : back.left, back.rows, bv);
        bu = c + (d - c) * (1 - lx) / 2;
        break;
      }
      case 'sleeve': {
        // Sample a strip just inside the garment's side edge near the armpit.
        const along = loc.getZ(i);
        fv = bv = Math.min(0.95, 0.12 + along * 0.5);
        const [a, b] = spanAt(front.center, front.rows, fv);
        const w = (b - a) * 0.08;
        fu = part.side < 0 ? a + w * (0.5 + 0.5 * lx) : b - w * (0.5 - 0.5 * lx);
        const [c, d] = spanAt(back.center, back.rows, bv);
        const wb = (d - c) * 0.08;
        bu = part.side < 0 ? d - wb * 0.5 : c + wb * 0.5;
        break;
      }
      case 'shoe': {
        // Shoe photos are side views: map along the foot (toe to the right) and up.
        const along = (pos.getZ(i) - zMin) / Math.max(0.01, zMax - zMin);
        fv = bv = 1 - (y - yMin) / Math.max(0.01, yMax - yMin);
        fu = bu = along;
        break;
      }
      default: {
        fu = bu = (pos.getX(i) - xMin) / Math.max(0.01, xMax - xMin);
        fv = bv = 1 - (y - yMin) / Math.max(0.01, yMax - yMin);
      }
    }
    // Texture v runs bottom-up in three.js.
    uv[i * 2] = fu;
    uv[i * 2 + 1] = 1 - fv;
    uvb[i * 2] = bu;
    uvb[i * 2 + 1] = 1 - bv;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('uvBack', new THREE.BufferAttribute(uvb, 2));
  // Shoes are textured all round from the same side-view photo, so mark every vertex "front".
  if (part.role === 'shoe') for (let i = 0; i < n; i++) loc.setY(i, 1);
}
