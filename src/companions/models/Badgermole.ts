import * as THREE from 'three';
import { CreatureModel, dampN, type AnimInput } from './CreatureModel';
import { legPhase, legPose, type LegSpec } from './gaits';
import { bezier, cachedTemplate, cnoise, cone, ellipsoid, limb, mix, ModelBuilder, PAT, smooth, tube, xf, type ModelTemplate } from './ModelKit';

/**
 * Badgermole: a low, enormous-shouldered tunneller (3.4 m) — dark grey-brown
 * fur with a cream badger stripe from the nose over the head, a long sensitive
 * snout with a big pink nose, closed (blind) eyes and huge ivory digging claws.
 */

const LEGS: LegSpec[] = [
  { thigh: 'thighFL', shin: 'shinFL', foot: 'pawFL', front: true, side: 1 },
  { thigh: 'thighFR', shin: 'shinFR', foot: 'pawFR', front: true, side: -1 },
  { thigh: 'thighBL', shin: 'shinBL', foot: 'pawBL', front: false, side: 1 },
  { thigh: 'thighBR', shin: 'shinBR', foot: 'pawBR', front: false, side: -1 },
];

export const BADGER_VARIANTS = [
  { fur: '#5a4e45', belly: '#3d342e', stripe: '#e9e0cc' },
  { fur: '#665748', belly: '#43382f', stripe: '#efe6d2' },
];

function buildBadgermole(variant: number, detail: number): ModelTemplate {
  const v = BADGER_VARIANTS[variant % BADGER_VARIANTS.length];
  const seg = (n: number) => Math.max(8, Math.round(n * detail));
  const B = new ModelBuilder();
  B.pad = 1.2;
  B.bone('body', null, 0, 0.98, 0);
  B.bone('head', 'body', 0, 0.06, 1.38);
  B.bone('nose', 'head', 0, -0.06, 0.78);
  B.bone('tail', 'body', 0, 0.05, -1.35);
  for (const [id, z, y, x] of [['F', 0.72, -0.2, 0.72], ['B', -0.85, -0.18, 0.6]] as const) {
    for (const [s, sx] of [['L', 1], ['R', -1]] as const) {
      B.bone(`thigh${id}${s}`, 'body', x * sx, y, z);
      B.bone(`shin${id}${s}`, `thigh${id}${s}`, 0.06 * sx, -0.38, 0.05);
      B.bone(`paw${id}${s}`, `shin${id}${s}`, 0, -0.3, 0.05);
    }
  }
  B.anchor('seat', 'body', 0, 0.93, 0.28); // saddle top
  B.anchor('mouth', 'nose', 0, -0.05, 0.25);
  B.anchor('head', 'head', 0, 0.25, 0.2);
  const fur = (p: THREE.Vector3, n: THREE.Vector3) => mix(v.fur, v.belly, smooth(0.0, -0.8, n.y) + (cnoise(p.x, p.y, p.z, 3) - 0.5) * 0.35);
  // Stripe along the spine of the head (head-local).
  const headCol = (p: THREE.Vector3, n: THREE.Vector3) => {
    const stripe = smooth(0.17, 0.1, Math.abs(p.x)) * smooth(-0.05, 0.12, p.y);
    const cheek = smooth(0.12, 0.05, Math.abs(Math.abs(p.x) - 0.36)) * smooth(0.1, -0.15, p.y) * smooth(-0.2, 0.2, p.z);
    return fur(p, n).lerp(new THREE.Color(v.stripe), Math.max(stripe, cheek * 0.9));
  };
  const lumps = (seed: number, amp = 0.08) => ({ amp, freq: 3.2, seed });
  // Body: wide barrel + towering shoulders.
  B.add('body', xf(ellipsoid(0.92, 0.7, 1.35, seg(26), seg(18), lumps(1, 0.1)), { pos: [0, -0.02, -0.1] }), { color: (p, n) => fur(p, n).lerp(new THREE.Color(v.stripe), smooth(0.14, 0.06, Math.abs(p.x)) * smooth(0.35, 0.6, p.y) * smooth(0.0, 0.9, p.z)), pat: PAT.fur, patScale: [12, 9] });
  B.add('body', xf(ellipsoid(0.98, 0.82, 0.72, seg(24), seg(16), lumps(2, 0.12)), { pos: [0, 0.14, 0.62] }), { color: (p, n) => fur(p, n).lerp(new THREE.Color(v.stripe), smooth(0.16, 0.08, Math.abs(p.x)) * smooth(0.5, 0.75, p.y)), pat: PAT.fur, patScale: [10, 8] });
  // Head: broad, flat skull; long tapering snout; big pink nose; closed eyes.
  B.add('head', xf(ellipsoid(0.5, 0.36, 0.55, seg(20), seg(14), lumps(3, 0.04)), { pos: [0, 0.02, 0.15] }), { color: headCol, pat: PAT.fur, patScale: [6, 5] });
  B.add('head', tube(bezier(new THREE.Vector3(0, -0.02, 0.45), new THREE.Vector3(0, -0.04, 0.65), new THREE.Vector3(0, -0.06, 0.85), 6), (t) => 0.26 - t * 0.12, { radial: seg(12), squash: [0.85, 1.15] }), { color: headCol, pat: PAT.fur });
  B.add('nose', xf(ellipsoid(0.15, 0.12, 0.13, 12, 8), { pos: [0, 0, 0.1] }), {
    color: (p, n) => (n.z > 0.6 && Math.hypot(Math.abs(p.x) - 0.06, p.y) < 0.035 ? '#3a1f22' : '#c98a8c'),
  });
  for (const sx of [1, -1]) {
    // Blind eyes: closed slits under a fold of fur.
    B.add('head', xf(ellipsoid(0.06, 0.016, 0.03, 8, 4), { pos: [0.3 * sx, 0.14, 0.52], rot: [0, 0.6 * sx, 0.2 * sx] }), { color: '#2a201c' });
    B.add('head', xf(ellipsoid(0.09, 0.07, 0.05, 8, 6), { pos: [0.4 * sx, 0.2, 0.15] }), { color: (p, n) => mix(v.fur, '#8a6f62', 0.3) });
  }
  // Legs: front legs massive with long digging claws; hind legs smaller.
  for (const leg of LEGS) {
    const id = leg.thigh.slice(5);
    const f = leg.front;
    B.add(leg.thigh, limb(0.42, f ? 0.36 : 0.3, f ? 0.28 : 0.24, seg(12), lumps(10 + leg.side, 0.06)), { color: fur, pat: PAT.fur });
    B.add(leg.shin, limb(0.32, f ? 0.27 : 0.22, f ? 0.24 : 0.19, seg(10), lumps(20 + leg.side, 0.04)), { color: fur, pat: PAT.fur });
    B.add(`paw${id}`, xf(ellipsoid(f ? 0.33 : 0.22, 0.12, f ? 0.32 : 0.24, 12, 8), { pos: [0, -0.02, 0.08] }), { color: (p, n) => (n.y < -0.5 ? '#2f2622' : v.belly), pat: PAT.fur });
    const claws = f ? [-0.2, -0.07, 0.07, 0.2] : [-0.1, 0, 0.1];
    for (const cx of claws) {
      const len = f ? 0.48 : 0.16;
      B.add(`paw${id}`, xf(cone(f ? 0.055 : 0.035, len, 6), { pos: [cx, -0.04, f ? 0.32 : 0.24], rot: [Math.PI / 2 + (f ? 0.55 : 0.4), 0, 0] }), { color: (p) => mix('#efe6cc', '#b9a77e', p.y / len) });
    }
  }
  B.add('tail', tube(bezier(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.03, -0.2), new THREE.Vector3(0, -0.04, -0.38), 5), (t) => 0.13 * (1 - t * 0.6), { radial: 8, caps: true, lumps: { amp: 0.04, freq: 9, seed: 7 } }), { color: fur, pat: PAT.fur });
  return B.build();
}

function buildBadgerSaddle(): ModelTemplate {
  const B = new ModelBuilder();
  B.bone('body', null, 0, 0.98, 0);
  B.add('body', xf(ellipsoid(0.85, 0.1, 0.62, 20, 8), { pos: [0, 0.74, 0.3] }), { color: (p) => (Math.abs(p.x) > 0.7 ? '#c8a23a' : '#3f6b35') });
  B.add('body', xf(ellipsoid(0.45, 0.12, 0.42, 14, 8), { pos: [0, 0.83, 0.28] }), { color: '#6e4426' });
  B.add('body', xf(ellipsoid(0.08, 0.16, 0.08, 8, 6), { pos: [0, 0.95, 0.62] }), { color: '#5a361c' });
  const strap: THREE.Vector3[] = [];
  for (let i = 0; i <= 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    strap.push(new THREE.Vector3(Math.sin(a) * 0.98, 0.14 + Math.cos(a) * 0.82, 0.5));
  }
  B.add('body', tube(strap, 0.03, { radial: 5 }), { color: '#3e2412' });
  return B.build();
}

export class BadgermoleModel extends CreatureModel {
  private digBlend = 0;
  private restBlend = 0;
  private sniff = 0;

  constructor(variant = 0, detail = 1, scale = 1) {
    super(cachedTemplate(`badger:${variant}:${detail.toFixed(2)}`, () => buildBadgermole(variant, detail)), cachedTemplate('badger:saddle', () => buildBadgerSaddle()), scale);
  }

  update(a: AnimInput): void {
    const dt = a.dt;
    const t = a.time + this.seed;
    this.digBlend = dampN(this.digBlend, a.action === 'dig' ? 1 : 0, 4, dt);
    this.restBlend = dampN(this.restBlend, a.action === 'rest' || a.action === 'sleep' ? 1 : 0, 2, dt);
    const db = this.digBlend, rb = this.restBlend;
    const run = Math.min(1, Math.max(0, (a.speed - 2.2) / 3.5));
    const ph = this.advance(a, 1.3 + run * 1.2);
    const moving = Math.min(1, a.speed / 0.6) * (1 - rb) * (1 - db);
    for (const leg of LEGS) {
      const p = ph + legPhase(leg, run * 0.6);
      const lp = legPose(p, moving, 0.38 + run * 0.2, 0.6, leg.front);
      // Digging: front claws scoop alternately.
      const scoop = leg.front ? (Math.sin(t * 7 + (leg.side > 0 ? 0 : Math.PI)) * 0.7 - 0.6) * db : 0.3 * db;
      this.rot(leg.thigh, lp.thighX + scoop + (leg.front ? -0.9 : 0.9) * rb, 0, 0.25 * leg.side * rb);
      this.rot(leg.shin, lp.shinX + (leg.front ? Math.max(0, Math.sin(t * 7 + (leg.side > 0 ? 0.6 : Math.PI + 0.6))) * 0.8 * db : 0) + 0.9 * rb, 0, 0);
      this.rot(leg.foot!, lp.footX + 0.5 * rb, 0, 0);
    }
    if (moving > 0.3) this.footfalls(ph, true);
    const breath = Math.sin(t * 1.4) * 0.012;
    this.off('body', 0, -0.45 * rb - 0.15 * db - Math.abs(Math.sin(ph)) * 0.04 * moving, 0);
    this.rot('body', 0.18 * db, 0, Math.sin(ph) * 0.05 * moving);
    this.scaleBone('body', 1 + breath, 1 + breath * 1.3, 1);
    // Blind: the head sweeps side to side "listening"; the nose wiggles constantly.
    const [ly, lp] = this.track(a, 0.7, 0.4, new THREE.Vector3(0, 1.1, 1.6));
    const sweep = Math.sin(t * 0.9) * 0.25 * (1 - moving) * (1 - db);
    this.rot('head', lp * 0.6 + 0.25 * db + 0.15 * rb + Math.sin(t * 1.7) * 0.03, ly * 0.6 + sweep, Math.sin(t * 0.6) * 0.12 * (1 - moving));
    this.sniff = dampN(this.sniff, a.action === 'sniff' || a.action === 'eat' ? 1 : 0.3, 4, dt);
    this.rot('nose', Math.sin(t * 13) * 0.08 * this.sniff, Math.sin(t * 9) * 0.1 * this.sniff, 0);
    this.rot('tail', 0.1, Math.sin(t * 1.3) * 0.2, 0);
  }
}
