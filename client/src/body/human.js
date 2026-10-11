// Realistic human body: the MakeHuman hm08 base mesh (CC0), morphed by sex, height
// and weight and posed with relaxed arms. The data is built by scripts/build-human.py
// into public/human/ and loaded once.
import * as THREE from 'three';

const BASE = (import.meta.env && import.meta.env.BASE_URL) || '/';
let data = null;
let loading = null;

export const humanReady = () => data;

export function loadHuman() {
  if (data) return Promise.resolve(data);
  if (!loading) {
    loading = Promise.all([
      fetch(`${BASE}human/human.json`).then((r) => r.json()),
      fetch(`${BASE}human/human.bin`).then((r) => r.arrayBuffer()),
    ]).then(([info, buf]) => {
      const arr = {};
      const types = { float32: Float32Array, int16: Int16Array, uint16: Uint16Array, uint8: Uint8Array, uint32: Uint32Array };
      for (const [name, a] of Object.entries(info.arrays)) arr[name] = new types[a.type](buf, a.offset, a.length);
      const jointIndex = Object.fromEntries(info.joints.map((j, i) => [j, info.points + i]));
      // Point-level triangle list (for normals) from the render-vertex triangles.
      const map = arr.renderToPoint;
      const idx = arr.index;
      data = { info, arr, jointIndex, totalPoints: info.points + info.joints.length, map, idx };
      return data;
    });
    loading.catch(() => {
      loading = null; // allow a retry
    });
  }
  return loading;
}

const clamp01 = (t) => Math.min(1, Math.max(0, t));

/** MakeHuman macro sliders (0..1) for an avatar. */
export function slidersFor({ sex, heightCm, weightKg }) {
  const female = sex === 'female';
  const H = heightCm / 100;
  const bmi = weightKg / (H * H);
  const mid = female ? 21.5 : 22.5;
  // Above MakeHuman's heaviest shape the weight morph is extrapolated a little.
  const weight = Math.min(1.65, Math.max(0, 0.5 + (bmi > mid ? (bmi - mid) / 17 : (bmi - mid) / 13)));
  // Leaner builds read a little more athletic; heavy builds a little softer.
  const muscle = clamp01((female ? 0.5 : 0.56) - Math.max(0, bmi - 27) * 0.012);
  const h = data.info.heights;
  const s = female ? 'female' : 'male';
  const height =
    H < h[`${s}-avg`] ? 0.5 - (0.5 * (h[`${s}-avg`] - H)) / (h[`${s}-avg`] - h[`${s}-min`]) : 0.5 + (0.5 * (H - h[`${s}-avg`])) / (h[`${s}-max`] - h[`${s}-avg`]);
  return { weight, muscle, height: clamp01(height), bmi };
}

/** Weight of each MakeHuman level (min/average/max) for a 0..1 slider. */
function levels(v) {
  return v < 0.5 ? { min: 1 - 2 * v, average: 2 * v, max: 0 } : { min: 0, average: 2 - 2 * v, max: 2 * v - 1 };
}
// (v > 1 extrapolates: max > 1 and average < 0.)

const v3 = (P, i) => new THREE.Vector3(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);

/** Minimal rotation taking unit vector a onto unit vector b. */
const rotBetween = (a, b) => new THREE.Quaternion().setFromUnitVectors(a.clone().normalize(), b.clone().normalize());

/** Rotation q scaled to a fraction w of its angle (same axis). */
function partial(q, w) {
  if (w >= 0.999) return q;
  return new THREE.Quaternion().slerp(q, w);
}

const cache = new Map();

/**
 * Morphed, posed body in metres: feet on y=0, facing +z, total height = heightCm.
 * Returns { P (points incl. eyes, lashes and joints), joint(name), sliders }.
 */
export function buildHuman(avatar) {
  const key = `${avatar.sex}|${avatar.heightCm}|${avatar.weightKg}`;
  if (cache.has(key)) return cache.get(key);
  const { info, arr, jointIndex, totalPoints } = data;
  const sex = avatar.sex === 'female' ? 'female' : 'male';
  const sl = slidersFor(avatar);
  const P = new Float32Array(arr[`base_${sex}`]);
  const add = (name, w) => {
    if (Math.abs(w) < 1e-4) return;
    const m = info.morphs.find((x) => x.name === `${sex}-${name}`);
    const d = arr[`morph_${sex}-${name}`];
    const k = w * m.scale;
    for (let i = 0; i < d.length; i++) P[i] += d[i] * k;
  };
  const mu = levels(sl.muscle);
  const we = levels(sl.weight);
  for (const m of ['min', 'average', 'max']) {
    for (const w of ['min', 'average', 'max']) {
      if (m === 'average' && w === 'average') continue;
      add(`${m}muscle-${w}weight`, mu[m] * we[w]);
    }
  }
  if (sl.height < 0.5) add('minheight', 1 - 2 * sl.height);
  else add('maxheight', 2 * sl.height - 1);

  pose(P, sl, avatar);

  // Feet on the floor, exact height, torso centred on z = 0.
  const nb = info.bodyPoints;
  let yMin = Infinity, yMax = -Infinity;
  for (let i = 0; i < nb; i++) {
    yMin = Math.min(yMin, P[i * 3 + 1]);
    yMax = Math.max(yMax, P[i * 3 + 1]);
  }
  const s = avatar.heightCm / 100 / (yMax - yMin);
  const pelvis = v3(P, jointIndex['spine05']);
  const zShift = -pelvis.z;
  for (let i = 0; i < totalPoints; i++) {
    P[i * 3] *= s;
    P[i * 3 + 1] = (P[i * 3 + 1] - yMin) * s;
    P[i * 3 + 2] = (P[i * 3 + 2] + zShift) * s;
  }
  const result = { P, sliders: sl, joint: (name) => v3(P, jointIndex[name]), scale: s };
  if (cache.size > 12) cache.delete(cache.keys().next().value);
  cache.set(key, result);
  return result;
}

/** Lowers the arms from MakeHuman's A-pose to hang at the sides, and brings the feet in. */
function pose(P, sl, avatar) {
  const { info, arr, jointIndex } = data;
  const skin = arr.skin;
  const G = info.skinGroups.length;
  const n = info.points;
  const J = (name) => v3(P, jointIndex[name]);
  const female = avatar.sex === 'female';
  // Heavier builds need the arms further out to clear the hips.
  const armDeg = (female ? 7 : 8) + Math.max(0, sl.weight - 0.5) * 20;
  const legDeg = Math.max(0, 4.2 - Math.max(0, sl.weight - 0.5) * 7);

  for (const [s, sign] of [['L', 1], ['R', -1]]) {
    const C = J(`clavicle.${s}`);
    const S = J(`upperarm01.${s}`);
    const E = J(`lowerarm01.${s}`);
    const Wr = J(`wrist.${s}`);
    // Clavicle: drop the shoulder slightly.
    const qc = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -sign * THREE.MathUtils.degToRad(5));
    const qcInv = qc.clone().invert();
    // Upper arm hangs at armDeg from vertical, slightly behind the shoulder line.
    const th = THREE.MathUtils.degToRad(armDeg);
    const uT = new THREE.Vector3(sign * Math.sin(th), -Math.cos(th), -0.04).normalize();
    const u = E.clone().sub(S).normalize();
    const qu = rotBetween(u, uT.clone().applyQuaternion(qcInv));
    // Forearm: nearly straight with a soft forward bend at the elbow.
    const bend = THREE.MathUtils.degToRad(14);
    const fT = new THREE.Vector3(sign * Math.sin(th * 0.6), -Math.cos(bend), Math.sin(bend)).normalize();
    const f = Wr.clone().sub(E).normalize();
    const qcu = qc.clone().multiply(qu);
    const qf = rotBetween(f, fT.clone().applyQuaternion(qcu.clone().invert()));

    const tmp = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const a = skin[i * G] / 255;
      if (a === 0) continue;
      const x = P[i * 3];
      if (Math.sign(x) !== sign) continue;
      const b = skin[i * G + 1] / 255;
      const c = skin[i * G + 2] / 255;
      tmp.set(x, P[i * 3 + 1], P[i * 3 + 2]);
      if (c > 0) tmp.sub(E).applyQuaternion(partial(qf, c)).add(E);
      if (b > 0) tmp.sub(S).applyQuaternion(partial(qu, b)).add(S);
      tmp.sub(C).applyQuaternion(partial(qc, a)).add(C);
      P[i * 3] = tmp.x;
      P[i * 3 + 1] = tmp.y;
      P[i * 3 + 2] = tmp.z;
    }
    // Joints follow their bones.
    const moveJoint = (name, chain) => {
      const j = jointIndex[name];
      tmp.copy(v3(P, j));
      if (chain >= 3) tmp.sub(E).applyQuaternion(qf).add(E);
      if (chain >= 2) tmp.sub(S).applyQuaternion(qu).add(S);
      tmp.sub(C).applyQuaternion(qc).add(C);
      P[j * 3] = tmp.x;
      P[j * 3 + 1] = tmp.y;
      P[j * 3 + 2] = tmp.z;
    };
    moveJoint(`finger3-1.${s}`, 3);
    moveJoint(`wrist.${s}`, 3);
    moveJoint(`lowerarm01.${s}`, 2);
    moveJoint(`upperarm01.${s}`, 1);

    // Legs: rotate in about the hip, then level the foot again.
    const Hp = J(`upperleg01.${s}`);
    const A = J(`foot.${s}`);
    const ql = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -sign * THREE.MathUtils.degToRad(legDeg));
    const qfoot = ql.clone().invert();
    for (let i = 0; i < n; i++) {
      const a = skin[i * G + 3] / 255;
      if (a === 0) continue;
      const x = P[i * 3];
      if (Math.sign(x) !== sign) continue;
      const d = skin[i * G + 4] / 255;
      tmp.set(x, P[i * 3 + 1], P[i * 3 + 2]);
      if (d > 0) tmp.sub(A).applyQuaternion(partial(qfoot, d)).add(A);
      tmp.sub(Hp).applyQuaternion(partial(ql, a)).add(Hp);
      P[i * 3] = tmp.x;
      P[i * 3 + 1] = tmp.y;
      P[i * 3 + 2] = tmp.z;
    }
    for (const name of [`lowerleg01.${s}`, `foot.${s}`]) {
      const j = jointIndex[name];
      tmp.copy(v3(P, j)).sub(Hp).applyQuaternion(ql).add(Hp);
      P[j * 3] = tmp.x;
      P[j * 3 + 1] = tmp.y;
      P[j * 3 + 2] = tmp.z;
    }
  }
}

// ---------------------------------------------------------------- subdivision
// One level of Catmull-Clark on the body quads, so the 13k-vertex base mesh renders
// smooth. Subdivision is linear in the point positions, so the topology is built once.
let topo = null;
function buildTopology() {
  const { info, map, idx } = data;
  const nq = info.bodyIndexCount / 6;
  const nv = info.bodyPoints;
  const quads = new Uint32Array(nq * 4); // point ids
  const rquads = new Uint32Array(nq * 4); // render-vertex ids
  for (let q = 0; q < nq; q++) {
    const r = [idx[q * 6], idx[q * 6 + 1], idx[q * 6 + 2], idx[q * 6 + 5]];
    for (let k = 0; k < 4; k++) {
      rquads[q * 4 + k] = r[k];
      quads[q * 4 + k] = map[r[k]];
    }
  }
  // Edges between points, with their two faces.
  const edgeId = new Map();
  const edgeA = [], edgeB = [], edgeF0 = [], edgeF1 = [];
  const quadEdges = new Uint32Array(nq * 4);
  for (let q = 0; q < nq; q++) {
    for (let k = 0; k < 4; k++) {
      const a = quads[q * 4 + k], b = quads[q * 4 + ((k + 1) & 3)];
      const key = a < b ? a * nv + b : b * nv + a;
      let e = edgeId.get(key);
      if (e === undefined) {
        e = edgeA.length;
        edgeId.set(key, e);
        edgeA.push(a);
        edgeB.push(b);
        edgeF0.push(q);
        edgeF1.push(q);
      } else edgeF1[e] = q;
      quadEdges[q * 4 + k] = e;
    }
  }
  const ne = edgeA.length;
  // Vertex valence and incident face / edge sums are accumulated per call.
  const valence = new Uint16Array(nv);
  for (let e = 0; e < ne; e++) {
    valence[edgeA[e]]++;
    valence[edgeB[e]]++;
  }
  // Render vertices of the subdivided mesh: corners, edge midpoints (per UV edge), face centres.
  const nr = info.renderVerts;
  const rEdge = new Map();
  const outQuads = [];
  const rvPoint = []; // new render vertex -> new point id
  const rvUV = [];
  const uv = arr().uv;
  const ptCorner = (p) => p; // new point ids: [0,nv) vertices, [nv,nv+ne) edges, then faces
  for (let r = 0; r < nr; r++) {
    // corner render verts keep their ids (eye render verts are unused here)
    rvPoint.push(map[r] < nv ? ptCorner(map[r]) : 0);
    rvUV.push(uv[r * 2], uv[r * 2 + 1]);
  }
  const edgeRV = (q, k) => {
    const ra = rquads[q * 4 + k], rb = rquads[q * 4 + ((k + 1) & 3)];
    const key = ra < rb ? ra * nr + rb : rb * nr + ra;
    let v = rEdge.get(key);
    if (v === undefined) {
      v = rvPoint.length;
      rEdge.set(key, v);
      rvPoint.push(nv + quadEdges[q * 4 + k]);
      rvUV.push((uv[ra * 2] + uv[rb * 2]) / 2, (uv[ra * 2 + 1] + uv[rb * 2 + 1]) / 2);
    }
    return v;
  };
  for (let q = 0; q < nq; q++) {
    const c = rvPoint.length;
    rvPoint.push(nv + ne + q);
    let u = 0, w = 0;
    for (let k = 0; k < 4; k++) {
      u += uv[rquads[q * 4 + k] * 2] / 4;
      w += uv[rquads[q * 4 + k] * 2 + 1] / 4;
    }
    rvUV.push(u, w);
    const e = [0, 1, 2, 3].map((k) => edgeRV(q, k));
    for (let k = 0; k < 4; k++) {
      // quad: corner k, edge k, centre, edge k-1
      outQuads.push(rquads[q * 4 + k], e[k], c, e[(k + 3) & 3]);
    }
  }
  const index = new Uint32Array(outQuads.length * 1.5);
  for (let i = 0, j = 0; i < outQuads.length; i += 4) {
    const [a, b, c, d] = [outQuads[i], outQuads[i + 1], outQuads[i + 2], outQuads[i + 3]];
    index.set([a, b, c, a, c, d], j);
    j += 6;
  }
  topo = {
    nv, ne, nq, quads, quadEdges,
    edgeA: Uint32Array.from(edgeA), edgeB: Uint32Array.from(edgeB),
    edgeF0: Uint32Array.from(edgeF0), edgeF1: Uint32Array.from(edgeF1),
    valence, points: nv + ne + nq,
    rvPoint: Uint32Array.from(rvPoint), rvUV: Float32Array.from(rvUV), index,
  };
  return topo;
}
const arr = () => data.arr;

/** Catmull-Clark of per-point values with `dim` components (positions, masks...). */
function subdivide(src, dim) {
  const t = topo || buildTopology();
  const { nv, ne, nq, quads, edgeA, edgeB, edgeF0, edgeF1, valence } = t;
  const out = new Float32Array(t.points * dim);
  const F = nv + ne;
  for (let q = 0; q < nq; q++) {
    for (let d = 0; d < dim; d++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += src[quads[q * 4 + k] * dim + d];
      out[(F + q) * dim + d] = s / 4;
    }
  }
  const Qsum = new Float32Array(nv * dim);
  const Rsum = new Float32Array(nv * dim);
  const nf = new Uint16Array(nv);
  for (let q = 0; q < nq; q++) {
    for (let k = 0; k < 4; k++) {
      const v = quads[q * 4 + k];
      nf[v]++;
      for (let d = 0; d < dim; d++) Qsum[v * dim + d] += out[(F + q) * dim + d];
    }
  }
  for (let e = 0; e < ne; e++) {
    const a = edgeA[e], b = edgeB[e];
    for (let d = 0; d < dim; d++) {
      const pa = src[a * dim + d], pb = src[b * dim + d];
      out[(nv + e) * dim + d] = (pa + pb + out[(F + edgeF0[e]) * dim + d] + out[(F + edgeF1[e]) * dim + d]) / 4;
      const mid = (pa + pb) / 2;
      Rsum[a * dim + d] += mid;
      Rsum[b * dim + d] += mid;
    }
  }
  for (let v = 0; v < nv; v++) {
    const n = valence[v];
    for (let d = 0; d < dim; d++) {
      const Q = Qsum[v * dim + d] / nf[v];
      const R = Rsum[v * dim + d] / n;
      out[v * dim + d] = (Q + 2 * R + (n - 3) * src[v * dim + d]) / n;
    }
  }
  return out;
}

/** Smooth normals for points of an indexed triangle mesh (render index -> point map). */
function normalsFor(P, count, index, rvPoint) {
  const N = new Float32Array(count * 3);
  for (let t = 0; t < index.length; t += 3) {
    const i0 = rvPoint[index[t]], i1 = rvPoint[index[t + 1]], i2 = rvPoint[index[t + 2]];
    const ax = P[i1 * 3] - P[i0 * 3], ay = P[i1 * 3 + 1] - P[i0 * 3 + 1], az = P[i1 * 3 + 2] - P[i0 * 3 + 2];
    const bx = P[i2 * 3] - P[i0 * 3], by = P[i2 * 3 + 1] - P[i0 * 3 + 1], bz = P[i2 * 3 + 2] - P[i0 * 3 + 2];
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    N[i0 * 3] += cx; N[i0 * 3 + 1] += cy; N[i0 * 3 + 2] += cz;
    N[i1 * 3] += cx; N[i1 * 3 + 1] += cy; N[i1 * 3 + 2] += cz;
    N[i2 * 3] += cx; N[i2 * 3 + 1] += cy; N[i2 * 3 + 2] += cz;
  }
  for (let i = 0; i < count; i++) {
    const l = Math.hypot(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]) || 1;
    N[i * 3] /= l; N[i * 3 + 1] /= l; N[i * 3 + 2] /= l;
  }
  return N;
}

let restCache = null;
/** Per-point attributes that don't change with the body: rest position, masks, AO (subdivided). */
function restAttributes() {
  if (restCache) return restCache;
  const { info, arr: a } = data;
  const nb = info.bodyPoints;
  const rest = subdivide(a.base_male.subarray(0, nb * 3), 3);
  const restF = subdivide(a.base_female.subarray(0, nb * 3), 3);
  const m9 = new Float32Array(nb * 9);
  for (let i = 0; i < nb; i++) {
    for (let k = 0; k < 8; k++) m9[i * 9 + k] = a.masks[i * 8 + k] / 255;
    m9[i * 9 + 8] = a.ao[i] / 255;
  }
  const masks = subdivide(m9, 9);
  restCache = { rest, restF, masks };
  return restCache;
}

/** Points spread over the body surface (n x n per quad) with body-part labels, for measuring. */
export function surfaceSamples(body, n = 3) {
  const t = topo || buildTopology();
  const { arr: a } = data;
  const src = body.P;
  const count = t.nq * n * n;
  const P = new Float32Array(count * 3);
  const labels = new Uint8Array(count);
  let k = 0;
  for (let q = 0; q < t.nq; q++) {
    const c = [t.quads[q * 4], t.quads[q * 4 + 1], t.quads[q * 4 + 2], t.quads[q * 4 + 3]];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const u = (i + 0.5) / n, v = (j + 0.5) / n;
        const w = [(1 - u) * (1 - v), u * (1 - v), u * v, (1 - u) * v];
        let best = 0;
        for (let d = 0; d < 3; d++) {
          P[k * 3 + d] = w[0] * src[c[0] * 3 + d] + w[1] * src[c[1] * 3 + d] + w[2] * src[c[2] * 3 + d] + w[3] * src[c[3] * 3 + d];
        }
        for (let m = 1; m < 4; m++) if (w[m] > w[best]) best = m;
        labels[k] = a.labels[c[best]];
        k++;
      }
    }
  }
  return { P, labels, count };
}

/** Skin geometry (subdivided body) for a posed body from buildHuman(). */
export function bodyGeometry(body) {
  const t = topo || buildTopology();
  const { info } = data;
  const P = subdivide(body.P.subarray(0, info.bodyPoints * 3), 3);
  const N = normalsFor(P, t.points, t.index, t.rvPoint);
  const { rest, restF, masks } = restAttributes();
  const nr = t.rvPoint.length;
  const pos = new Float32Array(nr * 3), nor = new Float32Array(nr * 3), rp = new Float32Array(nr * 3), rpf = new Float32Array(nr * 3);
  const msk = new Float32Array(nr * 4), msk2 = new Float32Array(nr * 4), ao = new Float32Array(nr);
  for (let r = 0; r < nr; r++) {
    const i = t.rvPoint[r];
    for (let k = 0; k < 3; k++) {
      pos[r * 3 + k] = P[i * 3 + k];
      nor[r * 3 + k] = N[i * 3 + k];
      rp[r * 3 + k] = rest[i * 3 + k];
      rpf[r * 3 + k] = restF[i * 3 + k];
    }
    for (let k = 0; k < 4; k++) {
      msk[r * 4 + k] = masks[i * 9 + k];
      msk2[r * 4 + k] = masks[i * 9 + 4 + k];
    }
    ao[r] = masks[i * 9 + 8];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(t.rvUV, 2));
  g.setAttribute('aRest', new THREE.BufferAttribute(rp, 3));
  g.setAttribute('aRestF', new THREE.BufferAttribute(rpf, 3));
  g.setAttribute('aMask', new THREE.BufferAttribute(msk, 4));
  g.setAttribute('aMask2', new THREE.BufferAttribute(msk2, 4));
  g.setAttribute('aAO', new THREE.BufferAttribute(ao, 1));
  g.setIndex(new THREE.BufferAttribute(t.index, 1));
  g.computeBoundingSphere();
  return g;
}

/** Eyeball geometry (both eyes) for a posed body. */
export function eyeGeometry(body) {
  const { info, arr: a, map, idx } = data;
  const from = info.bodyIndexCount;
  const count = info.eyeIndexCount;
  // Render vertices used by the eyes are contiguous after the body's.
  let rMin = Infinity, rMax = -Infinity;
  for (let k = from; k < from + count; k++) {
    rMin = Math.min(rMin, idx[k]);
    rMax = Math.max(rMax, idx[k]);
  }
  const n = rMax - rMin + 1;
  const pos = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  const P = body.P;
  for (let r = 0; r < n; r++) {
    const i = map[rMin + r];
    pos.set(P.subarray(i * 3, i * 3 + 3), r * 3);
    uv[r * 2] = a.uv[(rMin + r) * 2];
    uv[r * 2 + 1] = a.uv[(rMin + r) * 2 + 1];
  }
  const index = new Uint16Array(count);
  for (let k = 0; k < count; k++) index[k] = idx[from + k] - rMin;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  g.computeVertexNormals();
  return g;
}

/**
 * Eyelashes grown from MakeHuman's lid-margin helper strips: thin curved ribbons,
 * longer on the upper lid, curling away from the eye.
 */
export function lashGeometry(body, { female = false } = {}) {
  const { info, arr: a } = data;
  const P = body.P;
  const base = info.bodyPoints + info.eyePoints;
  const pos = [], idx = [];
  for (let strip = 0; strip < 4; strip++) {
    const upper = strip % 2 === 1;
    const side = strip < 2 ? 1 : -1;
    const eye = body.joint(side > 0 ? 'eye.L' : 'eye.R');
    const pts = [];
    for (let i = 0; i < info.lashPoints; i++) if (a.lashStrip[i] === strip) pts.push(new THREE.Vector3(P[(base + i) * 3], P[(base + i) * 3 + 1], P[(base + i) * 3 + 2]));
    // Order along the lid by angle around the eye, keep the frontmost point per bin.
    const bins = 18;
    const xs = pts.map((p) => p.x * side);
    const lo = Math.min(...xs), hi = Math.max(...xs);
    const curve = [];
    for (let b = 0; b < bins; b++) {
      const sel = pts.filter((p) => {
        const t = (p.x * side - lo) / (hi - lo);
        return t >= b / bins && t <= (b + 1) / bins + 1e-6;
      });
      if (!sel.length) continue;
      const m = sel.reduce((acc, p) => acc.add(p), new THREE.Vector3()).multiplyScalar(1 / sel.length);
      const front = sel.reduce((best, p) => (p.z > best.z ? p : best), sel[0]);
      curve.push(m.lerp(front, 0.6));
    }
    if (curve.length < 3) continue;
    const count = upper ? (female ? 52 : 44) : 12;
    const len0 = upper ? (female ? 0.0088 : 0.0063) : 0.0026; // metres
    let seed = strip * 977 + 13;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < count; k++) {
      const t = (k + rnd() * 0.8) / count;
      const f = t * (curve.length - 1);
      const i0 = Math.min(curve.length - 2, Math.floor(f));
      const root = curve[i0].clone().lerp(curve[i0 + 1], f - i0);
      const tangent = curve[i0 + 1].clone().sub(curve[i0]).normalize();
      // Outward from the eyeball, tipped forward and curled up (or down for the lower lid).
      const out = root.clone().sub(eye).normalize();
      const up = new THREE.Vector3(0, upper ? 1 : -1, 0);
      const dir = out.clone().multiplyScalar(0.55).add(new THREE.Vector3(0, 0, 0.55)).add(up.clone().multiplyScalar(0.25)).normalize();
      // shorter at the inner and outer corners
      const taper = Math.sin(Math.PI * (0.12 + 0.82 * t)) ** 0.7;
      const len = len0 * (0.55 + 0.45 * taper) * (0.85 + rnd() * 0.3);
      const width = upper ? 0.00017 : 0.00011;
      const segs = 4;
      const start = pos.length / 3;
      let p = root.clone();
      let d = dir.clone();
      for (let j = 0; j <= segs; j++) {
        const w = width * (1 - j / segs * 0.85);
        pos.push(p.x - tangent.x * w, p.y - tangent.y * w, p.z - tangent.z * w);
        pos.push(p.x + tangent.x * w, p.y + tangent.y * w, p.z + tangent.z * w);
        p = p.clone().addScaledVector(d, len / segs);
        d = d.clone().addScaledVector(up, 0.28).normalize();
      }
      for (let j = 0; j < segs; j++) {
        const q = start + j * 2;
        idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
