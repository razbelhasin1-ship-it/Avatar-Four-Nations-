import * as THREE from 'three';
import { CreatureModel, dampN, type AnimInput } from './CreatureModel';
import { arrowMask, bezier, cachedTemplate, cnoise, ellipsoid, limb, mix, ModelBuilder, PAT, smooth, tube, xf, type ModelTemplate } from './ModelKit';

/**
 * Sky bison: ~7.6 m long, six stumpy legs, a huge fluffy white body, wide flat
 * face, short curved horns, floppy ears, a brown arrow running from the tail
 * paddle over the back to the forehead, and a broad beaver tail it "swims"
 * through the air with.
 *
 * Bones: body (root) · head · jaw · earL/earR · tail0 · tail1 · thigh{F,M,B}{L,R} · shin{F,M,B}{L,R}
 */

const LEGS: Array<{ id: string; z: number }> = [
  { id: 'F', z: 1.45 },
  { id: 'M', z: 0.0 },
  { id: 'B', z: -1.45 },
];
const LEG_PHASE: Record<string, number> = { FL: 0, ML: (2 * Math.PI) / 3, BL: (4 * Math.PI) / 3, FR: Math.PI, MR: Math.PI + (2 * Math.PI) / 3, BR: Math.PI + (4 * Math.PI) / 3 };

export const BISON_VARIANTS = [
  { fur: '#f4f1ea', shade: '#d9d3c6', arrow: '#7a5232' },
  { fur: '#f6efe2', shade: '#ddd0bb', arrow: '#6b4528' },
  { fur: '#eef0f2', shade: '#cfd4da', arrow: '#80583a' },
];

function buildBison(variant: number, detail: number): ModelTemplate {
  const v = BISON_VARIANTS[variant % BISON_VARIANTS.length];
  const B = new ModelBuilder();
  B.pad = 2.5;
  B.bone('body', null, 0, 2.05, 0);
  B.bone('head', 'body', 0, 0.08, 2.05);
  B.bone('jaw', 'head', 0, -0.48, 1.0);
  B.bone('earL', 'head', 1.02, 0.32, 0.42);
  B.bone('earR', 'head', -1.02, 0.32, 0.42);
  B.bone('tail0', 'body', 0, -0.02, -2.12);
  B.bone('tail1', 'tail0', 0, 0, -0.62);
  for (const l of LEGS) {
    for (const [side, sx] of [['L', 1], ['R', -1]] as const) {
      B.bone(`thigh${l.id}${side}`, 'body', 1.22 * sx, -0.75, l.z);
      B.bone(`shin${l.id}${side}`, `thigh${l.id}${side}`, 0, -0.62, 0);
    }
  }
  B.anchor('seat', 'body', 0, 1.06, 0.55);
  B.anchor('mouth', 'head', 0, -0.35, 1.55);
  B.anchor('head', 'head', 0, 0.4, 0.8);
  B.anchor('back', 'body', 0, 1.4, -0.5);

  const seg = (n: number) => Math.max(8, Math.round(n * detail));
  const furCol = (p: THREE.Vector3, n: THREE.Vector3, arrowFn?: (p: THREE.Vector3) => number) => {
    const shade = smooth(0.2, -0.85, n.y) * 0.85;
    const c = mix(v.fur, v.shade, shade + (cnoise(p.x, p.y, p.z, 2.1) - 0.5) * 0.25);
    const a = arrowFn ? arrowFn(p) : 0;
    return a > 0 ? c.lerp(new THREE.Color(v.arrow).offsetHSL(0, 0, (cnoise(p.x, p.y, p.z, 3) - 0.5) * 0.06), a) : c;
  };
  // Back stripe (body-local): runs along the spine on the upper back.
  const backArrow = (p: THREE.Vector3) => (p.y > 0.55 ? smooth(0.5, 0.36, Math.abs(p.x)) * smooth(0.55, 0.85, p.y) * smooth(-2.6, -2.2, p.z) * smooth(2.5, 1.9, p.z) : 0);

  // ---- Body: main mass + chest + rump, all fluffy ----
  const lumps = { amp: 0.24, freq: 1.25, seed: 3 + variant, flatBottom: 0.25 };
  B.add('body', ellipsoid(1.95, 1.32, 2.3, seg(36), seg(26), lumps), { color: (p, n) => furCol(p, n, backArrow), pat: PAT.fur, patScale: [14, 9] });
  B.add('body', xf(ellipsoid(1.62, 1.12, 1.25, seg(24), seg(18), { amp: 0.2, freq: 1.5, seed: 9 }), { pos: [0, -0.22, 1.45] }), { color: (p, n) => furCol(new THREE.Vector3(p.x, p.y - 0.22, p.z + 1.45), n), pat: PAT.fur, patScale: [10, 7] });
  B.add('body', xf(ellipsoid(1.7, 1.15, 1.2, seg(24), seg(18), { amp: 0.2, freq: 1.5, seed: 17 }), { pos: [0, -0.12, -1.4] }), { color: (p, n) => furCol(new THREE.Vector3(p.x, p.y - 0.12, p.z - 1.4), n), pat: PAT.fur, patScale: [10, 7] });
  // Neck ruff bridging body and head.
  B.add('body', xf(ellipsoid(1.55, 1.08, 0.75, seg(24), seg(16), { amp: 0.26, freq: 1.8, seed: 23 }), { pos: [0, 0.02, 2.05] }), { color: (p, n) => furCol(p, n), pat: PAT.fur, patScale: [10, 6] });

  // ---- Head ----
  const headArrow = (p: THREE.Vector3) => (p.y > 0.25 ? arrowMask(p.x, p.z - 0.15, 1.7, 0.78, 1.55, 0.8) * smooth(0.25, 0.5, p.y) : 0);
  B.add('head', xf(ellipsoid(1.18, 0.98, 0.98, seg(28), seg(20), { amp: 0.16, freq: 2, seed: 31 }), { pos: [0, 0.05, 0.62] }), { color: (p, n) => furCol(p, n, headArrow), pat: PAT.fur, patScale: [10, 7] });
  // Cheek fluff
  for (const sx of [1, -1]) {
    B.add('head', xf(ellipsoid(0.55, 0.5, 0.5, seg(14), seg(10), { amp: 0.14, freq: 3, seed: 40 + sx }), { pos: [0.72 * sx, -0.32, 0.85] }), { color: (p, n) => furCol(p, n), pat: PAT.fur, patScale: [6, 4] });
  }
  // Broad muzzle with dark nose
  B.add('head', xf(ellipsoid(0.72, 0.42, 0.48, seg(18), seg(12)), { pos: [0, -0.3, 1.38] }), {
    color: (p, n) => {
      const nose = smooth(-0.05, 0.12, n.z) * smooth(-0.35, -0.1, p.y - -0.3 - 0.0);
      const nostril = (Math.hypot(Math.abs(p.x) - 0.22, p.y + 0.2) < 0.08 && n.z > 0.5 ? 1 : 0);
      return mix(mix(v.fur, '#d8cfc4', 0.4), '#5d5049', Math.max(nose * 0.75, nostril));
    },
    pat: PAT.fur,
    patScale: [4, 3],
  });
  // Eyes (dark brown, set on the front of the face) + highlights
  for (const sx of [1, -1]) {
    B.add('head', xf(ellipsoid(0.16, 0.15, 0.1, 12, 8), { pos: [0.56 * sx, 0.16, 1.44], rot: [0, 0.35 * sx, 0] }), { color: '#22170f' });
    B.add('head', xf(ellipsoid(0.045, 0.045, 0.02, 6, 4), { pos: [0.6 * sx, 0.22, 1.53] }), { color: '#ffffff', pat: PAT.glow });
    // Brow fluff
    B.add('head', xf(ellipsoid(0.32, 0.12, 0.2, 10, 6, { amp: 0.06, freq: 6 }), { pos: [0.58 * sx, 0.34, 1.25], rot: [0.2, 0, -0.25 * sx] }), { color: (p, n) => furCol(p, n), pat: PAT.fur });
  }
  // Horns: short, curving up and back, ivory with darker tips.
  for (const sx of [1, -1]) {
    const pts = bezier(new THREE.Vector3(0.5 * sx, 0.72, 0.62), new THREE.Vector3(0.82 * sx, 1.32, 0.66), new THREE.Vector3(0.72 * sx, 1.55, 0.12), 8);
    B.add('head', tube(pts, (t) => 0.17 * (1 - t) + 0.035, { radial: 8, caps: true }), { color: (p) => mix('#e3d6b4', '#8e7a5a', smooth(1.25, 1.55, p.y)) });
  }
  // Jaw / lower lip (dark mouth line on top) with chin fluff
  B.add('jaw', xf(ellipsoid(0.58, 0.2, 0.44, seg(14), 8), { pos: [0, -0.05, 0.24] }), { color: (p, n) => (n.y > 0.55 ? '#3a2a24' : '#cfc6ba'), pat: PAT.fur });
  B.add('jaw', xf(ellipsoid(0.5, 0.3, 0.4, seg(14), 8, { amp: 0.12, freq: 4, seed: 51 }), { pos: [0, -0.28, 0.0] }), { color: (p, n) => furCol(p, n), pat: PAT.fur, patScale: [6, 4] });
  // Ears: big, floppy, pointing outward and down.
  B.addPair('earL', 'earR', xf(ellipsoid(0.62, 0.17, 0.34, seg(16), 8, { amp: 0.05, freq: 4, seed: 61 }), { pos: [0.48, -0.12, 0], rot: [0, 0, -0.45] }), {
    color: (p, n) => mix(v.fur, '#e9c9bd', n.z < -0.3 ? 0 : smooth(0.1, 0.6, -n.y) * 0.0 + (Math.abs(p.z) < 0.18 && n.y < -0.4 ? 0.55 : 0)),
    pat: PAT.fur,
    patScale: [6, 3],
  });

  // ---- Legs: six stumpy, furry legs with dark pads ----
  for (const l of LEGS) {
    for (const side of ['L', 'R'] as const) {
      const sx = side === 'L' ? 1 : -1;
      B.add(`thigh${l.id}${side}`, limb(0.72, 0.6, 0.5, seg(12), { amp: 0.14, freq: 2.4, seed: l.z * 7 + sx }), { color: (p, n) => furCol(p, n), pat: PAT.fur, patScale: [8, 6] });
      B.add(`shin${l.id}${side}`, limb(0.42, 0.5, 0.46, seg(12), { amp: 0.12, freq: 3, seed: l.z * 5 - sx }), { color: (p, n) => furCol(p, n), pat: PAT.fur, patScale: [8, 6] });
      // Foot with toes and dark pad underneath.
      B.add(`shin${l.id}${side}`, xf(ellipsoid(0.5, 0.2, 0.58, seg(14), 8), { pos: [0, -0.52, 0.1] }), { color: (p, n) => (n.y < -0.4 ? '#5a4c45' : mix(v.fur, v.shade, 0.4)), pat: PAT.fur });
      for (const tx of [-0.26, 0, 0.26]) B.add(`shin${l.id}${side}`, xf(ellipsoid(0.13, 0.11, 0.13, 8, 6), { pos: [tx, -0.6, 0.6] }), { color: '#6a5b52' });
    }
  }

  // ---- Tail: furry base + broad flat beaver paddle with the stripe ----
  const tailStripe = (p: THREE.Vector3) => smooth(0.42, 0.3, Math.abs(p.x)) * smooth(-0.05, 0.08, p.y);
  B.add('tail0', xf(ellipsoid(1.0, 0.62, 0.72, seg(18), 12, { amp: 0.16, freq: 2, seed: 71 }), { pos: [0, 0, -0.18] }), { color: (p, n) => furCol(p, n, tailStripe), pat: PAT.fur });
  B.add('tail1', xf(ellipsoid(1.45, 0.26, 1.02, seg(24), 10, { amp: 0.07, freq: 2.5, seed: 81 }), { pos: [0, 0.05, -0.8], rot: [-0.12, 0, 0] }), {
    color: (p, n) => furCol(p, n, (q) => (q.y > 0 ? smooth(0.42, 0.3, Math.abs(q.x)) * (q.z > -1.25 ? 1 : 0) + arrowMask(q.x, -(q.z + 1.45), 0.4, 0.0, 0.9, 0.4) * (q.y > 0 ? 1 : 0) : 0)),
    pat: PAT.fur,
    patScale: [10, 4],
  });
  return B.build();
}

function buildBisonSaddle(): ModelTemplate {
  const B = new ModelBuilder();
  // Must mirror the main skeleton layout (names & positions).
  B.bone('body', null, 0, 2.05, 0);
  B.bone('head', 'body', 0, 0.08, 2.05);
  // Saddle: leather platform following the back, a raised rim and a blanket.
  B.add('body', xf(ellipsoid(1.32, 0.16, 1.5, 28, 8), { pos: [0, 1.36, -0.05] }), { color: '#7b4a26' });
  B.add('body', xf(ellipsoid(1.48, 0.12, 1.68, 28, 8), { pos: [0, 1.27, -0.05] }), {
    color: (p) => (Math.abs(p.x) > 1.25 || Math.abs(p.z + 0.05) > 1.45 ? '#c8a23a' : '#b9312b'),
  });
  // Rim (a loop of rope/wood)
  const rim: THREE.Vector3[] = [];
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    rim.push(new THREE.Vector3(Math.cos(a) * 1.28, 1.5, -0.05 + Math.sin(a) * 1.45));
  }
  B.add('body', tube(rim, 0.07, { radial: 6 }), { color: '#5a3518' });
  // Reins from the saddle front to the horn bases (blend body→head).
  for (const sx of [1, -1]) {
    const pts = bezier(new THREE.Vector3(0.45 * sx, 1.5, 1.3), new THREE.Vector3(0.6 * sx, 1.55, 2.0), new THREE.Vector3(0.52 * sx, 1.0, 2.62), 10);
    B.add('body', tube(pts, 0.035, { radial: 5 }), {
      color: '#3e2412',
      blend: (p) => {
        const t = smooth(1.6, 2.6, p.z);
        return [['body', 1 - t], ['head', t]];
      },
    });
  }
  return B.build();
}

export class SkyBisonModel extends CreatureModel {
  private tailPhase = 0;
  private flyBlend = 0;
  private restBlend = 0;
  private grazeBlend = 0;
  private earFlick = 0;
  private earFlickSide = 1;
  private roarT = 0;

  constructor(variant = 0, detail = 1, scale = 1) {
    const key = `bison:${variant}:${detail.toFixed(2)}`;
    super(
      cachedTemplate(key, () => buildBison(variant, detail)),
      cachedTemplate('bison:saddle', () => buildBisonSaddle()),
      scale,
    );
  }

  update(a: AnimInput): void {
    const dt = a.dt;
    const t = a.time + this.seed;
    this.flyBlend = dampN(this.flyBlend, a.flying ? 1 : 0, 3, dt);
    const resting = a.action === 'rest' || a.action === 'sleep' || a.action === 'injured';
    this.restBlend = dampN(this.restBlend, resting && !a.flying ? 1 : 0, 2.2, dt);
    this.grazeBlend = dampN(this.grazeBlend, (a.action === 'graze' || a.action === 'eat') && !a.flying ? 1 : 0, 3, dt);
    const fb = this.flyBlend, rb = this.restBlend, gb = this.grazeBlend;
    const ground = 1 - fb;

    // Gait: six legs in a wave gait, stride grows with speed.
    const run = Math.min(1, Math.max(0, (a.speed - 2.4) / 2.5));
    const stride = 2.4 + run * 1.6;
    const ph = this.advance(a, stride);
    const moving = Math.min(1, a.speed / 1.2) * ground * (1 - rb);
    const amp = 0.32 + run * 0.22;
    for (const l of LEGS) {
      for (const side of ['L', 'R'] as const) {
        const id = `${l.id}${side}`;
        const p = ph + LEG_PHASE[id];
        const swing = -Math.sin(p) * amp * moving; // forward while lifted
        const lift = Math.max(0, Math.cos(p)) * 0.55 * moving;
        // Flying: slow paddling as if swimming through air.
        const paddle = Math.sin(t * 1.5 + LEG_PHASE[id] * 0.5) * 0.35;
        const sx = side === 'L' ? 1 : -1;
        // Resting: legs fold out to the sides under the body.
        const restX = l.id === 'F' ? -1.05 : l.id === 'B' ? 1.0 : 0.15;
        const thighX = swing * ground * (1 - rb) + paddle * fb + restX * rb + (fb * (l.id === 'F' ? -0.25 : l.id === 'B' ? 0.35 : 0));
        const thighZ = (0.55 * rb + 0.12 * fb) * sx * (l.id === 'M' ? 1.6 : 1);
        this.rot(`thigh${id}`, thighX, 0, thighZ);
        this.rot(`shin${id}`, lift * ground + (0.5 + 0.25 * Math.sin(t * 1.5 + LEG_PHASE[id])) * fb + 1.25 * rb, 0, 0);
      }
    }
    if (moving > 0.3) this.footfalls(ph, true);

    // Body: bob, breathing, lowered when resting; pitch with tail strokes in flight.
    this.tailPhase += dt * (0.9 + (a.boost ? 0.9 : 0) + Math.max(0, a.vy) * 0.08) * Math.PI * 2 * (0.4 + 0.6 * fb);
    const stroke = Math.sin(this.tailPhase);
    const breath = Math.sin(t * (rb > 0.5 ? 0.9 : 1.3)) * (0.012 + 0.01 * rb);
    const bob = -Math.abs(Math.sin(ph)) * 0.06 * moving + Math.sin(this.tailPhase + 0.6) * 0.12 * fb;
    this.off('body', 0, bob - 1.1 * rb + 0.08 * gb, 0);
    this.scaleBone('body', 1 + breath, 1 + breath * 1.3, 1 + breath * 0.5);
    this.rot('body', stroke * 0.04 * fb - 0.03 * gb + 0.02 * rb, 0, Math.sin(ph * 0.5) * 0.025 * moving);

    // Tail: gentle sway on the ground, powerful up/down strokes in flight.
    const tailUp = a.flying ? -Math.max(-0.4, Math.min(0.4, a.vy * 0.04)) : 0;
    this.rot('tail0', (stroke * 0.32 + tailUp) * fb + (0.1 + Math.sin(t * 0.8) * 0.06) * ground + 0.25 * rb, Math.sin(t * 0.7) * 0.12 * ground, 0);
    this.rot('tail1', Math.sin(this.tailPhase - 0.9) * 0.38 * fb + Math.sin(t * 0.8 - 0.6) * 0.08 * ground, 0, 0);

    // Head: look-at, grazing, rest; slight lift in flight.
    const [ly, lp] = this.track(a, 0.7, 0.45, new THREE.Vector3(0, 2.3, 2.6));
    const graze = gb * 0.75;
    const rest = rb * 0.25;
    let headX = lp * (1 - gb) + graze + rest - 0.08 * fb + Math.sin(t * 0.6) * 0.03;
    if (a.action === 'roar' || a.action === 'alert') {
      this.roarT += dt;
      headX -= 0.25 * Math.min(1, this.roarT * 3);
    } else this.roarT = 0;
    this.rot('head', headX, ly * (1 - gb) + Math.sin(t * 0.4) * 0.05 * gb, 0);
    // Jaw: chewing when grazing/eating, open when calling.
    const chew = (gb > 0.3 ? Math.max(0, Math.sin(t * 7)) * 0.18 : 0) + (a.action === 'roar' ? 0.42 * Math.min(1, this.roarT * 4) : 0);
    this.rot('jaw', chew, 0, 0);
    // Ears: floppy, with occasional flicks; streaming back in flight.
    this.earFlick = Math.max(0, this.earFlick - dt * 3);
    if (Math.random() < dt * (0.12 + a.excite * 0.5)) {
      this.earFlick = 1;
      this.earFlickSide = Math.random() < 0.5 ? 1 : -1;
    }
    const flop = Math.sin(t * 1.1) * 0.08 + moving * Math.sin(ph * 2) * 0.12;
    const flick = Math.sin(this.earFlick * Math.PI) * 0.45;
    this.rot('earL', -0.5 * fb, 0.35 * fb, flop + (this.earFlickSide > 0 ? flick : 0) + 0.25 * fb);
    this.rot('earR', -0.5 * fb, -0.35 * fb, -flop - (this.earFlickSide < 0 ? flick : 0) - 0.25 * fb);
  }
}
