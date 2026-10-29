import * as THREE from 'three';
import { CreatureModel, dampN, type AnimInput } from './CreatureModel';
import { bezier, cachedTemplate, cnoise, cone, ellipsoid, mix, ModelBuilder, PAT, smooth, tube, xf, type ModelTemplate } from './ModelKit';
import { fieldNormal, furLock, lumps, occlusionOf, sculpt, sdEllipsoid, sdRoundCone, smax, smin, surfaceHit } from './Sculpt';

/**
 * Sun Warrior dragon (Ran and Shaw): a ~18 m serpentine body skinned over a
 * spine chain, crimson scales over segmented belly plates, a long neck and a
 * sculpted head — heavy brows, golden slit eyes, long swept-back horns,
 * trailing whiskers, a cream mane and beard — great bat-like wings with
 * finger bones that fold, four clawed legs and a lion tuft at the tail tip.
 * It flies by undulating and beating its wings.
 *
 * Bones: spine0 (chest, root) → neck0 → neck1 → head → jaw, whisk{L,R}{0,1,2};
 *        spine0 → spine1 … spine12 (tail); arm/fore/foot{F,B}{L,R};
 *        wing{L,R} (shoulder) → wing{L,R}1 (elbow) → wing{L,R}2 (wrist) → finger{L,R}1..4.
 */

export const DRAGON_VARIANTS = [
  { back: '#b52018', back2: '#74110b', belly: '#5a130e', plate: '#93311f', mane: '#f3e8d0', horn: '#f0e4c6', hornTip: '#a4875a', eye: '#ffb21a', wing: '#a3231a', vein: '#5c0f0b' },
  { back: '#1f54b8', back2: '#102c6c', belly: '#13285c', plate: '#2c4c94', mane: '#eef1f4', horn: '#f2ead6', hornTip: '#998b70', eye: '#ffd23a', wing: '#2550a0', vein: '#0f2558' },
];

const SPINE_N = 12;
const SPINE_STEP = 1.0;
const ROOT_Y = 2.1;
const NECK0 = new THREE.Vector3(0, 0.3, 1.15);
const NECK1 = new THREE.Vector3(0, 0.25, 1.1);
const HEAD = new THREE.Vector3(0, 0.12, 1.05);
/** Body radius at each chain point: head, neck1, neck0, spine0..spine12. */
const RADII = [0.36, 0.44, 0.56, 0.84, 0.9, 0.88, 0.84, 0.78, 0.71, 0.63, 0.55, 0.47, 0.39, 0.31, 0.23, 0.15];
/** Wing root (shoulder) in spine1's space, and the wing's joints in the shoulder's space (left wing). */
const WING_ROOT = new THREE.Vector3(0.6, 0.48, 0.2);
const WING = {
  E: new THREE.Vector3(1.55, 0.3, 0.35),
  W: new THREE.Vector3(3.4, 0.5, -0.2),
  T: [new THREE.Vector3(6.5, 0.6, -1.0), new THREE.Vector3(5.8, 0.35, -2.5), new THREE.Vector3(4.6, 0.15, -3.5), new THREE.Vector3(3.0, 0.0, -3.9)],
  R: new THREE.Vector3(0.35, -0.1, -3.3),
};
/** Finger yaw that closes each finger onto the leading one (wing folded). */
const FINGER_CLOSE = WING.T.map((t) => {
  const yaw = (p: THREE.Vector3) => Math.atan2(p.x - WING.W.x, p.z - WING.W.z);
  let d = yaw(WING.T[0]) - yaw(t);
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
});

function chain(): Array<{ bone: string; z: number; y: number }> {
  const n1 = NECK0.clone().add(NECK1), hd = n1.clone().add(HEAD);
  const out = [
    { bone: 'head', z: hd.z, y: hd.y },
    { bone: 'neck1', z: n1.z, y: n1.y },
    { bone: 'neck0', z: NECK0.z, y: NECK0.y },
    { bone: 'spine0', z: 0, y: 0 },
  ];
  for (let i = 1; i <= SPINE_N; i++) out.push({ bone: `spine${i}`, z: -i * SPINE_STEP, y: 0 });
  return out;
}
const CHAIN = chain();

/** Skin weights along the spine chain for a spine0-local point. */
function chainWeights(p: THREE.Vector3): Array<[string, number]> {
  for (let i = 0; i < CHAIN.length - 1; i++) {
    const a = CHAIN[i], b = CHAIN[i + 1];
    if (p.z <= a.z && p.z >= b.z) {
      const t = (a.z - p.z) / (a.z - b.z);
      return [[a.bone, 1 - t], [b.bone, t]];
    }
  }
  return p.z > CHAIN[0].z ? [[CHAIN[0].bone, 1]] : [[CHAIN[CHAIN.length - 1].bone, 1]];
}

// ---------------------------------------------------------------------------
// Sculpted parts
// ---------------------------------------------------------------------------

/** Head (head-local): cranium, long upper jaw, nostrils, brows, cheekbones, eye sockets, flat palate. */
function headField(x: number, y: number, z: number): number {
  const ax = Math.abs(x);
  let d = sdEllipsoid(x, y, z, 0, 0.1, 0.18, 0.4, 0.36, 0.52);
  d = smin(d, sdRoundCone(x, y * 1.4, z, 0, 0.042, 0.45, 0, -0.084, 1.72, 0.32, 0.17) / 1.4, 0.22);
  d = smin(d, sdEllipsoid(ax, y, z, 0.11, 0.06, 1.62, 0.08, 0.06, 0.11), 0.06);
  d = smin(d, sdEllipsoid(ax, y, z, 0.22, 0.28, 0.62, 0.16, 0.1, 0.34), 0.08);
  d = smin(d, sdEllipsoid(ax, y, z, 0.3, -0.02, 0.36, 0.15, 0.15, 0.32), 0.1);
  d = smin(d, sdRoundCone(x, y, z, 0, 0.2, 0.55, 0, 0.12, 1.35, 0.1, 0.07), 0.08);
  d = smax(d, -sdEllipsoid(ax, y, z, 0.29, 0.14, 0.7, 0.085, 0.07, 0.12), 0.035);
  d = smax(d, -(y + 0.17), 0.04);
  return d;
}

/** Lower jaw (jaw-local): flat-topped, tapering to the chin, with hinge muscles. */
function jawField(x: number, y: number, z: number): number {
  let d = sdRoundCone(x, y * 1.7, z, 0, 0, -0.18, 0, -0.051, 1.16, 0.25, 0.12) / 1.7;
  d = smin(d, sdEllipsoid(x, y, z, 0, -0.08, 0.05, 0.27, 0.12, 0.3), 0.08);
  return smax(d, y - 0.02, 0.03);
}

/** Leg (arm-local, left side): muscular upper leg, slimmer lower leg, foot pad. Hind legs are bulkier. */
function legField(hind: boolean): (x: number, y: number, z: number) => number {
  const k = hind ? 1.22 : 1;
  return (x, y, z) => {
    let d = sdEllipsoid(x, y, z, 0.04, -0.22, hind ? -0.05 : 0.02, 0.36 * k, 0.5 * k, 0.4 * k);
    d = smin(d, sdRoundCone(x, y, z, 0.02, -0.15, 0, 0.05, -0.78, 0.12, 0.32 * k, 0.2), 0.12);
    d = smin(d, sdRoundCone(x, y, z, 0.05, -0.78, 0.12, 0.05, -1.48, 0.16, 0.2, 0.14), 0.08);
    d = smin(d, sdEllipsoid(x, y, z, 0.05, -1.55, 0.27, 0.2, 0.1, 0.27), 0.08);
    return smax(d, y - 0.12, 0.05);
  };
}
const FRONT_LEG = legField(false);
const HIND_LEG = legField(true);

/** Mane volume (spine0-local): a thick fur sleeve over the nape, crown and sides of the neck. */
const MANE = [
  { p: new THREE.Vector3(0, CHAIN[0].y + 0.18, CHAIN[0].z - 0.05), r: 0.46 },
  { p: new THREE.Vector3(0, CHAIN[1].y + 0.1, CHAIN[1].z), r: 0.54 },
  { p: new THREE.Vector3(0, CHAIN[2].y + 0.1, CHAIN[2].z), r: 0.62 },
  { p: new THREE.Vector3(0, 0.28, 0.6), r: 0.5 },
];
/** Height of the neck's centre line at z (spine0-local). */
function neckY(z: number): number {
  for (let i = 0; i < 3; i++) {
    const a = CHAIN[i], b = CHAIN[i + 1];
    if (z >= b.z) return b.y + (a.y - b.y) * Math.min(1, (z - b.z) / (a.z - b.z));
  }
  return 0;
}
function maneField(x: number, y: number, z: number): number {
  let d = Infinity;
  for (let i = 0; i < MANE.length - 1; i++) {
    const a = MANE[i], b = MANE[i + 1];
    d = smin(d, sdRoundCone(x, y, z, a.p.x, a.p.y, a.p.z, b.p.x, b.p.y, b.p.z, a.r, b.r), 0.15);
  }
  // The throat stays bare: only the nape, crown and sides carry fur.
  d = smax(d, neckY(z) - 0.12 - y, 0.12);
  // Clumps stretched along the neck read as hair flowing back.
  if (d > -0.25 && d < 0.25) d -= 0.09 * lumps(x * 1.6, y * 1.6, z * 0.55, 2.4, 7);
  return d;
}

interface Parts {
  head: THREE.BufferGeometry;
  headAO: Float32Array;
  mane: THREE.BufferGeometry;
  maneAO: Float32Array;
  jaw: THREE.BufferGeometry;
  legs: Record<'F' | 'B', { g: THREE.BufferGeometry; ao: Float32Array }>;
}
const partsCache = new Map<string, Parts>();

function parts(detail: number): Parts {
  const q = detail < 0.7 ? 'low' : detail < 0.9 ? 'mid' : 'high';
  const hit = partsCache.get(q);
  if (hit) return hit;
  const cell = q === 'low' ? 0.075 : q === 'mid' ? 0.06 : 0.05;
  const head = sculpt(headField, { min: [-0.62, -0.3, -0.45], max: [0.62, 0.52, 1.85], cell, uv: (p) => [Math.atan2(p.x, p.y) * 0.45, p.z] });
  const jaw = sculpt(jawField, { min: [-0.4, -0.3, -0.5], max: [0.4, 0.1, 1.3], cell, uv: (p) => [Math.atan2(p.x, p.y) * 0.3, p.z] });
  const legCell = cell * 1.9;
  const leg = (f: (x: number, y: number, z: number) => number) => {
    const g = sculpt(f, { min: [-0.5, -1.7, -0.5], max: [0.55, 0.2, 0.6], cell: legCell, uv: (p) => [Math.atan2(p.x, p.z) * 0.3, p.y] });
    return { g, ao: occlusionOf(g, f, 0.18) };
  };
  const mane = sculpt(maneField, { min: [-1.0, -0.4, 0.0], max: [1.0, 1.6, 3.85], cell: cell * 2, uv: (p) => [Math.atan2(p.x, p.y - neckY(p.z)) * 0.6, p.z] });
  const out: Parts = { head, headAO: occlusionOf(head, headField, 0.14), mane, maneAO: occlusionOf(mane, maneField, 0.22), jaw, legs: { F: leg(FRONT_LEG), B: leg(HIND_LEG) } };
  partsCache.set(q, out);
  return out;
}

/** Build the shared dragon geometry ahead of time (loading screen), so the first spawn does not hitch. */
export function prewarmDragon(detail: number): void {
  parts(detail);
}

/** Mirror a geometry across X keeping its normals and vertex order (index-aligned data stays valid). */
function mirrorKeep(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = src.clone();
  const pos = g.attributes.position as THREE.BufferAttribute, nrm = g.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    pos.setX(i, -pos.getX(i));
    nrm.setX(i, -nrm.getX(i));
  }
  const idx = g.index!.array as Uint16Array | Uint32Array;
  for (let i = 0; i < idx.length; i += 3) {
    const t = idx[i + 1];
    idx[i + 1] = idx[i + 2];
    idx[i + 2] = t;
  }
  return g;
}

// ---------------------------------------------------------------------------
// Wings
// ---------------------------------------------------------------------------

/**
 * Double-sided membrane (shoulder-local) fanned from the wrist to the fingers,
 * with scalloped trailing edges; the inner panel runs back to the flank. Each
 * vertex carries its own skin weights (wrist → fingers / body / arm).
 */
function wingMembrane(side: 'L' | 'R', sx: number, rows: number, cols: number): { g: THREE.BufferGeometry; w: Array<Array<[string, number]>>; vein: number[] } {
  const m = (v: THREE.Vector3) => new THREE.Vector3(v.x * sx, v.y, v.z);
  const W = m(WING.W), E = m(WING.E), S = new THREE.Vector3(), R = m(WING.R);
  const T = WING.T.map(m);
  const wrist = `wing${side}2`, shoulder = `wing${side}`, elbow = `wing${side}1`;
  const finger = (k: number) => `finger${side}${k + 1}`;
  const rootOff = new THREE.Vector3(WING_ROOT.x * sx, WING_ROOT.y, WING_ROOT.z - SPINE_STEP);
  const bodyW = (p: THREE.Vector3) => chainWeights(p.clone().add(rootOff));
  const P: number[] = [], Wt: Array<Array<[string, number]>> = [], V: number[] = [], I: number[] = [];
  const scallop = (a: THREE.Vector3, b: THREE.Vector3, t: number, depth: number) => {
    const p = a.clone().lerp(b, t);
    const inward = W.clone().sub(a.clone().lerp(b, 0.5)).normalize();
    return p.addScaledVector(inward, depth * a.distanceTo(b) * Math.sin(Math.PI * t));
  };
  const panel = (n: number, edge: (t: number) => { p: THREE.Vector3; w: Array<[string, number]>; vein: number }) => {
    const base = P.length / 3;
    for (let i = 0; i <= rows; i++) {
      const s = i / rows;
      for (let j = 0; j <= n; j++) {
        const t = j / n;
        const b = edge(t);
        const p = W.clone().lerp(b.p, s);
        p.y -= Math.sin(Math.PI * s) * Math.sin(Math.PI * t) * 0.1;
        P.push(p.x, p.y, p.z);
        const w: Array<[string, number]> = [[wrist, 1 - s]];
        for (const [bn, ww] of b.w) w.push([bn, ww * s]);
        Wt.push(w);
        V.push(Math.max(b.vein, smooth(0.25, 0, s) * 0.6, smooth(0.93, 1, s) * 0.5));
      }
    }
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < n; j++) {
        const a = base + i * (n + 1) + j, b = a + n + 1;
        I.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  };
  for (let k = 0; k < 3; k++) {
    panel(cols, (t) => ({ p: scallop(T[k], T[k + 1], t, 0.3), w: [[finger(k), 1 - t], [finger(k + 1), t]], vein: smooth(0.14, 0, Math.min(t, 1 - t)) }));
  }
  // Inner panel: finger 4 → flank (scalloped), along the flank to the shoulder, then the upper arm.
  panel(cols * 2, (t) => {
    if (t < 0.45) {
      const u = t / 0.45;
      return { p: scallop(T[3], R, u, 0.22), w: [[finger(3), 1 - u], ...bodyW(R).map(([bn, ww]) => [bn, ww * u] as [string, number])], vein: smooth(0.12, 0, u) };
    }
    if (t < 0.75) {
      const u = (t - 0.45) / 0.3;
      const p = R.clone().lerp(S, u);
      return { p, w: bodyW(p), vein: 0.25 };
    }
    const u = (t - 0.75) / 0.25;
    return { p: S.clone().lerp(E, u), w: [[shoulder, 1 - u], [elbow, u]], vein: 0.6 };
  });
  // Second layer facing the other way (the material is single-sided).
  const n = P.length / 3;
  const P2 = P.concat(P), I2 = I.slice();
  for (let t = 0; t < I.length; t += 3) I2.push(I[t] + n, I[t + 2] + n, I[t + 1] + n);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P2, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((P2.length / 3) * 2).fill(0), 2));
  g.setIndex(I2);
  g.computeVertexNormals();
  return { g, w: Wt.concat(Wt), vein: V.concat(V) };
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

function buildDragon(variant: number, detail: number): ModelTemplate {
  const v = DRAGON_VARIANTS[variant % DRAGON_VARIANTS.length];
  const seg = (n: number) => Math.max(6, Math.round(n * detail));
  const P = parts(detail);
  const low = detail < 0.7;
  const B = new ModelBuilder();
  B.pad = 7;
  B.bone('spine0', null, 0, ROOT_Y, 0);
  B.bone('neck0', 'spine0', NECK0.x, NECK0.y, NECK0.z);
  B.bone('neck1', 'neck0', NECK1.x, NECK1.y, NECK1.z);
  B.bone('head', 'neck1', HEAD.x, HEAD.y, HEAD.z);
  B.bone('jaw', 'head', 0, -0.2, 0.42);
  for (let i = 1; i <= SPINE_N; i++) B.bone(`spine${i}`, i === 1 ? 'spine0' : `spine${i - 1}`, 0, 0, -SPINE_STEP);
  for (const [s, sx] of [['L', 1], ['R', -1]] as const) {
    // Whiskers: 3-bone chains trailing from the upper lip.
    B.bone(`whisk${s}0`, 'head', 0.22 * sx, -0.05, 1.4);
    B.bone(`whisk${s}1`, `whisk${s}0`, 0.5 * sx, -0.2, -0.55);
    B.bone(`whisk${s}2`, `whisk${s}1`, 0.35 * sx, -0.3, -0.7);
    // Wing: shoulder → elbow → wrist → four fingers.
    B.bone(`wing${s}`, 'spine1', WING_ROOT.x * sx, WING_ROOT.y, WING_ROOT.z);
    B.bone(`wing${s}1`, `wing${s}`, WING.E.x * sx, WING.E.y, WING.E.z);
    B.bone(`wing${s}2`, `wing${s}1`, (WING.W.x - WING.E.x) * sx, WING.W.y - WING.E.y, WING.W.z - WING.E.z);
    for (let k = 1; k <= 4; k++) B.bone(`finger${s}${k}`, `wing${s}2`, 0, 0, 0);
  }
  // Legs: front at the chest, hind at spine4.
  for (const [id, parent, z] of [['F', 'spine0', 0.25], ['B', 'spine4', 0.0]] as const) {
    for (const [s, sx] of [['L', 1], ['R', -1]] as const) {
      B.bone(`arm${id}${s}`, parent, 0.66 * sx, -0.42, z);
      B.bone(`fore${id}${s}`, `arm${id}${s}`, 0.05 * sx, -0.78, 0.12);
      B.bone(`foot${id}${s}`, `fore${id}${s}`, 0, -0.74, 0.05);
    }
  }
  B.anchor('seat', 'spine0', 0, 0.9, -0.25); // saddle top
  B.anchor('mouth', 'head', 0, -0.12, 1.85);
  B.anchor('head', 'head', 0, 0.4, 0.6);

  const back = new THREE.Color(v.back), back2 = new THREE.Color(v.back2);
  const scaleCol = (p: THREE.Vector3, n: THREE.Vector3, ao = 1) =>
    back.clone().lerp(back2, Math.max(0, Math.min(1, smooth(0.25, 0.95, n.y) * 0.55 + (cnoise(p.x, p.y, p.z, 1.6) - 0.5) * 0.3))).multiplyScalar(0.62 + 0.38 * ao);
  const mane = new THREE.Color(v.mane);
  const maneCol = (p: THREE.Vector3, base: THREE.Vector3, len: number) => mane.clone().multiplyScalar(0.8 + 0.2 * smooth(0, len * 0.7, p.distanceTo(base))).offsetHSL(0, 0, (cnoise(p.x, p.y, p.z, 3) - 0.5) * 0.05);
  const SCALES = { pat: PAT.scales, patScale: [16, 12] as [number, number] };
  const FUR = { pat: PAT.fur, patScale: [3, 2] as [number, number] };

  // ---- Body: one tube from the head base to the tail tip, skinned along the chain ----
  const ctrl = CHAIN.map((c) => new THREE.Vector3(0, c.y, c.z));
  const curve = new THREE.CatmullRomCurve3(ctrl, false, 'catmullrom', 0.4);
  const steps = seg(140);
  const pts: THREE.Vector3[] = [], rad: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    pts.push(curve.getPoint(u));
    const f = u * (RADII.length - 1);
    const i0 = Math.floor(f), i1 = Math.min(RADII.length - 1, i0 + 1);
    rad.push(RADII[i0] + (RADII[i1] - RADII[i0]) * (f - i0));
  }
  const PLATE = 0.34;
  const bellyK = (a: number) => smooth(-0.45, -0.78, Math.cos(a));
  const bodyGeo = tube(pts, rad, {
    radial: seg(20),
    caps: true,
    // Flatter belly made of overlapping plates (each rises toward its back edge).
    profile: (a, along) => {
      const k = bellyK(a);
      const f = ((along / PLATE) % 1 + 1) % 1;
      return 1 - 0.07 * k + k * 0.07 * f * f;
    },
  });
  const buv = (bodyGeo.attributes.uv as THREE.BufferAttribute).array as Float32Array;
  const belly = new THREE.Color(v.belly), plate = new THREE.Color(v.plate);
  B.add('spine0', bodyGeo, {
    color: (p, n, i) => {
      const a = buv[i * 2] * Math.PI * 2, along = buv[i * 2 + 1];
      const k = bellyK(a);
      const f = ((along / PLATE) % 1 + 1) % 1;
      const pl = belly.clone().lerp(plate, smooth(0.72, 0.97, f) * 0.85);
      return scaleCol(p, n).lerp(pl, k);
    },
    pat: PAT.scales,
    patFn: (_p, _n, i) => (bellyK(buv[i * 2] * Math.PI * 2) > 0.5 ? PAT.none : PAT.scales),
    patScale: [40, 6],
    blend: chainWeights,
  });

  // ---- Dorsal spines from behind the wings to the tail ----
  for (let i = 3; i < CHAIN.length - 1; i += 1) {
    const c = CHAIN[i];
    if (!c.bone.startsWith('spine') || c.bone === 'spine0' || c.bone === 'spine1') continue;
    const r = RADII[i];
    for (const off of [0, -0.5]) {
      const h = 0.12 + r * 0.32;
      B.add(c.bone, xf(cone(0.05 + r * 0.08, h, 4), { pos: [0, r * 0.88, off], rot: [-0.65, 0, 0], scale: [0.45, 1, 1] }), {
        color: (p) => back2.clone().lerp(new THREE.Color(v.hornTip), smooth(r * 0.9, r * 0.9 + h, p.y) * 0.7),
      });
    }
  }

  // ---- Head ----
  const headCol = (p: THREE.Vector3, n: THREE.Vector3, ao: number) => {
    const c = scaleCol(p, n, ao);
    if (p.y < -0.12 && n.y < -0.5) return c.lerp(new THREE.Color('#4a0d0a'), 0.85); // palate
    const lip = smooth(-0.05, -0.15, p.y) * smooth(0.5, 0.8, p.z);
    c.lerp(belly, lip * 0.45);
    const nostril = smooth(0.06, 0.03, Math.hypot(Math.abs(p.x) - 0.13, p.y - 0.12, (p.z - 1.6) * 0.6)) * smooth(0.3, 0.6, n.z + n.y);
    return c.lerp(new THREE.Color('#1c0504'), nostril);
  };
  B.add('head', P.head.clone(), { color: (p, n, i) => headCol(p, n, P.headAO[i]), ...SCALES });
  B.add('jaw', P.jaw.clone(), {
    color: (p, n) => (n.y > 0.7 && p.y > -0.01 ? new THREE.Color('#5a1410') : mix(v.belly, v.back, smooth(-0.1, 0.0, p.y) * 0.4)),
    ...SCALES,
  });
  // Teeth along both jaws; fangs near the front.
  const toothCol = '#f4ecd8';
  for (let k = 0; k < (low ? 5 : 8); k++) {
    const t = k / (low ? 4 : 7);
    const z = 0.6 + t * 1.0, fang = Math.abs(z - 1.46) < 0.08;
    const r = 0.32 + (0.17 - 0.32) * ((z - 0.45) / 1.27);
    for (const sx of [1, -1]) {
      B.add('head', xf(cone(fang ? 0.04 : 0.026, fang ? 0.17 : 0.08, 5), { pos: [r * 0.82 * sx, -0.15, z], rot: [Math.PI, 0, 0] }), { color: toothCol });
      if (k % 2 === 0) B.add('jaw', xf(cone(0.024, fang ? 0.12 : 0.07, 5), { pos: [(0.22 - t * 0.09) * sx, 0.0, 0.18 + t * 0.85] }), { color: toothCol });
    }
  }
  // Eyes in their sockets: glowing gold with a black slit.
  for (const sx of [1, -1]) {
    const c = new THREE.Vector3(0.285 * sx, 0.14, 0.71);
    const n = new THREE.Vector3(0.85 * sx, 0.12, 0.5).normalize();
    const ex = new THREE.Vector3(0, 1, 0).cross(n).normalize(), ey = n.clone().cross(ex);
    const g = ellipsoid(0.07, 0.062, 0.085, 14, 10);
    g.applyMatrix4(new THREE.Matrix4().makeBasis(ex, ey, n).setPosition(c));
    const eye = new THREE.Color(v.eye), deep = new THREE.Color(v.eye).offsetHSL(-0.03, 0, -0.18);
    B.add('head', g, {
      color: (p) => {
        const l = p.clone().sub(c);
        const lx = l.dot(ex), ly = l.dot(ey);
        if (Math.abs(lx) < 0.012 + 0.008 * (1 - Math.abs(ly) / 0.06)) return '#120400';
        return deep.clone().lerp(eye, smooth(0.07, 0.0, Math.hypot(lx, ly)));
      },
      pat: PAT.glow,
    });
  }
  // Horns: long, ridged, sweeping back from the crown.
  for (const sx of [1, -1]) {
    const top = surfaceHit(headField, new THREE.Vector3(0.22 * sx, 1, 0.02), new THREE.Vector3(0, -1, 0), 2) ?? new THREE.Vector3(0.22 * sx, 0.4, 0.02);
    const b0 = top.addScaledVector(fieldNormal(headField, top), -0.05);
    const hp = bezier(b0, b0.clone().add(new THREE.Vector3(0.24 * sx, 0.45, -0.62)), b0.clone().add(new THREE.Vector3(0.4 * sx, 0.5, -1.75)), seg(14));
    B.add('head', tube(hp, (t) => (0.135 * (1 - t) + 0.016) * (1 + 0.07 * Math.max(0, Math.sin(t * Math.PI * 11)) * (1 - t)), { radial: low ? 7 : 9, caps: true }), {
      color: (p) => mix(v.horn, v.hornTip, smooth(0.6, 1.8, p.distanceTo(b0))),
    });
    // Small spikes along the cheekbones, swept back.
    for (const [y, z, l] of [[0.0, 0.2, 0.32], [-0.08, 0.02, 0.26]] as Array<[number, number, number]>) {
      B.add('head', tube(bezier(new THREE.Vector3(0.36 * sx, y, z), new THREE.Vector3(0.48 * sx, y + 0.03, z - l * 0.5), new THREE.Vector3(0.55 * sx, y + 0.06, z - l), 4), (t) => 0.05 * (1 - t) + 0.008, { radial: 5, caps: true }), {
        color: (p) => mix(v.horn, v.hornTip, smooth(0.38, 0.55, Math.abs(p.x))),
      });
    }
  }
  // Whiskers (smoothly skinned over their chains).
  for (const [s, sx] of [['L', 1], ['R', -1]] as const) {
    const p0 = new THREE.Vector3(0, 0, 0);
    const p1 = new THREE.Vector3(0.5 * sx, -0.2, -0.55);
    const p2 = p1.clone().add(new THREE.Vector3(0.35 * sx, -0.3, -0.7));
    const p3 = p2.clone().add(new THREE.Vector3(0.15 * sx, -0.3, -0.7));
    const wp = new THREE.CatmullRomCurve3([p0, p1, p2, p3]).getPoints(seg(16));
    B.add(`whisk${s}0`, tube(wp, (t) => 0.042 * (1 - t) + 0.01, { radial: 5, caps: true }), {
      color: v.horn,
      blend: (p) => {
        const d = p.distanceTo(p0);
        const w1 = smooth(0.3, 0.8, d), w2 = smooth(1.1, 1.6, d);
        return [[`whisk${s}0`, 1 - w1], [`whisk${s}1`, w1 * (1 - w2)], [`whisk${s}2`, w2]];
      },
    });
  }

  // ---- Mane: a fur sleeve over the nape and crown with flowing locks, and a beard ----
  const radial = low ? 4 : 5, rings = low ? 3 : 4;
  const lockAdd = (bone: string, base: THREE.Vector3, dir: THREE.Vector3, len: number, r: number, droop: number, blend?: (p: THREE.Vector3) => Array<[string, number]>) => {
    B.add(bone, furLock(base, dir, len, r, droop, radial, rings, 0.7), { color: (p) => maneCol(p, base, len), ...FUR, blend });
  };
  B.add('spine0', P.mane.clone(), {
    color: (p, _n, i) => mane.clone().multiplyScalar(0.68 + 0.32 * P.maneAO[i]).offsetHSL(0, 0, (cnoise(p.x * 2, p.y * 2, p.z * 0.6, 2) - 0.5) * 0.06),
    pat: PAT.fur,
    patScale: [1.6, 3],
    blend: chainWeights,
  });
  const maneRows = low ? 5 : 8;
  const maneAngles = low ? [-70, 0, 70] : [-95, -50, 0, 50, 95];
  for (let r = 0; r < maneRows; r++) {
    const z = 3.45 - (2.65 * r) / (maneRows - 1);
    const cy = neckY(z) + 0.15;
    for (const deg of maneAngles) {
      const a = (deg * Math.PI) / 180 + (r % 2) * 0.2;
      const from = new THREE.Vector3(Math.sin(a) * 2.5, cy + Math.cos(a) * 2.5, z);
      const h = surfaceHit(maneField, from, new THREE.Vector3(0, cy, z).sub(from).normalize(), 3);
      if (!h) continue;
      const n = fieldNormal(maneField, h);
      const len = (0.78 - 0.32 * (r / maneRows)) * (deg === 0 ? 1.1 : 0.9) + 0.14 * cnoise(h.x, h.y, h.z, 5);
      lockAdd('spine0', h.addScaledVector(n, -0.07), n.clone().multiplyScalar(0.25).add(new THREE.Vector3(0, 0.08, -1)), len, 0.15, 0.5, chainWeights);
    }
  }
  // Beard under the chin.
  for (const [x, z, len] of (low ? [[0, 0.35, 0.6], [-0.12, 0.6, 0.5], [0.12, 0.6, 0.5]] : [[0, 0.3, 0.65], [-0.1, 0.45, 0.6], [0.1, 0.45, 0.6], [0, 0.62, 0.55], [-0.13, 0.75, 0.45], [0.13, 0.75, 0.45], [0, 0.88, 0.4]]) as Array<[number, number, number]>) {
    lockAdd('jaw', new THREE.Vector3(x, -0.1, z), new THREE.Vector3(x * 0.6, -0.65, -1), len * 1.15, 0.1, 0.25);
  }
  // Lion tuft at the tail tip.
  const tailEnd = pts[pts.length - 1];
  for (let k = 0; k < (low ? 9 : 16); k++) {
    const a = (k / (low ? 9 : 16)) * Math.PI * 2;
    const zz = tailEnd.z + 0.35 + (k % 3) * 0.18;
    const out = new THREE.Vector3(Math.sin(a), Math.cos(a), 0);
    const base = new THREE.Vector3(0, tailEnd.y, zz).addScaledVector(out, 0.1);
    lockAdd(`spine${SPINE_N}`, base.clone().add(new THREE.Vector3(0, 0, SPINE_N * SPINE_STEP)), out.clone().multiplyScalar(0.45).add(new THREE.Vector3(0, 0, -1)), 0.75 + 0.3 * cnoise(a, 0, 0, 2), 0.13, 0.2);
  }

  // ---- Legs: sculpted, with three clawed toes and a dewclaw ----
  const claw = (bone: string, tip: THREE.Vector3, dir: THREE.Vector3, len: number) => {
    const d = dir.clone().normalize();
    const mid = tip.clone().addScaledVector(d, len * 0.6);
    const end = tip.clone().addScaledVector(d, len);
    end.y -= len * 0.55;
    B.add(bone, tube(bezier(tip, mid, end, 5), (t) => 0.045 * (1 - t) + 0.004, { radial: 5, caps: true }), { color: (p) => mix(v.horn, v.hornTip, smooth(0, len, p.distanceTo(tip))) });
  };
  for (const id of ['F', 'B'] as const) {
    const L = P.legs[id];
    const right = mirrorKeep(L.g);
    for (const [s, sx] of [['L', 1], ['R', -1]] as const) {
      const arm = `arm${id}${s}`, fore = `fore${id}${s}`, foot = `foot${id}${s}`;
      B.add(arm, sx > 0 ? L.g.clone() : right.clone(), {
        color: (p, n, i) => scaleCol(p, n, L.ao[i]).lerp(back2, smooth(-1.2, -1.55, p.y) * 0.5),
        ...SCALES,
        blend: (p) => {
          const wf = smooth(-0.62, -0.92, p.y), wt = smooth(-1.38, -1.56, p.y);
          return [[arm, 1 - wf], [fore, wf * (1 - wt)], [foot, wf * wt]];
        },
      });
      // Toes (foot-local; the foot bone sits at arm-local (0.05, -1.52, 0.17)).
      for (const tx of [-0.11, 0, 0.11]) {
        const a = new THREE.Vector3(tx * sx, -0.03, 0.08), b = new THREE.Vector3(tx * 1.7 * sx, -0.06, 0.36);
        B.add(foot, tube([a, a.clone().lerp(b, 0.5).add(new THREE.Vector3(0, 0.02, 0)), b], [0.07, 0.06, 0.048], { radial: 6, caps: true }), { color: (p, n) => scaleCol(p, n, 0.85), ...SCALES });
        claw(foot, b.clone().add(new THREE.Vector3(0, 0.0, 0.03)), new THREE.Vector3(tx * 0.6 * sx, 0.1, 1), 0.2);
      }
      const dw = new THREE.Vector3(0.04 * sx, -0.02, -0.1);
      B.add(foot, tube([new THREE.Vector3(0.03 * sx, -0.01, 0.0), dw], 0.05, { radial: 5, caps: true }), { color: (p, n) => scaleCol(p, n, 0.8) });
      claw(foot, dw.clone().add(new THREE.Vector3(0, 0, -0.03)), new THREE.Vector3(0, 0.1, -1), 0.13);
    }
    right.dispose();
  }

  // ---- Wings: arm and finger bones, a thumb claw, the membrane ----
  const wingBone = new THREE.Color(v.back).lerp(back2, 0.3);
  for (const [s, sx] of [['L', 1], ['R', -1]] as const) {
    const m = (p: THREE.Vector3) => new THREE.Vector3(p.x * sx, p.y, p.z);
    const S = new THREE.Vector3(), E = m(WING.E), W = m(WING.W);
    const boneCol = (p: THREE.Vector3, n: THREE.Vector3) => wingBone.clone().multiplyScalar(0.8 + 0.2 * smooth(-0.3, 0.8, n.y)).offsetHSL(0, 0, (cnoise(p.x, p.y, p.z, 2) - 0.5) * 0.05);
    B.add(`wing${s}`, tube([S, S.clone().lerp(E, 0.5).add(new THREE.Vector3(0, 0.08, 0)), E], [0.2, 0.15, 0.12], { radial: 8, caps: true }), { color: boneCol, ...SCALES });
    B.add(`wing${s}`, tube([E, E.clone().lerp(W, 0.5), W], [0.12, 0.09, 0.085], { radial: 7, caps: true }), { color: boneCol, ...SCALES, blend: () => [[`wing${s}1`, 1]] });
    for (let k = 0; k < 4; k++) {
      const T = m(WING.T[k]);
      const knuckle = W.clone().lerp(T, 0.42).add(new THREE.Vector3(0, 0.05, 0));
      B.add(`wing${s}`, tube([W, knuckle, T], (t) => 0.075 * (1 - t) + 0.016, { radial: 6, caps: true }), { color: boneCol, blend: () => [[`finger${s}${k + 1}`, 1]] });
      if (k === 0) {
        // Claw at the tip of the leading finger.
        const tipDir = T.clone().sub(knuckle).normalize();
        B.add(`wing${s}`, tube(bezier(T, T.clone().addScaledVector(tipDir, 0.12), T.clone().addScaledVector(tipDir, 0.2).add(new THREE.Vector3(0, -0.1, 0)), 4), (t) => 0.03 * (1 - t) + 0.004, { radial: 5 }), { color: v.horn, blend: () => [[`finger${s}1`, 1]] });
      }
    }
    // Thumb claw at the wrist, hooked forward.
    B.add(`wing${s}`, tube(bezier(W, W.clone().add(new THREE.Vector3(0.05 * sx, 0.1, 0.22)), W.clone().add(new THREE.Vector3(0.0, 0.0, 0.36)), 5), (t) => 0.06 * (1 - t) + 0.006, { radial: 5, caps: true }), {
      color: (p) => mix(wingBone, v.horn, smooth(0.1, 0.25, p.distanceTo(W))),
      blend: () => [[`wing${s}2`, 1]],
    });
    const mem = wingMembrane(s, sx, low ? 5 : 7, low ? 4 : 6);
    const wing = new THREE.Color(v.wing), vein = new THREE.Color(v.vein);
    B.add(`wing${s}`, mem.g, {
      color: (p, _n, i) => wing.clone().lerp(vein, mem.vein[i] * 0.8).offsetHSL(0, 0, (cnoise(p.x, p.y, p.z, 1.2) - 0.5) * 0.05),
      blend: (_p, i) => mem.w[i],
    });
  }
  return B.build();
}

function buildDragonHarness(variant: number): ModelTemplate {
  const B = new ModelBuilder();
  B.bone('spine0', null, 0, ROOT_Y, 0);
  // Sun Warrior harness: golden collar band, a saddle cloth with a gold hem, and a cinch strap.
  const ring: THREE.Vector3[] = [];
  for (let i = 0; i <= 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    ring.push(new THREE.Vector3(Math.sin(a) * 0.9, Math.cos(a) * 0.9, 0.35));
  }
  B.add('spine0', tube(ring, 0.065, { radial: 6 }), { color: '#e2b23a' });
  const cloth = variant % 2 ? '#d8b04a' : '#a8141c', hem = variant % 2 ? '#7a1410' : '#e2b23a';
  B.add('spine0', xf(ellipsoid(0.55, 0.07, 0.6, 16, 6), { pos: [0, 0.86, -0.25] }), { color: (p) => (Math.hypot(p.x / 0.55, (p.z + 0.25) / 0.6) > 0.82 ? hem : cloth) });
  const cinch: THREE.Vector3[] = [];
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    cinch.push(new THREE.Vector3(Math.sin(a) * 0.92, Math.cos(a) * 0.92, -0.6));
  }
  B.add('spine0', tube(cinch, 0.045, { radial: 5 }), { color: '#5a3518' });
  return B.build();
}

export class DragonModel extends CreatureModel {
  private wave = 0;
  private flyBlend = 0;
  private restBlend = 0;
  private roar = 0;
  private bowBlend = 0;
  private wingPh = 0;
  private wingAmp = 0;

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
    // Chest rises and falls with the wing beat in flight.
    this.rot('spine0', Math.sin(this.wave * 2 + 1.5) * 0.04 * fb - Math.max(-0.25, Math.min(0.25, a.vy * 0.025)) * fb, 0, 0);
    this.off('spine0', 0, Math.sin(this.wingPh + Math.PI) * 0.12 * this.wingAmp - 0.75 * rb, 0);
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
    const [ly, lp] = this.track(a, 0.8, 0.5, new THREE.Vector3(0, 2.9, 3.6));
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
    // Wings: slow, deep beats in flight (stronger climbing or boosting, a glide when
    // descending); folded along the back on the ground. Elbow and wrist lag the
    // shoulder so each beat whips through to the tips, and the wing half-folds on
    // the upstroke.
    const beat = fb * (a.vy < -2 ? 0.35 : 1) * (a.boost ? 1.25 : 1);
    this.wingAmp = dampN(this.wingAmp, beat, 2, dt);
    this.wingPh += dt * (0.62 + (a.boost ? 0.45 : 0) + Math.max(0, a.vy) * 0.03) * Math.PI * 2 * (0.25 + 0.75 * fb);
    const wp = this.wingPh, amp = this.wingAmp;
    const fold = Math.max(rb, ground);
    const up = Math.max(0, Math.cos(wp)) * amp; // upstroke: tuck a little
    for (const [s, sx] of [['L', 1], ['R', -1]] as const) {
      const flap = Math.sin(wp) * 0.55 * amp;
      this.rot(`wing${s}`, 0.05 * fold, sx * 1.25 * fold, sx * (flap + 0.1 * fb + 0.14 * fold));
      this.rot(`wing${s}1`, 0, sx * (0.05 * fold + 0.18 * up), sx * Math.sin(wp - 0.6) * 0.2 * amp);
      this.rot(`wing${s}2`, 0, sx * (0.1 * fold + 0.3 * up), sx * Math.sin(wp - 1.2) * 0.24 * amp);
      for (let k = 1; k <= 4; k++) this.rot(`finger${s}${k}`, 0, sx * FINGER_CLOSE[k - 1] * Math.min(1, fold * 0.95 + up * 0.25), 0);
    }
  }
}
