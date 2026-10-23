import * as THREE from 'three';
import { CreatureModel, dampN, type AnimInput } from './CreatureModel';
import { bezier, cachedTemplate, cnoise, cone, dome, ellipsoid, flat, mirrorX, mix, ModelBuilder, PAT, smooth, tube, xf, type ModelTemplate } from './ModelKit';

// ---------------------------------------------------------------------------
// Winged lemur
// ---------------------------------------------------------------------------

export const LEMUR_VARIANTS = [
  { fur: '#ece8e0', stripe: '#8a7060', ring: '#5a4232', eye: '#7ed04a' },
  { fur: '#e4dccf', stripe: '#7b5f4c', ring: '#4b3527', eye: '#a6d84a' },
];

function buildLemur(variant: number): ModelTemplate {
  const v = LEMUR_VARIANTS[variant % LEMUR_VARIANTS.length];
  const B = new ModelBuilder();
  B.pad = 0.6;
  B.bone('body', null, 0, 0.2, 0);
  B.bone('head', 'body', 0, 0.07, 0.12);
  B.bone('earL', 'head', 0.045, 0.06, -0.01);
  B.bone('earR', 'head', -0.045, 0.06, -0.01);
  B.bone('armL', 'body', 0.06, 0.03, 0.06);
  B.bone('armR', 'body', -0.06, 0.03, 0.06);
  B.bone('legL', 'body', 0.05, -0.04, -0.07);
  B.bone('legR', 'body', -0.05, -0.04, -0.07);
  B.bone('tail0', 'body', 0, 0.0, -0.12);
  B.bone('tail1', 'tail0', 0, 0, -0.12);
  B.bone('tail2', 'tail1', 0, 0, -0.12);
  B.bone('tail3', 'tail2', 0, 0, -0.12);
  B.anchor('mouth', 'head', 0, -0.03, 0.08);
  B.anchor('head', 'head', 0, 0.05, 0);
  const furC = (p: THREE.Vector3, n: THREE.Vector3) => mix(v.fur, '#bdb5a8', smooth(0, -0.9, n.y) * 0.5);
  B.add('body', ellipsoid(0.075, 0.07, 0.125, 14, 10, { amp: 0.012, freq: 30, seed: 3 }), {
    color: (p, n) => furC(p, n).lerp(new THREE.Color(v.stripe), n.y > 0.3 && Math.sin(p.z * 70) > 0.2 ? 0.75 : 0),
    pat: PAT.fur,
    patScale: [10, 10],
  });
  B.add('head', ellipsoid(0.08, 0.072, 0.075, 14, 10), { color: furC, pat: PAT.fur });
  B.add('head', xf(ellipsoid(0.03, 0.025, 0.035, 8, 6), { pos: [0, -0.025, 0.065] }), { color: (p, n) => (n.z > 0.7 ? '#4a3030' : v.fur) });
  for (const sx of [1, -1]) {
    B.add('head', xf(ellipsoid(0.03, 0.032, 0.022, 10, 8), { pos: [0.038 * sx, 0.012, 0.058] }), { color: v.eye, pat: PAT.glow });
    B.add('head', xf(ellipsoid(0.014, 0.018, 0.01, 6, 4), { pos: [0.04 * sx, 0.012, 0.078] }), { color: '#0d0d0d' });
    B.add('head', xf(ellipsoid(0.006, 0.006, 0.004, 4, 3), { pos: [0.046 * sx, 0.022, 0.083] }), { color: '#ffffff', pat: PAT.glow });
  }
  // Huge ears
  const ear = new THREE.Shape();
  ear.ellipse(0, 0.06, 0.05, 0.075, 0, Math.PI * 2, false, 0);
  let earG = xf(flat(ear, 0.008, 12), { rot: [0, 0.3, -0.55] });
  B.add('earL', earG, { color: (p, n) => (n.z > 0.3 ? '#e9b8b0' : v.fur) });
  earG = mirrorX(xf(flat(ear, 0.008, 12), { rot: [0, 0.3, -0.55] }));
  B.add('earR', earG, { color: (p, n) => (n.z > 0.3 ? '#e9b8b0' : v.fur) });
  // Wing-arms: thin arm + membrane stretching back toward the legs.
  const wing = new THREE.Shape();
  wing.moveTo(0, 0.02);
  wing.lineTo(0.2, 0.0);
  wing.quadraticCurveTo(0.17, -0.08, 0.1, -0.13);
  wing.quadraticCurveTo(0.05, -0.1, 0, -0.14);
  wing.lineTo(0, 0.02);
  const wingG = xf(flat(wing, 0.004, 6), { rot: [Math.PI / 2, 0, 0] });
  B.add('armL', wingG.clone(), { color: (p) => mix(v.stripe, '#b9a594', smooth(0.0, 0.18, p.x)) });
  B.add('armR', mirrorX(wingG), { color: (p) => mix(v.stripe, '#b9a594', smooth(0.0, 0.18, -p.x)) });
  wingG.dispose();
  B.addPair('armL', 'armR', tube([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.1, -0.01, 0.01), new THREE.Vector3(0.2, 0, 0.02)], 0.012, { radial: 5, caps: true }), { color: v.fur });
  B.addPair('legL', 'legR', tube([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.01, -0.05, 0.02), new THREE.Vector3(0.01, -0.1, 0.03)], [0.018, 0.014, 0.012], { radial: 5, caps: true }), { color: v.fur });
  // Ringed tail, smoothly skinned over four bones.
  const tailPts = bezier(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.02, -0.25), new THREE.Vector3(0, 0.06, -0.48), 16);
  B.add('tail0', tube(tailPts, (t) => 0.018 * (1 - t * 0.5), { radial: 6, caps: true }), {
    color: (p) => (Math.sin(-p.z * 60) > 0.1 ? v.ring : v.fur),
    pat: PAT.fur,
    blend: (p) => {
      const d = -p.z / 0.12;
      const i0 = Math.max(0, Math.min(3, Math.floor(d))), i1 = Math.min(3, i0 + 1);
      const f = Math.max(0, Math.min(1, d - i0));
      return [[`tail${i0}`, 1 - f], [`tail${i1}`, f]];
    },
  });
  return B.build();
}

export class WingedLemurModel extends CreatureModel {
  private flyBlend = 0;
  private perchBlend = 0;
  private flapPh = 0;
  private earT = 0;

  constructor(variant = 0, _detail = 1, scale = 1) {
    super(cachedTemplate(`lemur:${variant}`, () => buildLemur(variant)), null, scale);
  }

  update(a: AnimInput): void {
    const dt = a.dt;
    const t = a.time + this.seed;
    this.flyBlend = dampN(this.flyBlend, a.flying ? 1 : 0, 8, dt);
    this.perchBlend = dampN(this.perchBlend, a.action === 'perch' || a.action === 'sit' || a.action === 'eat' ? 1 : 0, 6, dt);
    const fb = this.flyBlend, pb = this.perchBlend;
    this.flapPh += dt * (7 + (a.vy > 0.5 ? 3 : 0)) * Math.PI * 2 * fb;
    const glide = a.vy < -1 ? 0.6 : 0;
    const flap = Math.sin(this.flapPh) * 0.95 * fb * (1 - glide);
    const fold = (1 - fb);
    this.rot('armL', 0.2 * fold, 0.9 * fold, flap - 0.2 * fb + 1.2 * fold);
    this.rot('armR', 0.2 * fold, -0.9 * fold, -flap + 0.2 * fb - 1.2 * fold);
    // Hops on the ground.
    const ph = this.advance(a, 0.35);
    const hop = Math.abs(Math.sin(ph)) * 0.05 * Math.min(1, a.speed) * (1 - fb);
    this.off('body', 0, hop - 0.05 * pb, 0);
    this.rot('body', 0.25 * fb - 0.35 * pb, 0, 0);
    this.rot('legL', 0.9 * fb + 1.0 * pb, 0, 0);
    this.rot('legR', 0.9 * fb + 1.0 * pb, 0, 0);
    const [ly, lp] = this.track(a, 1.3, 0.7, new THREE.Vector3(0, 0.28, 0.14));
    const eat = a.action === 'eat' ? Math.sin(t * 12) * 0.12 : 0;
    this.rot('head', lp - 0.25 * fb + 0.35 * pb + eat, ly, Math.sin(t * 1.3) * 0.1);
    this.earT -= dt;
    let twitch = 0;
    if (this.earT < 0) {
      twitch = 0.4;
      if (this.earT < -0.15) this.earT = 0.5 + Math.random() * 3;
    }
    this.rot('earL', -0.3 * fb, 0, -twitch);
    this.rot('earR', -0.3 * fb, 0, twitch);
    // Tail: streams behind in flight, curls when perched, sways otherwise.
    for (let i = 0; i < 4; i++) {
      const w = Math.sin(t * 2.5 - i * 0.8) * 0.18;
      this.rot(`tail${i}`, -0.15 * fb + 0.45 * pb + (i === 0 ? 0.35 : 0) * (1 - fb), w * (1 - pb) + 0.55 * pb, 0);
    }
  }
}

// ---------------------------------------------------------------------------
// Turtle-duck
// ---------------------------------------------------------------------------

export const TURTLEDUCK_VARIANTS = [
  { body: '#c9a560', head: '#b8925a', shell: '#4e7a3a', rim: '#2f4f24', beak: '#e8902a' },
  { body: '#f0d070', head: '#f2d880', shell: '#7aa25a', rim: '#4d7038', beak: '#f0a040' },
];

function buildTurtleDuck(variant: number): ModelTemplate {
  const v = TURTLEDUCK_VARIANTS[variant % TURTLEDUCK_VARIANTS.length];
  const B = new ModelBuilder();
  B.pad = 0.4;
  B.bone('body', null, 0, 0.11, 0);
  B.bone('neck', 'body', 0, 0.05, 0.11);
  B.bone('head', 'neck', 0, 0.07, 0.03);
  B.bone('legL', 'body', 0.05, -0.05, 0.0);
  B.bone('legR', 'body', -0.05, -0.05, 0.0);
  B.bone('tail', 'body', 0, 0.02, -0.15);
  B.anchor('mouth', 'head', 0, -0.01, 0.08);
  B.anchor('head', 'head', 0, 0.03, 0);
  B.add('body', ellipsoid(0.105, 0.08, 0.15, 14, 10), { color: (p, n) => mix(v.body, '#f4ead0', smooth(-0.2, -0.8, n.y)), pat: PAT.feathers, patScale: [6, 6] });
  B.add('body', xf(dome(0.12, 0.075, 0.15, 16, 8), { pos: [0, 0.02, -0.01] }), { color: (p) => mix(v.rim, v.shell, smooth(0.0, 0.03, p.y - 0.02)), pat: PAT.shell, patScale: [6, 6] });
  B.add('neck', tube([new THREE.Vector3(0, -0.02, -0.02), new THREE.Vector3(0, 0.03, 0.01), new THREE.Vector3(0, 0.07, 0.03)], 0.035, { radial: 8 }), { color: v.head, pat: PAT.feathers });
  B.add('head', ellipsoid(0.05, 0.048, 0.055, 12, 8), { color: v.head, pat: PAT.feathers });
  B.add('head', xf(ellipsoid(0.03, 0.012, 0.045, 8, 5), { pos: [0, -0.01, 0.06] }), { color: v.beak });
  for (const sx of [1, -1]) {
    B.add('head', xf(ellipsoid(0.01, 0.011, 0.008, 6, 4), { pos: [0.038 * sx, 0.012, 0.03] }), { color: '#101010' });
  }
  for (const s of ['L', 'R'] as const) {
    B.add(`leg${s}`, tube([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -0.03, 0.005), new THREE.Vector3(0, -0.055, 0.01)], 0.009, { radial: 5 }), { color: v.beak });
    B.add(`leg${s}`, xf(ellipsoid(0.025, 0.005, 0.035, 8, 4), { pos: [0, -0.058, 0.025] }), { color: v.beak });
  }
  B.add('tail', xf(cone(0.025, 0.05, 5), { rot: [-Math.PI / 2 - 0.4, 0, 0] }), { color: v.body, pat: PAT.feathers });
  return B.build();
}

export class TurtleDuckModel extends CreatureModel {
  private swimBlend = 0;

  constructor(variant = 0, _detail = 1, scale = 1) {
    super(cachedTemplate(`turtleduck:${variant}`, () => buildTurtleDuck(variant)), null, scale);
  }

  update(a: AnimInput): void {
    const dt = a.dt;
    const t = a.time + this.seed;
    this.swimBlend = dampN(this.swimBlend, a.swimming ? 1 : 0, 4, dt);
    const sb = this.swimBlend;
    const ph = this.advance(a, 0.16);
    const moving = Math.min(1, a.speed / 0.2);
    // Waddle on land, paddle in water.
    this.rot('body', -0.05 * sb, 0, Math.sin(ph) * 0.18 * moving * (1 - sb));
    this.off('body', 0, -0.06 * sb + Math.sin(t * 2) * 0.004 * sb, 0);
    const paddle = Math.sin(t * (6 + a.speed * 6));
    this.rot('legL', Math.sin(ph) * 0.5 * moving * (1 - sb) + paddle * 0.6 * sb, 0, 0);
    this.rot('legR', -Math.sin(ph) * 0.5 * moving * (1 - sb) - paddle * 0.6 * sb, 0, 0);
    const [ly, lp] = this.track(a, 1.2, 0.5, new THREE.Vector3(0, 0.22, 0.14));
    const peck = a.action === 'eat' || a.action === 'graze' ? Math.max(0, Math.sin(t * 9)) * 0.7 : 0;
    this.rot('neck', Math.sin(ph * 2) * 0.15 * moving + peck * 0.6, ly * 0.5, 0);
    this.rot('head', lp * 0.5 + peck * 0.5, ly * 0.5, 0);
    this.rot('tail', Math.sin(t * 3) * 0.2, Math.sin(t * 7) * 0.3 * (a.excite + 0.2), 0);
  }
}
