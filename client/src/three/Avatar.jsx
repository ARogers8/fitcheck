import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { bodyGeometry, buildHuman, eyeGeometry, humanReady, lashGeometry } from '../body/human.js';
import { SKIN_TONES } from '../body/measurements.js';
import { makeSkinMaterial } from './skinMaterial.js';
import Hair from './Hair.jsx';

const BASE = (import.meta.env && import.meta.env.BASE_URL) || '/';
let eyeTexture = null;
function getEyeTexture() {
  if (!eyeTexture) {
    eyeTexture = new THREE.TextureLoader().load(`${BASE}human/eye.png`);
    eyeTexture.colorSpace = THREE.SRGBColorSpace;
    eyeTexture.anisotropy = 4;
  }
  return eyeTexture;
}

function makeEyeMaterial() {
  const mat = new THREE.MeshPhysicalMaterial({
    map: getEyeTexture(),
    roughness: 0.25,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    alphaTest: 0.5,
  });
  // The MakeHuman iris is reddish; shift it to a natural dark brown and calm the sclera.
  mat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
{
  vec3 c = diffuseColor.rgb;
  float l = dot(c, vec3(0.3, 0.59, 0.11));
  float iris = smoothstep(1.5, 2.4, c.r / (c.b + 0.004)) * (1.0 - smoothstep(0.25, 0.45, l));
  vec3 sclera = min(c * vec3(1.16, 1.14, 1.1), vec3(0.9));
  vec3 brown = vec3(0.3, 0.16, 0.08) * clamp(0.3 + 4.0 * l, 0.0, 1.0);
  diffuseColor.rgb = mix(sclera, brown, iris);
}`
    );
  };
  mat.customProgramCacheKey = () => 'fitcheck-eye-v3';
  return mat;
}

export default function Avatar({ avatar, hat = false, top = false }) {
  const tone = SKIN_TONES.find((t) => t.id === avatar.skin)?.color || SKIN_TONES[2].color;
  const female = avatar.sex === 'female';
  const body = buildHuman(avatar);
  const face = humanReady().info.face;
  const style = avatar.hairStyle;
  const scalp = style === 'none' ? 0 : style === 'buzz' ? 1 : 0.85;

  const skinGeo = useMemo(() => bodyGeometry(body), [body]);
  const eyeGeo = useMemo(() => eyeGeometry(body), [body]);
  const lashGeo = useMemo(() => lashGeometry(body, { female }), [body, female]);
  useEffect(() => () => [skinGeo, eyeGeo, lashGeo].forEach((g) => g.dispose()), [skinGeo, eyeGeo, lashGeo]);

  const skin = useMemo(
    () => makeSkinMaterial({ tone, hair: avatar.hairColor, female, scalp, face }),
    [tone, avatar.hairColor, female, scalp, face]
  );
  // Bra straps would show above a strapless dress or a tank: hide them under tops.
  skin.userData.uniforms.uStraps.value = top ? 0 : 1;
  const eyeMat = useMemo(makeEyeMaterial, []);
  const lashMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: new THREE.Color(avatar.hairColor).multiplyScalar(0.35), roughness: 0.6, side: THREE.DoubleSide }),
    [avatar.hairColor]
  );

  return (
    <group>
      <mesh geometry={skinGeo} material={skin} castShadow receiveShadow />
      <mesh geometry={eyeGeo} material={eyeMat} />
      <mesh geometry={lashGeo} material={lashMat} />
      <Hair body={body} avatar={avatar} hat={hat} />
    </group>
  );
}
