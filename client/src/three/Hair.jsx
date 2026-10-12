import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { hairGeometry } from '../body/hair.js';

// Hair shading: Kajiya-Kay style highlights along each strand (a sharp white one and a
// broader tinted one), soft diffuse, darker roots.
function makeHairMaterial(color) {
  const base = new THREE.Color(color);
  const mat = new THREE.MeshStandardMaterial({ color: base, roughness: 0.75, metalness: 0, envMapIntensity: 0.2, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aShade;\nattribute vec3 aTangent;\nvarying float vShade;\nvarying vec3 vHairT;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvShade = aShade;\nvHairT = normalize(normalMatrix * aTangent);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vShade;\nvarying vec3 vHairT;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vShade;')
      .replace(
        '#include <lights_physical_pars_fragment>',
        THREE.ShaderChunk.lights_physical_pars_fragment
          .replace(
            'reflectedLight.directSpecular += irradiance * BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material );',
            `{
    vec3 T = normalize( vHairT );
    vec3 H = normalize( directLight.direction + geometryViewDir );
    vec3 T1 = normalize( T - geometryNormal * 0.1 );
    vec3 T2 = normalize( T + geometryNormal * 0.14 );
    float d1 = dot( T1, H ), d2 = dot( T2, H );
    float s1 = pow( sqrt( max( 0.0, 1.0 - d1 * d1 ) ), 110.0 );
    float s2 = pow( sqrt( max( 0.0, 1.0 - d2 * d2 ) ), 26.0 );
    float vis = smoothstep( -0.25, 0.4, dot( geometryNormal, directLight.direction ) );
    reflectedLight.directSpecular += directLight.color * vis * ( s1 * 0.06 + s2 * 0.22 * min( material.diffuseColor * 2.5 + 0.03, vec3( 1.0 ) ) );
  }`
          )
          .replace(
            'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );',
            'reflectedLight.directDiffuse += directLight.color * clamp( dot( geometryNormal, directLight.direction ) * 0.75 + 0.25, 0.0, 1.0 ) * BRDF_Lambert( material.diffuseColor );'
          )
      );
  };
  mat.customProgramCacheKey = () => 'fitcheck-hair-v4';
  return mat;
}

export default function Hair({ body, avatar, hat = false }) {
  const female = avatar.sex === 'female';
  const geometry = useMemo(() => hairGeometry(body, avatar.hairStyle, { female, hat }), [body, avatar.hairStyle, female, hat]);
  const material = useMemo(() => makeHairMaterial(avatar.hairColor), [avatar.hairColor]);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  if (!geometry) return null;
  return <mesh geometry={geometry} material={material} castShadow />;
}
