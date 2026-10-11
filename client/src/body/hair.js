// Procedural hair: thousands of thin tapered strands grown from the scalp of the
// posed body, combed, curled and kept off the head and shoulders.
import * as THREE from 'three';
import { humanReady } from './human.js';

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/** Radial "height field" of the head (around its centre) and the body (around the vertical axis). */
function collider(body) {
  const { info, arr } = humanReady();
  const P = body.P;
  const nb = info.bodyPoints;
  const labels = arr.labels;
  const eye = body.joint('eye.L').add(body.joint('eye.R')).multiplyScalar(0.5);
  let top = -Infinity;
  let zMin = Infinity, zMax = -Infinity;
  for (let i = 0; i < nb; i++) {
    if (labels[i] !== 2) continue;
    const y = P[i * 3 + 1];
    top = Math.max(top, y);
    if (y > eye.y) {
      zMin = Math.min(zMin, P[i * 3 + 2]);
      zMax = Math.max(zMax, P[i * 3 + 2]);
    }
  }
  const C = new THREE.Vector3(0, eye.y + (top - eye.y) * 0.15, (zMin + zMax) / 2 - 0.004);
  const TH = 36, PH = 72;
  const head = new Float32Array(TH * PH);
  const bin = (v) => {
    const r = v.length();
    const th = Math.acos(THREE.MathUtils.clamp(v.y / r, -1, 1));
    const ph = Math.atan2(v.x, v.z) + Math.PI;
    return [Math.min(TH - 1, Math.floor((th / Math.PI) * TH)), Math.min(PH - 1, Math.floor((ph / (2 * Math.PI)) * PH)), r];
  };
  const v = new THREE.Vector3();
  for (let i = 0; i < nb; i++) {
    if (labels[i] > 2) continue;
    v.set(P[i * 3] - C.x, P[i * 3 + 1] - C.y, P[i * 3 + 2] - C.z);
    if (v.y < -0.16) continue;
    const [a, b, r] = bin(v);
    head[a * PH + b] = Math.max(head[a * PH + b], r);
  }
  // Fill holes and smooth a little.
  for (let pass = 0; pass < 3; pass++) {
    const src = head.slice();
    for (let a = 0; a < TH; a++) {
      for (let b = 0; b < PH; b++) {
        let m = src[a * PH + b];
        for (let da = -1; da <= 1; da++) {
          for (let db = -1; db <= 1; db++) {
            const aa = Math.min(TH - 1, Math.max(0, a + da));
            const bb = (b + db + PH) % PH;
            m = Math.max(m, src[aa * PH + bb] * (pass === 0 ? 1 : 0.985));
          }
        }
        head[a * PH + b] = pass === 0 && src[a * PH + b] > 0 ? src[a * PH + b] : m;
      }
    }
  }
  // Body: max radius around the vertical axis per height band and angle (no arms).
  const YB = 80, AB = 48;
  const yLo = 0.45 * top, yHi = top;
  const torso = new Float32Array(YB * AB);
  const bz = 0;
  for (let i = 0; i < nb; i++) {
    const l = labels[i];
    if (l > 2) continue;
    const y = P[i * 3 + 1];
    if (y < yLo || y > yHi) continue;
    const yb = Math.min(YB - 1, Math.floor(((y - yLo) / (yHi - yLo)) * YB));
    const ang = Math.atan2(P[i * 3], P[i * 3 + 2] - bz) + Math.PI;
    const ab = Math.min(AB - 1, Math.floor((ang / (2 * Math.PI)) * AB));
    const r = Math.hypot(P[i * 3], P[i * 3 + 2] - bz);
    torso[yb * AB + ab] = Math.max(torso[yb * AB + ab], r);
  }
  // Smooth (and fill) the body field along the angle.
  for (let pass = 0; pass < 2; pass++) {
    const src = torso.slice();
    for (let yb = 0; yb < YB; yb++) {
      for (let ab = 0; ab < AB; ab++) {
        let m = 0;
        for (let d = -1; d <= 1; d++) for (let e = -1; e <= 1; e++) m = Math.max(m, src[Math.min(YB - 1, Math.max(0, yb + e)) * AB + ((ab + d + AB) % AB)]);
        torso[yb * AB + ab] = m;
      }
    }
  }

  const headR = (dir) => {
    const th = Math.acos(THREE.MathUtils.clamp(dir.y, -1, 1));
    const ph = Math.atan2(dir.x, dir.z) + Math.PI;
    const a = Math.min(TH - 1, Math.floor((th / Math.PI) * TH));
    const b = Math.min(PH - 1, Math.floor((ph / (2 * Math.PI)) * PH));
    return head[a * PH + b];
  };
  const tmp = new THREE.Vector3();
  /** Pushes p (in place) to at least `off` outside the head and body. */
  const pushOut = (p, off, bodyOff = off) => {
    tmp.subVectors(p, C);
    const d = tmp.length();
    if (d > 1e-6) {
      tmp.multiplyScalar(1 / d);
      const r = headR(tmp) + off;
      if (d < r && tmp.y > -0.75) p.copy(C).addScaledVector(tmp, r);
    }
    if (p.y > yLo && p.y < yHi - 0.02 && p.y < C.y - 0.06) {
      const yb = Math.min(YB - 1, Math.floor(((p.y - yLo) / (yHi - yLo)) * YB));
      const ang = Math.atan2(p.x, p.z - bz) + Math.PI;
      const ab = Math.min(AB - 1, Math.floor((ang / (2 * Math.PI)) * AB));
      const R = torso[yb * AB + ab] + bodyOff;
      const r = Math.hypot(p.x, p.z - bz);
      if (r < R && r > 1e-6) {
        p.x *= R / r;
        p.z = bz + (p.z - bz) * (R / r);
      }
    }
    return p;
  };
  return { C, top, eye, pushOut, headR };
}

/** Random root points on the scalp, with surface normals and the scalp-mask value. */
function scalpRoots(body, count, rand, minMask = 0.5) {
  const { info, arr, map, idx } = humanReady();
  const P = body.P;
  const masks = arr.masks;
  const tris = [];
  let total = 0;
  for (let t = 0; t < info.bodyIndexCount; t += 3) {
    const i0 = map[idx[t]], i1 = map[idx[t + 1]], i2 = map[idx[t + 2]];
    const m = (masks[i0 * 8 + 2] + masks[i1 * 8 + 2] + masks[i2 * 8 + 2]) / (3 * 255);
    if (m < minMask) continue;
    const a = new THREE.Vector3(P[i0 * 3], P[i0 * 3 + 1], P[i0 * 3 + 2]);
    const b = new THREE.Vector3(P[i1 * 3], P[i1 * 3 + 1], P[i1 * 3 + 2]);
    const c = new THREE.Vector3(P[i2 * 3], P[i2 * 3 + 1], P[i2 * 3 + 2]);
    const n = b.clone().sub(a).cross(c.clone().sub(a));
    const area = n.length() / 2;
    total += area;
    tris.push({ a, b, c, n: n.normalize(), cum: total, m });
  }
  const roots = [];
  for (let k = 0; k < count; k++) {
    const r = rand() * total;
    let lo = 0, hi = tris.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tris[mid].cum < r) lo = mid + 1;
      else hi = mid;
    }
    const t = tris[lo];
    let u = rand(), v = rand();
    if (u + v > 1) {
      u = 1 - u;
      v = 1 - v;
    }
    const p = t.a.clone().multiplyScalar(1 - u - v).addScaledVector(t.b, u).addScaledVector(t.c, v);
    roots.push({ p, n: t.n.clone(), m: t.m });
  }
  return roots;
}

/**
 * Grows one guide strand. Returns its points.
 * style: short | long | bun. `zone` 0..1 is how much the root sits on the crown.
 */
/** How much a root sits on the crown (0 = sides/back, 1 = top), and its natural length. */
function crownOf(p, col) {
  return THREE.MathUtils.clamp((p.y - (col.eye.y + 0.035)) / 0.07, 0, 1);
}
function shortLen(crown, female) {
  // a fade: very short on the sides and back, longer from the temples up
  const top = THREE.MathUtils.smoothstep(crown, 0.4, 0.9);
  return THREE.MathUtils.lerp(0.0045, female ? 0.075 : 0.06, top);
}

function growGuide(root, style, col, rand, opts) {
  const { C, eye } = col;
  const n = root.n;
  const rel = root.p.clone().sub(C);
  const side = Math.sign(rel.x) || 1;
  const crown = THREE.MathUtils.clamp((root.p.y - (eye.y + 0.035)) / 0.07, 0, 1);
  const frontness = THREE.MathUtils.clamp(rel.z / 0.07, -1, 1);
  const g = new THREE.Vector3(0, -1, 0);
  const pts = [root.p.clone().addScaledVector(n, 0.0003)];
  const p = pts[0].clone();
  let d, len, segs, curlR = 0, curlAmp = 0, lift, liftTip;
  if (style === 'short') {
    // Curly crop: volume on top, short and close at the sides and back.
    const top = THREE.MathUtils.smoothstep(crown, 0.4, 0.9);
    len = shortLen(crown, opts.female) * (0.85 + rand() * 0.3);
    segs = top > 0.25 ? 14 : 6;
    const comb = new THREE.Vector3(side * 0.15, 0.25, 0.9 + 0.2 * frontness).normalize();
    const down = new THREE.Vector3(side * 0.25, -1, -0.35).normalize();
    d = n.clone().multiplyScalar(top > 0.25 ? 1.0 : 0.35).addScaledVector(top > 0.25 ? comb : down, top > 0.25 ? 0.45 : 1).normalize();
    curlR = 0.0032 + rand() * 0.0022;
    curlAmp = top > 0.25 ? 1 : 0.6;
    lift = 0.0015;
    liftTip = top > 0.25 ? 0.006 + 0.022 * top : 0.0025;
    if (opts.hat) {
      // flattened under a hat
      len = Math.min(len, 0.012);
      liftTip = Math.min(liftTip, 0.003);
      curlAmp *= 0.3;
    }
  } else if (style === 'long') {
    len = (opts.female ? 0.42 : 0.32) * (0.92 + rand() * 0.12);
    segs = 18;
    // Parted at the front of the crown; behind the crown the hair simply falls down the back.
    const partW = THREE.MathUtils.smoothstep(rel.z, -0.06, 0.0);
    const away = new THREE.Vector3(side * 0.7 * partW + (rand() - 0.5) * 0.1, -0.6 - 0.4 * (1 - partW), frontness > 0 ? -0.45 : -0.3).normalize();
    d = n.clone().multiplyScalar(0.12).addScaledVector(away, 1).normalize();
    curlR = 0.025 + rand() * 0.015;
    curlAmp = 0.08;
    lift = 0.0015;
    liftTip = opts.hat ? 0.0025 : 0.004;
  } else {
    len = root.p.distanceTo(opts.bun) * 1.02;
    segs = 10;
    d = opts.bun.clone().sub(root.p).normalize();
    lift = 0.0012;
    liftTip = 0.0015;
  }
  const step = len / segs;
  const phase = rand() * Math.PI * 2;
  const ref = new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();
  let travelled = 0;
  const center = p.clone();
  for (let s = 1; s <= segs; s++) {
    const t = s / segs;
    if (style === 'short') {
      d.addScaledVector(n, -0.1).addScaledVector(g, 0.06 + 0.1 * t).normalize();
    } else if (style === 'long') {
      d.addScaledVector(g, 0.45 + 0.3 * t).normalize();
      const q = center.clone().sub(C);
      // keep the face clear: hair in front of the ears is swept back and out
      if (q.z > -0.03 && q.y < 0.03) d.add(new THREE.Vector3(Math.sign(q.x) * 0.2, 0, -0.35)).normalize();
      if (center.y < eye.y - 0.12) d.add(new THREE.Vector3(0, 0, -0.12)).normalize();
    } else {
      d = opts.bun.clone().sub(center).normalize();
    }
    center.addScaledVector(d, step);
    travelled += step;
    const off = lift + (liftTip - lift) * Math.min(1, t * 1.5);
    col.pushOut(center, off, style === 'long' ? 0.022 : off);
    const out = center.clone();
    if (curlAmp > 0) {
      const a1 = new THREE.Vector3().crossVectors(d, ref).normalize();
      const a2 = new THREE.Vector3().crossVectors(d, a1).normalize();
      const ang = phase + travelled / curlR;
      const amp = curlR * curlAmp * Math.min(1, t * 2.5);
      out.addScaledVector(a1, Math.cos(ang) * amp).addScaledVector(a2, Math.sin(ang) * amp);
      col.pushOut(out, off * 0.7, style === 'long' ? 0.02 : off * 0.7);
    }
    pts.push(out);
  }
  return pts;
}

const STYLES = {
  short: { guides: 900, strands: 16000, clump: 0.75, width: 0.0007 },
  long: { guides: 1000, strands: 15000, clump: 0.6, width: 0.0007 },
  bun: { guides: 500, strands: 11000, clump: 0.3, width: 0.0006 },
};

/**
 * Builds hair geometry for a style ('short' | 'long' | 'bun'); buzz cuts and bald are
 * painted on the scalp by the skin shader instead.
 */
export function hairGeometry(body, style, { female = false, hat = false, seed = 7 } = {}) {
  const cfg = STYLES[style];
  if (!cfg) return null;
  const rand = rng(seed + style.length * 101 + (female ? 5 : 0));
  const col = collider(body);
  const { C } = col;
  const bun = new THREE.Vector3(0, C.y + 0.05, C.z - 0.1);
  const opts = { female, bun, hat };
  const guideRoots = scalpRoots(body, cfg.guides, rand);
  const guides = guideRoots.map((r) => growGuide(r, style, col, rand, opts));
  const roots = scalpRoots(body, cfg.strands, rand, 0.4);

  // Bucket guides on a coarse grid for nearest-guide lookups.
  const cell = 0.015;
  const grid = new Map();
  const key = (p) => `${Math.floor(p.x / cell)},${Math.floor(p.y / cell)},${Math.floor(p.z / cell)}`;
  guideRoots.forEach((r, i) => {
    const k = key(r.p);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  });
  const nearest = (p) => {
    let best = -1, bd = Infinity;
    const cx = Math.floor(p.x / cell), cy = Math.floor(p.y / cell), cz = Math.floor(p.z / cell);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const list = grid.get(`${cx + dx},${cy + dy},${cz + dz}`);
      if (!list) continue;
      for (const i of list) {
        const d = guideRoots[i].p.distanceToSquared(p);
        if (d < bd) { bd = d; best = i; }
      }
    }
    if (best < 0) {
      guideRoots.forEach((r, i) => {
        const d = r.p.distanceToSquared(p);
        if (d < bd) { bd = d; best = i; }
      });
    }
    return best;
  };

  const pos = [], nor = [], tan = [], shade = [], index = [];
  const pushStrand = (pts, rootN, width, tone, crownW = 1) => {
    const base = pos.length / 3;
    const m = pts.length;
    for (let s = 0; s < m; s++) {
      const a = pts[Math.max(0, s - 1)], b = pts[Math.min(m - 1, s + 1)];
      const t3 = b.clone().sub(a).normalize();
      let w = new THREE.Vector3().crossVectors(t3, rootN);
      if (w.lengthSq() < 1e-8) w = new THREE.Vector3(1, 0, 0);
      w.normalize();
      const nn = rootN.clone().addScaledVector(t3, -rootN.dot(t3)).normalize();
      const t = s / (m - 1);
      const hw = width * (1 - 0.85 * t);
      const q = pts[s];
      pos.push(q.x - w.x * hw, q.y - w.y * hw, q.z - w.z * hw, q.x + w.x * hw, q.y + w.y * hw, q.z + w.z * hw);
      nor.push(nn.x, nn.y, nn.z, nn.x, nn.y, nn.z);
      tan.push(t3.x, t3.y, t3.z, t3.x, t3.y, t3.z);
      const sh = tone * (0.45 + 0.45 * Math.min(1, t * 1.8)) * (0.55 + 0.45 * crownW);
      shade.push(sh, sh);
    }
    for (let s = 0; s < m - 1; s++) {
      const q = base + s * 2;
      index.push(q, q + 1, q + 2, q + 1, q + 3, q + 2);
    }
  };

  for (const root of roots) {
    const gi = nearest(root.p);
    const guide = guides[gi];
    const g0 = guide[0];
    const off = root.p.clone().sub(g0);
    const jitter = new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(style === 'long' ? 0.0012 : 0.003);
    // Strands take their guide's shape but their own length (short sides stay short).
    let lenScale = style === 'long' ? 0.93 + rand() * 0.1 : 0.85 + rand() * 0.2;
    if (style === 'short') {
      const own = shortLen(crownOf(root.p, col), female);
      const gl = shortLen(crownOf(guideRoots[gi].p, col), female);
      lenScale *= Math.min(1.15, own / gl);
    }
    const pts = [];
    for (let s = 0; s < guide.length; s++) {
      const t = s / (guide.length - 1);
      const q = g0.clone().lerp(guide[s], lenScale);
      q.addScaledVector(off, 1 - cfg.clump * t).addScaledVector(jitter, Math.sin(t * Math.PI));
      if (s > 0) col.pushOut(q, 0.0008, 0.0008);
      pts.push(q);
    }
    pts[0] = root.p.clone().addScaledVector(root.n, 0.0003);
    if (style === 'short') {
      // never longer than this root's own length allows (guides can sit in a longer zone)
      const maxD = hat ? 0.014 : shortLen(crownOf(root.p, col), female) * 1.3 + 0.002;
      for (let s = 1; s < pts.length; s++) if (pts[s].distanceTo(pts[0]) > maxD) pts[s].copy(pts[s - 1]);
    }
    pushStrand(pts, root.n, cfg.width, 0.8 + rand() * 0.3, style === 'short' ? 0.3 + 0.7 * crownOf(root.p, col) : 1);
  }

  if (style === 'bun') {
    // The bun: strands wound around a squashed sphere.
    const R = 0.034;
    for (let k = 0; k < 2400; k++) {
      const axis = new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();
      const start = new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).projectOnPlane(axis).normalize();
      const segs = 18;
      const arc = Math.PI * (0.8 + rand() * 0.8);
      const r = R * (0.75 + rand() * 0.3);
      const pts = [];
      for (let s = 0; s <= segs; s++) {
        const dir = start.clone().applyAxisAngle(axis, (arc * s) / segs);
        pts.push(bun.clone().add(new THREE.Vector3(dir.x * r * 1.1, dir.y * r * 0.85, dir.z * r * 0.9)));
      }
      pushStrand(pts, start.clone(), 0.0008, 0.85 + rand() * 0.3);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('aTangent', new THREE.Float32BufferAttribute(tan, 3));
  geo.setAttribute('aShade', new THREE.Float32BufferAttribute(shade, 1));
  geo.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(index, 1) : new THREE.Uint16BufferAttribute(index, 1));
  geo.computeBoundingSphere();
  return geo;
}
