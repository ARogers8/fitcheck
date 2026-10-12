import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, ContactShadows, Environment, Lightformer } from '@react-three/drei';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import Avatar from './Avatar.jsx';
import Garment from './Garment.jsx';
import { makeRig } from '../body/geometry.js';
import { bodyMeasurements } from '../body/measurements.js';
import { fitFor } from '../fit/sizes.js';
import { humanReady, loadHuman } from '../body/human.js';

// Garments draw in layer order so outer pieces sit over inner ones.
const ORDER = { shoes: 0, bottom: 1, base: 2, dress: 2, mid: 3, outer: 4, hat: 5 };

export const VIEWS = {
  full: { target: [0, 0.5, 0], distance: 4.6 },
  top: { target: [0, 0.7, 0], distance: 2.2 },
  bottom: { target: [0, 0.27, 0], distance: 2.6 },
  shoes: { target: [0, 0.05, 0.05], distance: 1.3 },
  face: { target: [0, 0.925, 0.02], distance: 0.62 },
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

function useHuman() {
  const [human, setHuman] = useState(humanReady);
  useEffect(() => {
    if (human) return undefined;
    let live = true;
    let timer;
    const attempt = (n) =>
      loadHuman().then(
        (h) => live && setHuman(h),
        (e) => {
          if (n < 3 && live) timer = setTimeout(() => attempt(n + 1), 1000 * (n + 1));
          else console.error('Could not load the body model', e);
        }
      );
    attempt(0);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [human]);
  return human;
}

export default function Scene(props) {
  const human = useHuman();
  return human ? <HumanScene {...props} /> : <div className="scene-loading" />;
}

function HumanScene({ avatar, outfit, sizes, view, autoRotate }) {
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
      {/* Soft studio light: a large key from front-left, gentle fill, two rims, and a
          procedural softbox environment for natural skin and hair highlights. */}
      <hemisphereLight args={['#ffffff', '#d9cfc4', 0.25]} />
      <directionalLight
        position={[-1.4, 3.3, 3.6]}
        intensity={2.1}
        color="#fff6ec"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-camera-left={-1.2}
        shadow-camera-right={1.2}
        shadow-camera-top={2.3}
        shadow-camera-bottom={-0.2}
        shadow-camera-near={0.5}
        shadow-camera-far={10}
      />
      <directionalLight position={[3, 1.8, 2.5]} intensity={0.35} color="#eef2ff" />
      <directionalLight position={[-2.5, 2.5, -3]} intensity={1.0} color="#ffffff" />
      <directionalLight position={[2.8, 2.2, -2.6]} intensity={0.8} color="#fff4e8" />
      <Environment resolution={128} frames={1} environmentIntensity={0.7}>
        <color attach="background" args={['#5d5853']} />
        <Lightformer form="rect" intensity={2.2} position={[-2.5, 2.5, 3]} scale={[3, 3, 1]} target={[0, 1, 0]} />
        <Lightformer form="rect" intensity={1.0} position={[3, 1.5, 2.5]} scale={[2.5, 3, 1]} target={[0, 1, 0]} />
        <Lightformer form="rect" intensity={1.4} position={[0, 4, -3]} scale={[4, 1.5, 1]} target={[0, 1, 0]} />
        <Lightformer form="ring" intensity={0.6} position={[0, 5, 0]} scale={2} target={[0, 0, 0]} />
      </Environment>
      <group>
        <Avatar avatar={avatar} hat={worn.some((p) => p.slot === 'hat')} top={worn.some((p) => ['base', 'mid', 'outer', 'dress'].includes(p.slot))} />
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
