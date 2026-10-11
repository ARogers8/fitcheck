import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, ContactShadows } from '@react-three/drei';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import Avatar from './Avatar.jsx';
import Garment from './Garment.jsx';
import { makeRig } from '../body/geometry.js';
import { bodyMeasurements } from '../body/measurements.js';
import { fitFor } from '../fit/sizes.js';

// Garments draw in layer order so outer pieces sit over inner ones.
const ORDER = { shoes: 0, bottom: 1, base: 2, dress: 2, mid: 3, outer: 4, hat: 5 };

export const VIEWS = {
  full: { target: [0, 0.5, 0], distance: 4.6 },
  top: { target: [0, 0.7, 0], distance: 2.2 },
  bottom: { target: [0, 0.27, 0], distance: 2.6 },
  shoes: { target: [0, 0.05, 0.05], distance: 1.3 },
};

function CameraRig({ view, height, controls }) {
  const { camera } = useThree();
  const goal = useRef(null);
  useEffect(() => {
    const v = VIEWS[view.name] || VIEWS.full;
    const target = new THREE.Vector3(v.target[0], v.target[1] * height, v.target[2]);
    const dir = camera.position.clone().sub(controls.current?.target || target).normalize();
    if (dir.lengthSq() < 0.5) dir.set(0, 0.08, 1).normalize();
    goal.current = { target, position: target.clone().addScaledVector(dir, v.distance * (height / 1.75)) };
  }, [view, height, camera, controls]);
  useFrame((_, delta) => {
    const c = controls.current;
    if (!goal.current || !c) return;
    const k = 1 - Math.exp(-delta * 7);
    c.target.lerp(goal.current.target, k);
    camera.position.lerp(goal.current.position, k);
    c.update();
    if (camera.position.distanceTo(goal.current.position) < 0.002) goal.current = null;
  });
  return null;
}

export default function Scene({ avatar, outfit, sizes, view, autoRotate }) {
  const rig = useMemo(() => makeRig(avatar), [avatar.sex, avatar.heightCm, avatar.weightKg]); // eslint-disable-line react-hooks/exhaustive-deps
  const body = useMemo(() => bodyMeasurements(avatar), [avatar.sex, avatar.heightCm, avatar.weightKg]); // eslint-disable-line react-hooks/exhaustive-deps
  const controls = useRef();
  const worn = useMemo(() => [...outfit].sort((a, b) => (ORDER[a.slot] ?? 9) - (ORDER[b.slot] ?? 9)), [outfit]);
  const fits = useMemo(
    () => Object.fromEntries(worn.map((p) => [p.id, fitFor(p, sizes[p.id], body, avatar.sex)])),
    [worn, sizes, body, avatar.sex]
  );

  return (
    <Canvas shadows dpr={[1, 2]} camera={{ position: [0, 1.0, 4.6], fov: 30, near: 0.05, far: 50 }} gl={{ preserveDrawingBuffer: true }}>
      <color attach="background" args={['#efeae4']} />
      <hemisphereLight args={['#ffffff', '#efe4d8', 1.05]} />
      <directionalLight position={[2.5, 4, 3]} intensity={1.6} castShadow shadow-mapSize={[1024, 1024]} />
      <directionalLight position={[-3, 2.5, -2]} intensity={0.7} />
      <directionalLight position={[0, 1.5, -4]} intensity={0.45} />
      <group>
        <Avatar rig={rig} avatar={avatar} />
        {worn.map((piece) => (
          <Garment key={piece.id} rig={rig} piece={piece} fit={fits[piece.id]} />
        ))}
      </group>
      <ContactShadows position={[0, 0.001, 0]} opacity={0.45} scale={3} blur={2.4} far={2} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.001, 0]} receiveShadow>
        <circleGeometry args={[1.4, 64]} />
        <meshStandardMaterial color="#e4ddd4" roughness={1} />
      </mesh>
      <OrbitControls
        ref={controls}
        makeDefault
        target={[0, rig.H * 0.5, 0]}
        minDistance={0.45}
        maxDistance={7}
        enablePan
        maxPolarAngle={Math.PI * 0.62}
        autoRotate={autoRotate}
        autoRotateSpeed={1.6}
        enableDamping
      />
      <CameraRig view={view} height={rig.H} controls={controls} />
    </Canvas>
  );
}
