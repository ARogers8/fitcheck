import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { garmentParts, assignUVs } from './garmentGeometry.js';
import { garmentTextures } from './textures.js';

/** Fabric material that shows the front photo on the front and the back photo behind. */
function makeFabricMaterial({ front, back, roughness, sheen }) {
  const mat = new THREE.MeshStandardMaterial({ map: front, roughness, metalness: 0, side: THREE.DoubleSide });
  mat.userData.backMap = { value: back };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.backMap = mat.userData.backMap;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 uvBack;\nattribute vec3 aLocal;\nvarying vec2 vUvBack;\nvarying float vFront;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvUvBack = uvBack;\nvFront = aLocal.y;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D backMap;\nvarying vec2 vUvBack;\nvarying float vFront;')
      .replace(
        '#include <map_fragment>',
        `vec4 fc = texture2D(map, vMapUv);
         vec4 bc = texture2D(backMap, vUvBack);
         vec4 sampledDiffuseColor = mix(bc, fc, smoothstep(-0.35, 0.35, vFront));
         diffuseColor *= sampledDiffuseColor;
         // Inside of the garment (seen through openings) is a bit darker.
         if (!gl_FrontFacing) diffuseColor.rgb *= 0.55;`
      );
    if (sheen) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         totalEmissiveRadiance += diffuseColor.rgb * 0.08 * pow(1.0 - abs(dot(normalize(vNormal), vec3(0.0, 0.0, 1.0))), 2.0);`
      );
    }
  };
  mat.customProgramCacheKey = () => `fabric-${sheen ? 1 : 0}`;
  return mat;
}

function fabricFor(title = '') {
  const t = title.toLowerCase();
  if (/leather|vinyl|patent|pu\b/.test(t)) return { roughness: 0.42, sheen: false };
  if (/satin|silk|sateen/.test(t)) return { roughness: 0.32, sheen: true };
  if (/velvet|velour|fleece|knit|wool|cashmere|mohair/.test(t)) return { roughness: 0.95, sheen: true };
  return { roughness: 0.82, sheen: false };
}

export default function Garment({ rig, piece, fit }) {
  const [tex, setTex] = useState(null);
  useEffect(() => {
    let live = true;
    garmentTextures(piece)
      .then((t) => live && setTex(t))
      .catch(() => live && setTex(null));
    return () => {
      live = false;
    };
  }, [piece]);

  const layout = useMemo(() => garmentParts(rig, piece, fit), [rig, piece, fit]);

  const meshes = useMemo(() => {
    if (!tex) return [];
    const fabric = fabricFor(piece.title);
    const mat = makeFabricMaterial({ front: tex.front.map, back: tex.back.map, ...fabric });
    const soleColor = /sneaker|trainer|runner|court|ace|samba|gazelle/i.test(piece.title) ? '#f1f0ec' : '#2b2622';
    const sole = new THREE.MeshStandardMaterial({ color: soleColor, roughness: 0.7 });
    const plain = new THREE.MeshStandardMaterial({ color: piece.color, roughness: fabric.roughness });
    return layout.parts.map((part) => {
      if (part.role === 'sole') return { part, material: sole };
      if (part.role === 'brim') return { part, material: plain };
      assignUVs(part, layout, tex.front.lookup, tex.back.lookup);
      return { part, material: mat };
    });
  }, [tex, layout, piece.title, piece.color]);

  useEffect(() => () => layout.parts.forEach((p) => p.geometry.dispose()), [layout]);

  return (
    <group>
      {meshes.map(({ part, material }, i) => (
        <mesh key={i} geometry={part.geometry} material={material} castShadow />
      ))}
    </group>
  );
}
