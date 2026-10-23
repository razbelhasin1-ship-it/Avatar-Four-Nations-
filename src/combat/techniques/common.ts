import * as THREE from 'three';
import { registerClip } from '../../character/Animator';
import type { Cast, ProjectileVisual } from '../types';

/**
 * Shared helpers and base clips for technique modules.
 */

const strike = (id: string, arm: 'L' | 'R', reach: number) =>
  registerClip({
    id,
    duration: 0.42,
    mask: arm === 'R' ? 'armR' : 'armL',
    events: [{ t: 0.12, name: 'release' }],
    keys: [
      { t: 0, pose: arm === 'R' ? { upperArmR: [0.4, 0, -0.3], foreArmR: [-1.4, 0, 0] } : { upperArmL: [0.4, 0, 0.3], foreArmL: [-1.4, 0, 0] } },
      { t: 0.12, pose: arm === 'R' ? { upperArmR: [-1.5 * reach, 0, -0.05], foreArmR: [-0.05, 0, 0] } : { upperArmL: [-1.5 * reach, 0, 0.05], foreArmL: [-0.05, 0, 0] }, ease: 'out' },
      { t: 0.42, pose: arm === 'R' ? { upperArmR: [-0.4, 0, -0.2], foreArmR: [-0.9, 0, 0] } : { upperArmL: [-0.4, 0, 0.2], foreArmL: [-0.9, 0, 0] }, ease: 'inout' },
    ],
  });
strike('base_strike_r', 'R', 1);
strike('base_strike_l', 'L', 1);

registerClip({
  id: 'base_push_two',
  duration: 0.6,
  mask: 'upper',
  keys: [
    { t: 0, pose: { spine: [-0.1, 0, 0], upperArmL: [0.3, 0, 0.4], upperArmR: [0.3, 0, -0.4], foreArmL: [-1.6, 0, 0], foreArmR: [-1.6, 0, 0] } },
    { t: 0.22, pose: { spine: [0.2, 0, 0], upperArmL: [-1.5, 0, 0.1], upperArmR: [-1.5, 0, -0.1], foreArmL: [-0.1, 0, 0], foreArmR: [-0.1, 0, 0] }, ease: 'out' },
    { t: 0.6, pose: { spine: [0, 0, 0], upperArmL: [-0.3, 0, 0.3], upperArmR: [-0.3, 0, -0.3], foreArmL: [-0.5, 0, 0], foreArmR: [-0.5, 0, 0] }, ease: 'inout' },
  ],
});

registerClip({
  id: 'base_stomp',
  duration: 0.7,
  mask: 'full',
  keys: [
    { t: 0, pose: { thighL: [-1.2, 0, 0.2], shinL: [1.2, 0, 0], upperArmL: [-0.3, 0, 0.8], upperArmR: [-0.3, 0, -0.8], hipsY: 0 } },
    { t: 0.28, pose: { thighL: [-0.3, 0, 0.35], shinL: [0.3, 0, 0], thighR: [-0.3, 0, -0.35], shinR: [0.5, 0, 0], upperArmL: [0.2, 0, 0.4], upperArmR: [0.2, 0, -0.4], spine: [0.25, 0, 0], hipsY: -0.25 }, ease: 'in' },
    { t: 0.7, pose: { thighL: [0, 0, 0.1], shinL: [0.1, 0, 0], thighR: [0, 0, -0.1], shinR: [0.1, 0, 0], spine: [0, 0, 0], hipsY: 0 }, ease: 'inout' },
  ],
});

export function orbVisual(color: string, radius: number, additive = true): ProjectileVisual {
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 12, 10), mat);
  return {
    object: mesh,
    update: () => {},
    dispose: () => {
      mesh.geometry.dispose();
      mat.dispose();
    },
  };
}

export function rockVisual(radius: number): ProjectileVisual {
  const mat = new THREE.MeshStandardMaterial({ color: '#7d6a55', roughness: 0.95, flatShading: true });
  const mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(radius, 0), mat);
  mesh.castShadow = true;
  return {
    object: mesh,
    update: (_p, dt) => {
      mesh.rotation.x += dt * 6;
      mesh.rotation.z += dt * 4;
    },
    dispose: () => {
      mesh.geometry.dispose();
      mat.dispose();
    },
  };
}

export function handOrigin(cast: Cast, hand: 'handL' | 'handR'): THREE.Vector3 {
  return cast.caster.castOrigin(hand, new THREE.Vector3());
}

