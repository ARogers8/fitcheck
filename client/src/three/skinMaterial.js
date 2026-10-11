// Skin shading for the realistic avatar: a physical material with soft wrapped
// diffuse (a cheap stand-in for subsurface scattering), baked cavity occlusion, and
// procedural detail evaluated per pixel in the body's rest pose: lips, brows, beard
// shadow, scalp tint, blotchiness and pores.
import * as THREE from 'three';

const NOISE = /* glsl */ `
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float vnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x),
                 mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x),
                 mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm(vec3 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; }
  return s;
}
`;

/**
 * @param {object} o
 * @param {string} o.tone      skin colour (sRGB hex)
 * @param {string} o.hair      hair colour (sRGB hex) for brows, stubble and scalp
 * @param {boolean} o.female
 * @param {number} o.scalp     0..1 how much the scalp shows hair colour (buzz cut = 1)
 * @param {object} o.face      rest-pose landmarks from human.json
 */
export function makeSkinMaterial({ tone, hair, female, scalp = 0, face, cloth = '#2a2a2e' }) {
  const uw = face.underwear;
  const toneC = new THREE.Color(tone);
  // Lighter skin has more visible redness and lip contrast.
  const lum = toneC.r * 0.3 + toneC.g * 0.59 + toneC.b * 0.11;
  const mat = new THREE.MeshPhysicalMaterial({
    color: toneC,
    roughness: 0.52,
    metalness: 0,
    sheen: 0.35,
    sheenRoughness: 0.6,
    sheenColor: new THREE.Color(toneC).lerp(new THREE.Color('#ffffff'), 0.35).multiplyScalar(0.35),
    specularIntensity: 0.55,
  });
  const uniforms = {
    uHair: { value: new THREE.Color(hair) },
    uCloth: { value: new THREE.Color(cloth) },
    uStraps: { value: 1 },
    uUwM: { value: new THREE.Vector2(uw.male.crotch, uw.male.waist) },
    uUwF: { value: new THREE.Vector3(uw.female.crotch, uw.female.waist, uw.female.shoulder) },
    uNip: { value: new THREE.Vector3(...uw.female.nipple) },
    uLum: { value: lum },
    uFemale: { value: female ? 1 : 0 },
    uScalp: { value: scalp },
    uEyeL: { value: new THREE.Vector3(...face.eyeL) },
    uEyeR: { value: new THREE.Vector3(...face.eyeR) },
    uWrap: { value: new THREE.Vector3(0.42, 0.2, 0.12) },
  };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec3 aRest;
attribute vec3 aRestF;
attribute vec4 aMask;
attribute vec4 aMask2;
attribute float aAO;
varying vec3 vRest;
varying vec3 vRestF;
varying vec4 vMask;
varying vec4 vMask2;
varying float vAO;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vRest = aRest; vRestF = aRestF; vMask = aMask; vMask2 = aMask2; vAO = aAO;`
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vRest;
varying vec3 vRestF;
varying vec4 vMask;
varying vec4 vMask2;
varying float vAO;
uniform vec2 uUwM;
uniform vec3 uUwF;
uniform vec3 uNip;
uniform float uStraps;
uniform vec3 uHair;
uniform vec3 uCloth;
uniform float uLum;
uniform float uFemale;
uniform float uScalp;
uniform vec3 uEyeL;
uniform vec3 uEyeR;
uniform vec3 uWrap;
${NOISE}
// Eyebrow: analytic shape above each eye in rest space, filled with hair strokes.
float browMask(vec3 p, float footprint) {
  float s = p.x >= 0.0 ? 1.0 : -1.0;
  vec3 E = s > 0.0 ? uEyeL : uEyeR;
  if (p.z < E.z - 0.012) return 0.0;
  float dx = s * (p.x - E.x);
  float dy = p.y - E.y;
  float x0 = mix(-0.0215, -0.0195, uFemale);
  float x1 = mix(0.0285, 0.0285, uFemale);
  float t = (dx - x0) / (x1 - x0);
  if (t < -0.1 || t > 1.1) return 0.0;
  float tc = clamp(t, 0.0, 1.0);
  float peak = mix(0.62, 0.66, uFemale);
  float arch = tc < peak ? sin(tc / peak * 1.5708) : cos((tc - peak) / (1.0 - peak) * 1.5708 * 0.9);
  float yc = mix(0.0128, 0.0150, uFemale) + arch * mix(0.0032, 0.0052, uFemale) - 0.0012 * (1.0 - tc);
  float hw = mix(mix(0.0056, 0.0032, uFemale), mix(0.002, 0.001, uFemale), smoothstep(0.15, 1.0, tc));
  float d = abs(dy - yc);
  float m = smoothstep(hw, hw * 0.45, d);
  m *= smoothstep(-0.08, 0.12, t) * smoothstep(1.06, 0.88, t);
  // Hair strokes: upward at the head of the brow, outward along the rest.
  float ang = mix(1.25, 0.12, smoothstep(0.05, 0.35, tc)) - 0.25 * smoothstep(0.6, 1.0, tc);
  vec2 dir = vec2(cos(ang), sin(ang));
  vec2 q = vec2(dot(vec2(dx, dy), dir), dot(vec2(dx, dy), vec2(-dir.y, dir.x)));
  float strands = vnoise(vec3(q.x * 220.0, q.y * 2600.0, s * 7.0)) * 0.6 + vnoise(vec3(q.x * 400.0, q.y * 4200.0, s * 3.0)) * 0.4;
  strands = smoothstep(0.4, 0.72, strands);
  float detail = 1.0 - smoothstep(0.0004, 0.0012, footprint);
  float dens = mix(0.72, mix(0.45, 1.0, strands), detail);
  // sparser at the head of the brow
  dens *= mix(0.55, 1.0, smoothstep(0.0, 0.25, tc));
  return m * dens;
}
// Underwear edges drawn per pixel in each sex's rest shape. Returns coverage and waistband.
vec2 underwear() {
  if (uFemale < 0.5) {
    float y = vRest.y;
    float m = smoothstep(uUwM.x - 0.083, uUwM.x - 0.08, y) * smoothstep(uUwM.y + 0.0015, uUwM.y - 0.0015, y);
    float band = smoothstep(uUwM.y - 0.03, uUwM.y - 0.028, y);
    return vec2(m * step(0.5, vMask2.x), band);
  }
  vec3 p = vRestF;
  float ax = abs(p.x);
  float yOpen = uUwF.x - 0.006 + max(0.0, ax - 0.02) * (p.z > 0.015 ? 1.2 : 0.55);
  float briefs = smoothstep(yOpen - 0.0015, yOpen + 0.0015, p.y) * smoothstep(uUwF.y + 0.0015, uUwF.y - 0.0015, p.y);
  briefs *= step(0.5, vMask2.x);
  vec3 N = uNip;
  float scoop = N.y + 0.045 - 0.032 * smoothstep(0.07, 0.0, ax);
  float sideTop = N.y + 0.028;
  float top = mix(scoop, sideTop, smoothstep(N.x, N.x + 0.045, ax));
  float bandLo = N.y - 0.092;
  float isFront = smoothstep(0.02, 0.05, p.z);
  float topY = mix(N.y - 0.052, top, isFront);
  float bra = smoothstep(bandLo - 0.0015, bandLo + 0.0015, p.y) * smoothstep(topY + 0.0015, topY - 0.0015, p.y);
  float strapX = N.x - 0.022;
  float strap = smoothstep(0.0072, 0.0055, abs(ax - strapX)) * step(topY - 0.004, p.y) * step(p.y, uUwF.z + 0.08);
  bra = max(bra, strap * uStraps) * step(0.5, vMask2.y);
  float band = smoothstep(uUwF.y - 0.012, uUwF.y - 0.0105, p.y) * briefs + smoothstep(bandLo + 0.012, bandLo + 0.0105, p.y) * bra;
  return vec2(max(briefs, bra), band);
}
vec3 perturbSkin(vec3 pos, vec3 n, float h) {
  vec3 sx = dFdx(pos), sy = dFdy(pos);
  vec3 r1 = cross(sy, n), r2 = cross(n, sx);
  float det = dot(sx, r1);
  vec2 dh = vec2(dFdx(h), dFdy(h));
  vec3 grad = sign(det) * (dh.x * r1 + dh.y * r2);
  return normalize(abs(det) * n - grad);
}`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
float footprint = length(fwidth(vRest));
vec3 skin = diffuseColor.rgb;
// Blotchy variation and a slightly warmer, redder face.
float blot = fbm(vRest * 38.0);
skin *= 0.94 + 0.12 * blot;
float redAmt = vMask.w * mix(0.25, 0.6, smoothstep(0.25, 0.7, uLum));
skin = mix(skin, skin * vec3(1.07, 0.8, 0.78), redAmt);
// Lips: darker and redder than the surrounding skin, with a crisp border.
float lip = smoothstep(0.42, 0.62, vMask.x);
vec3 lipCol = skin * mix(vec3(0.7, 0.52, 0.56), vec3(0.68, 0.47, 0.5), smoothstep(0.2, 0.7, uLum));
lipCol *= 0.92 + 0.12 * vnoise(vRest * vec3(900.0, 120.0, 900.0));
skin = mix(skin, lipCol, lip);
// Beard shadow (men): stubble dots in the hair colour under the skin.
float stub = vMask.y * (1.0 - uFemale);
float dots = smoothstep(0.55, 0.85, vnoise(vRest * 2600.0));
float dotsAvg = mix(dots, 0.32, smoothstep(0.0001, 0.0004, footprint));
vec3 stubCol = mix(skin, uHair * 0.9 + skin * 0.15, 0.85);
skin = mix(skin, mix(skin, stubCol, 0.3 + 0.6 * dotsAvg), stub * mix(0.75, 1.0, 1.0 - uLum));
// Scalp under hair, or a buzz cut.
float sc = smoothstep(0.35, 0.95, vMask.z) * uScalp;
float sdots = mix(smoothstep(0.35, 0.75, vnoise(vRest * 2200.0)), 0.55, smoothstep(0.0001, 0.0004, footprint));
skin = mix(skin, mix(skin * 0.8, uHair, 0.55 + 0.4 * sdots), sc);
// Eyebrows.
float brow = browMask(vRest, footprint);
skin = mix(skin, mix(skin * 0.45, uHair, 0.75), clamp(brow, 0.0, 1.0) * 0.85);
// Areolae (men).
skin = mix(skin, skin * vec3(0.78, 0.6, 0.58), vMask2.w * (1.0 - uFemale) * 0.8);
// Underwear, painted on: trunks for men, briefs and bra for women.
vec2 uw = underwear();
float cloth = uw.x;
float knit = vnoise(vRest * vec3(1800.0, 5200.0, 1800.0));
vec3 clothCol = uCloth * (0.9 + 0.16 * knit) * (1.0 - 0.25 * uw.y);
skin = mix(skin, clothCol, cloth);
diffuseColor.rgb = skin;`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.5, lip);
roughnessFactor = mix(roughnessFactor, 0.75, clamp(brow + sc * 0.8, 0.0, 1.0));
roughnessFactor += (fbm(vRest * 160.0) - 0.5) * 0.12;
roughnessFactor = mix(roughnessFactor, 0.88, cloth);`
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
{
  float poreFade = (1.0 - smoothstep(0.00015, 0.0006, footprint)) * (1.0 - cloth);
  if (poreFade > 0.0) {
    float h = (vnoise(vRest * 1400.0) * 0.6 + vnoise(vRest * 3100.0) * 0.4) * 0.00006 * poreFade;
    h += lip * vnoise(vRest * vec3(80.0, 1800.0, 80.0)) * 0.00012 * poreFade;
    normal = perturbSkin(-vViewPosition, normal, h);
  }
}`
      )
      .replace(
        '#include <lights_physical_pars_fragment>',
        ShaderChunkWrap()
      )
      .replace(
        '#include <lights_physical_fragment>',
        `#include <lights_physical_fragment>
material.sheenColor *= 1.0 - max(lip, cloth * 0.5);
material.specularColor *= 1.0 - 0.55 * lip;`
      )
      .replace(
        '#include <aomap_fragment>',
        `#include <aomap_fragment>
{
  float ao = mix(1.0, vAO, 0.85);
  reflectedLight.indirectDiffuse *= ao;
  reflectedLight.indirectSpecular *= ao * ao;
  reflectedLight.directDiffuse *= mix(1.0, ao, 0.35);
}`
      );
  };
  mat.customProgramCacheKey = () => 'fitcheck-skin-v4';
  mat.userData.uniforms = uniforms;
  return mat;
}

/** The physical lighting chunk with wrapped, red-shifted diffuse on direct lights. */
function ShaderChunkWrap() {
  return THREE.ShaderChunk.lights_physical_pars_fragment.replace(
    'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );',
    `float nl = dot( geometryNormal, directLight.direction );
	vec3 wrapNL = clamp( ( vec3( nl ) + uWrap ) / ( 1.0 + uWrap ), 0.0, 1.0 );
	wrapNL *= wrapNL * 0.25 + 0.75;
	reflectedLight.directDiffuse += wrapNL * directLight.color * BRDF_Lambert( material.diffuseColor );`
  );
}
