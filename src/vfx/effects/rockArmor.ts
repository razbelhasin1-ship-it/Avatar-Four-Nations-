import * as THREE from 'three';
import type { GameContext } from '../../core/GameContext';
import type { BoneName } from '../../character/Animator';
import type { Humanoid } from '../../character/Humanoid';
import { HEAD_CY, rigLayout } from '../../character/CharShape';
import { debris, effect } from './loop';
import { fbm3, noise3, rand01 } from './noise';
import { shared } from './shapes';
const armorMats = new Map<string, THREE.MeshStandardMaterial>();

/** Shared smooth-shaded stone (vertex-coloured) for armor plates, one per ground tint; never disposed. */
function armorMaterial(tint: string): THREE.MeshStandardMaterial {
  let m = armorMats.get(tint);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: tint, roughness: 0.93, metalness: 0, vertexColors: true });
    m.name = 'rock_armor';
    armorMats.set(tint, m);
  }
  return m;
}

/**
 * Rock Armor: stone plates fitted to a humanoid's own proportions — a helmet that leaves the face
 * open, a gorget, banded chest, back and belly plates, pauldrons, upper-arm plates, stone cuffs and
 * knuckle blocks, thigh plates, knee cops, greaves and boots.
 *
 * The plates are torn out of the ground around the bender and fly up to clamp on from the feet to
 * the head. Blows crack the plate they land on and, as the armor's integrity is spent, knock plates
 * off; the armor ends by bursting outward (thrown plates) or crumbling to the ground.
 *
 * Geometry is generated per body shape and cached (shared, never disposed); the material is the
 * shared stone material for the ground's tint.
 */

type V3 = [number, number, number];

export type ArmorPart =
  | 'helmet'
  | 'gorget'
  | 'chest'
  | 'back'
  | 'bellyFront'
  | 'bellyBack'
  | 'pauldronL'
  | 'pauldronR'
  | 'armL'
  | 'armR'
  | 'cuffL'
  | 'cuffR'
  | 'fistL'
  | 'fistR'
  | 'thighL'
  | 'thighR'
  | 'kneeL'
  | 'kneeR'
  | 'greaveL'
  | 'greaveR'
  | 'bootL'
  | 'bootR';

/** Stone Guard wears only the forearm cuffs and knuckles. */
export const GUARD_PARTS: ArmorPart[] = ['cuffL', 'cuffR', 'fistL', 'fistR'];

interface PieceDef {
  part: ArmorPart;
  bone: BoneName;
  key: string;
  build: (cracked: boolean) => THREE.BufferGeometry;
  /** Assembly order (s after the armor is called up). */
  delay: number;
  /** Chest, back and belly hold the armor together: they break last. */
  core: boolean;
}

// ---------------------------------------------------------------------------
// Shell geometry: a thick, chiselled stone surface over a parametric patch
// ---------------------------------------------------------------------------

type Surf = (u: number, v: number, p: THREE.Vector3, n: THREE.Vector3) => void;

interface ShellOpts {
  nu: number;
  nv: number;
  /** Thickness (m), inward from the surface. */
  th: number;
  /** Outer displacement amplitude (m). */
  rough: number;
  seed: number;
  /** Broken-edge wander, in parameter units. */
  jag?: number;
  /** v of horizontal seams between lamellae. */
  grooves?: number[];
  /** u of vertical seams. */
  vgrooves?: number[];
  /** Closed around u (a full ring: no u edges). */
  wrapU?: boolean;
  /** v = 0 is a pole (domes): no edge there. */
  pole?: boolean;
  cracked?: boolean;
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Crack polylines in (u, v): a few jagged runs from an edge into the plate. */
function crackLines(seed: number): Array<Array<[number, number]>> {
  const lines: Array<Array<[number, number]>> = [];
  const n = 2 + Math.floor(rand01(seed * 71 + 3) * 2);
  for (let k = 0; k < n; k++) {
    const r = (i: number) => rand01(seed * 137 + k * 313 + i * 59);
    // Start on a random edge, wander toward the middle with sharp turns.
    const side = Math.floor(r(0) * 4);
    let u = side === 0 ? 0 : side === 1 ? 1 : r(1);
    let v = side === 2 ? 0 : side === 3 ? 1 : r(1);
    const line: Array<[number, number]> = [[u, v]];
    let du = 0.5 - u, dv = 0.5 - v;
    const len = Math.hypot(du, dv) || 1;
    du /= len;
    dv /= len;
    const steps = 4 + Math.floor(r(2) * 3);
    for (let i = 0; i < steps; i++) {
      const turn = (r(10 + i) - 0.5) * 1.6;
      const c = Math.cos(turn), s = Math.sin(turn);
      const ndu = du * c - dv * s, ndv = du * s + dv * c;
      const step = 0.08 + r(20 + i) * 0.1;
      u = clamp01(u + ndu * step);
      v = clamp01(v + ndv * step);
      line.push([u, v]);
      // Branch once.
      if (i === 2 && r(40) > 0.5) lines.push([[u, v], [clamp01(u + (r(41) - 0.5) * 0.4), clamp01(v + (r(42) - 0.5) * 0.4)]]);
    }
    lines.push(line);
  }
  return lines;
}

function distToLines(u: number, v: number, lines: Array<Array<[number, number]>>, su: number, sv: number): number {
  let best = Infinity;
  for (const l of lines) {
    for (let i = 0; i + 1 < l.length; i++) {
      const ax = l[i][0] * su, ay = l[i][1] * sv, bx = l[i + 1][0] * su, by = l[i + 1][1] * sv;
      const px = u * su, py = v * sv;
      const dx = bx - ax, dy = by - ay;
      const L = dx * dx + dy * dy;
      const t = L > 0 ? clamp01(((px - ax) * dx + (py - ay) * dy) / L) : 0;
      const d = Math.hypot(ax + dx * t - px, ay + dy * t - py);
      if (d < best) best = d;
    }
  }
  return best;
}

const sP = new THREE.Vector3();
const sN = new THREE.Vector3();
const sA = new THREE.Vector3();
const sB = new THREE.Vector3();
const sC = new THREE.Vector3();

function buildShell(surf: Surf, o: ShellOpts): THREE.BufferGeometry {
  const nu = o.cracked ? Math.round(o.nu * 1.6) : o.nu;
  const nv = o.cracked ? Math.round(o.nv * 1.6) : o.nv;
  const outer: THREE.Vector3[][] = [];
  const inner: THREE.Vector3[][] = [];
  const nrm: THREE.Vector3[][] = [];
  const shade: number[][] = [];
  const cracks = o.cracked ? crackLines(o.seed) : null;
  // Each plate a slightly different stone tone.
  const tone = 0.74 + rand01(o.seed * 17 + 3) * 0.12;
  // Rough size of the patch (m) so crack width is metric-ish.
  surf(0, 0.5, sA, sN);
  surf(1, 0.5, sB, sN);
  surf(0.5, 0, sC, sN);
  surf(0.5, 1, sP, sN);
  const su = Math.max(0.05, o.wrapU ? sA.distanceTo(sB) * 3 : sA.distanceTo(sB) * 1.2);
  const sv = Math.max(0.05, sC.distanceTo(sP));
  for (let i = 0; i <= nu; i++) {
    outer.push([]);
    inner.push([]);
    nrm.push([]);
    shade.push([]);
    for (let j = 0; j <= nv; j++) {
      let u = i / nu;
      let v = j / nv;
      if (o.jag) {
        // Seam-safe noise (by angle around a ring, not by index).
        const cu = Math.cos(u * Math.PI * 2) * 2.2, su2 = Math.sin(u * Math.PI * 2) * 2.2;
        const w = noise3(cu + o.seed * 3.1, su2 + j * 0.91, o.seed * 1.7 + v * 3);
        if (!o.wrapU && i === 0) u += o.jag * w;
        if (!o.wrapU && i === nu) u -= o.jag * w;
        if (j === 0 && !o.pole) v += o.jag * w * 0.8;
        if (j === nv) v -= o.jag * w * 0.8;
      }
      surf(u, v, sP, sN);
      const s = o.seed;
      // Lumps and chiselled facets along the normal.
      const f = fbm3(sP.x * 8 + s * 3.3, sP.y * 8 - s, sP.z * 8 + s * 1.9, 3);
      const facet = Math.round(noise3(sP.x * 13 + s, sP.y * 13 - s * 2, sP.z * 13) * 3) / 3;
      let d = (f * 0.75 + (facet - 0.5) * 0.45) * o.rough;
      let sh = tone + f * 0.14 + (facet - 0.5) * 0.05;
      for (const g of o.grooves ?? []) {
        const k = 1 - Math.min(1, (Math.abs(v - g) * sv) / 0.012);
        if (k > 0) {
          d -= k * 0.009;
          sh -= k * 0.4;
        }
      }
      for (const g of o.vgrooves ?? []) {
        const k = 1 - Math.min(1, (Math.abs(u - g) * su) / 0.012);
        if (k > 0) {
          d -= k * 0.008;
          sh -= k * 0.34;
        }
      }
      if (cracks) {
        const cd = distToLines(u, v, cracks, su, sv);
        const k = 1 - Math.min(1, cd / 0.014);
        if (k > 0) {
          d -= k * 0.013;
          sh -= k * 0.55;
        }
        sh -= 0.06;
      }
      // Worn, darker rims.
      const edge = Math.min(o.wrapU ? 1 : Math.min(u, 1 - u) * su, (o.pole ? 1 - v : Math.min(v, 1 - v)) * sv);
      if (edge < 0.03) sh -= (0.03 - edge) * 4;
      outer[i].push(sP.clone().addScaledVector(sN, d));
      inner[i].push(sP.clone().addScaledVector(sN, -o.th));
      nrm[i].push(sN.clone());
      shade[i].push(Math.max(0.25, sh));
    }
  }
  // Indexed: smooth across each surface, hard edges where the rims meet it.
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const vert = (p: THREE.Vector3, c: number): number => {
    pos.push(p.x, p.y, p.z);
    col.push(c, c * 0.97, c * 0.93);
    return pos.length / 3 - 1;
  };
  const P = (k: number, out: THREE.Vector3) => out.set(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]);
  const tri = (a: number, b: number, c: number, hint: THREE.Vector3) => {
    P(a, sP);
    P(b, sA).sub(sP);
    P(c, sB).sub(sP);
    sC.crossVectors(sA, sB);
    if (sC.lengthSq() < 1e-14) return;
    if (sC.dot(hint) < 0) idx.push(a, c, b);
    else idx.push(a, b, c);
  };
  const hint = new THREE.Vector3();
  const quad = (a: number, b: number, c: number, d: number, h: THREE.Vector3) => {
    tri(a, b, c, h);
    tri(a, c, d, h);
  };
  const oi: number[][] = [];
  const ii: number[][] = [];
  for (let i = 0; i <= nu; i++) {
    oi.push([]);
    ii.push([]);
    for (let j = 0; j <= nv; j++) {
      // Shared seam (rings) and pole (domes) vertices keep the shading smooth there.
      if (o.wrapU && i === nu) {
        oi[i].push(oi[0][j]);
        ii[i].push(ii[0][j]);
      } else if (o.pole && j === 0 && i > 0) {
        oi[i].push(oi[0][0]);
        ii[i].push(ii[0][0]);
      } else {
        oi[i].push(vert(outer[i][j], shade[i][j]));
        ii[i].push(vert(inner[i][j], 0.36));
      }
    }
  }
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      hint.copy(nrm[i][j]).add(nrm[i + 1][j + 1]);
      quad(oi[i][j], oi[i + 1][j], oi[i + 1][j + 1], oi[i][j + 1], hint);
      hint.negate();
      quad(ii[i][j], ii[i + 1][j], ii[i + 1][j + 1], ii[i][j + 1], hint);
    }
  }
  // Rims (the stone's broken thickness): their own vertices, so the edge reads sharp.
  const RIM = 0.52;
  const rimStrip = (a: THREE.Vector3[], b: THREE.Vector3[], away: THREE.Vector3[]) => {
    const ta = a.map((p) => vert(p, RIM));
    const tb = b.map((p) => vert(p, RIM * 0.8));
    for (let k = 0; k + 1 < a.length; k++) quad(ta[k], ta[k + 1], tb[k + 1], tb[k], away[k]);
  };
  const awayV = (j: number, nj: number) => outer.map((col_, i) => sA.subVectors(outer[i][j], outer[i][nj]).clone());
  for (const j of o.pole ? [nv] : [0, nv]) {
    const nj = j === 0 ? 1 : nv - 1;
    rimStrip(outer.map((c) => c[j]), inner.map((c) => c[j]), awayV(j, nj));
  }
  if (!o.wrapU) {
    for (const i of [0, nu]) {
      const ni = i === 0 ? 1 : nu - 1;
      const away = outer[i].map((p, j) => sA.subVectors(p, outer[ni][j]).clone());
      rimStrip(outer[i], inner[i], away);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** Elliptic band around the local Y axis (torso and limbs). a = 0 faces +Z (front), +PI/2 faces +X. */
interface BandOpts {
  y0: number;
  y1: number;
  a0: number;
  a1: number;
  rx0: number;
  rz0: number;
  rx1: number;
  rz1: number;
  xc?: number;
  zc?: number;
  /** Barrel bulge at mid-height (fraction). */
  bulge?: number;
  /** Ridge down the front centre (fraction of the radius). */
  keel?: number;
  /** Bottom edge flaring outward (fraction). */
  flare?: number;
  /** Top edge flaring outward (fraction). */
  flareTop?: number;
}

function bandSurf(o: BandOpts): Surf {
  return (u, v, p, n) => {
    const a = o.a0 + (o.a1 - o.a0) * u;
    const y = o.y0 + (o.y1 - o.y0) * v;
    const rx = o.rx0 + (o.rx1 - o.rx0) * v;
    const rz = o.rz0 + (o.rz1 - o.rz0) * v;
    let k = 1 + (o.bulge ?? 0) * Math.sin(Math.PI * v);
    k *= 1 + (o.flare ?? 0) * (1 - v) * (1 - v) * (1 - v);
    k *= 1 + (o.flareTop ?? 0) * v * v * v;
    // Ridge: wrapped angular distance from the front.
    const da = Math.atan2(Math.sin(a), Math.cos(a));
    k *= 1 + (o.keel ?? 0) * Math.exp(-(da * da) / 0.05);
    const sa = Math.sin(a), ca = Math.cos(a);
    p.set((o.xc ?? 0) + sa * rx * k, y, (o.zc ?? 0) + ca * rz * k);
    n.set(sa / rx, 0, ca / rz).normalize();
  };
}

/** Spherical cap (pole along +Y before `pole` rotation); thMax(phi) shapes the rim. */
interface DomeOpts {
  r: V3;
  center: V3;
  pole: V3;
  phi0: number;
  phi1: number;
  thMax: (phi: number) => number;
  /** Rim lip flaring outward (fraction) where lip(phi) > 0. */
  lip?: (phi: number) => number;
  /** Ridge along phi = 0 and PI (helmet crest). */
  crest?: number;
}

const _UP = new THREE.Vector3(0, 1, 0);

function domeSurf(o: DomeOpts): Surf {
  const q = new THREE.Quaternion().setFromUnitVectors(_UP, new THREE.Vector3(...o.pole).normalize());
  return (u, v, p, n) => {
    const phi = o.phi0 + (o.phi1 - o.phi0) * u;
    const tm = o.thMax(phi);
    const th = Math.max(0.02, tm * v);
    let k = 1;
    if (o.lip) k *= 1 + o.lip(phi) * smooth(tm - 0.32, tm, th);
    if (o.crest) {
      const dp = Math.min(Math.abs(Math.atan2(Math.sin(phi), Math.cos(phi))), Math.abs(Math.atan2(Math.sin(phi - Math.PI), Math.cos(phi - Math.PI))));
      k *= 1 + o.crest * Math.exp(-(dp * dp) / 0.02) * (1 - smooth(0.6, 1.4, th));
    }
    const sx = Math.sin(th) * Math.sin(phi), sy = Math.cos(th), sz = Math.sin(th) * Math.cos(phi);
    p.set(sx * o.r[0] * k, sy * o.r[1] * k, sz * o.r[2] * k);
    n.set(sx / o.r[0], sy / o.r[1], sz / o.r[2]).normalize();
    p.applyQuaternion(q);
    n.applyQuaternion(q);
    p.x += o.center[0];
    p.y += o.center[1];
    p.z += o.center[2];
  };
}

/** A chunky stone block (knuckles, boots): a rounded, lumpy box, flat-shaded. */
function blockGeometry(half: V3, center: V3, seed: number, opts: { toeDrop?: number; cracked?: boolean } = {}): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(2, 2, 2, 3, 2, 4).toNonIndexed();
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const col: number[] = [];
  const v = new THREE.Vector3();
  const cracks = opts.cracked ? crackLines(seed) : null;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    // Round the box toward an ellipsoid (keeps flat-ish faces).
    const r = v.length();
    const rounded = v.clone().multiplyScalar(1 / Math.max(1e-6, r)).multiplyScalar(1.45);
    v.lerp(rounded.clampLength(0, 1.45), 0.5);
    const n = fbm3(v.x * 1.7 + seed, v.y * 1.7 - seed, v.z * 1.7 + seed * 2, 3);
    v.multiplyScalar(1 + n * 0.16);
    let sh = 0.74 + rand01(seed * 17 + 3) * 0.12 + n * 0.16;
    if (cracks) {
      const cd = distToLines((v.x + 1.4) / 2.8, (v.z + 1.4) / 2.8, cracks, half[0] * 2, half[2] * 2);
      if (cd < 0.012) {
        v.multiplyScalar(0.94);
        sh -= 0.5;
      }
      sh -= 0.05;
    }
    let y = v.y * half[1];
    // Boots: the top slopes down toward the toe.
    if (opts.toeDrop && v.y > 0) y -= opts.toeDrop * Math.max(0, v.z) * (v.y / 1.45);
    pos.setXYZ(i, center[0] + v.x * half[0], center[1] + y, center[2] + v.z * half[2]);
    if (v.y < -0.9) sh *= 0.7;
    col.push(sh, sh * 0.97, sh * 0.93);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

// ---------------------------------------------------------------------------
// Fitting: plate shapes from the character's rig and build
// ---------------------------------------------------------------------------

/** Torso half-width / half-depth / z by model height (TORSO_ROWS, average frame). */
const TORSO: Array<[number, number, number, number]> = [
  [0.83, 0.07, 0.06, -0.005],
  [0.86, 0.128, 0.086, -0.01],
  [0.9, 0.151, 0.1, -0.013],
  [0.96, 0.157, 0.104, -0.013],
  [1.02, 0.146, 0.096, -0.005],
  [1.08, 0.131, 0.089, 0.003],
  [1.15, 0.137, 0.093, 0.009],
  [1.22, 0.15, 0.102, 0.014],
  [1.29, 0.159, 0.108, 0.017],
  [1.35, 0.164, 0.104, 0.012],
  [1.395, 0.172, 0.093, 0.002],
  [1.425, 0.16, 0.08, -0.006],
  [1.452, 0.112, 0.068, -0.008],
  [1.47, 0.062, 0.054, -0.006],
];

function torsoAt(y: number, col: 1 | 2 | 3): number {
  const t = TORSO;
  if (y <= t[0][0]) return t[0][col];
  for (let i = 0; i + 1 < t.length; i++) {
    if (y <= t[i + 1][0]) {
      const k = (y - t[i][0]) / (t[i + 1][0] - t[i][0]);
      return t[i][col] + (t[i + 1][col] - t[i][col]) * k;
    }
  }
  return t[t.length - 1][col];
}

/** Builds rounded to tenths keep the shared geometry cache small. */
const r1 = (x: number) => Math.round(x * 10) / 10;

function armorDefs(h: Humanoid): PieceDef[] {
  const a = h.appearance;
  const rig = rigLayout(a.frame, a.body ?? 'male');
  const d = rig.dims;
  const build = r1(a.build ?? 0.5);
  const muscle = 0.9 + build * 0.22;
  const armK = d.limb * (0.92 + build * 0.16);
  const legK = d.limb * (0.93 + build * 0.14);
  // Torso size at model height y, with frame and build applied (as buildBody's torsoAt).
  const tw = (y: number) => {
    const chest = smooth(1.12, 1.3, y) * (1 - smooth(1.43, 1.47, y));
    const waist = smooth(0.98, 1.06, y) * (1 - smooth(1.12, 1.22, y));
    const hip = 1 - smooth(0.98, 1.06, y);
    return torsoAt(y, 1) * (1 + (d.chestW - 1) * chest + (d.waistW - 1) * waist + (d.hipW - 1) * hip) * (1 + (muscle - 1) * 0.5 * chest);
  };
  const td = (y: number) => {
    const chest = smooth(1.12, 1.3, y) * (1 - smooth(1.43, 1.47, y));
    const bust = a.body === 'female' ? 1 + 0.17 * smooth(1.16, 1.25, y) * (1 - smooth(1.3, 1.38, y)) : 1;
    return torsoAt(y, 2) * d.depth * (1 + (muscle - 1) * 0.6 * chest) * bust;
  };
  const dimsKey = `${a.frame}:${a.body ?? 'male'}:${r1(build)}`;
  const M = 0.034; // margin over the body (clothes)
  const defs: PieceDef[] = [];
  const add = (part: ArmorPart, bone: BoneName, delay: number, core: boolean, build: (c: boolean) => THREE.BufferGeometry) =>
    defs.push({ part, bone, key: `armor:${part}:${dimsKey}`, build, delay, core });

  // --- Torso (chest bone at model y 1.25, spine at 1.05) ---
  const CH = 1.25, SP = 1.05;
  const chestBand = (front: boolean): BandOpts => ({
    y0: 1.115 - CH,
    y1: 1.41 - CH,
    a0: front ? -1.12 : Math.PI - 1.18,
    a1: front ? 1.12 : Math.PI + 1.18,
    rx0: tw(1.13) + M + 0.006,
    rz0: td(1.13) + M + 0.008,
    rx1: tw(1.38) + M - 0.004,
    rz1: td(1.36) + M + 0.004,
    zc: front ? 0.012 : 0.008,
    bulge: front ? 0.07 : 0.05,
    keel: front ? 0.07 : 0.03,
    flareTop: 0.04,
  });
  add('chest', 'chest', 0.3, true, (c) => buildShell(bandSurf(chestBand(true)), { nu: 14, nv: 7, th: 0.03, rough: 0.015, seed: 11, jag: 0.035, grooves: [0.36, 0.69], cracked: c }));
  add('back', 'chest', 0.27, true, (c) => buildShell(bandSurf(chestBand(false)), { nu: 14, nv: 7, th: 0.03, rough: 0.015, seed: 23, jag: 0.035, grooves: [0.5], vgrooves: [0.5], cracked: c }));
  const bellyBand = (front: boolean): BandOpts => ({
    y0: 0.965 - SP,
    y1: 1.135 - SP,
    a0: front ? -1.22 : Math.PI - 1.22,
    a1: front ? 1.22 : Math.PI + 1.22,
    rx0: tw(0.97) + M + 0.004,
    rz0: td(0.97) + M + 0.006,
    rx1: tw(1.12) + M,
    rz1: td(1.12) + M + 0.004,
    zc: -0.004,
    bulge: 0.03,
    flare: 0.06,
  });
  add('bellyFront', 'spine', 0.21, true, (c) => buildShell(bandSurf(bellyBand(true)), { nu: 12, nv: 6, th: 0.026, rough: 0.01, seed: 31, jag: 0.03, grooves: [0.34, 0.67], cracked: c }));
  add('bellyBack', 'spine', 0.2, true, (c) => buildShell(bandSurf(bellyBand(false)), { nu: 12, nv: 6, th: 0.026, rough: 0.01, seed: 37, jag: 0.03, grooves: [0.5], cracked: c }));
  // Gorget: a collar around the base of the neck.
  add('gorget', 'chest', 0.34, false, (c) =>
    buildShell(
      bandSurf({ y0: 1.395 - CH, y1: 1.505 - CH, a0: 0, a1: Math.PI * 2, rx0: 0.138 * d.chestW, rz0: 0.1 * d.depth, rx1: 0.074 * d.neck + 0.03, rz1: 0.068 * d.neck + 0.03, zc: 0.0, flare: 0.08 }),
      { nu: 18, nv: 4, th: 0.024, rough: 0.009, seed: 41, wrapU: true, jag: 0.05, grooves: [0.55], cracked: c },
    ),
  );

  // --- Arms (upper arm origin = shoulder joint; local -Y runs down the limb) ---
  for (const side of [1, -1] as const) {
    // Pauldron: a rounded cap hugging the top and outside of the shoulder, two lames.
    const pole: V3 = [side * 1, 0.8, 0.02];
    add(side > 0 ? 'pauldronL' : 'pauldronR', side > 0 ? 'upperArmL' : 'upperArmR', 0.42, false, (c) =>
      buildShell(
        domeSurf({
          r: [0.07 * armK + 0.038, 0.062 * armK + 0.034, 0.078 * armK + 0.04],
          center: [side * 0.006, -0.018, -0.002],
          pole,
          phi0: 0,
          phi1: Math.PI * 2,
          thMax: () => 1.62,
          lip: () => 0.07,
        }),
        { nu: 18, nv: 7, th: 0.024, rough: 0.012, seed: side > 0 ? 51 : 53, wrapU: true, pole: true, jag: 0.05, grooves: [0.58, 0.8], cracked: c },
      ),
    );
    // Outer upper-arm plate under the pauldron.
    const ao = side > 0 ? Math.PI / 2 : -Math.PI / 2;
    add(side > 0 ? 'armL' : 'armR', side > 0 ? 'upperArmL' : 'upperArmR', 0.37, false, (c) =>
      buildShell(
        bandSurf({ y0: -0.215, y1: -0.075, a0: ao - 1.45, a1: ao + 1.45, rx0: 0.04 * armK + M, rz0: 0.04 * armK + M, rx1: 0.045 * armK + M, rz1: 0.045 * armK + M, bulge: 0.05, flare: 0.08 }),
        { nu: 10, nv: 4, th: 0.022, rough: 0.009, seed: side > 0 ? 61 : 63, jag: 0.06, cracked: c },
      ),
    );
    // Stone cuffs: a full ring from below the elbow to the wrist, flaring at the wrist.
    add(side > 0 ? 'cuffL' : 'cuffR', side > 0 ? 'foreArmL' : 'foreArmR', 0.39, false, (c) =>
      buildShell(
        bandSurf({ y0: -0.236, y1: -0.04, a0: 0, a1: Math.PI * 2, rx0: 0.027 * armK + 0.036, rz0: 0.0245 * armK + 0.034, rx1: 0.038 * armK + 0.034, rz1: 0.036 * armK + 0.032, bulge: 0.09, flare: 0.16 }),
        { nu: 16, nv: 5, th: 0.028, rough: 0.012, seed: side > 0 ? 71 : 73, wrapU: true, jag: 0.05, grooves: [0.38, 0.72], cracked: c },
      ),
    );
    // Knuckle block: a stone mitt over the hand.
    add(side > 0 ? 'fistL' : 'fistR', side > 0 ? 'handL' : 'handR', 0.46, false, (c) => blockGeometry([0.031 * armK + 0.006, 0.047, 0.044 * armK + 0.006], [side * 0.004, -0.056, 0.004], side > 0 ? 81 : 83, { cracked: c }));
  }

  // --- Legs (thigh origin = hip joint; shin origin = knee; foot origin = ankle, toes along +Z) ---
  for (const side of [1, -1] as const) {
    // Thigh plates cover the front and the outer side, open toward the other leg.
    const a0 = side > 0 ? -0.75 : -2.35;
    const a1 = side > 0 ? 2.35 : 0.75;
    add(side > 0 ? 'thighL' : 'thighR', side > 0 ? 'thighL' : 'thighR', 0.13, false, (c) =>
      buildShell(
        bandSurf({ y0: -0.355, y1: -0.06, a0, a1, rx0: 0.062 * legK + M + 0.004, rz0: 0.062 * legK + M + 0.004, rx1: 0.08 * legK + M, rz1: 0.08 * legK + M, zc: 0.004, bulge: 0.05, flareTop: 0.06 }),
        { nu: 12, nv: 6, th: 0.026, rough: 0.011, seed: side > 0 ? 91 : 93, jag: 0.045, grooves: [0.5], cracked: c },
      ),
    );
    add(side > 0 ? 'kneeL' : 'kneeR', side > 0 ? 'shinL' : 'shinR', 0.09, false, (c) =>
      buildShell(
        domeSurf({ r: [0.064 * legK + 0.022, 0.07 * legK + 0.022, 0.05 * legK + 0.02], center: [0, -0.012, 0.03], pole: [0, -0.12, 1], phi0: 0, phi1: Math.PI * 2, thMax: () => 1.18, lip: () => 0.1 }),
        { nu: 12, nv: 4, th: 0.022, rough: 0.009, seed: side > 0 ? 101 : 103, wrapU: true, pole: true, jag: 0.06, cracked: c },
      ),
    );
    add(side > 0 ? 'greaveL' : 'greaveR', side > 0 ? 'shinL' : 'shinR', 0.05, false, (c) =>
      buildShell(
        bandSurf({ y0: -0.37, y1: -0.07, a0: -2.05, a1: 2.05, rx0: 0.035 * legK + M, rz0: 0.036 * legK + M, rx1: 0.056 * legK + M, rz1: 0.058 * legK + M, zc: 0.002, bulge: 0.1, keel: 0.08, flare: 0.1 }),
        { nu: 12, nv: 6, th: 0.025, rough: 0.011, seed: side > 0 ? 111 : 113, jag: 0.045, grooves: [0.3], cracked: c },
      ),
    );
    add(side > 0 ? 'bootL' : 'bootR', side > 0 ? 'footL' : 'footR', 0, false, (c) => blockGeometry([0.058, 0.04, 0.112], [0, -0.022, 0.05], side > 0 ? 121 : 123, { toeDrop: 0.022, cracked: c }));
  }

  // --- Helmet: covers the crown, the back and the sides, open in front of the face ---
  add('helmet', 'head', 0.52, false, (c) =>
    buildShell(
      domeSurf({
        r: [0.142, 0.148, 0.152],
        center: [0, HEAD_CY + 0.014, -0.004],
        pole: [0, 1, 0],
        phi0: -Math.PI,
        phi1: Math.PI,
        // Brow line in front (a short visor); cheek guards down the sides; the nape at the back.
        thMax: (phi) => {
          const f = Math.abs(Math.atan2(Math.sin(phi), Math.cos(phi)));
          return 1.05 + 0.8 * smooth(0.95, 1.5, f) + 0.12 * smooth(1.9, 2.8, f);
        },
        lip: (phi) => 0.16 * (1 - smooth(0.7, 1.2, Math.abs(Math.atan2(Math.sin(phi), Math.cos(phi))))),
        crest: 0.07,
      }),
      { nu: 24, nv: 9, th: 0.024, rough: 0.01, seed: 131, wrapU: true, pole: true, jag: 0.04, grooves: [0.6], cracked: c },
    ),
  );
  return defs;
}

// ---------------------------------------------------------------------------
// Runtime: assembly, damage, break-off, burst / crumble
// ---------------------------------------------------------------------------

const FLY = 0.24;
const GRAV = 13;

type PieceState = 'waiting' | 'flying' | 'on' | 'loose' | 'gone';

interface Piece {
  def: PieceDef;
  mesh: THREE.Mesh;
  bone: THREE.Object3D;
  state: PieceState;
  cracked: boolean;
  /** Assembly: torn-out start point and tumble. */
  from: THREE.Vector3;
  fromQ: THREE.Quaternion;
  /** Landing pulse / hit shudder timers. */
  pulse: number;
  shudder: number;
  /** Loose flight. */
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  looseT: number;
  bounced: boolean;
}

const tP = new THREE.Vector3();
const tQ = new THREE.Quaternion();
const tS = new THREE.Vector3();
const tV = new THREE.Vector3();
const tW = new THREE.Vector3();
const tE = new THREE.Euler();
const IDQ = new THREE.Quaternion();
const ONE = new THREE.Vector3(1, 1, 1);

const easeOut = (k: number) => 1 - Math.pow(1 - k, 3);
const easeOutBack = (k: number) => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
};

export interface RockArmorOptions {
  /** Only these parts (Stone Guard: cuffs and knuckles). */
  parts?: ArmorPart[];
  /** Assembly speed multiplier (> 1 = faster). */
  speed?: number;
  /** Pieces come up from the ground (true) or grow out of the stone at the bender's feet. */
  fromGround?: boolean;
}

export class RockArmorVisual {
  readonly pieces: Piece[] = [];
  private t = 0;
  private alive = true;
  private ending: 'none' | 'burst' | 'crumble' | 'broken' = 'none';
  private endT = 0;
  private landedSound = 0;
  private readonly speed: number;

  constructor(
    private readonly ctx: GameContext,
    private readonly humanoid: Humanoid,
    readonly tint: string,
    opts: RockArmorOptions = {},
  ) {
    this.speed = opts.speed ?? 1;
    const mat = armorMaterial(tint);
    const shadows = ctx.vfx.quality !== 'low';
    const root = humanoid.root;
    root.updateWorldMatrix(true, true);
    const center = root.getWorldPosition(new THREE.Vector3());
    const ground = ctx.world.groundAt(center.x, center.z, center.y + 1).y;
    let i = 0;
    for (const def of armorDefs(humanoid)) {
      if (opts.parts && !opts.parts.includes(def.part)) continue;
      const geo = shared(def.key, () => def.build(false));
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = shadows;
      mesh.name = `rock_armor_${def.part}`;
      mesh.visible = false;
      ctx.vfx.group.add(mesh);
      const bone = humanoid.bones[def.bone];
      // Torn out of the ground beside the bender, on the side of the plate's slot.
      bone.updateWorldMatrix(true, false);
      bone.getWorldPosition(tV);
      tW.set(tV.x - center.x, 0, tV.z - center.z);
      if (tW.lengthSq() < 0.0025) {
        const ang = rand01(i * 37 + 1) * Math.PI * 2;
        tW.set(Math.sin(ang), 0, Math.cos(ang));
      }
      tW.normalize();
      const dist = opts.fromGround === false ? 0.25 : 0.7 + rand01(i * 51 + 2) * 0.45;
      const from = new THREE.Vector3(center.x + tW.x * dist, ground - 0.12, center.z + tW.z * dist);
      const fromQ = new THREE.Quaternion().setFromEuler(tE.set(rand01(i * 13 + 5) * 6, rand01(i * 29 + 7) * 6, rand01(i * 41 + 9) * 6));
      this.pieces.push({ def, mesh, bone, state: 'waiting', cracked: false, from, fromQ, pulse: 0, shudder: 0, vel: new THREE.Vector3(), spin: new THREE.Vector3(), looseT: 0, bounced: false });
      i++;
    }
    effect(
      (dt) => this.update(dt),
      () => this.dispose(),
    );
  }

  /** Plates still on the body. */
  get attached(): number {
    let n = 0;
    for (const p of this.pieces) if (p.state === 'on' || p.state === 'flying' || p.state === 'waiting') n++;
    return n;
  }

  /** Every plate has landed on the body. */
  get assembled(): boolean {
    return this.pieces.every((p) => p.state !== 'waiting' && p.state !== 'flying');
  }

  private boneTarget(p: Piece, outPos: THREE.Vector3, outQ: THREE.Quaternion, outS: THREE.Vector3): void {
    p.bone.updateWorldMatrix(true, false);
    p.bone.matrixWorld.decompose(outPos, outQ, outS);
  }

  private update(dt: number): boolean {
    if (!this.alive) return false;
    this.t += dt;
    let busy = false;
    for (const p of this.pieces) {
      switch (p.state) {
        case 'waiting': {
          busy = true;
          if (this.ending !== 'none') {
            p.state = 'gone';
            p.mesh.removeFromParent();
            break;
          }
          if (this.t * this.speed >= p.def.delay) {
            p.state = 'flying';
            p.mesh.visible = true;
            // A slab tears out of the ground.
            if (this.pieces.indexOf(p) % 3 === 0) {
              debris(p.from.clone().setY(p.from.y + 0.15), 2, { spread: 0.8, speed: 3, size: 0.06, color: this.tint, life: 0.7 });
              this.ctx.vfx.burst('dust', tP.copy(p.from).setY(p.from.y + 0.12), { count: 3, radius: 0.25, speed: 0.8 });
            }
          }
          break;
        }
        case 'flying': {
          busy = true;
          const k = Math.min(1, ((this.t * this.speed - p.def.delay) / FLY));
          this.boneTarget(p, tP, tQ, tS);
          if (k >= 1) {
            this.attach(p);
            break;
          }
          const e = easeOut(k);
          // Arc: up out of the ground, then in to the slot.
          const mx = (p.from.x + tP.x) * 0.5, mz = (p.from.z + tP.z) * 0.5;
          const my = Math.max(p.from.y, tP.y) + 0.35;
          const a = 1 - e;
          p.mesh.position.set(
            a * a * p.from.x + 2 * a * e * mx + e * e * tP.x,
            a * a * p.from.y + 2 * a * e * my + e * e * tP.y,
            a * a * p.from.z + 2 * a * e * mz + e * e * tP.z,
          );
          p.mesh.quaternion.slerpQuaternions(p.fromQ, tQ, e);
          p.mesh.scale.copy(tS).multiplyScalar(0.55 + 0.45 * easeOutBack(k));
          break;
        }
        case 'on': {
          if (p.pulse > 0 || p.shudder > 0) {
            p.pulse = Math.max(0, p.pulse - dt);
            p.shudder = Math.max(0, p.shudder - dt);
            const s = 1 + (p.pulse / 0.09) * 0.1;
            p.mesh.scale.setScalar(s);
            if (p.shudder > 0) {
              const j = (p.shudder / 0.12) * 0.012;
              p.mesh.position.set((Math.random() - 0.5) * j, (Math.random() - 0.5) * j, (Math.random() - 0.5) * j);
            } else p.mesh.position.set(0, 0, 0);
          }
          break;
        }
        case 'loose': {
          busy = true;
          this.updateLoose(p, dt);
          break;
        }
        default:
          break;
      }
    }
    if (this.ending !== 'none') {
      this.endT += dt;
      // Crumbling: plates come away from the top down.
      if (this.ending === 'crumble' || this.ending === 'broken') {
        const ground = this.humanoid.root.getWorldPosition(tW).y;
        for (const p of this.pieces) {
          if (p.state !== 'on') continue;
          p.mesh.getWorldPosition(tV);
          const h = tV.y - ground;
          const at = (2.0 - h) * (this.ending === 'broken' ? 0.1 : 0.16);
          if (this.endT >= at) this.loosen(p, 0.6 + Math.random() * 0.6, this.ending === 'broken' ? 2.2 : 0.8);
        }
      }
      if (!busy && this.pieces.every((p) => p.state === 'gone')) return false;
    }
    return true;
  }

  private attach(p: Piece): void {
    p.state = 'on';
    p.bone.add(p.mesh);
    p.mesh.position.set(0, 0, 0);
    p.mesh.quaternion.copy(IDQ);
    p.mesh.scale.copy(ONE);
    p.pulse = 0.09;
    const ctx = this.ctx;
    p.mesh.getWorldPosition(tV);
    if (ctx.vfx.quality !== 'low' || p.def.core) ctx.vfx.burst('dust', tV, { count: 2, radius: 0.12, speed: 0.6, size: 0.6 });
    // Clicks as the plates lock on (not every one: they come in a rush).
    if (this.landedSound++ % 3 === 0) ctx.audio.play('bend_stone_block', { position: tV, volume: 0.28, pitch: 1.25 + Math.random() * 0.35 });
  }

  /** Detach a plate and send it tumbling (outward speed, upward speed). */
  private loosen(p: Piece, out: number, up: number): void {
    if (p.state !== 'on' && p.state !== 'flying') return;
    p.mesh.updateWorldMatrix(true, false);
    this.ctx.vfx.group.attach(p.mesh);
    p.state = 'loose';
    p.looseT = 0;
    p.bounced = false;
    this.humanoid.root.getWorldPosition(tW).setY(tW.y + 1.1);
    tV.subVectors(p.mesh.position, tW).setY(0);
    if (tV.lengthSq() < 1e-4) tV.set(Math.random() - 0.5, 0, Math.random() - 0.5);
    tV.normalize();
    p.vel.set(tV.x * out, up, tV.z * out);
    p.spin.set((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9);
  }

  private updateLoose(p: Piece, dt: number): void {
    p.looseT += dt;
    p.vel.y -= GRAV * dt;
    p.mesh.position.addScaledVector(p.vel, dt);
    p.mesh.rotation.x += p.spin.x * dt;
    p.mesh.rotation.y += p.spin.y * dt;
    p.mesh.rotation.z += p.spin.z * dt;
    const g = this.ctx.world.groundAt(p.mesh.position.x, p.mesh.position.z, p.mesh.position.y + 0.5).y;
    if (p.mesh.position.y < g + 0.04 && p.vel.y < 0) {
      p.mesh.position.y = g + 0.04;
      if (!p.bounced && Math.abs(p.vel.y) > 2.5) {
        p.bounced = true;
        p.vel.y = -p.vel.y * 0.28;
        p.vel.x *= 0.45;
        p.vel.z *= 0.45;
        p.spin.multiplyScalar(0.4);
        if (Math.random() < 0.5) this.ctx.audio.play('bend_stone_block', { position: p.mesh.position, volume: 0.22, pitch: 0.7 + Math.random() * 0.3 });
      } else {
        // Settled: break into grit and dust.
        this.crumblePiece(p);
        return;
      }
    }
    if (p.looseT > 2.2) this.crumblePiece(p);
  }

  private crumblePiece(p: Piece): void {
    if (p.state === 'gone') return;
    p.state = 'gone';
    const at = p.mesh.position;
    if (this.ctx.vfx.quality !== 'low' || Math.random() < 0.5) {
      debris(at, 3, { spread: 1.1, speed: 2.4, size: 0.05, color: this.tint, life: 0.9 });
      this.ctx.vfx.burst('dust', at, { count: 3, radius: 0.18, speed: 0.6 });
    }
    p.mesh.removeFromParent();
  }

  /**
   * A blow landed at `at` (world): the nearest plate shudders and sheds grit; `crack` swaps it to
   * its cracked look; `knockOff` sends the nearest breakable plate flying. Returns that plate.
   */
  impact(at: THREE.Vector3, opts: { crack?: boolean; knockOff?: boolean } = {}): ArmorPart | null {
    let best: Piece | null = null;
    let bestD = Infinity;
    let bestLoose: Piece | null = null;
    let bestLooseD = Infinity;
    for (const p of this.pieces) {
      if (p.state !== 'on') continue;
      p.mesh.getWorldPosition(tV);
      // Plates sit around the bone origin: aim at the middle of their bounds.
      const bs = p.mesh.geometry.boundingSphere;
      if (bs) tV.copy(bs.center).applyMatrix4(p.mesh.matrixWorld);
      const dd = tV.distanceToSquared(at);
      if (dd < bestD) {
        bestD = dd;
        best = p;
      }
      if (!p.def.core && dd < bestLooseD) {
        bestLooseD = dd;
        bestLoose = p;
      }
    }
    if (!best) return null;
    best.shudder = 0.12;
    if (opts.crack && !best.cracked) {
      best.cracked = true;
      best.mesh.geometry = shared(`${best.def.key}:cracked`, () => best!.def.build(true));
    }
    debris(at, 2, { spread: 1.2, speed: 3.2, size: 0.05, color: this.tint, life: 0.8 });
    if (opts.knockOff) {
      const p = bestLoose ?? best;
      if (!p.cracked) {
        p.cracked = true;
        p.mesh.geometry = shared(`${p.def.key}:cracked`, () => p.def.build(true));
      }
      this.loosen(p, 2.4 + Math.random() * 1.2, 2.2 + Math.random());
      p.mesh.getWorldPosition(tV);
      this.ctx.vfx.burst('dust', tV, { count: 4, radius: 0.2, speed: 1.2 });
      this.ctx.audio.play('bend_earth_crumble', { position: tV, volume: 0.45, pitch: 1.3 });
      return p.def.part;
    }
    return best.def.part;
  }

  /** Throw every plate outward (the armor's burst). */
  burst(): void {
    if (this.ending !== 'none') return;
    this.ending = 'burst';
    for (const p of this.pieces) {
      if (p.state === 'on' || p.state === 'flying') this.loosen(p, 9 + Math.random() * 4, 2 + Math.random() * 2.5);
      else if (p.state === 'waiting') {
        p.state = 'gone';
        p.mesh.removeFromParent();
      }
    }
  }

  /** The armor ends on its own: plates crack and come away from the top down. */
  crumble(broken = false): void {
    if (this.ending !== 'none') return;
    this.ending = broken ? 'broken' : 'crumble';
    for (const p of this.pieces) {
      if (p.state === 'on' && !p.cracked) {
        p.cracked = true;
        p.mesh.geometry = shared(`${p.def.key}:cracked`, () => p.def.build(true));
      }
      if (p.state === 'flying') this.attach(p);
    }
  }

  dispose(): void {
    if (!this.alive) return;
    this.alive = false;
    for (const p of this.pieces) {
      p.mesh.removeFromParent();
      p.state = 'gone';
    }
  }
}

/** Debug: the plate list for a humanoid (shape keys and bones). */
export function rockArmorParts(h: Humanoid): Array<{ part: ArmorPart; bone: BoneName; core: boolean }> {
  return armorDefs(h).map((d) => ({ part: d.part, bone: d.bone, core: d.core }));
}

/** Tests: build every plate (intact and cracked) for an appearance, uncached. */
export function buildArmorGeometries(appearance: Humanoid['appearance']): Array<{ part: ArmorPart; bone: BoneName; intact: THREE.BufferGeometry; cracked: THREE.BufferGeometry }> {
  return armorDefs({ appearance } as Humanoid).map((d) => ({ part: d.part, bone: d.bone, intact: d.build(false), cracked: d.build(true) }));
}

