import * as THREE from 'three';
import { CreatureModel, dampN, type AnimInput } from './CreatureModel';
import { legPhase, legPose, type LegSpec } from './gaits';
import { bezier, cachedTemplate, cnoise, ellipsoid, limb, mix, ModelBuilder, PAT, smooth, tube, xf, type ModelTemplate } from './ModelKit';

/**
 * Polar bear dog: a 3.6 m white bear-dog — heavy bear body and paws, a dog's
 * long muzzle, small round ears, thick neck ruff, short fluffy tail.
 *
 * Bones: body · neck · head · jaw · earL/R · tail · thigh{F,B}{L,R} · shin… · paw…
 */

export const BEARDOG_VARIANTS = [
  { fur: '#f3f2ec', shade: '#cfd3d6' },
  { fur: '#efebe1', shade: '#d3cbbb' },
  { fur: '#e9edf0', shade: '#b9c2ca' },
];

const LEGS: LegSpec[] = [
  { thigh: 'thighFL', shin: 'shinFL', foot: 'pawFL', front: true, side: 1 },
  { thigh: 'thighFR', shin: 'shinFR', foot: 'pawFR', front: true, side: -1 },
  { thigh: 'thighBL', shin: 'shinBL', foot: 'pawBL', front: false, side: 1 },
  { thigh: 'thighBR', shin: 'shinBR', foot: 'pawBR', front: false, side: -1 },
];

function buildBearDog(variant: number, detail: number): ModelTemplate {
  const v = BEARDOG_VARIANTS[variant % BEARDOG_VARIANTS.length];
  const seg = (n: number) => Math.max(8, Math.round(n * detail));
  const B = new ModelBuilder();
  B.pad = 1.2;
  B.bone('body', null, 0, 1.32, 0);
  B.bone('neck', 'body', 0, 0.22, 1.05);
  B.bone('head', 'neck', 0, 0.3, 0.5);
  B.bone('jaw', 'head', 0, -0.2, 0.38);
  B.bone('earL', 'head', 0.27, 0.3, -0.05);
  B.bone('earR', 'head', -0.27, 0.3, -0.05);
  B.bone('tail', 'body', 0, 0.22, -1.28);
  for (const [id, z, y] of [['F', 0.78, -0.32], ['B', -0.82, -0.3]] as const) {
    for (const [s, sx] of [['L', 1], ['R', -1]] as const) {
      B.bone(`thigh${id}${s}`, 'body', 0.42 * sx, y, z);
      B.bone(`shin${id}${s}`, `thigh${id}${s}`, 0, -0.5, id === 'F' ? 0.02 : -0.04);
      B.bone(`paw${id}${s}`, `shin${id}${s}`, 0, -0.42, 0.02);
    }
  }
  B.anchor('seat', 'body', 0, 0.8, 0.12); // saddle top
  B.anchor('mouth', 'head', 0, -0.12, 0.85);
  B.anchor('head', 'head', 0, 0.2, 0.3);

  const fur = (p: THREE.Vector3, n: THREE.Vector3) => mix(v.fur, v.shade, smooth(0.1, -0.9, n.y) * 0.7 + (cnoise(p.x, p.y, p.z, 3.3) - 0.5) * 0.3);
  const lumpy = (seed: number, amp = 0.09) => ({ amp, freq: 3, seed });
  // Body: chest, barrel, hips — a bear's mass.
  B.add('body', xf(ellipsoid(0.7, 0.66, 1.25, seg(26), seg(18), lumpy(1, 0.1)), { pos: [0, 0, -0.05] }), { color: fur, pat: PAT.fur, patScale: [12, 9] });
  B.add('body', xf(ellipsoid(0.74, 0.76, 0.66, seg(22), seg(16), lumpy(2, 0.12)), { pos: [0, 0.06, 0.72] }), { color: fur, pat: PAT.fur, patScale: [10, 8] });
  B.add('body', xf(ellipsoid(0.66, 0.64, 0.62, seg(22), seg(16), lumpy(3, 0.1)), { pos: [0, 0.02, -0.82] }), { color: fur, pat: PAT.fur, patScale: [10, 8] });
  // Neck ruff (thick fur collar).
  B.add('neck', xf(ellipsoid(0.56, 0.6, 0.55, seg(20), seg(14), lumpy(4, 0.16)), { pos: [0, 0.05, 0.12] }), { color: fur, pat: PAT.fur, patScale: [8, 6] });
  // Head: skull, long dog muzzle, black nose, eyes, brow.
  B.add('head', xf(ellipsoid(0.38, 0.36, 0.42, seg(20), seg(14), lumpy(5, 0.05)), { pos: [0, 0.04, 0.08] }), { color: fur, pat: PAT.fur, patScale: [6, 5] });
  B.add('head', xf(ellipsoid(0.22, 0.2, 0.42, seg(16), seg(12)), { pos: [0, -0.08, 0.5] }), { color: (p, n) => mix(v.fur, '#d9d6cf', smooth(0.2, 0.9, p.z)), pat: PAT.fur, patScale: [4, 4] });
  B.add('head', xf(ellipsoid(0.1, 0.075, 0.07, 10, 8), { pos: [0, -0.02, 0.9] }), { color: '#1c1a1a' });
  for (const sx of [1, -1]) {
    B.add('head', xf(ellipsoid(0.055, 0.05, 0.035, 8, 6), { pos: [0.19 * sx, 0.1, 0.38], rot: [0, 0.5 * sx, 0] }), { color: '#1d140e' });
    B.add('head', xf(ellipsoid(0.016, 0.016, 0.01, 4, 3), { pos: [0.205 * sx, 0.12, 0.415] }), { color: '#ffffff', pat: PAT.glow });
  }
  B.add('jaw', xf(ellipsoid(0.17, 0.08, 0.32, 12, 8), { pos: [0, -0.02, 0.18] }), { color: (p, n) => (n.y > 0.5 ? '#3a2322' : v.fur), pat: PAT.fur });
  B.add('jaw', xf(ellipsoid(0.1, 0.03, 0.2, 8, 5), { pos: [0, 0.02, 0.15] }), { color: '#d77a7a' });
  // Ears: small, round (bear) with pink insides.
  B.addPair('earL', 'earR', xf(ellipsoid(0.12, 0.13, 0.05, 10, 8), { pos: [0.02, 0.07, 0], rot: [0, 0.3, -0.3] }), { color: (p, n) => (n.z > 0.4 && p.y < 0.1 ? '#e7b6b0' : v.fur), pat: PAT.fur });
  // Legs: thick, furry, big paws with dark pads and claws.
  for (const leg of LEGS) {
    const id = leg.thigh.slice(5);
    const front = leg.front;
    B.add(leg.thigh, limb(0.56, front ? 0.27 : 0.3, 0.22, seg(12), lumpy(10 + leg.side, 0.07)), { color: fur, pat: PAT.fur, patScale: [8, 6] });
    B.add(leg.shin, limb(0.45, 0.2, 0.18, seg(10), lumpy(20 + leg.side, 0.05)), { color: fur, pat: PAT.fur, patScale: [8, 6] });
    B.add(`paw${id}`, xf(ellipsoid(0.22, 0.11, 0.27, 12, 8), { pos: [0, -0.02, 0.06] }), { color: (p, n) => (n.y < -0.5 ? '#3b3638' : v.fur), pat: PAT.fur });
    for (const tx of [-0.12, -0.04, 0.04, 0.12]) B.add(`paw${id}`, xf(new THREE.ConeGeometry(0.025, 0.09, 5), { pos: [tx, -0.06, 0.33], rot: [Math.PI / 2 + 0.4, 0, 0] }), { color: '#2b2622' });
  }
  // Tail: short and fluffy, held up.
  B.add('tail', tube(bezier(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.15, -0.25), new THREE.Vector3(0, 0.12, -0.5), 6), (t) => 0.16 * (1 - t * 0.6), { radial: 9, caps: true, lumps: { amp: 0.06, freq: 8, seed: 33 } }), { color: fur, pat: PAT.fur });
  return B.build();
}

function buildBearDogSaddle(): ModelTemplate {
  const B = new ModelBuilder();
  B.bone('body', null, 0, 1.32, 0);
  B.bone('neck', 'body', 0, 0.22, 1.05);
  B.bone('head', 'neck', 0, 0.3, 0.5);
  // Water Tribe blanket (blue with white fur trim) and a leather seat.
  B.add('body', xf(ellipsoid(0.76, 0.12, 0.62, 20, 8), { pos: [0, 0.6, 0.1], rot: [0.06, 0, 0] }), { color: (p) => (Math.abs(p.x) > 0.6 ? '#f2f2f2' : '#2b5aa0'), pat: PAT.none });
  B.add('body', xf(ellipsoid(0.42, 0.11, 0.4, 16, 8), { pos: [0, 0.7, 0.12] }), { color: '#6e4426' });
  B.add('body', xf(ellipsoid(0.36, 0.1, 0.06, 12, 6), { pos: [0, 0.76, 0.46] }), { color: '#5a361c' });
  // Girth strap
  const strap: THREE.Vector3[] = [];
  for (let i = 0; i <= 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    strap.push(new THREE.Vector3(Math.sin(a) * 0.76, Math.cos(a) * 0.72, 0.22));
  }
  B.add('body', tube(strap, 0.03, { radial: 5 }), { color: '#3e2412' });
  // Reins to the head
  for (const sx of [1, -1]) {
    B.add('body', tube(bezier(new THREE.Vector3(0.22 * sx, 0.74, 0.4), new THREE.Vector3(0.3 * sx, 0.85, 1.0), new THREE.Vector3(0.24 * sx, 0.52, 1.82), 8), 0.02, { radial: 4 }), {
      color: '#3e2412',
      blend: (p) => {
        const t = smooth(1.0, 1.8, p.z);
        return [['body', 1 - t], ['head', t]];
      },
    });
  }
  return B.build();
}

export class PolarBearDogModel extends CreatureModel {
  private sitBlend = 0;
  private restBlend = 0;
  private alertBlend = 0;
  private sniffT = 0;
  private wag = 0;

  constructor(variant = 0, detail = 1, scale = 1) {
    super(cachedTemplate(`beardog:${variant}:${detail.toFixed(2)}`, () => buildBearDog(variant, detail)), cachedTemplate('beardog:saddle', () => buildBearDogSaddle()), scale);
  }

  update(a: AnimInput): void {
    const dt = a.dt;
    const t = a.time + this.seed;
    const resting = a.action === 'rest' || a.action === 'sleep' || a.action === 'trapped';
    this.restBlend = dampN(this.restBlend, resting ? 1 : 0, 2.5, dt);
    this.sitBlend = dampN(this.sitBlend, a.action === 'sit' || a.action === 'happy' ? 1 : 0, 3, dt);
    this.alertBlend = dampN(this.alertBlend, a.action === 'alert' || a.action === 'roar' ? 1 : 0, 5, dt);
    const rb = this.restBlend, sb = this.sitBlend, ab = this.alertBlend;
    const run = Math.min(1, Math.max(0, (a.speed - 3.5) / 6));
    const stride = 1.6 + run * 2.6;
    const ph = this.advance(a, stride);
    const moving = Math.min(1, a.speed / 0.8) * (1 - rb) * (1 - sb);
    const swim = a.swimming ? 1 : 0;
    for (const leg of LEGS) {
      const p = ph + legPhase(leg, run);
      const lp = legPose(p, moving, 0.42 + run * 0.35, 0.7 + run * 0.4, leg.front);
      const paddle = Math.sin(t * 4 + legPhase(leg, 0)) * 0.6 * swim;
      // Rest: lie down with front legs forward, hind legs tucked; sit: hind legs folded.
      const restX = leg.front ? -1.2 : 1.1;
      const sitX = leg.front ? 0.05 : -1.05;
      this.rot(leg.thigh, lp.thighX * (1 - swim) + paddle + restX * rb + sitX * sb, 0, 0.15 * leg.side * rb);
      this.rot(leg.shin, lp.shinX + 0.5 * swim + (leg.front ? 0.2 : 1.6) * rb + (leg.front ? 0 : 1.9) * sb, 0, 0);
      this.rot(leg.foot!, lp.footX + (leg.front ? 1.0 : -0.6) * rb + (leg.front ? 0 : -0.8) * sb, 0, 0);
    }
    if (moving > 0.3) this.footfalls(ph, a.speed > 5);
    // Body: lower when resting/sitting; bounding motion when galloping.
    const breath = Math.sin(t * (rb > 0.5 ? 1.1 : 1.8)) * 0.015;
    const gallopBob = Math.sin(ph * 2) * 0.08 * run * moving;
    this.off('body', 0, -0.72 * rb - 0.32 * sb + gallopBob - 0.35 * swim - Math.abs(Math.sin(ph)) * 0.03 * moving, -0.2 * sb);
    this.rot('body', -0.42 * sb + Math.cos(ph * 2) * 0.05 * run * moving + 0.04 * ab, 0, Math.sin(ph) * 0.03 * moving);
    this.scaleBone('body', 1 + breath, 1 + breath * 1.4, 1);
    // Head & neck
    const [ly, lp] = this.track(a, 0.9, 0.6, new THREE.Vector3(0, 1.85, 1.6));
    let sniff = 0;
    if (a.action === 'sniff' || a.action === 'eat') {
      this.sniffT += dt;
      sniff = 0.5 + Math.sin(this.sniffT * 9) * 0.05;
    } else this.sniffT = 0;
    this.rot('neck', 0.15 * rb + sniff * 0.6 - 0.25 * ab + 0.3 * sb * 0 + run * 0.12 * moving, ly * 0.5, 0);
    this.rot('head', lp + 0.2 * rb + sniff * 0.4 + Math.sin(t * 0.7) * 0.03, ly * 0.5, Math.sin(t * 0.5) * 0.04 * (1 - moving));
    const pant = a.speed > 6 || a.action === 'happy' ? 0.12 + Math.sin(t * 9) * 0.06 : 0;
    this.rot('jaw', pant + (a.action === 'roar' ? 0.4 : 0) + (a.action === 'eat' ? Math.max(0, Math.sin(t * 8)) * 0.18 : 0), 0, 0);
    // Ears: pinned back when alert, perked when curious.
    const perk = -0.25 * ab + Math.sin(t * 2.3) * 0.05;
    this.rot('earL', perk, 0, -0.1 * ab);
    this.rot('earR', perk, 0, 0.1 * ab);
    // Tail wag (excitement) and sway.
    this.wag = dampN(this.wag, a.excite, 3, dt);
    this.rot('tail', 0.2 - 0.3 * ab + 0.25 * rb, Math.sin(t * (4 + 8 * this.wag)) * (0.12 + 0.45 * this.wag), 0);
  }
}
