#!/usr/bin/env python3
"""Builds the realistic avatar body from MakeHuman 1.1 assets (CC0).

Usage:
  python3 -I scripts/build-human.py <makehuman/data dir> <out dir>

Reads the hm08 base mesh, the macro targets (sex, height, weight, muscle, the
default 1/3 ethnic mix), the default skeleton and weights and the high-poly eyes,
and writes a compact binary (human.bin + human.json) that the client morphs and
poses at runtime, plus a face-detail texture (human-detail.png) baked in UV space:
lips, brows, beard shadow, scalp and cavity masks.

Units: MakeHuman decimetres are converted to metres; the client rescales to the
user's exact height anyway.
"""
import json
import math
import os
import struct
import sys
import zlib

import numpy as np

DATA, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
T = os.path.join(DATA, 'targets')


# ---------------------------------------------------------------- loading
def load_obj(path):
    V, VT, groups, cur = [], [], {}, None
    for line in open(path):
        if line.startswith('v '):
            V.append([float(x) for x in line.split()[1:4]])
        elif line.startswith('vt '):
            VT.append([float(x) for x in line.split()[1:3]])
        elif line.startswith('g '):
            cur = line.split()[1]
        elif line.startswith('f '):
            f = []
            for t in line.split()[1:]:
                p = t.split('/')
                f.append((int(p[0]) - 1, int(p[1]) - 1 if len(p) > 1 and p[1] else -1))
            groups.setdefault(cur, []).append(f)
    return np.array(V), np.array(VT), groups


V0, VT0, GROUPS = load_obj(os.path.join(DATA, '3dobjs/base.obj'))
NV = len(V0)


def target(rel):
    d = np.zeros((NV, 3))
    for line in open(os.path.join(T, rel)):
        if line.startswith('#') or not line.strip():
            continue
        p = line.split()
        d[int(p[0])] = [float(p[1]), float(p[2]), float(p[3])]
    return d


RACES = ['african', 'asian', 'caucasian']
LEVELS = ['min', 'average', 'max']
SEXES = ['male', 'female']
# Default MakeHuman look: 1/3 of each ethnic target, plus a touch of "ideal" proportions,
# with slightly less pouty lips than the base mesh.
IDEAL = 0.6
FACE_TWEAKS = [('mouth/mouth-lowerlip-volume-decr.target', 0.7), ('mouth/mouth-upperlip-volume-decr.target', 0.25)]

skel = json.load(open(os.path.join(DATA, 'rigs/default.mhskel')))
BONES = skel['bones']
JOINTV = {k: np.array(v) for k, v in skel['joints'].items()}
W = json.load(open(os.path.join(DATA, 'rigs/default_weights.mhw')))['weights']

# Joints the client needs (bone heads, by name) to pose arms and legs and measure the body.
JOINTS = []
for s in ['L', 'R']:
    JOINTS += [f'clavicle.{s}', f'upperarm01.{s}', f'lowerarm01.{s}', f'wrist.{s}', f'finger3-1.{s}',
               f'upperleg01.{s}', f'lowerleg01.{s}', f'foot.{s}', f'eye.{s}']
JOINTS += ['neck01', 'head', 'spine05']
JOINT_SETS = [JOINTV[BONES[b]['head']] for b in JOINTS]
JOINT_SETS.append(JOINTV[BONES['head']['tail']])
JOINTS.append('head.tail')


def joints_of(P):
    return np.array([P[js].mean(0) for js in JOINT_SETS])


# ---------------------------------------------------------------- eyes (mhclo proxy fit)
def load_mhclo(path):
    refs, scales, inside = [], {}, False
    for line in open(path):
        p = line.split()
        if not p or line.startswith('#'):
            continue
        if p[0] in ('x_scale', 'y_scale', 'z_scale'):
            scales[p[0][0]] = (int(p[1]), int(p[2]), float(p[3]))
        elif p[0] == 'verts':
            inside = True
        elif inside and len(p) == 9:
            refs.append(([int(x) for x in p[:3]], [float(x) for x in p[3:6]], [float(x) for x in p[6:9]]))
    return refs, scales


EYE_DIR = os.path.join(DATA, 'eyes/high-poly')
EV, EVT, EG = load_obj(os.path.join(EYE_DIR, 'high-poly.obj'))
EREFS, ESCALES = load_mhclo(os.path.join(EYE_DIR, 'high-poly.mhclo'))
assert len(EREFS) == len(EV)
EIDX = np.array([r[0] for r in EREFS])
EW = np.array([r[1] for r in EREFS])
EOFF = np.array([r[2] for r in EREFS])


def eye_positions(P, with_offset=True):
    pos = (P[EIDX] * EW[:, :, None]).sum(1)
    if with_offset:
        sc = np.array([abs(P[ESCALES[a][0], i] - P[ESCALES[a][1], i]) / ESCALES[a][2] for i, a in enumerate('xyz')])
        pos += EOFF * sc
    return pos


# ---------------------------------------------------------------- body topology
BODY_FACES = GROUPS['body']
body_vidx = sorted({v for f in BODY_FACES for v, _ in f})
NB = len(body_vidx)
remap = -np.ones(NV, dtype=np.int64)
remap[body_vidx] = np.arange(NB)
NE = len(EV)
NJ = len(JOINTS)
# Eyelashes: MakeHuman's lash helper strips along each lid.
LASH_FACES = [f for g, fs in GROUPS.items() if 'eyelashes' in g for f in fs]
lash_vidx = sorted({v for f in LASH_FACES for v, _ in f})
NL = len(lash_vidx)
lremap = -np.ones(NV, dtype=np.int64)
lremap[lash_vidx] = np.arange(NL)
NP = NB + NE + NL  # rendered points (body + eyes + lashes)


def points(P):
    """Rendered points (body + eyes) and joints for a full-mesh position array, in metres."""
    return np.concatenate([P[body_vidx], eye_positions(P), P[lash_vidx], joints_of(P)]) * 0.1


def delta_points(D):
    """Same for a target delta (eyes follow their reference triangles)."""
    return np.concatenate([D[body_vidx], eye_positions(D, with_offset=False), D[lash_vidx], joints_of(D)]) * 0.1


# Render vertices: unique (position, uv) pairs, so UV seams split vertices.
rv_key, rv_pos, rv_uv, tris = {}, [], [], []
for f in BODY_FACES:
    ids = []
    for v, t in f:
        k = (v, t)
        if k not in rv_key:
            rv_key[k] = len(rv_pos)
            rv_pos.append(remap[v])
            rv_uv.append(VT0[t])
        ids.append(rv_key[k])
    tris += [ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]] if len(ids) == 4 else ids[:3]
body_tri_count = len(tris)
eye_key = {}
for g, fs in EG.items():
    for f in fs:
        ids = []
        for v, t in f:
            k = (v, t)
            if k not in eye_key:
                eye_key[k] = len(rv_pos)
                rv_pos.append(NB + v)
                rv_uv.append(EVT[t])
            ids.append(eye_key[k])
        tris += [ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]] if len(ids) == 4 else ids[:3]
eye_tri_count = len(tris) - body_tri_count
# Lash strips (lid margins) are kept as points only; the client grows lashes from them.
lash_strip = np.zeros(NL, dtype=np.uint8)
for g, fs in GROUPS.items():
    if 'eyelashes' in g:
        sid = (0 if '-l-' in g else 2) + (1 if g.endswith('-2') else 0)  # 0 L lower, 1 L upper, 2 R lower, 3 R upper
        for f in fs:
            for v, _ in f:
                lash_strip[lremap[v]] = sid
NR = len(rv_pos)
print('body points', NB, 'eye points', NE, 'render verts', NR, 'tris', len(tris) // 3)

# ---------------------------------------------------------------- morphs
bases, morphs, morph_names = {}, [], []
heights = {}
for sex in SEXES:
    neutral = V0.copy()
    for r in RACES:
        neutral += target(f'macrodetails/{r}-{sex}-young.target') / 3
    neutral += IDEAL * target(f'macrodetails/proportions/{sex}-young-averagemuscle-averageweight-idealproportions.target')
    for rel, w in FACE_TWEAKS:
        neutral += w * target(rel)
    bases[sex] = points(neutral)
    for m in LEVELS:
        for w in LEVELS:
            if m == 'average' and w == 'average':
                continue
            morphs.append(delta_points(target(f'macrodetails/universal-{sex}-young-{m}muscle-{w}weight.target')))
            morph_names.append(f'{sex}-{m}muscle-{w}weight')
    for h in ['min', 'max']:
        d = target(f'macrodetails/height/{sex}-young-averagemuscle-averageweight-{h}height.target')
        morphs.append(delta_points(d))
        morph_names.append(f'{sex}-{h}height')
        P = points(neutral + d)
        heights[f'{sex}-{h}'] = float(P[:NB, 1].max() - P[:NB, 1].min())
    heights[f'{sex}-avg'] = float(bases[sex][:NB, 1].max() - bases[sex][:NB, 1].min())
print('heights (m)', {k: round(v, 3) for k, v in heights.items()})

# ---------------------------------------------------------------- skinning groups
def wsum(names):
    a = np.zeros(NV)
    for n in names:
        for v, w in W.get(n, []):
            a[v] += w
    return a


def side_names(prefixes, s):
    return [b for b in BONES if b.endswith('.' + s) and any(b.startswith(p) for p in prefixes)]


GROUP_DEFS = [
    ('clav', ['clavicle', 'shoulder01']),
    ('upper', ['upperarm']),
    ('fore', ['lowerarm', 'wrist', 'finger', 'metacarpal']),
    ('leg', ['upperleg', 'lowerleg']),
    ('foot', ['foot', 'toe']),
]
skin = np.zeros((NV, len(GROUP_DEFS)))
for s, sign in [('L', 1), ('R', -1)]:
    sel = np.sign(np.round(V0[:, 0], 4)) == sign
    for gi, (_, pre) in enumerate(GROUP_DEFS):
        skin[sel, gi] = wsum(side_names(pre, s))[sel]
# Cumulative chains: arm = clav > upper > fore, leg = leg > foot.
cum = skin.copy()
cum[:, 1] += cum[:, 2]
cum[:, 0] += cum[:, 1]
cum[:, 3] += cum[:, 4]
cum = np.clip(cum, 0, 1)

# Body part labels: 0 torso, 1 neck, 2 head, 3 arm L, 4 arm R, 5 leg L, 6 leg R, 7 eye
head_bones = [b for b in BONES if not any(b.startswith(p) for p in [
    'spine', 'root', 'pelvis', 'clavicle', 'shoulder', 'upperarm', 'lowerarm', 'wrist', 'finger', 'metacarpal',
    'upperleg', 'lowerleg', 'foot', 'toe', 'breast', 'neck'])]
part_w = np.stack([
    wsum([b for b in BONES if b.startswith(('spine', 'root', 'pelvis', 'clavicle', 'shoulder', 'breast'))]),
    wsum(['neck01', 'neck02', 'neck03']),
    wsum(head_bones),
    wsum(side_names(['upperarm', 'lowerarm', 'wrist', 'finger', 'metacarpal'], 'L')),
    wsum(side_names(['upperarm', 'lowerarm', 'wrist', 'finger', 'metacarpal'], 'R')),
    wsum(side_names(['upperleg', 'lowerleg', 'foot', 'toe'], 'L')),
    wsum(side_names(['upperleg', 'lowerleg', 'foot', 'toe'], 'R')),
], 1)
labels = np.concatenate([part_w[body_vidx].argmax(1), np.full(NE + NL, 7)]).astype(np.uint8)

# ---------------------------------------------------------------- cavity / ambient occlusion
quads = np.array([[remap[v] for v, _ in f] for f in BODY_FACES])
def normals_quads(P):
    n = np.cross(P[quads[:, 2]] - P[quads[:, 0]], P[quads[:, 3]] - P[quads[:, 1]])
    N = np.zeros_like(P)
    for k in range(4):
        np.add.at(N, quads[:, k], n)
    return N / np.maximum(1e-12, np.linalg.norm(N, axis=1, keepdims=True))


def ambient_occlusion(P, Nrm, reach=0.06, voxel=0.004, rays=48, seed=1):
    """Short-range AO by marching rays through a voxelised copy of the surface."""
    lo = P.min(0) - 0.05
    dims = np.ceil((P.max(0) + 0.05 - lo) / voxel).astype(int) + 1
    occ = np.zeros(dims, dtype=bool)
    # Densely sample the quads so the voxel shell is watertight.
    for u in np.linspace(0, 1, 6):
        for v in np.linspace(0, 1, 6):
            q = (P[quads[:, 0]] * (1 - u) * (1 - v) + P[quads[:, 1]] * u * (1 - v)
                 + P[quads[:, 2]] * u * v + P[quads[:, 3]] * (1 - u) * v)
            i = ((q - lo) / voxel).astype(int)
            occ[i[:, 0], i[:, 1], i[:, 2]] = True
    rng = np.random.default_rng(seed)
    dirs = rng.normal(size=(rays, 3))
    dirs /= np.linalg.norm(dirs, axis=1, keepdims=True)
    ao = np.zeros(len(P))
    steps = np.linspace(voxel * 2.2, reach, 18)
    for d in dirs:
        cos = Nrm @ d
        ok = cos > 0.05
        hit = np.zeros(len(P), dtype=bool)
        for s in steps:
            q = P + Nrm * voxel * 1.2 + d * s
            i = np.clip(((q - lo) / voxel).astype(int), 0, dims - 1)
            hit |= occ[i[:, 0], i[:, 1], i[:, 2]]
        ao += np.where(ok, cos * (~hit), 0)
    tot = np.zeros(len(P))
    for d in dirs:
        tot += np.maximum(0, Nrm @ d)
    return np.clip(ao / np.maximum(1e-6, tot), 0, 1)


Pm = bases['male'][:NB]
Nm = normals_quads(Pm)
ao = ambient_occlusion(Pm, Nm)
print('ao mean', ao.mean().round(3), 'min', ao.min().round(3))

# ---------------------------------------------------------------- face masks (per point: lips, beard, scalp, redness)
def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


lip_up = np.linalg.norm(target('mouth/mouth-upperlip-volume-incr.target'), axis=1)[body_vidx]
lip_lo = np.linalg.norm(target('mouth/mouth-lowerlip-volume-incr.target'), axis=1)[body_vidx]
lips = np.maximum(lip_up / lip_up.max(), lip_lo / lip_lo.max())
JM = dict(zip(JOINTS, bases['male'][NP:]))
EL, ER = JM['eye.L'], JM['eye.R']
EY = (EL[1] + ER[1]) / 2
wl = lips ** 4
M = (Pm * wl[:, None]).sum(0) / wl.sum()
head_pts = (labels[:NB] == 2) | (labels[:NB] == 1)
hp = Pm[head_pts]
CZ = hp[hp[:, 1] > EY, 2].min() * 0.5 + hp[hp[:, 1] > EY, 2].max() * 0.5  # skull centre depth
TOP = Pm[:, 1].max()
print('landmarks: eyeL', EL.round(4), 'mouth', M.round(4), 'skull cz', round(float(CZ), 4), 'top', round(float(TOP), 4))
x, y, z = Pm[:, 0], Pm[:, 1], Pm[:, 2]
ax = np.abs(x)
phi = np.abs(np.arctan2(x, z - CZ))  # 0 = front, pi = back

# Beard shadow: jaw, chin, upper lip and the front of the neck, below a line from the
# sideburn down to the corner of the mouth.
upper = np.minimum(M[1] + 0.017 + np.maximum(0, ax - 0.026) * 1.15, EY - 0.012)
beard = smooth(0.006, -0.004, y - upper) * smooth(M[1] - 0.105, M[1] - 0.07, y)
beard *= smooth(2.05, 1.75, phi) * head_pts
beard *= 1 - smooth(0.25, 0.6, lips)
# keep the area just under the lower lip lighter, and clear the nose
beard *= 1 - 0.55 * smooth(0.012, 0.0, np.abs(y - (M[1] - 0.013))) * smooth(0.012, 0.004, ax)

# Scalp: where hair grows. Hairline height as a function of the angle around the head.
tab_phi = np.array([0.0, 0.45, 0.8, 1.1, 1.3, 1.45, 1.95, 2.25, 2.6, 3.2])
tab_h = np.array([0.066, 0.063, 0.054, 0.038, -0.012, 0.03, 0.03, 0.0, -0.05, -0.062])
hl = EY + np.interp(phi, tab_phi, tab_h)
scalp = smooth(-0.004, 0.006, y - hl) * head_pts
# no hair on the ears: the ear sticks out beyond the skull
ear = (ax > 0.063) & (y < EY + 0.035) & (y > EY - 0.05) & (phi > 1.2) & (phi < 2.2)
scalp = np.where(ear, 0, scalp)

# Redness: cheeks, nose, ears and around the lips.
cheek = np.exp(-(((ax - 0.042) / 0.018) ** 2) - (((y - (M[1] + 0.035)) / 0.02) ** 2)) * (z > CZ)
nose = np.exp(-((x / 0.012) ** 2) - (((y - (M[1] + 0.03)) / 0.016) ** 2)) * (z > CZ)
red = np.clip(cheek * 0.8 + nose * 0.6 + ear * 0.7 + 0.35 * smooth(0.1, 0.4, lips) * (1 - smooth(0.6, 0.9, lips)), 0, 1) * head_pts

# Mouth interior (behind the lips) reads as a dark slit between them.
inner = (lips > 0.12) & (z < M[2] - 0.009)
ao = np.where(inner, np.minimum(ao, 0.12), ao)

# Underwear, painted on: men's trunks, women's briefs and bra (in each sex's own rest shape).
JF = dict(zip(JOINTS, bases['female'][NP:]))
Fb = bases['female'][:NB]
lab = labels[:NB]
torso_legs = (lab == 0) | (lab == 5) | (lab == 6)


def crotch_y(B, J):
    mid = B[np.abs(B[:, 0]) < 0.004]
    return mid[(mid[:, 1] < J['spine05'][1]) & (mid[:, 1] > J['spine05'][1] - 0.25), 1].min()


# The garment edges are drawn per pixel by the skin shader from these landmarks; the
# masks only say which body parts may carry them.
cy = crotch_y(Pm, JM)
cyf = crotch_y(Fb, JF)
tor_f = (lab == 0)
bust = Fb[tor_f & (Fb[:, 0] > 0.03) & (Fb[:, 1] > JF['spine05'][1] + 0.2)]
NIP = bust[bust[:, 2].argmax()]
UNDERWEAR = {
    'male': {'crotch': float(cy), 'waist': float(JM['spine05'][1] + 0.046)},
    'female': {'crotch': float(cyf), 'waist': float(JF['spine05'][1] + 0.032), 'nipple': NIP.tolist(),
               'shoulder': float(JF['clavicle.L'][1] + 0.03)},
}
print('underwear', UNDERWEAR)
lower_ok = torso_legs.astype(float)
upper_ok = tor_f.astype(float)
# Men's nipples/areolae.
chest = Pm[(lab == 0) & (x > 0.03) & (y > JM['spine05'][1] + 0.2)]
NM = chest[chest[:, 2].argmax()]
areola = smooth(0.0085, 0.0055, np.hypot(ax - NM[0], y - NM[1])) * (z > NM[2] - 0.02) * (lab == 0)
masks = np.stack([lips, beard, scalp, red, lower_ok, upper_ok, np.zeros(NB), areola], 1)
FACE = {'maskChannels': ['lips', 'beard', 'scalp', 'red', 'lowerBody', 'torso', 'unused', 'areola'], 'underwear': UNDERWEAR, 'eyeL': EL.tolist(), 'eyeR': ER.tolist(), 'mouth': M.tolist(), 'skullZ': float(CZ), 'top': float(TOP)}

# ---------------------------------------------------------------- write binary
def f32(a):
    return np.ascontiguousarray(a, dtype='<f4').tobytes()


chunks, meta = [], {}


def put(name, arr, dtype):
    off = sum(len(c) for c in chunks)
    pad = (-off) % 4
    if pad:
        chunks.append(b'\0' * pad)
        off += pad
    b = np.ascontiguousarray(arr, dtype=dtype).tobytes()
    chunks.append(b)
    meta[name] = {'offset': off, 'length': int(np.asarray(arr).size), 'type': np.dtype(dtype).name}


for sex in SEXES:
    put(f'base_{sex}', bases[sex], '<f4')
scales = []
for name, d in zip(morph_names, morphs):
    s = float(np.abs(d).max()) / 32767 or 1e-9
    scales.append(s)
    put(f'morph_{name}', np.round(d / s), '<i2')
put('renderToPoint', np.array(rv_pos), '<u2')
put('uv', np.array(rv_uv), '<f4')
put('index', np.array(tris), '<u2' if NR < 65536 else '<u4')
put('labels', labels, 'u1')
put('skin', np.round(np.concatenate([cum[body_vidx], np.zeros((NE + NL, cum.shape[1]))]) * 255), 'u1')
put('masks', np.round(np.clip(np.concatenate([masks, np.zeros((NE + NL, masks.shape[1]))]), 0, 1) * 255), 'u1')
put('lashStrip', lash_strip, 'u1')
put('ao', np.round(np.concatenate([ao, np.ones(NE + NL)]) * 255), 'u1')

info = {
    'source': 'MakeHuman 1.1 hm08 base mesh, macro targets, default skeleton and high-poly eyes (CC0)',
    'points': NP, 'bodyPoints': NB, 'eyePoints': NE, 'lashPoints': NL, 'joints': JOINTS, 'renderVerts': NR,
    'bodyIndexCount': body_tri_count, 'eyeIndexCount': eye_tri_count, 'indexCount': len(tris),
    'morphs': [{'name': n, 'scale': s} for n, s in zip(morph_names, scales)],
    'skinGroups': [g for g, _ in GROUP_DEFS], 'heights': heights, 'ideal': IDEAL,
    'labels': ['torso', 'neck', 'head', 'armL', 'armR', 'legL', 'legR', 'eye'],
    'face': FACE,
    'arrays': meta,
}
blob = b''.join(chunks)
open(os.path.join(OUT, 'human.bin'), 'wb').write(blob)
json.dump(info, open(os.path.join(OUT, 'human.json'), 'w'), indent=1)
print('human.bin', len(blob), 'bytes; gz', len(zlib.compress(blob, 9)))

