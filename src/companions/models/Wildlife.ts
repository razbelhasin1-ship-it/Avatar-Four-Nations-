import * as THREE from 'three';
import { CreatureModel, dampN, type AnimInput } from './CreatureModel';
import { bezier, cachedTemplate, cnoise, cone, ellipsoid, flat, mirrorX, mix, ModelBuilder, PAT, smooth, tube, xf, type ModelTemplate } from './ModelKit';

/**
 * Ambient wildlife: simple, readable models with a few bones each —
 * otter penguin, cat owl, armadillo lizard, hog monkey, elephant koi.
 */

// ---------------------------------------------------------------------------
// Otter penguin
// ---------------------------------------------------------------------------

function buildOtterPenguin(): ModelTemplate {
  const B = new ModelBuilder();
  B.pad = 0.5;
  B.bone('body', null, 0, 0.36, 0);
  B.bone('head', 'body', 0, 0.32, 0.03);
  B.bone('flipL', 'body', 0.18, 0.1, 0);
  B.bone('flipR', 'body', -0.18, 0.1, 0);
  B.bone('footL', 'body', 0.08, -0.33, 0.04);
  B.bone('footR', 'body', -0.08, -0.33, 0.04);
  B.anchor('head', 'head', 0, 0.1, 0);
  B.add('body', ellipsoid(0.2, 0.33, 0.19, 14, 12), { color: (p, n) => (n.z > 0.25 && Math.abs(p.x) < 0.15 ? '#f4f2ec' : '#1e2328'), pat: PAT.fur, patScale: [6, 6] });
  B.add('head', ellipsoid(0.13, 0.12, 0.13, 12, 10), { color: (p, n) => (n.z > 0.35 && p.y < 0.04 ? '#efe6d8' : '#4a3a2e'), pat: PAT.fur });
  B.add('head', xf(ellipsoid(0.03, 0.02, 0.02, 6, 4), { pos: [0, -0.01, 0.13] }), { color: '#111111' });
  for (const sx of [1, -1]) {
    B.add('head', xf(ellipsoid(0.018, 0.02, 0.012, 6, 4), { pos: [0.06 * sx, 0.04, 0.11] }), { color: '#0c0c0c' });
    for (const wy of [-0.01, -0.025]) B.add('head', tube([new THREE.Vector3(0.03 * sx, wy, 0.12), new THREE.Vector3(0.13 * sx, wy - 0.01, 0.1)], 0.003, { radial: 3 }), { color: '#d8d0c0' });
  }
  B.addPair('flipL', 'flipR', xf(ellipsoid(0.025, 0.15, 0.07, 8, 6), { pos: [0.01, -0.12, 0], rot: [0, 0, 0.2] }), { color: '#1e2328' });
  B.addPair('footL', 'footR', xf(ellipsoid(0.05, 0.018, 0.08, 8, 4), { pos: [0, 0, 0.04] }), { color: '#d98a3a' });
  return B.build();
}

export class OtterPenguinModel extends CreatureModel {
  private slide = 0;
  constructor(_v = 0, _d = 1, scale = 1) {
    super(cachedTemplate('otterpenguin', buildOtterPenguin), null, scale);
  }
  update(a: AnimInput): void {
    const t = a.time + this.seed;
    this.slide = dampN(this.slide, a.action === 'slide' ? 1 : 0, 6, a.dt);
    const sl = this.slide;
    const ph = this.advance(a, 0.25);
    const moving = Math.min(1, a.speed / 0.3) * (1 - sl);
    this.rot('body', sl * 1.45, 0, Math.sin(ph) * 0.2 * moving);
    this.off('body', 0, -0.17 * sl, 0);
    this.rot('head', -1.2 * sl + Math.sin(t * 1.5) * 0.08, Math.sin(t * 0.7) * 0.3 * (1 - moving), 0);
    const flap = a.action === 'alert' ? Math.sin(t * 14) * 0.4 : 0;
    this.rot('flipL', -1.2 * sl, 0, 0.45 * moving + 0.3 + flap);
    this.rot('flipR', -1.2 * sl, 0, -0.45 * moving - 0.3 - flap);
    this.rot('footL', Math.sin(ph) * 0.6 * moving + 1.3 * sl, 0, 0);
    this.rot('footR', -Math.sin(ph) * 0.6 * moving + 1.3 * sl, 0, 0);
  }
}

// ---------------------------------------------------------------------------
// Cat owl
// ---------------------------------------------------------------------------

function buildCatOwl(): ModelTemplate {
  const B = new ModelBuilder();
  B.pad = 0.6;
  B.bone('body', null, 0, 0.22, 0);
  B.bone('head', 'body', 0, 0.2, 0.02);
  B.bone('wingL', 'body', 0.12, 0.08, 0);
  B.bone('wingR', 'body', -0.12, 0.08, 0);
  B.anchor('head', 'head', 0, 0.1, 0);
  const plum = (p: THREE.Vector3, n: THREE.Vector3) => mix('#7a5a3c', '#d8c49a', smooth(0.2, 0.8, n.z) * smooth(0.2, -0.1, p.y + 0.05));
  B.add('body', ellipsoid(0.13, 0.17, 0.12, 12, 10), { color: plum, pat: PAT.feathers, patScale: [5, 5] });
  B.add('head', ellipsoid(0.12, 0.11, 0.11, 12, 10), { color: (p, n) => (n.z > 0.5 ? '#e2d2ae' : '#6e5034'), pat: PAT.feathers });
  for (const sx of [1, -1]) {
    B.add('head', xf(cone(0.04, 0.09, 4), { pos: [0.075 * sx, 0.08, 0.0], rot: [0, 0, -0.35 * sx] }), { color: '#5a3e26' });
    B.add('head', xf(ellipsoid(0.032, 0.032, 0.015, 8, 6), { pos: [0.045 * sx, 0.015, 0.1] }), { color: '#f2c22a', pat: PAT.glow });
    B.add('head', xf(ellipsoid(0.008, 0.024, 0.006, 4, 4), { pos: [0.045 * sx, 0.015, 0.113] }), { color: '#0a0a0a' });
  }
  B.add('head', xf(cone(0.012, 0.03, 4), { pos: [0, -0.02, 0.11], rot: [Math.PI / 2 + 0.6, 0, 0] }), { color: '#3a2a1a' });
  const wing = new THREE.Shape();
  wing.moveTo(0, 0.05);
  wing.quadraticCurveTo(0.2, 0.1, 0.32, 0.0);
  wing.lineTo(0.26, -0.06);
  wing.lineTo(0.2, -0.04);
  wing.lineTo(0.14, -0.1);
  wing.quadraticCurveTo(0.05, -0.12, 0, -0.08);
  const g = xf(flat(wing, 0.01, 6), { rot: [Math.PI / 2, 0, 0] });
  B.add('wingL', g.clone(), { color: (p) => mix('#6e5034', '#3e2c1c', smooth(0.1, 0.3, p.x)), pat: PAT.feathers, patScale: [6, 6] });
  B.add('wingR', mirrorX(g), { color: (p) => mix('#6e5034', '#3e2c1c', smooth(0.1, 0.3, -p.x)), pat: PAT.feathers, patScale: [6, 6] });
  g.dispose();
  return B.build();
}

export class CatOwlModel extends CreatureModel {
  private fly = 0;
  private flapPh = 0;
  private headTurn = 0;
  private turnT = 0;
  constructor(_v = 0, _d = 1, scale = 1) {
    super(cachedTemplate('catowl', buildCatOwl), null, scale);
  }
  update(a: AnimInput): void {
    const dt = a.dt;
    this.fly = dampN(this.fly, a.flying ? 1 : 0, 8, dt);
    this.flapPh += dt * 5.5 * Math.PI * 2 * this.fly;
    const flap = Math.sin(this.flapPh) * 1.0 * this.fly;
    this.rot('wingL', 0, 0.4 * (1 - this.fly), flap + 1.2 * (1 - this.fly));
    this.rot('wingR', 0, -0.4 * (1 - this.fly), -flap - 1.2 * (1 - this.fly));
    this.rot('body', 0.5 * this.fly, 0, 0);
    // Owls swivel their heads in jerky turns.
    this.turnT -= dt;
    if (this.turnT <= 0) {
      this.turnT = 0.8 + Math.random() * 2.5;
      this.headTurn = (Math.random() - 0.5) * 3.2;
    }
    const [ly, lp] = this.track(a, 1.5, 0.5, new THREE.Vector3(0, 0.42, 0.02));
    this.rot('head', lp - 0.4 * this.fly, a.look ? ly : dampN(this.lookYaw, this.headTurn, 10, dt), 0);
  }
}

// ---------------------------------------------------------------------------
// Armadillo lizard
// ---------------------------------------------------------------------------

function buildArmadillo(): ModelTemplate {
  const B = new ModelBuilder();
  B.pad = 0.6;
  B.bone('s0', null, 0, 0.26, 0.15);
  B.bone('head', 's0', 0, 0.0, 0.22);
  B.bone('s1', 's0', 0, 0, -0.25);
  B.bone('s2', 's1', 0, 0, -0.25);
  B.bone('t1', 's2', 0, 0, -0.25);
  B.bone('t2', 't1', 0, 0, -0.25);
  for (const [b, z, s, sx] of [['legFL', 0.0, 's0', 1], ['legFR', 0.0, 's0', -1], ['legBL', 0.0, 's2', 1], ['legBR', 0.0, 's2', -1]] as const) B.bone(b, s, 0.15 * sx, -0.08, z);
  B.anchor('head', 'head', 0, 0.08, 0.05);
  const chain = [{ b: 'head', z: 0.22 }, { b: 's0', z: 0 }, { b: 's1', z: -0.25 }, { b: 's2', z: -0.5 }, { b: 't1', z: -0.75 }, { b: 't2', z: -1.0 }];
  const pts: THREE.Vector3[] = [];
  const rad: number[] = [];
  for (let i = 0; i <= 20; i++) {
    const u = i / 20;
    pts.push(new THREE.Vector3(0, 0, 0.12 - u * 1.12));
    rad.push(0.17 * Math.sin(Math.min(1, (u + 0.08) * 1.6) * Math.PI * 0.55) * (1 - u * 0.75) + 0.02);
  }
  B.add('s0', tube(pts, rad, { radial: 12, caps: true, squash: [1.0, 0.8] }), {
    color: (p, n) => (n.y > -0.2 ? (Math.sin(p.z * 40) > 0.6 ? '#6a5236' : '#b49466') : '#d8c49a'),
    pat: PAT.shell,
    patScale: [8, 2],
    blend: (p) => {
      for (let i = 0; i < chain.length - 1; i++) {
        const a = chain[i], b = chain[i + 1];
        if (p.z <= a.z && p.z >= b.z) {
          const f = (a.z - p.z) / (a.z - b.z);
          return [[a.b, 1 - f], [b.b, f]];
        }
      }
      return p.z > 0 ? [['s0', 1]] : [['t2', 1]];
    },
  });
  B.add('head', xf(ellipsoid(0.08, 0.06, 0.13, 10, 8), { pos: [0, 0, 0.06] }), { color: '#a08860', pat: PAT.scales, patScale: [4, 4] });
  for (const sx of [1, -1]) B.add('head', xf(ellipsoid(0.014, 0.014, 0.01, 5, 4), { pos: [0.055 * sx, 0.03, 0.1] }), { color: '#1a1408' });
  for (const leg of ['legFL', 'legFR', 'legBL', 'legBR']) B.add(leg, tube([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.03 * (leg.endsWith('L') ? 1 : -1), -0.1, 0.02), new THREE.Vector3(0.04 * (leg.endsWith('L') ? 1 : -1), -0.18, 0.04)], 0.035, { radial: 6, caps: true }), { color: '#8a7050' });
  return B.build();
}

export class ArmadilloLizardModel extends CreatureModel {
  private curl = 0;
  private roll = 0;
  constructor(_v = 0, _d = 1, scale = 1) {
    super(cachedTemplate('armadillo', buildArmadillo), null, scale);
  }
  update(a: AnimInput): void {
    const dt = a.dt;
    const t = a.time + this.seed;
    this.curl = dampN(this.curl, a.action === 'curl' ? 1 : 0, 6, dt);
    const c = this.curl;
    const ph = this.advance(a, 0.4);
    const moving = Math.min(1, a.speed / 0.3) * (1 - c);
    const wave = Math.sin(ph) * 0.18 * moving;
    this.rot('head', 1.6 * c, -wave + Math.sin(t * 0.8) * 0.1 * (1 - moving), 0);
    this.rot('s1', 1.05 * c, wave, 0);
    this.rot('s2', 1.05 * c, wave, 0);
    this.rot('t1', 1.1 * c, -wave * 1.5, 0);
    this.rot('t2', 1.0 * c, -wave * 2, 0);
    for (const [leg, off] of [['legFL', 0], ['legFR', Math.PI], ['legBL', Math.PI], ['legBR', 0]] as const) this.rot(leg, -Math.sin(ph + off) * 0.6 * moving - 1.2 * c, 0, 0);
    // Curled into a ball: roll along the ground.
    if (c > 0.7) this.roll += (a.speed / 0.3) * dt;
    this.off('s0', 0, 0.06 * c, -0.25 * c);
    this.tilt.rotation.x = c > 0.7 ? this.roll : dampN(this.tilt.rotation.x % (Math.PI * 2), 0, 6, dt);
  }
}

// ---------------------------------------------------------------------------
// Hog monkey
// ---------------------------------------------------------------------------

function buildHogMonkey(): ModelTemplate {
  const B = new ModelBuilder();
  B.pad = 0.6;
  B.bone('body', null, 0, 0.42, 0);
  B.bone('head', 'body', 0, 0.22, 0.08);
  B.bone('armL', 'body', 0.14, 0.14, 0.05);
  B.bone('armR', 'body', -0.14, 0.14, 0.05);
  B.bone('legL', 'body', 0.09, -0.15, -0.05);
  B.bone('legR', 'body', -0.09, -0.15, -0.05);
  B.bone('tail', 'body', 0, -0.08, -0.15);
  B.anchor('head', 'head', 0, 0.1, 0);
  const fur = (p: THREE.Vector3, n: THREE.Vector3) => mix('#6e4a2e', '#c49a6c', smooth(0.3, 0.9, n.z) * 0.6 + (cnoise(p.x, p.y, p.z, 9) - 0.5) * 0.2);
  B.add('body', ellipsoid(0.15, 0.2, 0.15, 12, 10, { amp: 0.015, freq: 20 }), { color: fur, pat: PAT.fur });
  B.add('head', ellipsoid(0.12, 0.11, 0.11, 12, 10), { color: fur, pat: PAT.fur });
  B.add('head', tube([new THREE.Vector3(0, -0.02, 0.08), new THREE.Vector3(0, -0.025, 0.15)], [0.055, 0.05], { radial: 10, caps: true }), { color: (p, n) => (n.z > 0.8 && Math.hypot(Math.abs(p.x) - 0.02, p.y + 0.025) < 0.012 ? '#5a2a2a' : '#e8a49a') });
  for (const sx of [1, -1]) {
    B.add('head', xf(ellipsoid(0.016, 0.018, 0.01, 6, 4), { pos: [0.05 * sx, 0.04, 0.09] }), { color: '#100c08' });
    B.add('head', xf(cone(0.04, 0.07, 3), { pos: [0.08 * sx, 0.08, -0.01], rot: [-0.4, 0, -0.6 * sx] }), { color: '#d8968c' });
  }
  B.addPair('armL', 'armR', tube([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.04, -0.17, 0.03), new THREE.Vector3(0.05, -0.34, 0.06)], [0.04, 0.035, 0.03], { radial: 6, caps: true }), { color: fur, pat: PAT.fur });
  B.addPair('legL', 'legR', tube([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.02, -0.12, 0.06), new THREE.Vector3(0.02, -0.27, 0.03)], [0.05, 0.04, 0.035], { radial: 6, caps: true }), { color: fur, pat: PAT.fur });
  B.add('tail', tube(bezier(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.1, -0.3), new THREE.Vector3(0, 0.35, -0.25), 10), (t) => 0.025 * (1 - t * 0.5), { radial: 5, caps: true }), { color: '#5a3a22' });
  return B.build();
}

export class HogMonkeyModel extends CreatureModel {
  private sit = 0;
  constructor(_v = 0, _d = 1, scale = 1) {
    super(cachedTemplate('hogmonkey', buildHogMonkey), null, scale);
  }
  update(a: AnimInput): void {
    const t = a.time + this.seed;
    this.sit = dampN(this.sit, a.action === 'sit' || a.action === 'rest' || a.speed < 0.2 ? 1 : 0, 3, a.dt);
    const ph = this.advance(a, 0.6);
    const moving = Math.min(1, a.speed / 0.4);
    const hop = Math.abs(Math.sin(ph)) * 0.08 * moving;
    this.off('body', 0, hop - 0.12 * this.sit, 0);
    this.rot('body', 0.7 * moving * (1 - this.sit), 0, 0);
    const scratch = this.sit > 0.6 && Math.sin(t * 0.4) > 0.6 ? 1 : 0;
    this.rot('armL', -Math.sin(ph) * 0.8 * moving - 0.5 * moving - 2.6 * scratch, 0, 0.2);
    this.rot('armR', Math.sin(ph) * 0.8 * moving - 0.5 * moving, 0, -0.2);
    this.rot('legL', Math.sin(ph) * 0.6 * moving - 1.2 * this.sit, 0, 0.2 * this.sit);
    this.rot('legR', -Math.sin(ph) * 0.6 * moving - 1.2 * this.sit, 0, -0.2 * this.sit);
    const [ly, lp] = this.track(a, 1.2, 0.5, new THREE.Vector3(0, 0.66, 0.1));
    this.rot('head', lp - 0.6 * moving * (1 - this.sit) + Math.sin(t * 3) * 0.05, ly, Math.sin(t * 1.1) * 0.15);
    this.rot('tail', Math.sin(t * 2) * 0.2, Math.sin(t * 1.3) * 0.4, 0);
  }
}

// ---------------------------------------------------------------------------
// Elephant koi
// ---------------------------------------------------------------------------

function buildKoi(variant: number): ModelTemplate {
  const B = new ModelBuilder();
  B.pad = 2;
  B.bone('s0', null, 0, 0, 1.0);
  B.bone('s1', 's0', 0, 0, -1.1);
  B.bone('s2', 's1', 0, 0, -1.1);
  B.bone('s3', 's2', 0, 0, -1.1);
  B.bone('s4', 's3', 0, 0, -1.0);
  B.anchor('head', 's0', 0, 0.4, 0.8);
  const chain = [{ b: 's0', z: 1.0 }, { b: 's1', z: -0.1 }, { b: 's2', z: -1.2 }, { b: 's3', z: -2.3 }, { b: 's4', z: -3.3 }];
  const pts: THREE.Vector3[] = [];
  const rad: number[] = [];
  for (let i = 0; i <= 26; i++) {
    const u = i / 26;
    pts.push(new THREE.Vector3(0, 0, 2.2 - u * 5.5));
    rad.push(0.72 * Math.pow(Math.sin(Math.min(1, u * 1.15 + 0.12) * Math.PI), 0.7) * (1 - u * 0.55) + 0.04);
  }
  const koi = (p: THREE.Vector3, n: THREE.Vector3) => {
    const pat = cnoise(p.x * 0.6 + variant * 3, p.y * 0.6, p.z * 0.5, 1.3);
    const top = smooth(-0.2, 0.4, n.y);
    const orange = pat > 0.5 ? '#ef6a1a' : pat > 0.42 ? '#f4a050' : '#f4f0e8';
    const black = cnoise(p.x + 9, p.y, p.z + variant, 2.4) > 0.78 && top > 0.5;
    return black ? '#1e1a18' : mix('#f4f0e8', orange, top * 0.9 + 0.1);
  };
  B.add('s0', tube(pts.map((p) => p.clone().setZ(p.z - 1.0)), rad, { radial: 14, caps: true, squash: [0.85, 1.0] }), {
    color: (p, n) => koi(new THREE.Vector3(p.x, p.y, p.z + 1.0), n),
    pat: PAT.scales,
    patScale: [16, 3.5],
    blend: (p) => {
      const z = p.z + 1.0;
      for (let i = 0; i < chain.length - 1; i++) {
        const a = chain[i], b = chain[i + 1];
        if (z <= a.z && z >= b.z) {
          const f = (a.z - z) / (a.z - b.z);
          return [[a.b, 1 - f], [b.b, f]];
        }
      }
      return z > chain[0].z ? [['s0', 1]] : [['s4', 1]];
    },
  });
  for (const sx of [1, -1]) {
    B.add('s0', xf(ellipsoid(0.1, 0.1, 0.06, 8, 6), { pos: [0.4 * sx, 0.12, 0.7], rot: [0, 0.5 * sx, 0] }), { color: '#151010' });
    // Barbels
    B.add('s0', tube(bezier(new THREE.Vector3(0.18 * sx, -0.12, 1.15), new THREE.Vector3(0.4 * sx, -0.25, 1.0), new THREE.Vector3(0.5 * sx, -0.45, 0.7), 6), (t) => 0.035 * (1 - t) + 0.01, { radial: 4 }), { color: '#f0a060' });
    // Pectoral fins
    const fin = new THREE.Shape();
    fin.moveTo(0, 0);
    fin.quadraticCurveTo(0.6, 0.1, 0.9, -0.3);
    fin.quadraticCurveTo(0.4, -0.35, 0, -0.2);
    let g = xf(flat(fin, 0.02, 6), { rot: [Math.PI / 2, 0, 0.3] });
    if (sx < 0) g = mirrorX(g);
    B.add('s1', xf(g, { pos: [0.55 * sx, -0.25, 0.6] }), { color: '#f6c08a' });
  }
  const dorsal = new THREE.Shape();
  dorsal.moveTo(0.6, 0);
  dorsal.quadraticCurveTo(0.2, 0.7, -0.9, 0.45);
  dorsal.lineTo(-1.1, 0);
  B.add('s1', xf(flat(dorsal, 0.03, 6), { pos: [0, 0.62, -0.4], rot: [0, -Math.PI / 2, 0] }), { color: '#f08a3a' });
  const tailFin = new THREE.Shape();
  tailFin.moveTo(0, 0);
  tailFin.quadraticCurveTo(-0.6, 0.6, -1.3, 1.0);
  tailFin.quadraticCurveTo(-0.9, 0, -1.3, -1.0);
  tailFin.quadraticCurveTo(-0.6, -0.6, 0, 0);
  B.add('s4', xf(flat(tailFin, 0.03, 8), { pos: [0, 0, -0.2], rot: [0, -Math.PI / 2, 0] }), { color: (p) => mix('#f4f0e8', '#ef6a1a', smooth(0.2, 1.0, Math.abs(p.y))) });
  return B.build();
}

export class ElephantKoiModel extends CreatureModel {
  private wave = 0;
  constructor(variant = 0, _d = 1, scale = 1) {
    super(cachedTemplate(`koi:${variant}`, () => buildKoi(variant)), null, scale);
  }
  update(a: AnimInput): void {
    this.wave += a.dt * (1.5 + a.speed * 0.4) * Math.PI * 2 * 0.5;
    for (let i = 1; i <= 4; i++) this.rot(`s${i}`, 0, Math.sin(this.wave - i * 0.9) * (0.08 + i * 0.06), 0);
    this.rot('s0', 0, Math.sin(this.wave + 0.6) * 0.05, 0);
  }
}
