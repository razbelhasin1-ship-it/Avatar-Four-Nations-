import * as THREE from 'three';
import { CreatureModel, dampN, type AnimInput } from './CreatureModel';
import { bezier, cachedTemplate, cnoise, cone, ellipsoid, flat, mirrorX, mix, ModelBuilder, PAT, smooth, tube, xf, type ModelTemplate } from './ModelKit';

/**
 * Sun Warrior dragon: a ~17 m serpentine body skinned over a spine chain
 * (smooth bending), overlapping scales with golden belly plates, a ridge of
 * fins along the back, swept-back horns, a frilled mane, long trailing
 * whiskers, four clawed legs and small fin-like wings. It flies by undulating.
 *
 * Bones: spine0 (chest, root) → neck0 → neck1 → head → jaw, whiskers;
 *        spine0 → spine1 … spine12 (tail); arm/fore/foot × 4 legs; wingL/R.
 */

export const DRAGON_VARIANTS = [
  { back: '#c4261c', back2: '#8e160f', belly: '#f0c65a', fin: '#ff9a2a', horn: '#f4e6c0', eye: '#ffd23a' },
  { back: '#1f5fc4', back2: '#123a86', belly: '#f2d27a', fin: '#5ad0ff', horn: '#f4ead2', eye: '#ffe066' },
];

const SPINE_N = 12;
const SPINE_STEP = 1.0;
const ROOT_Y = 2.1;
/** Body radius at each chain point: head base, neck1, neck0, spine0..spine12. */
const RADII = [0.46, 0.52, 0.64, 0.84, 0.86, 0.82, 0.77, 0.7, 0.62, 0.53, 0.45, 0.37, 0.3, 0.23, 0.16, 0.09];

function chainZ(): Array<{ bone: string; z: number; y: number }> {
  const out: Array<{ bone: string; z: number; y: number }> = [
    { bone: 'head', z: 3.0, y: 0.55 },
    { bone: 'neck1', z: 2.05, y: 0.45 },
    { bone: 'neck0', z: 1.05, y: 0.25 },
    { bone: 'spine0', z: 0, y: 0 },
  ];
  for (let i = 1; i <= SPINE_N; i++) out.push({ bone: `spine${i}`, z: -i * SPINE_STEP, y: 0 });
  return out;
}

function buildDragon(variant: number, detail: number): ModelTemplate {
  const v = DRAGON_VARIANTS[variant % DRAGON_VARIANTS.length];
  const seg = (n: number) => Math.max(8, Math.round(n * detail));
  const B = new ModelBuilder();
  B.pad = 6;
  B.bone('spine0', null, 0, ROOT_Y, 0);
  B.bone('neck0', 'spine0', 0, 0.25, 1.05);
  B.bone('neck1', 'neck0', 0, 0.2, 1.0);
  B.bone('head', 'neck1', 0, 0.1, 0.95);
  B.bone('jaw', 'head', 0, -0.22, 0.45);
  for (let i = 1; i <= SPINE_N; i++) B.bone(`spine${i}`, i === 1 ? 'spine0' : `spine${i - 1}`, 0, 0, -SPINE_STEP);
  // Whiskers: 3-bone chains trailing from the snout.
  for (const [s, sx] of [['L', 1], ['R', -1]] as const) {
    B.bone(`whisk${s}0`, 'head', 0.3 * sx, -0.08, 1.55);
    B.bone(`whisk${s}1`, `whisk${s}0`, 0.45 * sx, -0.15, -0.55);
    B.bone(`whisk${s}2`, `whisk${s}1`, 0.3 * sx, -0.2, -0.65);
    B.bone(`wing${s}`, 'spine1', 0.62 * sx, 0.42, 0.35);
  }
  // Legs: front at the chest, hind at spine4.
  for (const [id, parent, z] of [['F', 'spine0', 0.25], ['B', 'spine4', 0.0]] as const) {
    for (const [s, sx] of [['L', 1], ['R', -1]] as const) {
      B.bone(`arm${id}${s}`, parent, 0.66 * sx, -0.42, z);
      B.bone(`fore${id}${s}`, `arm${id}${s}`, 0.05 * sx, -0.78, 0.12);
      B.bone(`foot${id}${s}`, `fore${id}${s}`, 0, -0.74, 0.05);
    }
  }
  B.anchor('seat', 'spine0', 0, 0.42, -0.25);
  B.anchor('mouth', 'head', 0, -0.12, 1.85);
  B.anchor('head', 'head', 0, 0.4, 0.6);

  // ---- Body tube (spine0-local), smoothly skinned along the chain ----
  const chain = chainZ();
  const ctrl = chain.map((c) => new THREE.Vector3(0, c.y, c.z));
  const curve = new THREE.CatmullRomCurve3(ctrl, false, 'catmullrom', 0.4);
  const steps = seg(64);
  const pts: THREE.Vector3[] = [];
  const rad: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    pts.push(curve.getPoint(u));
    const f = u * (RADII.length - 1);
    const i0 = Math.floor(f), i1 = Math.min(RADII.length - 1, i0 + 1);
    rad.push(RADII[i0] + (RADII[i1] - RADII[i0]) * (f - i0));
  }
  const weights = (p: THREE.Vector3): Array<[string, number]> => {
    for (let i = 0; i < chain.length - 1; i++) {
      const a = chain[i], b = chain[i + 1];
      if (p.z <= a.z && p.z >= b.z) {
        const t = (a.z - p.z) / (a.z - b.z);
        return [[a.bone, 1 - t], [b.bone, t]];
      }
    }
    return p.z > chain[0].z ? [[chain[0].bone, 1]] : [[chain[chain.length - 1].bone, 1]];
  };
  const bodyCol = (p: THREE.Vector3, n: THREE.Vector3) => {
    const belly = smooth(-0.15, -0.5, n.y);
    const back = mix(v.back, v.back2, smooth(0.6, 0.95, n.y) * 0.6 + (cnoise(p.x, p.y, p.z, 1.3) - 0.5) * 0.35);
    return back.lerp(new THREE.Color(v.belly), belly);
  };
  B.add('spine0', tube(pts, rad, { radial: seg(18), caps: true }), { color: bodyCol, pat: PAT.scales, patScale: [22, 3.2], blend: weights });

  // ---- Dorsal fins along the back (rigid per bone) ----
  const finShape = (h: number, len: number) => {
    const s = new THREE.Shape();
    s.moveTo(len * 0.5, 0);
    s.quadraticCurveTo(len * 0.25, h * 0.6, -len * 0.45, h);
    s.quadraticCurveTo(-len * 0.3, h * 0.45, -len * 0.5, 0);
    s.lineTo(len * 0.5, 0);
    return s;
  };
  for (let i = 1; i < chain.length - 1; i++) {
    const c = chain[i];
    if (c.bone === 'spine0' || c.bone === 'spine1') continue; // the rider sits here
    const r = RADII[i];
    const h = Math.max(0.12, 0.62 * r + 0.08);
    const g = flat(finShape(h, 0.85), 0.03, 6);
    // Shape +x is the fin's leading edge → rotate so it faces forward (+Z).
    B.add(c.bone, xf(g, { pos: [0, r * 0.86, 0], rot: [0, -Math.PI / 2, 0] }), {
      color: (p) => mix(v.back2, v.fin, smooth(0.0, h * 0.8, p.y - r * 0.86)),
      pat: PAT.none,
    });
  }
  // Tail tip flame-fin
  B.add(`spine${SPINE_N}`, xf(flat(finShape(0.55, 0.9), 0.03, 6), { pos: [0, 0.05, -0.35], rot: [0, -Math.PI / 2, 0] }), { color: v.fin });

  // ---- Head ----
  B.add('head', xf(ellipsoid(0.48, 0.4, 0.62, seg(20), seg(14)), { pos: [0, 0.06, 0.3] }), { color: bodyCol, pat: PAT.scales, patScale: [10, 6] });
  B.add('head', tube([new THREE.Vector3(0, 0.02, 0.5), new THREE.Vector3(0, -0.02, 1.0), new THREE.Vector3(0, -0.05, 1.5), new THREE.Vector3(0, -0.06, 1.78)], [0.36, 0.32, 0.27, 0.2], { radial: seg(14), caps: true, squash: [1.25, 0.82] }), {
    color: (p, n) => {
      const nostril = n.z > 0.3 && Math.hypot(Math.abs(p.x) - 0.12, p.y - 0.06) < 0.05 && p.z > 1.6 ? 1 : 0;
      return bodyCol(p, n).lerp(new THREE.Color('#2a0806'), nostril);
    },
    pat: PAT.scales,
    patScale: [9, 7],
  });
  for (const sx of [1, -1]) {
    // Brow ridge, eye (glowing gold with a slit), horn, cheek frill.
    B.add('head', xf(ellipsoid(0.2, 0.09, 0.3, 10, 6), { pos: [0.3 * sx, 0.26, 0.85], rot: [0.1, 0.25 * sx, -0.2 * sx] }), { color: v.back2, pat: PAT.scales, patScale: [6, 4] });
    B.add('head', xf(ellipsoid(0.1, 0.075, 0.09, 10, 8), { pos: [0.33 * sx, 0.16, 0.92], rot: [0, 0.55 * sx, 0] }), {
      color: (p) => (Math.abs(p.z - 0.92 + (p.x - 0.33 * sx) * 0.5 * sx) < 0.012 ? '#1a0a00' : v.eye),
      pat: PAT.glow,
    });
    const horn = bezier(new THREE.Vector3(0.22 * sx, 0.36, 0.25), new THREE.Vector3(0.45 * sx, 0.85, -0.35), new THREE.Vector3(0.5 * sx, 0.72, -1.25), 10);
    B.add('head', tube(horn, (t) => 0.13 * (1 - t) + 0.025, { radial: 8, caps: true }), { color: (p) => mix(v.horn, '#c9a04a', smooth(-0.3, -1.2, p.z)) });
    const frill = new THREE.Shape();
    frill.moveTo(0, 0);
    frill.lineTo(-0.15, 0.55);
    frill.lineTo(-0.35, 0.3);
    frill.lineTo(-0.6, 0.5);
    frill.lineTo(-0.7, 0.12);
    frill.lineTo(-0.95, 0.15);
    frill.lineTo(-0.7, -0.12);
    frill.lineTo(0, -0.15);
    // Frill shape extends along −x: aim it outward and back on each side.
    B.add('head', xf(flat(frill, 0.025, 2), { pos: [0.4 * sx, -0.05, 0.35], rot: [0, sx > 0 ? -2.214 : -0.927, 0] }), { color: (p) => mix(v.fin, v.back2, smooth(0.35, 0.0, Math.abs(p.y + 0.05))) });
  }
  // Teeth along the upper jaw
  for (let i = 0; i < 6; i++) {
    for (const sx of [1, -1]) B.add('head', xf(cone(0.03, 0.09, 4), { pos: [0.2 * sx * (1 - i * 0.06), -0.22, 0.9 + i * 0.15], rot: [Math.PI, 0, 0] }), { color: '#f6f0de' });
  }
  // Jaw
  B.add('jaw', tube([new THREE.Vector3(0, 0, -0.1), new THREE.Vector3(0, -0.04, 0.5), new THREE.Vector3(0, -0.02, 1.15)], [0.26, 0.22, 0.14], { radial: 12, caps: true, squash: [1.25, 0.5] }), {
    color: (p, n) => (n.y > 0.4 ? '#7a1a12' : v.belly),
    pat: PAT.scales,
    patScale: [6, 5],
  });
  // Whiskers (smoothly skinned over their chains)
  for (const [s, sx] of [['L', 1], ['R', -1]] as const) {
    const p0 = new THREE.Vector3(0, 0, 0);
    const p1 = new THREE.Vector3(0.45 * sx, -0.15, -0.55);
    const p2 = p1.clone().add(new THREE.Vector3(0.3 * sx, -0.2, -0.65));
    const p3 = p2.clone().add(new THREE.Vector3(0.15 * sx, -0.15, -0.6));
    const curvePts = new THREE.CatmullRomCurve3([p0, p1, p2, p3]).getPoints(seg(14));
    B.add(`whisk${s}0`, tube(curvePts, (t) => 0.045 * (1 - t) + 0.012, { radial: 5, caps: true }), {
      color: v.horn,
      blend: (p) => {
        const d = p.distanceTo(p0);
        const w1 = smooth(0.2, 0.75, d), w2 = smooth(0.9, 1.4, d);
        return [[`whisk${s}0`, 1 - w1], [`whisk${s}1`, w1 * (1 - w2)], [`whisk${s}2`, w2]];
      },
    });
  }
  // ---- Legs with talons ----
  for (const id of ['F', 'B'] as const) {
    for (const s of ['L', 'R'] as const) {
      const up = id === 'F' ? 0.26 : 0.3;
      B.add(`arm${id}${s}`, tube([new THREE.Vector3(0, 0.15, 0), new THREE.Vector3(0.02, -0.4, 0.05), new THREE.Vector3(0.05, -0.78, 0.12)], [up, up * 0.85, up * 0.7], { radial: 10, caps: true }), { color: bodyCol, pat: PAT.scales, patScale: [8, 5] });
      B.add(`fore${id}${s}`, tube([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -0.4, 0.02), new THREE.Vector3(0, -0.74, 0.05)], [up * 0.7, up * 0.6, up * 0.55], { radial: 10, caps: true }), { color: bodyCol, pat: PAT.scales, patScale: [8, 5] });
      B.add(`foot${id}${s}`, xf(ellipsoid(0.2, 0.09, 0.26, 10, 6), { pos: [0, -0.02, 0.12] }), { color: v.back2, pat: PAT.scales });
      for (const tx of [-0.13, 0, 0.13]) B.add(`foot${id}${s}`, xf(cone(0.04, 0.22, 5), { pos: [tx, -0.04, 0.34], rot: [Math.PI / 2 + 0.6, 0, 0] }), { color: v.horn });
      B.add(`foot${id}${s}`, xf(cone(0.035, 0.16, 5), { pos: [0, -0.02, -0.12], rot: [-Math.PI / 2 - 0.6, 0, 0] }), { color: v.horn });
    }
  }
  // ---- Small fin-like wings ----
  for (const [s, sx] of [['L', 1], ['R', -1]] as const) {
    const w = new THREE.Shape();
    w.moveTo(0, 0);
    w.quadraticCurveTo(0.4, 0.5, 1.4, 0.55);
    w.lineTo(1.1, 0.25);
    w.lineTo(1.45, 0.05);
    w.lineTo(1.05, -0.1);
    w.lineTo(1.2, -0.35);
    w.quadraticCurveTo(0.5, -0.3, 0, -0.15);
    // Shape lies in XY → lay it flat (shape y → +Z), extend outward (+X left / −X right), sweep back.
    let g = xf(flat(w, 0.03, 6), { rot: [Math.PI / 2, 0, 0] });
    if (sx < 0) g = mirrorX(g);
    B.add(`wing${s}`, xf(g, { rot: [0, sx * 0.5, 0] }), { color: (p) => mix(v.fin, v.back2, smooth(0.6, 0.0, Math.abs(p.x))) });
  }
  return B.build();
}

function buildDragonHarness(variant: number): ModelTemplate {
  const B = new ModelBuilder();
  B.bone('spine0', null, 0, ROOT_Y, 0);
  // Sun Warrior harness: golden collar band + red silk seat cloth.
  const ring: THREE.Vector3[] = [];
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    ring.push(new THREE.Vector3(Math.sin(a) * 0.9, Math.cos(a) * 0.9, 0.35));
  }
  B.add('spine0', tube(ring, 0.06, { radial: 6 }), { color: '#e2b23a' });
  B.add('spine0', xf(ellipsoid(0.5, 0.06, 0.55, 14, 6), { pos: [0, 0.86, -0.25] }), { color: variant % 2 ? '#d8b04a' : '#a8141c' });
  return B.build();
}

export class DragonModel extends CreatureModel {
  private wave = 0;
  private flyBlend = 0;
  private restBlend = 0;
  private roar = 0;
  private bowBlend = 0;
  private wingPh = 0;

  constructor(variant = 0, detail = 1, scale = 1) {
    super(cachedTemplate(`dragon:${variant}:${detail.toFixed(2)}`, () => buildDragon(variant, detail)), cachedTemplate(`dragon:harness:${variant}`, () => buildDragonHarness(variant)), scale);
  }

  update(a: AnimInput): void {
    const dt = a.dt;
    const t = a.time + this.seed;
    this.flyBlend = dampN(this.flyBlend, a.flying ? 1 : 0, 2.5, dt);
    this.restBlend = dampN(this.restBlend, (a.action === 'rest' || a.action === 'sleep') && !a.flying ? 1 : 0, 1.5, dt);
    this.roar = dampN(this.roar, a.action === 'roar' || a.action === 'breath' ? 1 : 0, 6, dt);
    this.bowBlend = dampN(this.bowBlend, a.action === 'bow' ? 1 : 0, 2, dt);
    const fb = this.flyBlend, rb = this.restBlend, ground = 1 - fb;
    // Undulation travels from head to tail; faster when moving.
    this.wave += dt * (1.1 + Math.min(2.5, a.speed * 0.12)) * (1 + fb * 0.4);
    const yawAmp = (0.05 + 0.04 * ground * Math.min(1, a.speed / 3)) * (1 - rb);
    const pitchAmp = 0.07 * fb;
    const turnBend = Math.max(-0.08, Math.min(0.08, -a.turn * 0.06));
    for (let i = 1; i <= SPINE_N; i++) {
      const k = i / SPINE_N;
      const w = this.wave * 2 - i * 0.55;
      const coil = rb * (i > 3 ? 0.2 : 0.05);
      const droop = ground * (i <= 4 ? 0.035 : i <= 8 ? -0.02 : 0) * (1 - rb);
      this.rot(`spine${i}`, Math.sin(w + 0.7) * pitchAmp * (0.5 + k) + droop - pitchAmp * 0.2 * Math.sign(a.vy) * k, Math.sin(w) * yawAmp * (0.4 + k) + turnBend + coil, 0);
    }
    // Chest rises and falls with the wave in flight.
    this.rot('spine0', Math.sin(this.wave * 2 + 1.5) * 0.04 * fb - Math.max(-0.25, Math.min(0.25, a.vy * 0.025)) * fb, 0, 0);
    this.off('spine0', 0, Math.sin(this.wave * 2) * 0.15 * fb - 0.75 * rb, 0);
    // Legs: walk on the ground, tucked back in flight.
    const ph = this.advance(a, 2.2);
    const moving = Math.min(1, a.speed / 0.8) * ground * (1 - rb);
    for (const id of ['F', 'B'] as const) {
      for (const [s, off] of [['L', 0], ['R', Math.PI]] as const) {
        const p = ph + off + (id === 'B' ? Math.PI * 0.5 : 0);
        const sw = -Math.sin(p) * 0.45 * moving;
        const lift = Math.max(0, Math.cos(p)) * 0.7 * moving;
        this.rot(`arm${id}${s}`, sw + 1.25 * fb + (id === 'F' ? -0.9 : 0.9) * rb, 0, (s === 'L' ? 0.35 : -0.35) * rb);
        this.rot(`fore${id}${s}`, lift + 0.9 * fb + 0.6 * rb, 0, 0);
        this.rot(`foot${id}${s}`, -sw * 0.5 + 0.6 * fb, 0, 0);
      }
    }
    if (moving > 0.3) this.footfalls(ph, true);
    // Neck & head: track, roar/breath (head up, jaw open), bow (head to the ground).
    const [ly, lp] = this.track(a, 0.8, 0.5, new THREE.Vector3(0, 2.9, 3.4));
    const swayY = Math.sin(this.wave * 2 + 0.8) * 0.05 * (1 - this.roar);
    this.rot('neck0', -0.1 * this.roar + 0.35 * this.bowBlend + 0.15 * rb + lp * 0.3 + Math.sin(this.wave * 2 - 0.4) * 0.04 * fb, ly * 0.35 + swayY, 0);
    this.rot('neck1', -0.15 * this.roar + 0.35 * this.bowBlend + 0.1 * rb + lp * 0.3, ly * 0.35 - swayY * 0.5, 0);
    this.rot('head', lp * 0.4 - 0.1 * this.roar + 0.25 * this.bowBlend + Math.sin(t * 0.9) * 0.03, ly * 0.3, Math.sin(t * 0.6) * 0.05);
    this.rot('jaw', 0.55 * this.roar + Math.max(0, Math.sin(t * 0.7)) * 0.04, 0, 0);
    // Whiskers trail and swing with motion.
    for (const [s, sx] of [['L', 1], ['R', -1]] as const) {
      const sw = Math.sin(t * 2.2 + (sx > 0 ? 0 : 1.3));
      this.rot(`whisk${s}0`, 0.2 * fb + sw * 0.1, -ly * 0.4 + sw * 0.15, 0);
      this.rot(`whisk${s}1`, 0.15 * fb + Math.sin(t * 2.2 - 0.8) * 0.18, sw * 0.25, 0);
      this.rot(`whisk${s}2`, 0.1 * fb + Math.sin(t * 2.2 - 1.6) * 0.22, sw * 0.3, 0);
    }
    // Wings: slow strokes in flight, folded on the ground.
    this.wingPh += dt * (1.4 + (a.boost ? 1.2 : 0)) * Math.PI * 2 * (0.3 + 0.7 * fb);
    const flap = Math.sin(this.wingPh) * 0.45 * fb;
    this.rot('wingL', 0.2 * ground, 0.5 * ground, flap - 0.5 * ground);
    this.rot('wingR', 0.2 * ground, -0.5 * ground, -flap + 0.5 * ground);
  }
}
