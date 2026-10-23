import * as THREE from 'three';
import { CreatureModel, dampN, type AnimInput } from './CreatureModel';
import { bezier, cachedTemplate, cnoise, cone, ellipsoid, flat, mix, ModelBuilder, PAT, smooth, tube, xf, type ModelTemplate } from './ModelKit';

/**
 * Ostrich horse: a big flightless bird body on two long, backward-kneed legs,
 * a long neck, and a horse's head with a horn-coloured beak tip and a dark
 * feather crest; plumed tail and stubby folded wings.
 */

export const OSTRICH_VARIANTS = [
  { body: '#a37548', back: '#6c4a2d', neck: '#c79c69', crest: '#4a2f1c' },
  { body: '#b89466', back: '#7d5a37', neck: '#d6b385', crest: '#5a3a20' },
  { body: '#8a6646', back: '#5a3f2a', neck: '#b48c66', crest: '#3a2416' },
];

function seg3(B: ModelBuilder, bone: string, to: THREE.Vector3, r0: number, r1: number, color: THREE.ColorRepresentation | ((p: THREE.Vector3, n: THREE.Vector3) => THREE.ColorRepresentation), pat: number = PAT.none): void {
  B.add(bone, tube([new THREE.Vector3(0, 0, 0), to.clone().multiplyScalar(0.5), to.clone()], [r0, (r0 + r1) / 2, r1], { radial: 8, caps: true }), { color, pat, patScale: [4, 6] });
}

function buildOstrich(variant: number, detail: number): ModelTemplate {
  const v = OSTRICH_VARIANTS[variant % OSTRICH_VARIANTS.length];
  const seg = (n: number) => Math.max(8, Math.round(n * detail));
  const B = new ModelBuilder();
  B.pad = 1.2;
  B.bone('body', null, 0, 1.42, 0);
  B.bone('neck0', 'body', 0, 0.2, 0.5);
  B.bone('neck1', 'neck0', 0, 0.42, 0.12);
  B.bone('head', 'neck1', 0, 0.4, 0.05);
  B.bone('tail', 'body', 0, 0.18, -0.66);
  B.bone('wingL', 'body', 0.36, 0.12, 0.08);
  B.bone('wingR', 'body', -0.36, 0.12, 0.08);
  const knee = new THREE.Vector3(0, -0.42, 0.13);
  const ankle = new THREE.Vector3(0, -0.5, -0.17);
  const toes = new THREE.Vector3(0, -0.42, 0.05);
  for (const [s, sx] of [['L', 1], ['R', -1]] as const) {
    B.bone(`thigh${s}`, 'body', 0.21 * sx, -0.14, -0.02);
    B.bone(`shin${s}`, `thigh${s}`, knee.x, knee.y, knee.z);
    B.bone(`foot${s}`, `shin${s}`, ankle.x, ankle.y, ankle.z);
    B.bone(`toes${s}`, `foot${s}`, toes.x, toes.y, toes.z);
  }
  B.anchor('seat', 'body', 0, 0.12, 0.0);
  B.anchor('mouth', 'head', 0, -0.08, 0.45);
  B.anchor('head', 'head', 0, 0.1, 0.1);
  const plumage = (p: THREE.Vector3, n: THREE.Vector3) => mix(v.body, v.back, smooth(0.0, 0.8, n.y) + (cnoise(p.x, p.y, p.z, 5) - 0.5) * 0.25);
  // Body: plump bird torso with feathers.
  B.add('body', ellipsoid(0.42, 0.44, 0.7, seg(22), seg(16), { amp: 0.05, freq: 5, seed: 1 }), { color: plumage, pat: PAT.feathers, patScale: [6, 5] });
  // Neck: a smooth tube blended over the neck bones.
  const neckPts = [new THREE.Vector3(0, 1.5, 0.42), new THREE.Vector3(0, 1.72, 0.58), new THREE.Vector3(0, 2.0, 0.66), new THREE.Vector3(0, 2.3, 0.68), new THREE.Vector3(0, 2.5, 0.68)];
  const toBody = (p: THREE.Vector3) => p.clone().sub(new THREE.Vector3(0, 1.42, 0));
  B.add('body', tube(neckPts.map(toBody), [0.24, 0.17, 0.13, 0.11, 0.1], { radial: seg(12) }), {
    color: (p) => mix(v.neck, v.body, smooth(0.5, 0.0, p.y)),
    pat: PAT.feathers,
    patScale: [3, 8],
    blend: (p) => {
      const y = p.y + 1.42;
      const a = smooth(1.6, 1.95, y), b = smooth(2.05, 2.35, y);
      return [['body', 1 - a], ['neck0', a * (1 - b)], ['neck1', b]];
    },
  });
  // Mane crest of dark feathers down the back of the neck.
  for (let i = 0; i < 6; i++) {
    const y = 0.05 + i * 0.13;
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.quadraticCurveTo(0.06, 0.12, -0.04, 0.2);
    shape.quadraticCurveTo(-0.08, 0.08, 0, 0);
    const bone = i < 3 ? 'neck0' : 'neck1';
    const base = i < 3 ? y : y - 0.42;
    B.add(bone, xf(flat(shape, 0.015, 4), { pos: [0, base, -0.08 - (i < 3 ? 0.0 : 0)], rot: [0.5, Math.PI / 2, 0] }), { color: v.crest, pat: PAT.feathers });
  }
  // Head: long horse skull, muzzle with a horn-coloured beak tip, eyes, ears, crest.
  B.add('head', xf(ellipsoid(0.13, 0.15, 0.22, seg(14), seg(10)), { pos: [0, 0.02, 0.04] }), { color: v.neck, pat: PAT.fur });
  B.add('head', tube([new THREE.Vector3(0, 0.0, 0.12), new THREE.Vector3(0, -0.05, 0.28), new THREE.Vector3(0, -0.09, 0.42)], [0.12, 0.1, 0.075], { radial: 10, caps: true, squash: [1.15, 0.85] }), {
    color: (p) => mix(v.neck, '#d9b45e', smooth(0.34, 0.42, p.z)),
    pat: PAT.fur,
  });
  for (const sx of [1, -1]) {
    B.add('head', xf(ellipsoid(0.04, 0.045, 0.03, 8, 6), { pos: [0.11 * sx, 0.06, 0.12], rot: [0, 0.8 * sx, 0] }), { color: '#1b120c' });
    B.add('head', xf(ellipsoid(0.012, 0.012, 0.008, 4, 3), { pos: [0.125 * sx, 0.075, 0.135] }), { color: '#ffffff', pat: PAT.glow });
    B.add('head', xf(cone(0.035, 0.12, 6), { pos: [0.07 * sx, 0.14, -0.05], rot: [-0.3, 0, -0.3 * sx] }), { color: v.back });
  }
  for (let i = 0; i < 4; i++) {
    B.add('head', xf(cone(0.025, 0.18 - i * 0.02, 5), { pos: [0, 0.16, -0.02 - i * 0.05], rot: [-0.9 - i * 0.15, 0, 0] }), { color: v.crest, pat: PAT.feathers });
  }
  // Folded stubby wings.
  for (const [bone, sx] of [['wingL', 1], ['wingR', -1]] as const) {
    B.add(bone, xf(ellipsoid(0.07, 0.24, 0.42, 12, 8, { amp: 0.03, freq: 8, seed: sx }), { pos: [0.02 * sx, 0, -0.12], rot: [0.25, 0, 0.15 * sx] }), { color: (p, n) => mix(v.back, v.crest, smooth(-0.1, -0.4, p.z)), pat: PAT.feathers, patScale: [5, 5] });
  }
  // Legs: feathered thighs, long bare shins and tarsi, three big toes.
  for (const s of ['L', 'R'] as const) {
    B.add(`thigh${s}`, xf(ellipsoid(0.15, 0.27, 0.17, 12, 10, { amp: 0.03, freq: 9, seed: 4 }), { pos: [0, -0.2, 0.06] }), { color: plumage, pat: PAT.feathers });
    seg3(B, `shin${s}`, ankle, 0.075, 0.055, '#b7a585');
    seg3(B, `foot${s}`, toes, 0.05, 0.045, '#b7a585', PAT.scales);
    for (const [tx, ry] of [[-0.06, -0.45], [0, 0], [0.06, 0.45]] as const) {
      B.add(`toes${s}`, tube([new THREE.Vector3(0, 0, 0), new THREE.Vector3(Math.sin(ry) * 0.1 + tx * 0.3, -0.02, Math.cos(ry) * 0.1), new THREE.Vector3(Math.sin(ry) * 0.2 + tx * 0.5, -0.03, Math.cos(ry) * 0.2)], [0.035, 0.03, 0.02], { radial: 6, caps: true }), { color: '#a8946f' });
    }
  }
  // Tail plume.
  for (let i = 0; i < 7; i++) {
    const a = (i / 6 - 0.5) * 1.3;
    const pts = bezier(new THREE.Vector3(0, 0, 0), new THREE.Vector3(Math.sin(a) * 0.18, 0.2, -0.22), new THREE.Vector3(Math.sin(a) * 0.32, 0.12 - Math.abs(a) * 0.1, -0.5), 6);
    B.add('tail', tube(pts, (t) => 0.05 * (1 - t * 0.5) + 0.01, { radial: 6, caps: true, squash: [1, 0.35] }), { color: (p) => mix(v.back, v.crest, smooth(-0.2, -0.45, p.z)), pat: PAT.feathers, patScale: [3, 10] });
  }
  return B.build();
}

function buildOstrichSaddle(): ModelTemplate {
  const B = new ModelBuilder();
  B.bone('body', null, 0, 1.42, 0);
  B.bone('neck0', 'body', 0, 0.2, 0.5);
  B.bone('neck1', 'neck0', 0, 0.42, 0.12);
  B.bone('head', 'neck1', 0, 0.4, 0.05);
  B.add('body', xf(ellipsoid(0.36, 0.08, 0.36, 16, 6), { pos: [0, 0.43, 0.0] }), { color: '#3f6b35' });
  B.add('body', xf(ellipsoid(0.24, 0.1, 0.28, 14, 6), { pos: [0, 0.5, 0.0] }), { color: '#734a28' });
  B.add('body', xf(ellipsoid(0.06, 0.1, 0.05, 6, 5), { pos: [0, 0.58, 0.25] }), { color: '#5a361c' });
  for (const sx of [1, -1]) {
    // Stirrup straps + stirrups.
    B.add('body', tube([new THREE.Vector3(0.3 * sx, 0.42, 0.02), new THREE.Vector3(0.42 * sx, 0.1, 0.02), new THREE.Vector3(0.44 * sx, -0.2, 0.02)], 0.015, { radial: 4 }), { color: '#3e2412' });
    B.add('body', xf(new THREE.TorusGeometry(0.06, 0.012, 4, 10), { pos: [0.44 * sx, -0.26, 0.02], rot: [0, Math.PI / 2, 0] }), { color: '#8a8a8a' });
    // Reins
    B.add('body', tube(bezier(new THREE.Vector3(0.12 * sx, 0.55, 0.2), new THREE.Vector3(0.15 * sx, 0.9, 0.55), new THREE.Vector3(0.1 * sx, 1.0, 1.05), 8), 0.012, { radial: 4 }), {
      color: '#3e2412',
      blend: (p) => {
        const y = p.y + 1.42;
        const a = smooth(1.9, 2.2, y), b = smooth(2.25, 2.4, y);
        return [['body', 1 - a], ['neck1', a * (1 - b)], ['head', b]];
      },
    });
  }
  return B.build();
}

export class OstrichHorseModel extends CreatureModel {
  private restBlend = 0;
  private alert = 0;

  constructor(variant = 0, detail = 1, scale = 1) {
    super(cachedTemplate(`ostrich:${variant}:${detail.toFixed(2)}`, () => buildOstrich(variant, detail)), cachedTemplate('ostrich:saddle', () => buildOstrichSaddle()), scale);
  }

  update(a: AnimInput): void {
    const dt = a.dt;
    const t = a.time + this.seed;
    this.restBlend = dampN(this.restBlend, a.action === 'rest' || a.action === 'sleep' ? 1 : 0, 2, dt);
    this.alert = dampN(this.alert, a.action === 'alert' ? 1 : 0, 5, dt);
    const rb = this.restBlend;
    const run = Math.min(1, Math.max(0, (a.speed - 3) / 9));
    const ph = this.advance(a, 1.7 + run * 3.2);
    const moving = Math.min(1, a.speed / 0.6) * (1 - rb);
    const amp = 0.45 + run * 0.4;
    for (const [s, off] of [['L', 0], ['R', Math.PI]] as const) {
      const p = ph + off;
      const sw = -Math.sin(p) * amp * moving;
      const lift = Math.max(0, Math.cos(p)) * moving;
      // Bird leg: thigh swings, the backward "knee" (ankle) folds while lifting.
      this.rot(`thigh${s}`, sw - 0.15 * moving + 0.9 * rb, 0, 0);
      this.rot(`shin${s}`, lift * 0.6 - 0.5 * rb, 0, 0);
      this.rot(`foot${s}`, -lift * (0.9 + run * 0.5) - 1.6 * rb, 0, 0);
      this.rot(`toes${s}`, lift * 0.6 + 1.0 * rb, 0, 0);
    }
    if (moving > 0.3) this.footfalls(ph, false);
    const bob = Math.abs(Math.sin(ph)) * 0.07 * moving;
    this.off('body', 0, bob - 0.85 * rb, 0);
    this.rot('body', -0.1 * run * moving + 0.08 * rb, 0, Math.sin(ph) * 0.05 * moving);
    // Head bobbing with each stride, alert head-up pose.
    const [ly, lp] = this.track(a, 1.0, 0.6, new THREE.Vector3(0, 2.4, 0.7));
    const bobHead = Math.sin(ph * 2) * 0.12 * moving;
    this.rot('neck0', 0.25 * run * moving + bobHead * 0.5 - 0.15 * this.alert + 0.9 * rb, ly * 0.3, 0);
    this.rot('neck1', 0.15 * run * moving - bobHead + 0.5 * rb + (a.action === 'graze' || a.action === 'eat' ? 0.9 : 0), ly * 0.35, 0);
    this.rot('head', lp * 0.8 - 0.15 * run * moving + Math.sin(t * 0.8) * 0.04, ly * 0.35, 0);
    // Wings flare when sprinting; tail plume bounces.
    const flare = (run > 0.5 ? (run - 0.5) * 2 : 0) * moving + this.alert * 0.4;
    this.rot('wingL', 0, 0, -0.9 * flare + Math.sin(ph * 2) * 0.12 * flare);
    this.rot('wingR', 0, 0, 0.9 * flare - Math.sin(ph * 2) * 0.12 * flare);
    this.rot('tail', 0.2 + Math.sin(ph * 2) * 0.1 * moving - 0.2 * this.alert, Math.sin(t * 1.2) * 0.12, 0);
  }
}
