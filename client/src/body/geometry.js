// Procedural body and garment geometry.
//
// The body is a set of "tubes": stacks of rounded cross-sections (rings) along a
// path - torso, neck, arms, legs, feet. Garments are built from the same rings,
// pushed outward by the garment's ease and cut to the garment's extent, so every
// piece follows the body exactly and stays aligned when height or weight change.
import * as THREE from 'three';
import { bodyMeasurements, LANDMARKS as L } from './measurements.js';

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (t) => Math.min(1, Math.max(0, t));
const spow = (v, p) => Math.sign(v) * Math.abs(v) ** p;

/** Catmull-Rom through keyframes [{at, ...values}], sampled at `at`. */
function sampleKeys(keys, at, fields) {
  if (at <= keys[0].at) return pick(keys[0], fields);
  if (at >= keys[keys.length - 1].at) return pick(keys[keys.length - 1], fields);
  let i = 0;
  while (keys[i + 1].at < at) i++;
  const k0 = keys[Math.max(0, i - 1)];
  const k1 = keys[i];
  const k2 = keys[i + 1];
  const k3 = keys[Math.min(keys.length - 1, i + 2)];
  const t = (at - k1.at) / (k2.at - k1.at);
  const out = {};
  for (const f of fields) {
    const p0 = k0[f], p1 = k1[f], p2 = k2[f], p3 = k3[f];
    // Uniform Catmull-Rom, clamped so it never overshoots between keys.
    const v =
      0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
    out[f] = Math.min(Math.max(v, Math.min(p1, p2) * 0.97), Math.max(p1, p2) * 1.03);
  }
  return out;
}
const pick = (k, fields) => Object.fromEntries(fields.map((f) => [f, k[f]]));

/** Half-width and depth for an ellipse with circumference c (m) and depth/width ratio k. */
function ellipse(c, k) {
  const rx = c / (Math.PI * (1 + k));
  return { rx, rz: rx * k };
}

/** Everything needed to build the body and fit garments to it, in metres. */
export function makeRig(avatar) {
  const m = bodyMeasurements(avatar);
  const H = m.heightCm / 100;
  const cm = (v) => v / 100;
  const female = avatar.sex === 'female';

  const hip = ellipse(cm(m.hip), female ? 0.78 : 0.72);
  const waist = ellipse(cm(m.waist), female ? 0.72 : 0.78);
  const chest = ellipse(cm(m.chest), female ? 0.62 : 0.66);
  const under = ellipse(cm(m.underbust), 0.7);
  const neckR = cm(m.neck) / (2 * Math.PI);
  const shoulderHalf = cm(m.shoulderWidth) / 2;

  // Torso keyframes from crotch to neck: half-width, front depth, back depth, z-centre.
  const torsoKeys = [
    // The pelvis rounds off into the legs instead of ending in a flat "hem".
    // Below the hip line the torso tucks inside the leg tops (which form the lower pelvis).
    { at: L.crotch, rx: hip.rx * 0.3, rzF: hip.rz * 0.25, rzB: hip.rz * 0.3, cz: -0.006 },
    { at: (L.crotch + L.hip) / 2, rx: hip.rx * 0.62, rzF: hip.rz * 0.48, rzB: hip.rz * 0.65, cz: -0.004 },
    { at: L.hip, rx: hip.rx, rzF: hip.rz * 0.76, rzB: hip.rz * (female ? 1.15 : 1.05), cz: 0 },
    { at: (L.hip + L.waist) / 2, rx: lerp(hip.rx, waist.rx, 0.55), rzF: lerp(hip.rz, waist.rz, 0.6) * 0.95, rzB: lerp(hip.rz, waist.rz, 0.6) * 1.0, cz: 0 },
    { at: L.waist, rx: waist.rx, rzF: waist.rz * 1.02, rzB: waist.rz * 0.95, cz: 0 },
    { at: (L.waist + L.bust) / 2, rx: lerp(waist.rx, female ? under.rx : chest.rx, 0.6), rzF: lerp(waist.rz, under.rz, 0.6), rzB: lerp(waist.rz, under.rz, 0.6) * 0.95, cz: 0 },
    { at: L.bust, rx: chest.rx, rzF: chest.rz * (female ? 1.3 : 1.05), rzB: chest.rz * (female ? 0.85 : 0.98), cz: 0 },
    { at: L.armpit, rx: Math.max(chest.rx * 0.98, shoulderHalf * 0.84), rzF: chest.rz * (female ? 1.0 : 0.98), rzB: chest.rz * 0.95, cz: 0 },
    { at: L.shoulder - 0.022, rx: shoulderHalf * 0.86, rzF: chest.rz * 0.8, rzB: chest.rz * 0.82, cz: -0.003 },
    // Trapezius: the shoulder line slopes up into the neck.
    { at: L.shoulder - 0.004, rx: shoulderHalf * 0.74, rzF: chest.rz * 0.6, rzB: chest.rz * 0.66, cz: -0.005 },
    { at: L.shoulder + 0.01, rx: shoulderHalf * 0.5, rzF: neckR * 1.3, rzB: neckR * 1.6, cz: -0.007 },
    { at: L.neckBase, rx: neckR * 1.45, rzF: neckR * 1.05, rzB: neckR * 1.2, cz: -0.007 },
    { at: L.neckBase + 0.01, rx: neckR * 1.05, rzF: neckR, rzB: neckR * 1.05, cz: -0.006 },
  ];
  const torsoAt = (frac) => {
    const v = sampleKeys(torsoKeys, frac, ['rx', 'rzF', 'rzB', 'cz']);
    return { ...v, y: frac * H };
  };

  // Arms hang in a relaxed A-pose.
  const armAngle = THREE.MathUtils.degToRad(female ? 11 : 12);
  const upperLen = 0.183 * H;
  const foreLen = 0.158 * H;
  const handLen = 0.105 * H;
  const upperR = cm(m.upperArm) / (2 * Math.PI);
  const foreR = cm(m.forearm) / (2 * Math.PI);
  const wristR = cm(m.wrist) / (2 * Math.PI);
  const arm = (side) => {
    const shoulder = new THREE.Vector3(side * (shoulderHalf - upperR * 1.05), L.shoulder * H - upperR * 0.2, -0.004);
    const dirUpper = new THREE.Vector3(side * Math.sin(armAngle), -Math.cos(armAngle), 0);
    const elbow = shoulder.clone().addScaledVector(dirUpper, upperLen);
    const dirFore = new THREE.Vector3(side * Math.sin(armAngle * 0.7), -Math.cos(armAngle * 0.7), 0.06).normalize();
    const wrist = elbow.clone().addScaledVector(dirFore, foreLen);
    const total = upperLen + foreLen;
    const e = upperLen / total;
    return {
      side,
      joints: [shoulder, elbow, wrist],
      dir: dirFore,
      handLen,
      keys: [
        // Rounded deltoid cap that tucks into the shoulder.
        { at: 0, rx: upperR * 0.55, rz: upperR * 0.6 },
        { at: e * 0.07, rx: upperR * 1.18, rz: upperR * 1.12 },
        { at: e * 0.25, rx: upperR * 1.14, rz: upperR * 1.05 },
        { at: e * 0.6, rx: upperR, rz: upperR * 0.95 },
        { at: e, rx: foreR * 0.86, rz: foreR * 0.8 },
        { at: e + (1 - e) * 0.3, rx: foreR * 1.02, rz: foreR * 0.9 },
        { at: 1, rx: wristR * 1.12, rz: wristR * 0.8 },
      ],
      upperFrac: e,
    };
  };

  const thighR = cm(m.thigh) / (2 * Math.PI);
  const kneeR = cm(m.knee) / (2 * Math.PI);
  const calfR = cm(m.calf) / (2 * Math.PI);
  const ankleR = cm(m.ankle) / (2 * Math.PI);
  const leg = (side) => {
    // The leg tops start at hip height and together form the lower pelvis, so the
    // torso flows into the thighs without a ledge.
    const hipJ = new THREE.Vector3(side * hip.rx * 0.47, (L.hip + 0.03) * H, 0);
    const knee = new THREE.Vector3(side * Math.max(kneeR * 1.15, hip.rx * 0.36), L.knee * H, 0.004);
    const ankle = new THREE.Vector3(side * Math.max(ankleR * 1.6, hip.rx * 0.34), L.ankle * H + ankleR * 0.3, -0.006);
    const thighLen = hipJ.distanceTo(knee);
    const total = thighLen + knee.distanceTo(ankle);
    const k = thighLen / total;
    const crotchAt = (hipJ.y - L.crotch * H) / total;
    const hipAt = (hipJ.y - L.hip * H) / total;
    return {
      side,
      joints: [hipJ, knee, ankle],
      keys: [
        { at: 0, rx: hip.rx * 0.45, rzF: hip.rz * 0.6, rzB: hip.rz * 0.8 },
        { at: hipAt, rx: hip.rx * 0.56, rzF: hip.rz * 0.76, rzB: hip.rz * (female ? 1.12 : 1.02) },
        { at: (hipAt + crotchAt) / 2, rx: lerp(hip.rx * 0.56, thighR * 1.08, 0.5), rzF: lerp(hip.rz * 0.76, thighR, 0.6), rzB: lerp(hip.rz * (female ? 1.08 : 1.0), thighR * 1.12, 0.5) },
        { at: crotchAt, rx: thighR * 1.06, rzF: thighR, rzB: thighR * 1.1 },
        { at: k * 0.55, rx: thighR * 0.86, rzF: thighR * 0.86, rzB: thighR * 0.86 },
        { at: k, rx: kneeR, rzF: kneeR, rzB: kneeR * 0.95 },
        { at: k + (1 - k) * 0.28, rx: calfR * 0.95, rzF: calfR * 0.88, rzB: calfR * 1.15 },
        { at: k + (1 - k) * 0.75, rx: ankleR * 1.15, rzF: ankleR * 1.05, rzB: ankleR * 1.05 },
        { at: 1, rx: ankleR, rzF: ankleR, rzB: ankleR },
      ],
      crotchAt,
    };
  };

  return {
    H,
    m,
    female,
    torsoAt,
    hip,
    waist,
    chest,
    neckR,
    shoulderHalf,
    arms: [arm(-1), arm(1)],
    legs: [leg(-1), leg(1)],
    footLen: cm(m.footLength),
    head: { y: 0.935 * H, rx: 0.043 * H, ry: 0.066 * H, rz: 0.054 * H },
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
 * Builds a tube from rings: [{ c: Vector3, right, fwd, rx, rzF, rzB, n }].
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
      const sx = spow(Math.sin(th), p);
      const cz = spow(Math.cos(th), p);
      const rz = cz >= 0 ? ring.rzF : ring.rzB;
      const v = ring.c.clone().addScaledVector(ring.right, ring.rx * sx).addScaledVector(ring.fwd, rz * cz);
      pos.push(v.x, v.y, v.z);
      local.push(sx, Math.cos(th), r / (R - 1));
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
    const t = rig.torsoAt(Math.max(f, L.crotch));
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
    });
  }
  return rings;
}

/** Rings along an arm or leg between path fractions a..b. */
export function limbRings(limb, a, b, { steps = 24, offset = () => 0, n = 2 } = {}) {
  const rings = [];
  for (let i = 0; i <= steps; i++) {
    const at = lerp(a, b, i / steps);
    const { pos, axis } = alongPath(limb.joints, at);
    const { right, fwd } = frameFor(axis);
    const k = sampleKeys(limb.keys, at, limb.keys[0].rzF != null ? ['rx', 'rzF', 'rzB'] : ['rx', 'rz']);
    const o = offset(at);
    rings.push({ c: pos, right, fwd, rx: k.rx + o, rzF: (k.rzF ?? k.rz) + o, rzB: (k.rzB ?? k.rz) + o, n });
  }
  return rings;
}

/** Rings for a foot (or shoe), heel to toe. `o` inflates it for footwear. */
export function footRings(rig, leg, o = 0, { sole = 0 } = {}) {
  const ankle = leg.joints[2];
  const len = rig.footLen + o * 2.2;
  const w = rig.footLen * 0.2 + o;
  const rings = [];
  const steps = 22;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const z = ankle.z - rig.footLen * 0.24 - o + t * len;
    // Profile: rounded heel, tall instep behind the ankle, tapering toe box.
    const width = w * (t < 0.12 ? 0.55 + 3.6 * t : t > 0.88 ? 0.98 - (t - 0.88) * 4.5 : lerp(0.98, 1.08, Math.sin(t * Math.PI)));
    const height = (t < 0.45 ? lerp(0.075, 0.062, t / 0.45) : lerp(0.062, 0.03, (t - 0.45) / 0.55)) * rig.H * 0.5 + o;
    const topY = Math.max(0.005, height) + sole;
    const capT = t < 0.06 ? Math.sqrt(t / 0.06) : t > 0.95 ? Math.sqrt((1 - t) / 0.05) : 1;
    rings.push({
      c: new THREE.Vector3(ankle.x + leg.side * 0.004 * t, topY * 0.5, z),
      right: X,
      fwd: Y,
      rx: Math.max(0.002, width * capT),
      rzF: Math.max(0.002, (topY * 0.5) * capT),
      rzB: Math.max(0.002, (topY * 0.5) * capT),
      n: 3,
    });
  }
  return rings;
}

/** All body meshes for the avatar, as { name, geometry } list. */
export function bodyGeometries(rig) {
  const parts = [];
  parts.push({ name: 'torso', geometry: tubeGeometry(torsoRings(rig, L.crotch, L.neckBase + 0.01, { steps: 48 }), { segments: 56, capStart: true }) });
  // Neck to the base of the skull.
  const neck = [];
  for (let i = 0; i <= 6; i++) {
    const f = lerp(L.neckBase + 0.005, 0.9, i / 6);
    neck.push({ c: new THREE.Vector3(0, f * rig.H, -0.006 - i * 0.001), right: X, fwd: Z, rx: rig.neckR * 1.02, rzF: rig.neckR * 0.98, rzB: rig.neckR * 1.02, n: 2 });
  }
  parts.push({ name: 'neck', geometry: tubeGeometry(neck, { segments: 32 }) });
  for (const arm of rig.arms) {
    parts.push({ name: `arm${arm.side}`, geometry: tubeGeometry(limbRings(arm, 0, 1, { steps: 36 }), { segments: 32, capStart: true, capEnd: true }) });
  }
  for (const leg of rig.legs) {
    parts.push({ name: `leg${leg.side}`, geometry: tubeGeometry(limbRings(leg, 0, 1, { steps: 40 }), { segments: 36, capStart: true, capEnd: true }) });
    parts.push({ name: `foot${leg.side}`, geometry: tubeGeometry(footRings(rig, leg), { segments: 28, capStart: true, capEnd: true }) });
  }
  return parts;
}

export { L as LANDMARKS, alongPath };
