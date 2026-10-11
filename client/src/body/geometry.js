// Garment fitting geometry.
//
// The realistic body (human.js) is measured into a "rig": landmark heights and stacks
// of cross-sections (rings) along the torso, arms, legs and feet, each with the body's
// convex outline. Garments are built from the same rings, pushed outward by the
// garment's ease and cut to the garment's extent, so every piece follows the body and
// stays aligned when sex, height or weight change.
import * as THREE from 'three';
import { bodyMeasurements, LANDMARKS as L } from './measurements.js';
import { buildHuman, surfaceSamples } from './human.js';

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (t) => Math.min(1, Math.max(0, t));
const spow = (v, p) => Math.sign(v) * Math.abs(v) ** p;

const HULL_K = 64;

/**
 * Convex outline of 2D points (x across, z front) around the origin, as radii at
 * HULL_K angles (angle 0 = +z/front, pi/2 = +x). Fabric stretched over a body follows
 * its convex hull, so garment shells built on it never cut into the body.
 */
function hullProfile(xs, zs) {
  const K = HULL_K;
  const h = new Float32Array(K);
  for (let j = 0; j < K; j++) {
    const th = (j / K) * Math.PI * 2;
    const sx = Math.sin(th), cz = Math.cos(th);
    let m = -Infinity;
    for (let i = 0; i < xs.length; i++) m = Math.max(m, xs[i] * sx + zs[i] * cz);
    h[j] = m;
  }
  const r = new Float32Array(K);
  for (let k = 0; k < K; k++) {
    let best = Infinity;
    for (let j = 0; j < K; j++) {
      const c = Math.cos(((k - j) / K) * Math.PI * 2);
      if (c > 0.25 && h[j] > 0) best = Math.min(best, h[j] / c);
    }
    r[k] = isFinite(best) ? best : 0;
  }
  // Directions with no body (centre outside the outline) borrow from their neighbours.
  const valid = [...r].map((v) => v > 0.004);
  if (valid.some(Boolean)) {
    for (let k = 0; k < K; k++) {
      if (valid[k]) continue;
      let a = k, b = k, da = 0, db = 0;
      while (!valid[(a + K) % K]) { a--; da++; }
      while (!valid[b % K]) { b++; db++; }
      r[k] = (r[(a + K) % K] * db + r[b % K] * da) / (da + db);
    }
  }
  return r;
}

/** Radius of a hull profile at angle th (radians), linearly interpolated. */
export function hullAt(hull, th) {
  const K = hull.length;
  let f = ((th / (Math.PI * 2)) % 1) * K;
  if (f < 0) f += K;
  const i = Math.floor(f) % K;
  const t = f - Math.floor(f);
  return hull[i] * (1 - t) + hull[(i + 1) % K] * t;
}

function lerpHull(a, b, t) {
  const out = new Float32Array(a.length);
  for (let k = 0; k < a.length; k++) out[k] = a[k] + (b[k] - a[k]) * t;
  return out;
}

/** Cross-section of a set of 2D points: extents plus convex outline around (0, cz). */
function section(xs, zs, centerZ) {
  let rx = 0, zMin = Infinity, zMax = -Infinity;
  for (let i = 0; i < xs.length; i++) {
    rx = Math.max(rx, Math.abs(xs[i]));
    zMin = Math.min(zMin, zs[i]);
    zMax = Math.max(zMax, zs[i]);
  }
  const cz = centerZ ?? (zMin + zMax) / 2;
  const hull = hullProfile(xs, zs.map((z) => z - cz));
  return { rx, rzF: zMax - cz, rzB: cz - zMin, cz, hull };
}

/**
 * Everything needed to fit garments to the body, in metres, measured from the posed
 * realistic body mesh (see human.js): landmark heights, torso cross-sections, arm and
 * leg paths with their cross-sections, feet and head.
 */
export function makeRig(avatar) {
  const m = bodyMeasurements(avatar);
  const H = m.heightCm / 100;
  const female = avatar.sex === 'female';
  const body = buildHuman(avatar);
  // Measure on points sampled densely over the surface (the base mesh is sparse on limbs).
  const { P, labels: lab, count: nb } = surfaceSamples(body, 3);
  const J = (n) => body.joint(n);

  // ---- landmarks
  const hipJ = J('upperleg01.L');
  const S = J('upperarm01.L');
  let crotch = Infinity, chin = Infinity, shoulderTop = -Infinity;
  const eye = J('eye.L');
  for (let i = 0; i < nb; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    const l = lab[i];
    if (Math.abs(x) < 0.006 && l === 0 && y < hipJ.y) crotch = Math.min(crotch, y);
    if (l === 2 && Math.abs(x) < 0.012 && z > eye.z - 0.03) chin = Math.min(chin, y);
    if ((l === 0 || l === 3) && Math.abs(x - S.x) < 0.02 && y < S.y + 0.1) shoulderTop = Math.max(shoulderTop, y);
  }
  const neckBaseY = J('neck01').y - 0.012 * (H / 1.75);

  // ---- torso sections from below the crotch to above the neck base
  const yLo = crotch - 0.02, yHi = neckBaseY + 0.05;
  const N = 110;
  const dy = (yHi - yLo) / N;
  const buckets = Array.from({ length: N + 1 }, () => ({ xs: [], zs: [] }));
  // Above the armpits the shoulder caps belong to the torso shell (where a shoulder seam sits).
  const capY = S.y - 0.045 * (H / 1.75);
  for (let i = 0; i < nb; i++) {
    const l = lab[i];
    const y = P[i * 3 + 1];
    if (l === 2 || ((l === 3 || l === 4) && y < capY)) continue;
    if (y < yLo - dy || y > yHi + dy) continue;
    const b = Math.round((y - yLo) / dy);
    for (const k of [b - 1, b, b + 1]) {
      if (k < 0 || k > N) continue;
      buckets[k].xs.push(P[i * 3]);
      buckets[k].zs.push(P[i * 3 + 2]);
    }
  }
  const slices = buckets.map((b, k) => ({ y: yLo + k * dy, ...section(b.xs, b.zs) }));
  for (let k = 0; k <= N; k++) if (!slices[k].hull || !isFinite(slices[k].rzF)) slices[k] = { ...slices[Math.max(0, k - 1)], y: yLo + k * dy };

  // widest hip, narrowest waist, fullest bust
  const widthAt = (y) => slices[Math.min(N, Math.max(0, Math.round((y - yLo) / dy)))];
  let hipY = hipJ.y, best = 0;
  for (let y = crotch + 0.05 * (H / 1.75); y < crotch + 0.14 * (H / 1.75); y += dy) if (widthAt(y).rx > best) { best = widthAt(y).rx; hipY = y; }
  const armpitY = S.y - 0.075 * (H / 1.75);
  let bustY = armpitY - 0.06, front = -Infinity;
  for (let y = armpitY - 0.16; y < armpitY - 0.01; y += dy) {
    const sl = widthAt(y);
    if (sl.cz + sl.rzF > front) { front = sl.cz + sl.rzF; bustY = y; }
  }
  let waistY = (hipY + bustY) / 2, narrow = Infinity;
  for (let y = hipY + 0.06; y < bustY - 0.06; y += dy) if (widthAt(y).rx < narrow) { narrow = widthAt(y).rx; waistY = y; }

  const Lm = {
    ankle: J('foot.L').y / H,
    knee: J('lowerleg01.L').y / H,
    crotch: crotch / H,
    hip: hipY / H,
    waist: waistY / H,
    bust: bustY / H,
    armpit: armpitY / H,
    shoulder: shoulderTop / H,
    neckBase: neckBaseY / H,
    chin: chin / H,
    top: 1,
  };

  const torsoAt = (frac) => {
    const f = ((frac * H - yLo) / dy);
    const i = Math.min(N - 1, Math.max(0, Math.floor(f)));
    const t = Math.min(1, Math.max(0, f - i));
    const a = slices[i], b = slices[i + 1];
    return {
      rx: lerp(a.rx, b.rx, t),
      rzF: lerp(a.rzF, b.rzF, t),
      rzB: lerp(a.rzB, b.rzB, t),
      cz: lerp(a.cz, b.cz, t),
      hull: lerpHull(a.hull, b.hull, t),
      y: frac * H,
    };
  };

  // ---- limbs: sections perpendicular to the bone path
  const limbSections = (joints, select, count) => {
    const out = [];
    const { total } = alongPath(joints, 0);
    // Slab around each section: thick enough to be a slightly conservative envelope.
    const half = Math.max(0.012, (total / count) * 0.8);
    const pts = [];
    for (let i = 0; i < nb; i++) if (select(i)) pts.push(new THREE.Vector3(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]));
    const v = new THREE.Vector3();
    for (let k = 0; k <= count; k++) {
      const at = k / count;
      const { pos, axis } = alongPath(joints, at);
      const { right, fwd } = frameFor(axis);
      const xs = [], zs = [];
      for (const p of pts) {
        v.subVectors(p, pos);
        const along = v.dot(axis);
        if (Math.abs(along) > half) continue;
        const x = v.dot(right), z = v.dot(fwd);
        if (x * x + z * z > 0.0225) continue;
        xs.push(x);
        zs.push(z);
      }
      if (xs.length < 3) {
        out.push(out.length ? { ...out[out.length - 1], at } : { at, rx: 0.03, rzF: 0.03, rzB: 0.03, hull: new Float32Array(HULL_K).fill(0.03) });
        continue;
      }
      const sec = section(xs, zs, 0);
      out.push({ at, rx: sec.rx, rzF: sec.rzF, rzB: sec.rzB, hull: sec.hull });
    }
    return out;
  };

  const arm = (side) => {
    const s = side > 0 ? 'L' : 'R';
    const joints = [J(`upperarm01.${s}`), J(`lowerarm01.${s}`), J(`wrist.${s}`)];
    const armLabel = side > 0 ? 3 : 4;
    const sections = limbSections(joints, (i) => lab[i] === armLabel, 40);
    const e = joints[0].distanceTo(joints[1]) / (joints[0].distanceTo(joints[1]) + joints[1].distanceTo(joints[2]));
    return { side, joints, sections, upperFrac: e, dir: joints[2].clone().sub(joints[1]).normalize(), handLen: J(`finger3-1.${s}`).distanceTo(joints[2]) * 2 };
  };

  const leg = (side) => {
    const s = side > 0 ? 'L' : 'R';
    const legLabel = side > 0 ? 5 : 6;
    const hip = J(`upperleg01.${s}`);
    // Start the leg path at hip height above the hip joint so leg tops reach the pelvis.
    const top = new THREE.Vector3(hip.x, Math.max(hip.y, hipY) + 0.01, hip.z);
    const ankle = J(`foot.${s}`);
    const joints = [top, J(`lowerleg01.${s}`), ankle];
    const total = joints[0].distanceTo(joints[1]) + joints[1].distanceTo(joints[2]);
    const crotchAt = (top.y - crotch) / total;
    const sections = limbSections(joints, (i) => {
      const l = lab[i];
      if (l === 3 || l === 4 || l === 2) return false;
      const x = P[i * 3] * side;
      if (x <= 0) return false;
      const y = P[i * 3 + 1];
      if (y < ankle.y + 0.012) return false; // the foot belongs to the shoe
      return l === legLabel || y > crotch - 0.01;
    }, 44);
    return { side, joints, sections, crotchAt };
  };

  // ---- feet: profile from heel to toe along each foot's axis
  const foot = (side) => {
    const s = side > 0 ? 'L' : 'R';
    const legLabel = side > 0 ? 5 : 6;
    const ankle = J(`foot.${s}`);
    const pts = [];
    for (let i = 0; i < nb; i++) {
      if (lab[i] !== legLabel) continue;
      const y = P[i * 3 + 1];
      if (y > ankle.y + 0.025) continue;
      pts.push(new THREE.Vector3(P[i * 3], y, P[i * 3 + 2]));
    }
    let heel = pts[0], toe = pts[0];
    for (const p of pts) {
      if (p.z < heel.z) heel = p;
      if (p.z > toe.z) toe = p;
    }
    const axis = new THREE.Vector3(toe.x - heel.x, 0, toe.z - heel.z);
    const len = axis.length();
    axis.normalize();
    const right = new THREE.Vector3(axis.z, 0, -axis.x);
    const origin = new THREE.Vector3(heel.x, 0, heel.z);
    const bins = 24;
    const prof = Array.from({ length: bins + 1 }, () => ({ lo: Infinity, hi: -Infinity, top: 0 }));
    const v = new THREE.Vector3();
    for (const p of pts) {
      v.set(p.x - origin.x, 0, p.z - origin.z);
      const t = v.dot(axis) / len;
      const b = Math.min(bins, Math.max(0, Math.round(t * bins)));
      const x = v.dot(right);
      for (const k of [b - 1, b, b + 1]) {
        if (k < 0 || k > bins) continue;
        prof[k].lo = Math.min(prof[k].lo, x);
        prof[k].hi = Math.max(prof[k].hi, x);
        prof[k].top = Math.max(prof[k].top, p.y);
      }
    }
    return { side, origin, axis, right, len, prof };
  };

  const neck = slices[Math.min(N, Math.round((neckBaseY + 0.025 - yLo) / dy))];

  // ---- head (skull, for hats)
  let hTop = -Infinity, hx = 0, hzMin = Infinity, hzMax = -Infinity;
  for (let i = 0; i < nb; i++) {
    if (lab[i] !== 2) continue;
    const y = P[i * 3 + 1];
    hTop = Math.max(hTop, y);
    if (y > eye.y + 0.015) {
      hx = Math.max(hx, Math.abs(P[i * 3]));
      hzMin = Math.min(hzMin, P[i * 3 + 2]);
      hzMax = Math.max(hzMax, P[i * 3 + 2]);
    }
  }

  // Skull sections (for hats), around the head's centre depth.
  const headZ = (hzMax + hzMin) / 2;
  const HN = 24, hy0 = eye.y - 0.02, hy1 = hTop;
  const hb = Array.from({ length: HN + 1 }, () => ({ xs: [], zs: [] }));
  for (let i = 0; i < nb; i++) {
    if (lab[i] !== 2) continue;
    const y = P[i * 3 + 1];
    if (y < hy0) continue;
    const k = Math.round(((y - hy0) / (hy1 - hy0)) * HN);
    for (const j of [k - 1, k, k + 1]) {
      if (j < 0 || j > HN) continue;
      hb[j].xs.push(P[i * 3]);
      hb[j].zs.push(P[i * 3 + 2] - headZ);
    }
  }
  const headSecs = hb.map((b) => (b.xs.length > 2 ? section(b.xs, b.zs, 0) : null));
  for (let k = HN; k >= 0; k--) if (!headSecs[k]) headSecs[k] = headSecs[k + 1] || headSecs[k - 1];
  const headAt = (y) => {
    const f = Math.min(HN, Math.max(0, ((y - hy0) / (hy1 - hy0)) * HN));
    const i = Math.min(HN - 1, Math.floor(f));
    const t = f - i;
    const a = headSecs[i], b = headSecs[i + 1];
    return { rx: lerp(a.rx, b.rx, t), rzF: lerp(a.rzF, b.rzF, t), rzB: lerp(a.rzB, b.rzB, t), hull: lerpHull(a.hull, b.hull, t) };
  };

  return {
    H,
    m,
    female,
    L: Lm,
    headAt,
    torsoAt,
    neckR: (neck.rx + (neck.rzF + neck.rzB) / 2) / 2,
    shoulderHalf: widthAt(armpitY + 0.03).rx,
    arms: [arm(-1), arm(1)],
    legs: [leg(-1), leg(1)],
    feet: { [-1]: foot(-1), 1: foot(1) },
    footLen: foot(1).len,
    head: { y: (hTop + chin) / 2, ry: (hTop - chin) / 2, rx: hx, rz: (hzMax - hzMin) / 2, z: headZ, eyeY: eye.y },
  };
}

/** Position and frame at fraction `at` (0..1) along a polyline of joints. */
function alongPath(joints, at) {
  const lens = [];
  let total = 0;
  for (let i = 0; i < joints.length - 1; i++) {
    lens.push(joints[i].distanceTo(joints[i + 1]));
    total += lens[i];
  }
  let d = clamp01(at) * total;
  let i = 0;
  while (i < lens.length - 1 && d > lens[i]) d -= lens[i++];
  const a = joints[i];
  const b = joints[i + 1];
  const pos = a.clone().lerp(b, d / lens[i]);
  // Blend the direction near joints so bends are smooth.
  let axis = b.clone().sub(a).normalize();
  const blend = 0.12 * total;
  if (i > 0 && d < blend) {
    const prev = a.clone().sub(joints[i - 1]).normalize();
    axis = prev.lerp(axis, 0.5 + 0.5 * (d / blend)).normalize();
  } else if (i < lens.length - 1 && lens[i] - d < blend) {
    const next = joints[i + 2].clone().sub(b).normalize();
    axis = axis.lerp(next, 0.5 * (1 - (lens[i] - d) / blend)).normalize();
  }
  return { pos, axis, total };
}

function frameFor(axis) {
  const fwd = Z.clone().addScaledVector(axis, -Z.dot(axis)).normalize();
  const right = X.clone().addScaledVector(axis, -X.dot(axis)).addScaledVector(fwd, -X.dot(fwd)).normalize();
  return { right, fwd };
}

/**
 * Builds a tube from rings: [{ c: Vector3, right, fwd, rx, rzF, rzB, n, hull?, base? }].
 * Rings measured from the body carry `hull` (its convex outline) and `base` (the body's
 * own rx/rzF/rzB); the tube then follows the outline, pushed out by however much the
 * ring's radii exceed the body's (the garment's room, flare, drape).
 * Also writes per-vertex attributes used for garment texturing:
 *   aLocal = (x across the ring -1..1, front/back -1..1, ring fraction 0..1).
 */
export function tubeGeometry(rings, { segments = 40, capStart = false, capEnd = false } = {}) {
  const pos = [];
  const local = [];
  const index = [];
  const R = rings.length;
  for (let r = 0; r < R; r++) {
    const ring = rings[r];
    const p = 2 / (ring.n || 2);
    for (let s = 0; s <= segments; s++) {
      const th = (s / segments) * Math.PI * 2;
      const sn = Math.sin(th), cs = Math.cos(th);
      const sx = spow(sn, p);
      let v;
      if (ring.hull && ring.base) {
        const ox = ring.rx - ring.base.rx;
        const oz = cs >= 0 ? ring.rzF - ring.base.rzF : ring.rzB - ring.base.rzB;
        const rad = hullAt(ring.hull, th) + ox * sn * sn + oz * cs * cs;
        v = ring.c.clone().addScaledVector(ring.right, rad * sn).addScaledVector(ring.fwd, rad * cs);
      } else {
        const cz = spow(cs, p);
        const rz = cz >= 0 ? ring.rzF : ring.rzB;
        v = ring.c.clone().addScaledVector(ring.right, ring.rx * sx).addScaledVector(ring.fwd, rz * cz);
      }
      pos.push(v.x, v.y, v.z);
      local.push(sx, cs, r / (R - 1));
    }
  }
  const row = segments + 1;
  for (let r = 0; r < R - 1; r++) {
    for (let s = 0; s < segments; s++) {
      const a = r * row + s;
      const b = a + row;
      index.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const cap = (r, flip) => {
    const ring = rings[r];
    const ci = pos.length / 3;
    pos.push(ring.c.x, ring.c.y, ring.c.z);
    local.push(0, 1, r / (R - 1));
    for (let s = 0; s < segments; s++) {
      const a = r * row + s;
      flip ? index.push(ci, a + 1, a) : index.push(ci, a, a + 1);
    }
  };
  if (capStart) cap(0, false);
  if (capEnd) cap(R - 1, true);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aLocal', new THREE.Float32BufferAttribute(local, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** Torso rings between two height fractions, each pushed out by `offset(frac)` metres. */
export function torsoRings(rig, fromFrac, toFrac, { steps = 28, offset = () => 0, widen = () => 1, n = 2.3 } = {}) {
  const rings = [];
  for (let i = 0; i <= steps; i++) {
    const f = lerp(fromFrac, toFrac, i / steps);
    const t = rig.torsoAt(Math.max(f, rig.L.crotch));
    const o = offset(f);
    const w = widen(f);
    rings.push({
      c: new THREE.Vector3(0, f * rig.H, t.cz),
      right: X,
      fwd: Z,
      rx: t.rx * w + o,
      rzF: t.rzF * w + o,
      rzB: t.rzB * w + o,
      n,
      hull: t.hull,
      base: { rx: t.rx, rzF: t.rzF, rzB: t.rzB },
    });
  }
  return rings;
}

/** Interpolated cross-section of a limb at path fraction `at`. */
function limbSection(limb, at) {
  const secs = limb.sections;
  const f = clamp01(at) * (secs.length - 1);
  const i = Math.min(secs.length - 2, Math.floor(f));
  const t = f - i;
  const a = secs[i], b = secs[i + 1];
  return { rx: lerp(a.rx, b.rx, t), rzF: lerp(a.rzF, b.rzF, t), rzB: lerp(a.rzB, b.rzB, t), hull: lerpHull(a.hull, b.hull, t) };
}

/** Rings along an arm or leg between path fractions a..b. */
export function limbRings(limb, a, b, { steps = 24, offset = () => 0, n = 2 } = {}) {
  const rings = [];
  for (let i = 0; i <= steps; i++) {
    const at = lerp(a, b, i / steps);
    const { pos, axis } = alongPath(limb.joints, at);
    const { right, fwd } = frameFor(axis);
    const k = limbSection(limb, at);
    const o = offset(at);
    rings.push({ c: pos, right, fwd, rx: k.rx + o, rzF: k.rzF + o, rzB: k.rzB + o, n, hull: k.hull, base: { rx: k.rx, rzF: k.rzF, rzB: k.rzB } });
  }
  return rings;
}

/** Rings for a foot (or shoe), heel to toe, from the measured foot. `o` inflates it for footwear. */
export function footRings(rig, leg, o = 0, { sole = 0 } = {}) {
  const ft = rig.feet[leg.side];
  const rings = [];
  const steps = 22;
  const B = ft.prof.length - 1;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const pr = ft.prof[Math.min(B, Math.round(t * B))];
    // Overshoot the heel and toe slightly so the shoe closes around them.
    const along = -o * 1.1 + t * (ft.len + o * 2.2);
    const mid = (pr.lo + pr.hi) / 2;
    const half = Math.max(0.004, (pr.hi - pr.lo) / 2);
    const capT = t < 0.07 ? Math.sqrt(t / 0.07) : t > 0.94 ? Math.sqrt((1 - t) / 0.06) : 1;
    const topY = Math.max(0.006, pr.top) + o + sole;
    const c = ft.origin.clone().addScaledVector(ft.axis, along).addScaledVector(ft.right, mid);
    c.y = topY * 0.5;
    rings.push({
      c,
      right: ft.right,
      fwd: Y,
      rx: Math.max(0.002, (half + o) * capT),
      rzF: Math.max(0.002, topY * 0.5 * capT),
      rzB: Math.max(0.002, topY * 0.5 * capT),
      n: 3,
    });
  }
  return rings;
}

export { L as LANDMARKS, alongPath };
