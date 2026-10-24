import * as THREE from 'three';
import type { AnimInput } from './CreatureModel';
import { dampN } from './CreatureModel';
import { bezier, cachedTemplate, cnoise, ellipsoid, limb, mix, ModelBuilder, PAT, smooth, tube, xf, type ModelTemplate } from './ModelKit';
import { PolarBearDogModel } from './PolarBearDog';

/**
 * Komodo rhino: the Fire Nation cavalry beast — a low, armoured 3.8 m lizard
 * body with a rhino's horned head, bony neck frills, a dorsal ridge of plates
 * and a heavy dragging tail. It shares the polar bear dog's quadruped skeleton
 * and gait (same bone names), with a slower, heavier tail.
 *
 * Bones: body · neck · head · jaw · earL/R (frills) · tail · thigh{F,B}{L,R} · shin… · paw…
 */

export const RHINO_VARIANTS = [
  { hide: '#6f6a5e', shade: '#4a453d', belly: '#a99f8a', plate: '#3b2f28' },
  { hide: '#7a6250', shade: '#4f3b2c', belly: '#b49c80', plate: '#3a2618' },
  { hide: '#5e6460', shade: '#3c413f', belly: '#9ea596', plate: '#2c2f2e' },
];

function buildRhino(variant: number, detail: number): ModelTemplate {
  const v = RHINO_VARIANTS[variant % RHINO_VARIANTS.length];
  const seg = (n: number) => Math.max(8, Math.round(n * detail));
  const B = new ModelBuilder();
  B.pad = 1.2;
  B.bone('body', null, 0, 1.1, 0);
  B.bone('neck', 'body', 0, 0.06, 1.15);
  B.bone('head', 'neck', 0, 0.04, 0.55);
  B.bone('jaw', 'head', 0, -0.17, 0.3);
  B.bone('earL', 'head', 0.3, 0.14, -0.14);
  B.bone('earR', 'head', -0.3, 0.14, -0.14);
  B.bone('tail', 'body', 0, 0.02, -1.32);
  for (const [id, z, y] of [['F', 0.8, -0.3], ['B', -0.85, -0.28]] as const) {
    for (const [s, sx] of [['L', 1], ['R', -1]] as const) {
      B.bone(`thigh${id}${s}`, 'body', 0.52 * sx, y, z);
      B.bone(`shin${id}${s}`, `thigh${id}${s}`, 0.04 * sx, -0.42, 0.02);
      B.bone(`paw${id}${s}`, `shin${id}${s}`, 0, -0.32, 0.02);
    }
  }
  B.anchor('seat', 'body', 0, 0.74, 0.1); // saddle top
  B.anchor('mouth', 'head', 0, -0.1, 0.78);
  B.anchor('head', 'head', 0, 0.22, 0.3);

  // Scaly hide: darker along the back, pale belly, mottled.
  const hide = (p: THREE.Vector3, n: THREE.Vector3) =>
    n.y < -0.25 ? mix(v.hide, v.belly, smooth(-0.25, -0.8, n.y)) : mix(v.hide, v.shade, smooth(0.2, 0.95, n.y) * 0.55 + (cnoise(p.x, p.y, p.z, 2.6) - 0.5) * 0.4);
  const lumpy = (seed: number, amp = 0.06) => ({ amp, freq: 3.2, seed });
  // Body: a long, low armoured barrel with shoulder and hip masses.
  B.add('body', xf(ellipsoid(0.78, 0.58, 1.32, seg(26), seg(18), lumpy(1, 0.06)), { pos: [0, 0, -0.05] }), { color: hide, pat: PAT.scales, patScale: [16, 10] });
  B.add('body', xf(ellipsoid(0.82, 0.66, 0.62, seg(22), seg(16), lumpy(2, 0.07)), { pos: [0, 0.04, 0.72] }), { color: hide, pat: PAT.scales, patScale: [12, 9] });
  B.add('body', xf(ellipsoid(0.72, 0.58, 0.62, seg(22), seg(16), lumpy(3, 0.06)), { pos: [0, 0.02, -0.86] }), { color: hide, pat: PAT.scales, patScale: [12, 9] });
  // Armour bands across the back and a dorsal ridge of plates.
  for (let i = 0; i < 4; i++) {
    const z = 0.75 - i * 0.5;
    B.add('body', xf(ellipsoid(0.7, 0.14, 0.2, seg(18), 6), { pos: [0, 0.5 - Math.abs(z) * 0.06, z], rot: [0, 0, 0] }), { color: (p, n) => mix(v.plate, v.shade, (cnoise(p.x, p.y, p.z, 4) - 0.3) * 0.6), pat: PAT.shell, patScale: [6, 2] });
  }
  for (let i = 0; i < 9; i++) {
    const z = 1.0 - i * 0.28;
    const hgt = 0.2 - Math.abs(i - 3) * 0.018;
    B.add('body', xf(new THREE.ConeGeometry(0.08, hgt, 5), { pos: [0, 0.6 + hgt * 0.4 - Math.abs(z) * 0.05, z], rot: [-0.35, 0, 0] }), { color: v.plate });
  }
  // Neck: short and thick, armoured on top.
  B.add('neck', xf(ellipsoid(0.5, 0.46, 0.52, seg(20), seg(14), lumpy(4, 0.05)), { pos: [0, 0, 0.1] }), { color: hide, pat: PAT.scales, patScale: [9, 7] });
  B.add('neck', xf(ellipsoid(0.42, 0.12, 0.34, seg(16), 6), { pos: [0, 0.4, 0.08], rot: [0.15, 0, 0] }), { color: v.plate, pat: PAT.shell, patScale: [4, 2] });
  // Head: a broad lizard skull with a rhino's horned snout, heavy brow and amber eyes.
  B.add('head', xf(ellipsoid(0.36, 0.3, 0.46, seg(20), seg(14), lumpy(5, 0.03)), { pos: [0, 0.02, 0.12] }), { color: hide, pat: PAT.scales, patScale: [7, 6] });
  B.add('head', xf(ellipsoid(0.26, 0.21, 0.42, seg(16), seg(12)), { pos: [0, -0.04, 0.52] }), { color: hide, pat: PAT.scales, patScale: [5, 5] });
  B.add('head', xf(new THREE.ConeGeometry(0.11, 0.56, 8), { pos: [0, 0.3, 0.7], rot: [0.62, 0, 0] }), { color: (p) => mix('#d8ccb2', '#5b4a3a', smooth(0.2, -0.25, p.y)) });
  B.add('head', xf(new THREE.ConeGeometry(0.065, 0.26, 7), { pos: [0, 0.32, 0.38], rot: [0.45, 0, 0] }), { color: '#c8baa0' });
  for (const sx of [1, -1]) {
    B.add('head', xf(ellipsoid(0.12, 0.05, 0.16, 10, 6), { pos: [0.2 * sx, 0.2, 0.28], rot: [0.2, 0, 0.25 * sx] }), { color: v.plate });
    B.add('head', xf(ellipsoid(0.05, 0.045, 0.035, 8, 6), { pos: [0.25 * sx, 0.12, 0.34], rot: [0, 0.55 * sx, 0] }), { color: '#e59a1c', pat: PAT.glow });
    B.add('head', xf(ellipsoid(0.012, 0.03, 0.01, 4, 4), { pos: [0.275 * sx, 0.12, 0.365] }), { color: '#140c06' });
    B.add('head', xf(ellipsoid(0.03, 0.02, 0.02, 6, 4), { pos: [0.11 * sx, -0.02, 0.92] }), { color: '#1a1410' });
  }
  B.add('jaw', xf(ellipsoid(0.22, 0.08, 0.4, 12, 8), { pos: [0, -0.02, 0.22] }), { color: (p, n) => (n.y > 0.5 ? '#5a2620' : mix(v.belly, v.hide, 0.4)), pat: PAT.scales });
  B.add('jaw', xf(ellipsoid(0.12, 0.03, 0.24, 8, 5), { pos: [0, 0.03, 0.2] }), { color: '#b8504a' });
  // Frills: bony fans behind the jaw (the "ears").
  B.addPair('earL', 'earR', xf(ellipsoid(0.05, 0.2, 0.22, 10, 8), { pos: [0.02, 0.02, -0.04], rot: [-0.3, 0.5, -0.5] }), { color: (p) => mix(v.plate, '#9c3a22', smooth(0.05, 0.2, p.y)), pat: PAT.shell, patScale: [3, 3] });
  // Legs: short, thick, scaly, with broad three-clawed feet.
  for (const leg of ['FL', 'FR', 'BL', 'BR']) {
    const side = leg.endsWith('L') ? 1 : -1;
    const front = leg.startsWith('F');
    B.add(`thigh${leg}`, limb(0.5, front ? 0.27 : 0.31, 0.22, seg(12), lumpy(10 + side, 0.05)), { color: hide, pat: PAT.scales, patScale: [10, 6] });
    B.add(`shin${leg}`, limb(0.38, 0.2, 0.17, seg(10), lumpy(20 + side, 0.04)), { color: hide, pat: PAT.scales, patScale: [8, 5] });
    B.add(`paw${leg}`, xf(ellipsoid(0.21, 0.1, 0.25, 12, 8), { pos: [0, -0.02, 0.06] }), { color: (p, n) => (n.y < -0.5 ? '#2f2a26' : v.hide), pat: PAT.scales });
    for (const tx of [-0.1, 0, 0.1]) B.add(`paw${leg}`, xf(new THREE.ConeGeometry(0.03, 0.11, 5), { pos: [tx, -0.06, 0.31], rot: [Math.PI / 2 + 0.35, 0, 0] }), { color: '#d9cfbd' });
  }
  // Tail: long, heavy and tapering, held low.
  B.add('tail', tube(bezier(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -0.1, -0.75), new THREE.Vector3(0, -0.42, -1.5), 10), (t) => 0.3 * (1 - t * 0.85), { radial: 10, caps: true, lumps: { amp: 0.03, freq: 6, seed: 41 } }), { color: hide, pat: PAT.scales, patScale: [14, 8] });
  return B.build();
}

function buildRhinoSaddle(): ModelTemplate {
  const B = new ModelBuilder();
  B.bone('body', null, 0, 1.1, 0);
  B.bone('neck', 'body', 0, 0.06, 1.15);
  B.bone('head', 'neck', 0, 0.04, 0.55);
  // Fire Nation cavalry tack: crimson blanket with gold trim, a raised black seat and a head plate.
  B.add('body', xf(ellipsoid(0.84, 0.12, 0.66, 20, 8), { pos: [0, 0.56, 0.1], rot: [0.04, 0, 0] }), { color: (p) => (Math.abs(p.x) > 0.68 || Math.abs(p.z - 0.1) > 0.55 ? '#d9a536' : '#8e1b14'), pat: PAT.none });
  B.add('body', xf(ellipsoid(0.42, 0.12, 0.42, 16, 8), { pos: [0, 0.68, 0.1] }), { color: '#231a17' });
  B.add('body', xf(ellipsoid(0.38, 0.12, 0.06, 12, 6), { pos: [0, 0.76, 0.46] }), { color: '#3a1410' });
  B.add('body', xf(ellipsoid(0.34, 0.1, 0.06, 12, 6), { pos: [0, 0.74, -0.26] }), { color: '#3a1410' });
  const strap: THREE.Vector3[] = [];
  for (let i = 0; i <= 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    strap.push(new THREE.Vector3(Math.sin(a) * 0.84, Math.cos(a) * 0.66, 0.24));
  }
  B.add('body', tube(strap, 0.03, { radial: 5 }), { color: '#2a1810' });
  // Head plate (red lacquer with a gold flame crest).
  B.add('head', xf(ellipsoid(0.3, 0.06, 0.3, 14, 6), { pos: [0, 0.3, 0.22], rot: [0.18, 0, 0] }), { color: '#8e1b14' });
  B.add('head', xf(new THREE.ConeGeometry(0.05, 0.16, 6), { pos: [0, 0.38, 0.16], rot: [-0.25, 0, 0] }), { color: '#e2b23e' });
  for (const sx of [1, -1]) {
    B.add('body', tube(bezier(new THREE.Vector3(0.22 * sx, 0.7, 0.42), new THREE.Vector3(0.3 * sx, 0.78, 1.0), new THREE.Vector3(0.26 * sx, 0.3, 1.78), 8), 0.02, { radial: 4 }), {
      color: '#2a1810',
      blend: (p) => {
        const t = smooth(1.0, 1.75, p.z);
        return [['body', 1 - t], ['head', t]];
      },
    });
  }
  return B.build();
}

export class KomodoRhinoModel extends PolarBearDogModel {
  private sway = 0;

  constructor(variant = 0, detail = 1, scale = 1) {
    super(variant, detail, scale, {
      body: cachedTemplate(`rhino:${variant % RHINO_VARIANTS.length}:${detail.toFixed(2)}`, () => buildRhino(variant, detail)),
      saddle: cachedTemplate('rhino:saddle', () => buildRhinoSaddle()),
    });
  }

  override update(a: AnimInput): void {
    super.update(a);
    // A heavy reptile tail: no wagging, a slow sway that follows the stride; frills flare when alarmed.
    const t = a.time;
    this.sway = dampN(this.sway, Math.min(1, a.speed / 6), 2, a.dt);
    const alarmed = a.action === 'alert' || a.action === 'roar' ? 1 : 0;
    this.rot('tail', -0.05 + 0.04 * Math.sin(t * 0.9), Math.sin(t * (1.2 + this.sway * 2.4)) * (0.1 + 0.12 * this.sway), 0);
    this.rot('earL', -0.15 * alarmed, 0, 0.35 * alarmed);
    this.rot('earR', -0.15 * alarmed, 0, -0.35 * alarmed);
  }
}
