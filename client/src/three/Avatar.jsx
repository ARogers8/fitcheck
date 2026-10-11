import { useMemo } from 'react';
import * as THREE from 'three';
import { bodyGeometries } from '../body/geometry.js';
import { SKIN_TONES } from '../body/measurements.js';

function headGeometry(h) {
  const g = new THREE.SphereGeometry(1, 48, 36);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    // Narrower jaw and chin, fuller back of the skull, a hint of a nose.
    if (y < 0) {
      const t = -y;
      x *= 1 - 0.28 * t * t;
      z *= 1 - 0.12 * t;
    }
    if (z < 0) z *= 1.04;
    const nose = Math.exp(-((x / 0.12) ** 2) - ((y + 0.1) / 0.2) ** 2) * Math.max(0, z) * 0.11;
    p.setXYZ(i, x * h.rx, y * h.ry, (z + nose) * h.rz);
  }
  g.computeVertexNormals();
  return g;
}

function Hair({ rig, style, color }) {
  const h = rig.head;
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color, roughness: 0.75 }), [color]);
  const cap = useMemo(() => {
    const g = new THREE.SphereGeometry(1, 48, 32, 0, Math.PI * 2, 0, Math.PI * 0.62);
    return g;
  }, []);
  if (style === 'none') return null;
  const s = style === 'buzz' ? 1.03 : 1.08;
  return (
    <group position={[0, h.y + h.ry * 0.02, -0.008]}>
      <mesh geometry={cap} material={mat} scale={[h.rx * s, h.ry * s, h.rz * s]} rotation={[-0.3, 0, 0]} />
      {style === 'long' && (
        <mesh material={mat} position={[0, -h.ry * 0.75, -h.rz * 0.45]} scale={[h.rx * 1.1, h.ry * 1.2, h.rz * 0.55]}>
          <sphereGeometry args={[1, 32, 24]} />
        </mesh>
      )}
      {style === 'bun' && (
        <mesh material={mat} position={[0, h.ry * 0.75, -h.rz * 0.7]} scale={h.rx * 0.42}>
          <sphereGeometry args={[1, 24, 16]} />
        </mesh>
      )}
    </group>
  );
}

export default function Avatar({ rig, avatar }) {
  const skin = SKIN_TONES.find((t) => t.id === avatar.skin)?.color || SKIN_TONES[2].color;
  const material = useMemo(() => new THREE.MeshStandardMaterial({ color: skin, roughness: 0.55, metalness: 0 }), [skin]);
  const parts = useMemo(() => bodyGeometries(rig), [rig]);
  const head = useMemo(() => headGeometry(rig.head), [rig]);
  const hands = useMemo(
    () =>
      rig.arms.map((arm) => {
        const wrist = arm.joints[2];
        const pos = wrist.clone().addScaledVector(arm.dir, arm.handLen * 0.38);
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), arm.dir);
        return { pos, q, len: arm.handLen, side: arm.side };
      }),
    [rig]
  );

  return (
    <group>
      {parts.map((p) => (
        <mesh key={p.name} geometry={p.geometry} material={material} castShadow />
      ))}
      <mesh geometry={head} material={material} position={[0, rig.head.y, 0]} castShadow />
      {[-1, 1].map((s) => (
        <mesh key={s} material={material} position={[s * rig.head.rx * 0.98, rig.head.y - rig.head.ry * 0.05, -rig.head.rz * 0.05]} scale={[rig.head.rx * 0.12, rig.head.ry * 0.25, rig.head.rz * 0.2]}>
          <sphereGeometry args={[1, 16, 12]} />
        </mesh>
      ))}
      {hands.map((hnd) => (
        <mesh key={hnd.side} material={material} position={hnd.pos} quaternion={hnd.q} scale={[hnd.len * 0.11, hnd.len * 0.42, hnd.len * 0.2]}>
          <sphereGeometry args={[1, 24, 16]} />
        </mesh>
      ))}
      <Hair rig={rig} style={avatar.hairStyle} color={avatar.hairColor} />
    </group>
  );
}
